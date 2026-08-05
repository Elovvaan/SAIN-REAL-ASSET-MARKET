import test from 'node:test';
import assert from 'node:assert/strict';
import { scanProductLifecycleProgress } from '../services/product-lifecycle-progress-service.js';

class MemoryDomain {
  constructor(records = {}) { this.records = records; }
  list(type) { return structuredClone(this.records[type] || []); }
  get(type, id) {
    return structuredClone((this.records[type] || []).find((record) => String(record.id || record.productDefinitionId || record.productCode) === String(id)) || null);
  }
}

test('progress scanner resolves instrument families from active product definition', () => {
  const domain = new MemoryDomain({
    SRA_PRODUCT_DEFINITION: [{ id: 'CUSTOM_BILL', productCode: 'CUSTOM_BILL', instrumentFamilies: ['TRUE_BILL'], state: 'ACTIVE' }],
    SRA_INSTRUMENT: [{ id: 'INS-1', instrumentId: 'INS-1', instrumentFamily: 'TRUE_BILL', state: 'ISSUED' }],
  });

  const result = scanProductLifecycleProgress(domain, 'CUSTOM_BILL');

  assert.equal(result.instrumentCount, 1);
  assert.equal(result.productDefinitionId, 'CUSTOM_BILL');
  assert.deepEqual(result.instrumentFamilies, ['TRUE_BILL']);
  assert.equal(result.chains[0].instrumentFamily, 'TRUE_BILL');
});

test('progress scanner supports multiple configured instrument families', () => {
  const domain = new MemoryDomain({
    SRA_PRODUCT_DEFINITION: [{ id: 'BILL_PORTFOLIO', productCode: 'BILL_PORTFOLIO', instrumentFamilies: ['TRUE_BILL', 'COMMERCIAL_PAPER'], state: 'ACTIVE' }],
    SRA_INSTRUMENT: [
      { id: 'INS-1', instrumentFamily: 'TRUE_BILL' },
      { id: 'INS-2', instrumentFamily: 'COMMERCIAL_PAPER' },
      { id: 'INS-3', instrumentFamily: 'ASSET_BACKED_NOTE' },
    ],
  });

  const result = scanProductLifecycleProgress(domain, 'BILL_PORTFOLIO');

  assert.equal(result.instrumentCount, 2);
  assert.deepEqual(result.instrumentFamilies, ['TRUE_BILL', 'COMMERCIAL_PAPER']);
});

test('progress scanner falls back to product code without an active definition', () => {
  const domain = new MemoryDomain({
    SRA_PRODUCT_DEFINITION: [{ id: 'CUSTOM_BILL', productCode: 'CUSTOM_BILL', instrumentFamilies: ['TRUE_BILL'], state: 'INACTIVE' }],
    SRA_INSTRUMENT: [{ id: 'INS-2', instrumentId: 'INS-2', instrumentFamily: 'CUSTOM_BILL', state: 'ISSUED' }],
  });

  const result = scanProductLifecycleProgress(domain, 'CUSTOM_BILL');

  assert.equal(result.instrumentCount, 1);
  assert.equal(result.productDefinitionId, null);
  assert.deepEqual(result.instrumentFamilies, ['CUSTOM_BILL']);
});
