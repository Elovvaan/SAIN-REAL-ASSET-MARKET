import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectValueAccountService } from '../services/direct-value-account-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return payload; }
  async atomicPut(changes) { for (const change of changes) await this.put(change.type, change.id, change.payload); return changes.map((change) => change.payload); }
}

async function fixture(amount = 30000) {
  const domain = new Domain();
  const service = new DirectValueAccountService(domain);
  await service.initialize();
  await domain.put(RECORD_TYPES.SRA_TRANSACTION, 'LFA-1', {
    transactionId: 'LFA-1', transactionType: 'LOAN_FINANCING_AUTHORIZATION', borrowerParticipantId: 'P-1', amount, currency: 'USD', state: 'POSTED',
  });
  return { domain, service };
}

test('authorized financing credits native SRA/USD without consuming treasury or participant assets', async () => {
  const { service } = await fixture();
  const result = await service.creditAuthorizedFunding({ financingTransactionId: 'LFA-1', universalAccountId: 'UA-1' }, 'ADMIN');
  assert.equal(result.position.canonicalAssetId, 'SRA-USD');
  assert.equal(result.position.available, 30000);
  assert.equal(result.account.participantAssetsFundOrigination, false);
  const again = await service.creditAuthorizedFunding({ financingTransactionId: 'LFA-1', universalAccountId: 'UA-1' }, 'ADMIN');
  assert.equal(again.created, false);
  assert.equal(again.position.available, 30000);
});

test('confirmed external deposits retain their original asset and cannot be credited twice', async () => {
  const { service } = await fixture();
  const account = await service.ensureAccount({ participantId: 'P-1', universalAccountId: 'UA-1' });
  const input = { directValueAccountId: account.directValueAccountId, network: 'SOLANA', symbol: 'SOL', amount: 12.5, transactionId: 'SIG-1', custodyReference: 'VAULT-SOL-1' };
  const first = await service.recordExternalDeposit(input, 'ADMIN');
  const second = await service.recordExternalDeposit(input, 'ADMIN');
  assert.equal(first.position.canonicalAssetId, 'SOLANA-SOL');
  assert.equal(first.position.available, 12.5);
  assert.equal(second.created, false);
  assert.equal(second.position.available, 12.5);
});

test('recorded conversion cannot complete from a typed execution reference', async () => {
  const { service } = await fixture();
  const funding = await service.creditAuthorizedFunding({ financingTransactionId: 'LFA-1', universalAccountId: 'UA-1' }, 'ADMIN');
  await assert.rejects(() => service.convert({
    directValueAccountId: funding.account.directValueAccountId,
    fromAssetId: 'SRA-USD', fromNetwork: 'NATIVE', fromAmount: 10000,
    toAssetId: 'BITCOIN-BTC', toNetwork: 'BITCOIN', toSymbol: 'BTC', toAmount: 0.125,
    executionReference: 'EXCHANGE-1', custodyReference: 'BTC-VAULT-1', pricingSource: 'EXECUTED_QUOTE',
  }, 'P-1'), /verified native-asset exchange quote/i);
  assert.equal(service.getPosition(funding.account.directValueAccountId, 'SRA-USD').available, 30000);
});

test('confirmed public-rail movement cannot duplicate native SRA/USD', async () => {
  const { service } = await fixture();
  const funding = await service.creditAuthorizedFunding({ financingTransactionId: 'LFA-1', universalAccountId: 'UA-1' }, 'ADMIN');
  await service.registerRailRepresentation({ canonicalAssetId: 'SRA-USD', network: 'STELLAR', networkAssetCode: 'SRAUSD', networkAssetIdentifier: 'SRAUSD:GISSUER' }, 'ADMIN');
  const result = await service.recordConfirmedRailMovement({
    directValueAccountId: funding.account.directValueAccountId, canonicalAssetId: 'SRA-USD', direction: 'OUTBOUND', amount: 10000,
    publicNetwork: 'STELLAR', transactionId: 'STELLAR-TX-1', destinationAddress: 'GDESTINATION', heldInSraCustody: false,
  }, 'ADMIN');
  assert.equal(result.nativePosition.available, 20000);
  assert.equal(result.movement.amount, 10000);
  const duplicate = await service.recordConfirmedRailMovement({
    directValueAccountId: funding.account.directValueAccountId, canonicalAssetId: 'SRA-USD', direction: 'OUTBOUND', amount: 10000,
    publicNetwork: 'STELLAR', transactionId: 'STELLAR-TX-1', destinationAddress: 'GDESTINATION', heldInSraCustody: false,
  }, 'ADMIN');
  assert.equal(duplicate.created, false);
  assert.equal(service.getPosition(funding.account.directValueAccountId, 'SRA-USD').available, 20000);
});

test('repayment becomes an institutional-growth receipt and does not restore origination capacity', async () => {
  const { service } = await fixture();
  const result = await service.recordRepayment({ financingTransactionId: 'LFA-1', amount: 12000, settlementReference: 'SETTLED-1' }, 'ADMIN');
  assert.equal(result.receipt.remainingAfter, 18000);
  assert.equal(result.receipt.institutionalUse, 'PLATFORM_OPERATION_AND_GROWTH');
  assert.equal(result.receipt.originationFundingUse, 'PROHIBITED_BY_ACCOUNT_ARCHITECTURE');
});

test('authorized forgiveness releases only the remaining obligation and creates a reporting determination', async () => {
  const { service } = await fixture();
  await service.recordRepayment({ financingTransactionId: 'LFA-1', amount: 12000, settlementReference: 'SETTLED-1' }, 'ADMIN');
  const result = await service.releaseObligation({
    financingTransactionId: 'LFA-1', authorization: 'APPROVE_RELEASE', decisionRationale: 'The obligation reached its economically complete state.',
  }, 'ADMIN');
  assert.equal(result.release.repaidAmount, 12000);
  assert.equal(result.release.releasedAmount, 18000);
  assert.equal(result.release.state, 'RELEASED');
  assert.equal(result.release.informationReportingState, 'DETERMINATION_REQUIRED');
});
