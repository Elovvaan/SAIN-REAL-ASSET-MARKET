import test from 'node:test';
import assert from 'node:assert/strict';
import { TreasuryLedgerService } from '../services/treasury-ledger-service.js';
import { RecordedValueRepresentationService } from '../services/recorded-value-representation-service.js';

test('treasury and recorded-value production services are exported', () => {
  assert.equal(typeof TreasuryLedgerService, 'function');
  assert.equal(typeof RecordedValueRepresentationService, 'function');
});
