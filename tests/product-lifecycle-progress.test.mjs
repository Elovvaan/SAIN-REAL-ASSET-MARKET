import test from 'node:test';
import assert from 'node:assert/strict';
import { scanProductLifecycleProgress } from '../services/product-lifecycle-progress-service.js';

class Domain {
  constructor(records = {}) { this.records = records; }
  list(type) { return structuredClone(this.records[type] || []); }
}

test('scanner reports the first missing stage for a stored True Bill chain', () => {
  const domain = new Domain({
    SRA_INSTRUMENT: [{ instrumentId: 'INS-1', instrumentFamily: 'TRUE_BILL', state: 'ISSUED' }],
    MARKETPLACE_LISTING: [{ listingId: 'LST-1', instrumentId: 'INS-1', state: 'PUBLISHED' }],
    PARTICIPATION_POSITION: [{ positionId: 'PAR-1', listingId: 'LST-1', participantId: 'P-1', state: 'ACTIVE' }],
    FUNDING_MARKETPLACE_COMMITMENT: [{ commitmentId: 'COM-1', listingId: 'LST-1', participantId: 'P-1', state: 'COMMITTED' }],
    FUNDING_MARKETPLACE_POSITION: [],
    SRA_SETTLEMENT_RECORD: [],
    OWNERSHIP_RECOGNITION: [],
    EXPORT_PACKAGE: [],
  });
  const result = scanProductLifecycleProgress(domain, 'TRUE_BILL');
  assert.equal(result.instrumentCount, 1);
  assert.equal(result.furthestStage, 'commitment');
  assert.equal(result.chains[0].firstMissing, 'allocation');
  assert.deepEqual(result.chains[0].completedStages, ['instrument', 'listing', 'participation', 'commitment']);
});

test('scanner recognizes a complete stored export chain', () => {
  const domain = new Domain({
    SRA_INSTRUMENT: [{ instrumentId: 'INS-1', instrumentFamily: 'TRUE_BILL', state: 'ISSUED' }],
    MARKETPLACE_LISTING: [{ listingId: 'LST-1', instrumentId: 'INS-1', state: 'PUBLISHED' }],
    PARTICIPATION_POSITION: [{ positionId: 'PAR-1', listingId: 'LST-1', participantId: 'P-1', state: 'ACTIVE' }],
    FUNDING_MARKETPLACE_COMMITMENT: [{ commitmentId: 'COM-1', listingId: 'LST-1', participantId: 'P-1', state: 'COMMITTED' }],
    FUNDING_MARKETPLACE_POSITION: [{ positionId: 'ALL-1', commitmentId: 'COM-1', listingId: 'LST-1', instrumentId: 'INS-1', participantId: 'P-1', state: 'ALLOCATED' }],
    SRA_SETTLEMENT_RECORD: [{ settlementRecordId: 'SET-1', allocationPositionId: 'ALL-1', instrumentId: 'INS-1', participantId: 'P-1', state: 'SETTLED' }],
    OWNERSHIP_RECOGNITION: [{ ownershipRecognitionId: 'OWN-1', settlementRecordId: 'SET-1', instrumentId: 'INS-1', state: 'RECOGNIZED' }],
    EXPORT_PACKAGE: [{ exportPackageId: 'EXP-1', ownershipRecognitionId: 'OWN-1', state: 'READY_FOR_EXPORT', manifest: { references: { instrument: 'INS-1', ownershipRecognition: 'OWN-1' } } }],
  });
  const result = scanProductLifecycleProgress(domain, 'TRUE_BILL');
  assert.equal(result.furthestStage, 'exportPackage');
  assert.equal(result.chains[0].firstMissing, null);
  assert.equal(result.chains[0].readyForExport, true);
  assert.equal(result.stageCounts.exportPackage, 1);
});
