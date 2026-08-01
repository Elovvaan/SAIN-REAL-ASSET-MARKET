import crypto from 'node:crypto';
import { CustodyRecord, DischargeRecord } from '../domain/index.js';

const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class InstitutionalCustodyService {
  constructor() {
    this.custodyRecords = new Map();
    this.dischargeRecords = new Map();
    this.collateralSchedules = new Map();
    this.seed();
  }

  seed() {
    const custody = new CustodyRecord({
      id: 'CR-A-3104-001', filingNumber: 'CR-2026-000145', assetId: 'A-3104',
      evidencePackageId: 'EP-A-3104-001', documentIds: ['DOC-DEED-3104', 'DOC-INSPECTION-3104'],
      custodyType: 'HYBRID', custodyStatus: 'HELD', storageLocation: 'PRIVATE_VAULT / SHELF-3104',
      accessClass: 'INSTITUTIONAL_RESTRICTED', collateralState: 'ELIGIBILITY_REVIEW',
      collateralScheduleId: 'CS-2026-00031',
      chainOfCustody: [
        { position: 1, action: 'EVIDENCE_RECEIVED', actorId: 'V4V', at: '2026-08-01T16:00:00.000Z', details: { source: 'V4V Exchange' } },
        { position: 2, action: 'CUSTODY_ACCEPTED', actorId: 'SRA-CUSTODY', at: '2026-08-01T16:10:00.000Z', details: { accessClass: 'INSTITUTIONAL_RESTRICTED' } },
        { position: 3, action: 'COLLATERAL_REVIEW_OPENED', actorId: 'SANE', at: '2026-08-01T16:20:00.000Z', details: { scheduleId: 'CS-2026-00031' } }
      ]
    });
    custody.hash = hash(custody);
    this.custodyRecords.set(custody.id, custody);

    this.collateralSchedules.set('CS-2026-00031', {
      id: 'CS-2026-00031', filingNumber: 'CS-2026-000031', status: 'INTERNAL_REVIEW',
      assetIds: ['A-3104'], custodyRecordIds: ['CR-A-3104-001'], grossVerifiedValue: 2480000,
      lendableValue: null, haircut: null, designatedAmount: 505000,
      controls: { documentsControlled: true, conflictingClaimReview: 'PENDING', automatedIdentification: true, reportingState: 'NOT_REPORTED' },
      note: 'Internal collateral schedule. It does not represent Federal Reserve acceptance or a completed pledge.'
    });

    const discharge = new DischargeRecord({
      id: 'DR-C-0033-001', filingNumber: 'DR-2026-000044', assetId: 'A-3104', projectId: 'SRA-RE-0033',
      instrumentIds: ['TB-0033'], positionType: 'PLATFORM_COMPLETION_POSITION', openingAmount: 98000,
      method: 'COMBINATION', valueApplied: 68000, setoffApplied: 20000, releasedAmount: 10000,
      remainingAmount: 0, settlementRecordIds: ['SR-0033-001'], verifiedValuePackageIds: ['VVP-3104-001'], state: 'DISCHARGED'
    });
    discharge.postedAt = '2026-08-01T17:00:00.000Z'; discharge.hash = hash(discharge);
    this.dischargeRecords.set(discharge.id, discharge);
  }

  snapshot() {
    return {
      metrics: {
        custodyRecords: this.custodyRecords.size,
        restrictedDocuments: [...this.custodyRecords.values()].reduce((n, r) => n + r.documentIds.length, 0),
        collateralSchedules: this.collateralSchedules.size,
        dischargedPositions: [...this.dischargeRecords.values()].filter((r) => r.state === 'DISCHARGED').length
      },
      workflow: ['V4V_SUBMITTED', 'EVIDENCE_PACKAGE', 'CUSTODY_ACCEPTED', 'INSTITUTIONAL_REVIEW', 'VERIFIED_VALUE_PACKAGE', 'COLLATERAL_SCHEDULE', 'CAPITAL_DEPLOYMENT', 'SETTLEMENT', 'SETOFF', 'DISCHARGE', 'RELEASE_OR_CONTINUED_CUSTODY'],
      custodyRecords: [...this.custodyRecords.values()],
      collateralSchedules: [...this.collateralSchedules.values()],
      dischargeRecords: [...this.dischargeRecords.values()],
      policy: {
        customerFacing: ['V4V status', 'Institutional review status', 'Verified Value status', 'Approved marketplace representation'],
        internalOnly: ['document location', 'chain of custody', 'collateral schedule', 'pledge designation', 'lendable value', 'haircut', 'capital utilization', 'setoff', 'discharge filing'],
        filingSequence: ['EP', 'CR', 'VVP', 'AA', 'TB', 'CS', 'SR', 'DR']
      }
    };
  }
}
