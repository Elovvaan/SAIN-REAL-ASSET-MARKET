import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectValueAccountService } from '../services/direct-value-account-service.js';
import { NativeAssetExchangeService } from '../services/native-asset-exchange-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return payload; }
  async atomicPut(changes) { for (const change of changes) await this.put(change.type, change.id, change.payload); return changes.map((change) => change.payload); }
}

class Transfers {
  constructor(result = null, error = null) { this.result = result; this.error = error; this.records = new Map(); this.calls = []; }
  get(id) { return this.records.get(id) || null; }
  async send(input) {
    this.calls.push(input);
    if (this.error) throw this.error;
    const record = this.result || { transferId: input.transferId, transactionId: 'TX-VALIDATED-1', state: 'CONFIRMED', confirmation: { state: 'CONFIRMED', validated: true } };
    this.records.set(input.transferId, record);
    return record;
  }
  async reconcile(id) { return this.records.get(id); }
}

async function fixture({ transferResult = null, transferError = null } = {}) {
  const domain = new Domain();
  const directAccounts = new DirectValueAccountService(domain);
  await directAccounts.initialize();
  await domain.put(RECORD_TYPES.SRA_TRANSACTION, 'LFA-1', {
    transactionId: 'LFA-1', transactionType: 'LOAN_FINANCING_AUTHORIZATION', borrowerParticipantId: 'P-1', amount: 100, currency: 'USD', state: 'POSTED',
  });
  const funding = await directAccounts.creditAuthorizedFunding({ financingTransactionId: 'LFA-1', universalAccountId: 'UA-1' }, 'ADMIN');
  const observedAt = new Date().toISOString();
  await domain.put(RECORD_TYPES.MARKET_OBSERVATION, 'OBS-XRP', {
    observationId: 'OBS-XRP', sourceMarket: 'COINBASE', sourceRecordType: 'MARKET_TRADE', sourceTimestamp: observedAt, observedAt,
    rawValues: { productId: 'XRP-USD', price: 2 },
  });
  await domain.put(RECORD_TYPES.MARKET_OBSERVATION, 'OBS-XLM', {
    observationId: 'OBS-XLM', sourceMarket: 'COINBASE', sourceRecordType: 'MARKET_TRADE', sourceTimestamp: observedAt, observedAt,
    rawValues: { productId: 'XLM-USD', price: 0.25 },
  });
  const transfers = new Transfers(transferResult, transferError);
  const service = new NativeAssetExchangeService({ domain, directAccounts, transfers });
  return { domain, directAccounts, funding, transfers, service };
}

test('verified XRP exchange locks SRA/USD, sends XRP, and debits only after confirmation', async () => {
  const { directAccounts, funding, transfers, service } = await fixture();
  const quote = await service.quote({ directValueAccountId: funding.account.directValueAccountId, fromAmount: 20, toAsset: 'XRP', destinationAddress: 'rDestination' }, 'ADMIN');
  assert.equal(quote.toAmount, 10);
  assert.equal(quote.observationId, 'OBS-XRP');
  const result = await service.execute({ quoteId: quote.quoteId }, 'ADMIN');
  assert.equal(result.exchange.state, 'COMPLETED');
  assert.equal(result.exchange.transactionId, 'TX-VALIDATED-1');
  assert.deepEqual(transfers.calls[0], {
    transferId: result.exchange.transferId, network: 'XRPL', asset: 'XRP', amount: '10', destinationAddress: 'rDestination',
  });
  const source = directAccounts.getPosition(funding.account.directValueAccountId, 'SRA-USD');
  assert.equal(source.available, 80);
  assert.equal(source.restricted, 0);
  assert.equal(source.total, 80);
  assert.equal(directAccounts.movements(funding.account.directValueAccountId)[0].transactionId, 'TX-VALIDATED-1');
});

test('definite transfer failure unlocks the SRA/USD balance', async () => {
  const { directAccounts, funding, service } = await fixture({ transferError: new Error('destination rejected before broadcast') });
  const quote = await service.quote({ directValueAccountId: funding.account.directValueAccountId, fromAmount: 10, toAsset: 'XLM', destinationAddress: 'GDESTINATION' }, 'ADMIN');
  await assert.rejects(() => service.execute({ quoteId: quote.quoteId }, 'ADMIN'), /destination rejected/);
  const source = directAccounts.getPosition(funding.account.directValueAccountId, 'SRA-USD');
  assert.equal(source.available, 100);
  assert.equal(source.restricted, 0);
  assert.equal(source.total, 100);
});

test('submitted but unconfirmed transfer keeps SRA/USD locked for reconciliation', async () => {
  const pendingTransfer = { transactionId: 'TX-PENDING-1', state: 'SUBMITTED', confirmation: { state: 'PENDING' } };
  const { directAccounts, funding, service } = await fixture({ transferResult: pendingTransfer });
  const quote = await service.quote({ directValueAccountId: funding.account.directValueAccountId, fromAmount: 10, toAsset: 'XLM', destinationAddress: 'GDESTINATION' }, 'ADMIN');
  const result = await service.execute({ quoteId: quote.quoteId }, 'ADMIN');
  assert.equal(result.exchange.state, 'RECONCILIATION_REQUIRED');
  const source = directAccounts.getPosition(funding.account.directValueAccountId, 'SRA-USD');
  assert.equal(source.available, 90);
  assert.equal(source.restricted, 10);
  assert.equal(source.total, 100);
});

test('reconciliation completes a later-confirmed transfer and consumes the lock once', async () => {
  const pendingTransfer = { transactionId: 'TX-PENDING-2', state: 'SUBMITTED', confirmation: { state: 'PENDING' } };
  const { directAccounts, funding, transfers, service } = await fixture({ transferResult: pendingTransfer });
  const quote = await service.quote({ directValueAccountId: funding.account.directValueAccountId, fromAmount: 10, toAsset: 'XLM', destinationAddress: 'GDESTINATION' }, 'ADMIN');
  const pending = await service.execute({ quoteId: quote.quoteId }, 'ADMIN');
  transfers.records.set(pending.exchange.transferId, { ...pendingTransfer, state: 'CONFIRMED', confirmation: { state: 'CONFIRMED' } });
  const result = await service.reconcile(pending.exchange.exchangeId, 'ADMIN');
  assert.equal(result.exchange.state, 'COMPLETED');
  assert.equal(result.reconciled, true);
  const source = directAccounts.getPosition(funding.account.directValueAccountId, 'SRA-USD');
  assert.equal(source.available, 90);
  assert.equal(source.restricted, 0);
  assert.equal(source.total, 90);
});

test('validated failed transaction releases the locked SRA/USD balance', async () => {
  const failedTransfer = { transactionId: 'TX-FAILED-1', state: 'FAILED', confirmation: { state: 'FAILED', validated: true } };
  const { directAccounts, funding, service } = await fixture({ transferResult: failedTransfer });
  const quote = await service.quote({ directValueAccountId: funding.account.directValueAccountId, fromAmount: 10, toAsset: 'XRP', destinationAddress: 'rDestination' }, 'ADMIN');
  await assert.rejects(() => service.execute({ quoteId: quote.quoteId }, 'ADMIN'), /validated as failed/);
  const source = directAccounts.getPosition(funding.account.directValueAccountId, 'SRA-USD');
  assert.equal(source.available, 100);
  assert.equal(source.restricted, 0);
  assert.equal(source.total, 100);
});

test('quotes reject stale market observations', async () => {
  const { domain, funding, service } = await fixture();
  const old = domain.get(RECORD_TYPES.MARKET_OBSERVATION, 'OBS-XRP');
  old.sourceTimestamp = new Date(Date.now() - 300000).toISOString();
  await domain.put(RECORD_TYPES.MARKET_OBSERVATION, 'OBS-XRP', old);
  await assert.rejects(() => service.quote({ directValueAccountId: funding.account.directValueAccountId, fromAmount: 20, toAsset: 'XRP' }, 'ADMIN'), /stale/);
});
