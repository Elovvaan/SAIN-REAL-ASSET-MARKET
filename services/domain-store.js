import {
  AssetAccount,
  Completion,
  LifecycleRecord,
  MarketplaceProject,
  Participant,
  TrueBill,
  VerifiedValuePackage
} from '../domain/index.js';

export class DomainStore {
  constructor() {
    this.participants = new Map();
    this.assets = new Map();
    this.lifecycleRecords = new Map();
    this.verifiedValuePackages = new Map();
    this.trueBills = new Map();
    this.projects = new Map();
    this.completions = new Map();
  }

  addParticipant(input) { const entity = new Participant(input); this.participants.set(entity.id, entity); return entity; }
  addAsset(input) { const entity = new AssetAccount(input); this.assets.set(entity.id, entity); return entity; }
  addLifecycleRecord(input) { const entity = new LifecycleRecord(input); this.lifecycleRecords.set(entity.id, entity); return entity; }
  addVerifiedValuePackage(input) { const entity = new VerifiedValuePackage(input); this.verifiedValuePackages.set(entity.id, entity); return entity; }
  addTrueBill(input) { const entity = new TrueBill(input); this.trueBills.set(entity.id, entity); return entity; }
  addProject(input) { const entity = new MarketplaceProject(input); this.projects.set(entity.id, entity); return entity; }
  addCompletion(input) { const entity = new Completion(input); this.completions.set(entity.id, entity); return entity; }

  getAssetStudio(assetId) {
    const asset = this.assets.get(assetId);
    if (!asset) return null;
    return {
      asset,
      lifecycle: this.lifecycleRecords.get(asset.lifecycleRecordId) || null,
      verifiedValuePackages: asset.verifiedValuePackageIds.map((id) => this.verifiedValuePackages.get(id)).filter(Boolean),
      projects: asset.projectIds.map((id) => this.projects.get(id)).filter(Boolean),
      trueBills: asset.trueBillIds.map((id) => this.trueBills.get(id)).filter(Boolean),
      completions: asset.completionIds.map((id) => this.completions.get(id)).filter(Boolean)
    };
  }

  snapshot() {
    return {
      participants: [...this.participants.values()],
      assets: [...this.assets.values()],
      lifecycleRecords: [...this.lifecycleRecords.values()],
      verifiedValuePackages: [...this.verifiedValuePackages.values()],
      trueBills: [...this.trueBills.values()],
      projects: [...this.projects.values()],
      completions: [...this.completions.values()]
    };
  }
}

export function createSeededDomainStore() {
  const store = new DomainStore();

  store.addParticipant({ id: 'P-OWNER-001', displayName: 'North District Holdings', type: 'ORGANIZATION', roles: ['ASSET_OWNER', 'PROJECT_OPERATOR'] });
  store.addParticipant({ id: 'P-CAP-014', displayName: 'Marketplace Capital Position 14', type: 'ORGANIZATION', roles: ['CAPITAL_PARTICIPANT'] });
  store.addParticipant({ id: 'P-SRA-COMP', displayName: 'SRA Completion Participant', type: 'PLATFORM', roles: ['COMPLETION_PARTICIPANT'] });

  store.addLifecycleRecord({ id: 'LR-A-1042', assetId: 'A-1042', events: [{ id: 'LR-A-1042-EV-1', type: 'ASSET_REGISTERED', recordedAt: '2026-08-01T15:00:00.000Z' }] });
  store.addLifecycleRecord({ id: 'LR-A-2088', assetId: 'A-2088', events: [{ id: 'LR-A-2088-EV-1', type: 'PROJECT_OPENED', recordedAt: '2026-08-01T15:05:00.000Z' }] });
  store.addLifecycleRecord({ id: 'LR-A-3104', assetId: 'A-3104', events: [{ id: 'LR-A-3104-EV-1', type: 'VVP_FROZEN', recordedAt: '2026-08-01T15:10:00.000Z' }] });

  store.addVerifiedValuePackage({ id: 'VVP-1042-001', assetId: 'A-1042', measurements: { production: 91, condition: 84, reliability: 93, capacity: 79 }, score: 88, value: 735000, rulesetVersion: 'SRA-VV-1.0', proof: { anchorState: 'READY' } });
  store.addVerifiedValuePackage({ id: 'VVP-2088-001', assetId: 'A-2088', measurements: { production: 72, condition: 68, reliability: 82, capacity: 81 }, score: 76, value: 1860000, rulesetVersion: 'SRA-VV-1.0', proof: { anchorState: 'ANCHORED' } });
  store.addVerifiedValuePackage({ id: 'VVP-3104-001', assetId: 'A-3104', measurements: { production: 89, condition: 90, reliability: 94, capacity: 95 }, score: 92, value: 2480000, rulesetVersion: 'SRA-VV-1.0', proof: { anchorState: 'ANCHORED' } });

  store.addProject({ id: 'SRA-RE-0021', assetId: 'A-1042', title: 'Neighborhood Grocery Expansion', stage: 'PRODUCTION_BEGINS', participantIds: ['P-OWNER-001'], verifiedValuePackageIds: ['VVP-1042-001'], trueBillIds: ['TB-0021'] });
  store.addProject({ id: 'SRA-RE-0014', assetId: 'A-2088', title: '14-Unit Residential Recovery', stage: 'SERVICES_SCHEDULED', participantIds: ['P-OWNER-001', 'P-CAP-014'], verifiedValuePackageIds: ['VVP-2088-001'], trueBillIds: ['TB-0014'], completionId: 'C-0014' });
  store.addProject({ id: 'SRA-RE-0033', assetId: 'A-3104', title: 'Mixed-Use Rehabilitation', stage: 'VERIFIED_VALUE', participantIds: ['P-OWNER-001'], verifiedValuePackageIds: ['VVP-3104-001'], trueBillIds: ['TB-0033'], completionId: 'C-0033' });

  store.addTrueBill({ id: 'TB-0021', assetId: 'A-1042', projectId: 'SRA-RE-0021', verifiedValuePackageId: 'VVP-1042-001', purpose: 'ASSET_EXPANSION', faceValue: 168000, state: 'ISSUED' });
  store.addTrueBill({ id: 'TB-0014', assetId: 'A-2088', projectId: 'SRA-RE-0014', verifiedValuePackageId: 'VVP-2088-001', purpose: 'CAPITAL_FORMATION', faceValue: 310000, state: 'ACTIVE', holderId: 'P-CAP-014' });
  store.addTrueBill({ id: 'TB-0033', assetId: 'A-3104', projectId: 'SRA-RE-0033', verifiedValuePackageId: 'VVP-3104-001', purpose: 'COMPLETION_CAPACITY', faceValue: 505000, state: 'PLEDGED' });

  store.addCompletion({ id: 'C-0014', projectId: 'SRA-RE-0014', gap: 109000, coverage: 82, health: 74, projectedGain: 380000, platformReturn: 12000, state: 'WATCH' });
  store.addCompletion({ id: 'C-0033', projectId: 'SRA-RE-0033', gap: 88000, coverage: 94, health: 86, projectedGain: 197000, platformReturn: 10000, participantId: 'P-SRA-COMP', state: 'ELIGIBLE' });

  store.addAsset({ id: 'A-1042', name: 'North District Market', classification: 'OPERATING_BUSINESS', region: 'Ogden, Utah', ownerId: 'P-OWNER-001', lifecycleRecordId: 'LR-A-1042', verifiedValuePackageIds: ['VVP-1042-001'], projectIds: ['SRA-RE-0021'], trueBillIds: ['TB-0021'] });
  store.addAsset({ id: 'A-2088', name: 'Weber Residential Portfolio', classification: 'REAL_ESTATE', region: 'Northern Utah', ownerId: 'P-OWNER-001', lifecycleRecordId: 'LR-A-2088', verifiedValuePackageIds: ['VVP-2088-001'], projectIds: ['SRA-RE-0014'], trueBillIds: ['TB-0014'], completionIds: ['C-0014'] });
  store.addAsset({ id: 'A-3104', name: 'Weber Mixed-Use Block', classification: 'MIXED_USE_REAL_ESTATE', region: 'Weber County, Utah', ownerId: 'P-OWNER-001', lifecycleRecordId: 'LR-A-3104', verifiedValuePackageIds: ['VVP-3104-001'], projectIds: ['SRA-RE-0033'], trueBillIds: ['TB-0033'], completionIds: ['C-0033'] });

  return store;
}
