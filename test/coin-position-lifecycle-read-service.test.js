import test from 'node:test';
import assert from 'node:assert/strict';
import { CoinPositionLifecycleReadService } from '../services/coin-position-lifecycle-read-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor(seed = {}) { this.seed = seed; }
  list(type) { return structuredClone(this.seed[type] || []); }
}

test('Coin Position lifecycle aggregate reads beyond the admin 100-record display cap', () => {
  const financialRecords = [];
  const coinPositions = [];
  for (let i = 1; i <= 150; i += 1) {
    financialRecords.push({ financialRecordId:`FR-${i}`, recognizedPosition:{ amount:1, unit:'USD' } });
    coinPositions.push({ coinPositionId:`CP-${i}`, financialRecordId:`FR-${i}`, symbol:'SRA', quantity:1, availableQuantity:1, state:'REPRESENTED', sourcePosition:{ amount:0.001, unit:'BTC' }, recordedValue:{ amount:1, currency:'USD' } });
  }
  const service = new CoinPositionLifecycleReadService(new Domain({
    [RECORD_TYPES.FINANCIAL_RECORD]: financialRecords,
    [RECORD_TYPES.COIN_POSITION]: coinPositions,
    [RECORD_TYPES.COIN_ACCOUNT]: [{ coinAccountId:'CA-1', symbol:'SRA', representedQuantity:150 }],
    [RECORD_TYPES.LIFECYCLE_EVENT]: [],
  }));
  const result = service.read();
  assert.equal(result.completePersistentDomainRead, true);
  assert.equal(result.counts.coinPositionCount, 150);
  assert.equal(result.counts.financialRecordCount, 150);
  assert.equal(result.supply.activeSra, 150);
  assert.equal(result.supply.recognizedUsd, 150);
  assert.equal(result.reconciliation.missingUsdBasisCount, 0);
});

test('segmented child positions do not create represented supply or a second par test', () => {
  const parent = { coinPositionId:'CP-1', financialRecordId:'FR-1', symbol:'SRA', quantity:1000, availableQuantity:875, state:'REPRESENTED', segmentationState:'SEGMENTED', childPositionIds:['CP-1-SEG-0001'], sourcePosition:{ amount:1, unit:'BTC' }, recordedValue:{ amount:1000, currency:'USD' } };
  const child = { ...parent, coinPositionId:'CP-1-SEG-0001', positionId:'CP-1-SEG-0001', id:'CP-1-SEG-0001', parentPositionId:'CP-1', sourcePositionId:'CP-1', quantity:125, availableQuantity:125, childPositionIds:[], segmentationState:'ACTIVE_CHILD' };
  const service = new CoinPositionLifecycleReadService(new Domain({
    [RECORD_TYPES.FINANCIAL_RECORD]: [{ financialRecordId:'FR-1', recognizedPosition:{ amount:1000, unit:'USD' } }],
    [RECORD_TYPES.COIN_POSITION]: [parent, child],
    [RECORD_TYPES.COIN_ACCOUNT]: [{ coinAccountId:'CA-1', symbol:'SRA', representedQuantity:1000 }],
    [RECORD_TYPES.LIFECYCLE_EVENT]: [],
  }));
  const result = service.read();
  assert.equal(result.supply.activeSra, 1000);
  assert.equal(result.supply.availableSra, 1000);
  assert.equal(result.supply.accountIssuedSra, 1000);
  assert.equal(result.supply.recognizedUsd, 1000);
  assert.equal(result.reconciliation.rootPositionCount, 1);
  assert.equal(result.reconciliation.derivativePositionCount, 1);
  assert.equal(result.reconciliation.mismatchCount, 0);
  assert.equal(result.reconciliation.parDeltaSra, 0);
});
