import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentMarketplaceService } from '../services/persistent-marketplace-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

function domain(records = {}) {
  return {
    list(type) {
      return records[type] || [];
    }
  };
}

test('transaction market is ready when no transaction records exist', () => {
  const marketplace = new PersistentMarketplaceService(domain(), {});
  const snapshot = marketplace.snapshot();

  assert.equal(snapshot.transactionMarket.status, 'READY');
  assert.equal(snapshot.transactionMarket.transactionCount, 0);
  assert.equal(snapshot.transactionMarket.totalVolume, 0);
  assert.deepEqual(snapshot.transactionMarket.recentTransactions, []);
});

test('transaction market normalizes and measures existing SRA records', () => {
  const marketplace = new PersistentMarketplaceService(domain({
    [RECORD_TYPES.LEDGER_ENTRY]: [
      {
        entryId: 'LE-100',
        transactionType: 'CAPITAL_SUBSCRIPTION',
        state: 'POSTED',
        amount: 25000,
        currency: 'USD',
        postedAt: '2026-08-03T20:00:00.000Z',
        debitAccountId: 'AV-100',
        creditAccountId: 'OFFERING-001'
      }
    ],
    [RECORD_TYPES.SRA_SETTLEMENT]: [
      {
        settlementId: 'SET-100',
        status: 'PENDING',
        settlementAmount: 5000,
        currency: 'USD',
        createdAt: '2026-08-03T20:05:00.000Z'
      }
    ],
    [RECORD_TYPES.VERIFIED_MARKET_EVENT]: [
      {
        eventId: 'VME-100',
        eventType: 'PAYMENT_RECEIVED',
        amount: 10000,
        currency: 'USD',
        occurredAt: '2026-08-03T20:10:00.000Z',
        assetId: 'A-100'
      }
    ]
  }), {});

  const market = marketplace.transactionMarket;

  assert.equal(market.status, 'ACTIVE');
  assert.equal(market.transactionCount, 3);
  assert.equal(market.completedTransactionCount, 1);
  assert.equal(market.pendingTransactionCount, 1);
  assert.equal(market.verifiedTransactionCount, 1);
  assert.equal(market.totalVolume, 25000);
  assert.equal(market.verifiedVolume, 10000);
  assert.equal(market.averageTransactionSize, 25000);
  assert.equal(market.latestOccurredAt, '2026-08-03T20:10:00.000Z');
  assert.equal(market.recentTransactions[0].transactionId, 'VME-100');
  assert.equal(market.recentTransactions[0].verified, true);
  assert.deepEqual(market.volumeByKind.PAYMENT_RECEIVED, { count: 1, volume: 10000 });
});
