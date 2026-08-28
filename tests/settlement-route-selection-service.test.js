import test from 'node:test';
import assert from 'node:assert/strict';
import { SettlementRouteSelectionService } from '../services/settlement-route-selection-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  async hydrate() {}
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }
  async put(type, id, payload) { this.records.set(this.key(type, id), payload); return payload; }
  async atomicPut(changes) { for (const change of changes) await this.put(change.type, change.id, change.payload); }
}

async function fixture() {
  const domain = new MemoryDomain();
  await domain.put('FINANCING_CLOSING', 'FCL-1', { closingId: 'FCL-1', beneficiaryName: 'Seller', status: 'AUTHORIZED' });
  await domain.put('FINANCING_DISBURSEMENT', 'FDB-1', { disbursementId: 'FDB-1', closingId: 'FCL-1', status: 'AUTHORIZED', settledAt: null });
  await domain.put('EXPORT_PACKAGE', 'EXP-FDB-1', {
    exportPackageId: 'EXP-FDB-1', exportKind: 'FINANCING_DISBURSEMENT', closingId: 'FCL-1', disbursementId: 'FDB-1',
    financingTransactionId: 'TX-1', opportunityId: 'OPP-1', instrumentId: 'INS-1', participantId: 'P-1', beneficiaryName: 'Seller', amount: 650000, currency: 'USD', externalSettlementReference: null,
  });
  const service = new SettlementRouteSelectionService(domain);
  await service.initialize();
  return { domain, service };
}

test('exposes all three SRA settlement route families', async () => {
  const { service } = await fixture();
  assert.deepEqual(service.availableRoutes().map((entry) => entry.route), ['DIRECT_SETTLEMENT', 'ESCROW_CUSTODIAL_SETTLEMENT', 'ON_CHAIN_SETTLEMENT']);
});

test('persists direct settlement selection on the export package', async () => {
  const { domain, service } = await fixture();
  const result = await service.select('EXP-FDB-1', { route: 'DIRECT_SETTLEMENT' }, 'ADMIN');
  assert.equal(result.selection.route, 'DIRECT_SETTLEMENT');
  assert.equal(domain.get('EXPORT_PACKAGE', 'EXP-FDB-1').settlementRoute, 'DIRECT_SETTLEMENT');
});

test('escrow route creates a transaction-specific escrow file', async () => {
  const { service } = await fixture();
  const result = await service.select('EXP-FDB-1', {
    route: 'ESCROW_CUSTODIAL_SETTLEMENT',
    escrowRoute: 'FIAT_ESCROW',
    escrowAgentName: 'Independent Escrow',
    releaseConditions: ['Executed acquisition documents', 'Seller delivery condition satisfied'],
    returnConditions: ['Closing fails before release'],
  }, 'ADMIN');
  assert.equal(result.selection.route, 'ESCROW_CUSTODIAL_SETTLEMENT');
  assert.equal(result.escrowSettlement.status, 'INSTRUCTIONS_PREPARED');
  assert.equal(result.escrowSettlement.amount, 650000);
});

test('does not default an on-chain settlement to a network', async () => {
  const { service } = await fixture();
  const result = await service.select('EXP-FDB-1', { route: 'ON_CHAIN_SETTLEMENT' }, 'ADMIN');
  assert.equal(result.selection.route, 'ON_CHAIN_SETTLEMENT');
  assert.equal(result.selection.network, null);
});

test('on-chain settlement preserves the chosen stable settlement asset', async () => {
  const { domain, service } = await fixture();
  const result = await service.select('EXP-FDB-1', {
    route: 'ON_CHAIN_SETTLEMENT',
    settlementAsset: 'SRA_USD',
    network: 'STELLAR',
  }, 'ADMIN');
  assert.equal(result.selection.settlementAsset, 'SRA_USD');
  assert.equal(result.selection.network, 'STELLAR');
  assert.equal(domain.get('EXPORT_PACKAGE', 'EXP-FDB-1').settlementAsset, 'SRA_USD');
});

test('route selection is immutable once chosen', async () => {
  const { service } = await fixture();
  await service.select('EXP-FDB-1', { route: 'DIRECT_SETTLEMENT' }, 'ADMIN');
  await assert.rejects(() => service.select('EXP-FDB-1', { route: 'ON_CHAIN_SETTLEMENT' }, 'ADMIN'), /already selected/);
});

test('route selection is locked after external settlement', async () => {
  const { domain, service } = await fixture();
  const pkg = domain.get('EXPORT_PACKAGE', 'EXP-FDB-1');
  await domain.put('EXPORT_PACKAGE', 'EXP-FDB-1', { ...pkg, externalSettlementReference: 'WIRE-1' });
  await assert.rejects(() => service.select('EXP-FDB-1', { route: 'DIRECT_SETTLEMENT' }, 'ADMIN'), /locked after external settlement/);
});
