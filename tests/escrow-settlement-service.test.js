import test from 'node:test';
import assert from 'node:assert/strict';
import { EscrowSettlementService } from '../services/escrow-settlement-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  async hydrate() {}
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }
  async put(type, id, payload) { this.records.set(this.key(type, id), payload); return payload; }
}

async function fixture() {
  const domain = new MemoryDomain();
  await domain.put('FINANCING_CLOSING', 'FCL-1', { closingId: 'FCL-1', beneficiaryName: 'Seller', status: 'AUTHORIZED' });
  await domain.put('FINANCING_DISBURSEMENT', 'FDB-1', { disbursementId: 'FDB-1', closingId: 'FCL-1', status: 'AUTHORIZED' });
  await domain.put('EXPORT_PACKAGE', 'EXP-FDB-1', {
    exportPackageId: 'EXP-FDB-1', exportKind: 'FINANCING_DISBURSEMENT', closingId: 'FCL-1', disbursementId: 'FDB-1',
    financingTransactionId: 'TX-1', opportunityId: 'OPP-1', instrumentId: 'INS-1', participantId: 'P-1', beneficiaryName: 'Seller', amount: 650000, currency: 'USD',
  });
  return { domain, service: new EscrowSettlementService(domain) };
}

test('prepares fiat escrow only from an authoritative financing disbursement', async () => {
  const { service } = await fixture();
  const result = await service.prepare({ exportPackageId: 'EXP-FDB-1', route: 'FIAT_ESCROW', escrowAgentName: 'Independent Escrow', releaseConditions: ['Executed closing documents', 'Seller delivery condition satisfied'] }, 'ADMIN');
  assert.equal(result.created, true);
  assert.equal(result.settlement.status, 'INSTRUCTIONS_PREPARED');
  assert.equal(result.settlement.settlementAsset, 'USD');
  assert.equal(result.settlement.amount, 650000);
});

test('requires an identified digital settlement asset for digital escrow', async () => {
  const { service } = await fixture();
  await assert.rejects(() => service.prepare({ exportPackageId: 'EXP-FDB-1', route: 'DIGITAL_ASSET_ESCROW', escrowAgentName: 'Digital Custodian', releaseConditions: ['Closing condition satisfied'] }, 'ADMIN'), /settlementAsset is required/);
});

test('does not permit release without external evidence', async () => {
  const { service } = await fixture();
  const { settlement } = await service.prepare({ exportPackageId: 'EXP-FDB-1', route: 'FIAT_ESCROW', escrowAgentName: 'Independent Escrow', releaseConditions: ['Closing condition satisfied'] }, 'ADMIN');
  await service.transition(settlement.escrowSettlementId, { status: 'ACKNOWLEDGED' }, 'ESCROW');
  await service.transition(settlement.escrowSettlementId, { status: 'ASSET_IN_ESCROW', evidenceReference: 'CUSTODY-RECEIPT-1' }, 'ESCROW');
  await service.transition(settlement.escrowSettlementId, { status: 'READY_FOR_RELEASE', evidenceReference: 'CONDITIONS-1' }, 'ESCROW');
  await assert.rejects(() => service.transition(settlement.escrowSettlementId, { status: 'RELEASED' }, 'ESCROW'), /external evidence reference/);
});

test('records release evidence without declaring Phase 4 verification', async () => {
  const { service } = await fixture();
  const { settlement } = await service.prepare({ exportPackageId: 'EXP-FDB-1', route: 'FIAT_ESCROW', escrowAgentName: 'Independent Escrow', releaseConditions: ['Closing condition satisfied'] }, 'ADMIN');
  await service.transition(settlement.escrowSettlementId, { status: 'ACKNOWLEDGED' }, 'ESCROW');
  await service.transition(settlement.escrowSettlementId, { status: 'ASSET_IN_ESCROW', evidenceReference: 'CUSTODY-1' }, 'ESCROW');
  await service.transition(settlement.escrowSettlementId, { status: 'READY_FOR_RELEASE', evidenceReference: 'READY-1' }, 'ESCROW');
  const released = await service.transition(settlement.escrowSettlementId, { status: 'RELEASED', evidenceReference: 'RELEASE-1', releaseReference: 'WIRE-OR-CHAIN-REFERENCE' }, 'ESCROW');
  assert.equal(released.status, 'RELEASED');
  assert.equal(released.releaseReference, 'WIRE-OR-CHAIN-REFERENCE');
  assert.equal('verified', Object.fromEntries(Object.entries(released).map(([key, value]) => [key.toLowerCase(), value])), false);
});
