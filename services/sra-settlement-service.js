import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const SETTLEMENT_STATES = new Set([
  'DRAFT', 'READY', 'LOCKED', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED'
]);

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}
function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class SraSettlementService {
  constructor(domain, homeFinancingService) {
    this.domain = domain;
    this.homeFinancingService = homeFinancingService;
  }

  listSettlements(filters = {}) {
    return this.domain.list(RECORD_TYPES.SRA_SETTLEMENT).filter((record) => {
      if (filters.homeProjectId && record.homeProjectId !== filters.homeProjectId) return false;
      if (filters.customerId && record.customerId !== filters.customerId) return false;
      if (filters.state && record.state !== filters.state) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getSettlement(settlementId) {
    return this.domain.get(RECORD_TYPES.SRA_SETTLEMENT, settlementId);
  }

  listRecords(filters = {}) {
    return this.domain.list(RECORD_TYPES.SRA_SETTLEMENT_RECORD).filter((record) => {
      if (filters.homeProjectId && record.homeProjectId !== filters.homeProjectId) return false;
      if (filters.assetId && record.assetId !== filters.assetId) return false;
      return true;
    }).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  }

  getRecord(settlementRecordId) {
    return this.domain.get(RECORD_TYPES.SRA_SETTLEMENT_RECORD, settlementRecordId);
  }

  readiness(homeProjectId) {
    const project = this.homeFinancingService.getProject(homeProjectId);
    if (!project) throw new Error('Home Project not found.');
    const plan = project.fundingPlanId ? this.homeFinancingService.getFundingPlan(project.fundingPlanId) : null;
    const checks = {
      projectSettlementReady: project.state === 'SETTLEMENT_READY',
      verifiedSnapshotPresent: Boolean(project.snapshotId),
      verifiedValuePackagePresent: Boolean(project.valuePackageId),
      fundingPlanPresent: Boolean(plan),
      fundingPlanSettlementReady: plan?.state === 'SETTLEMENT_READY',
      fundingGapCovered: plan ? plan.remainingGap === 0 : false,
      customerApprovalPresent: Boolean(plan?.customerApprovalReference),
      settlementInstructionsPresent: Boolean(plan?.settlementInstructionsReference),
      propertyIdentified: Boolean(project.property?.address),
      buyerIdentified: Boolean(project.customerId)
    };
    const missing = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
    return {
      homeProjectId,
      fundingPlanId: plan?.fundingPlanId || null,
      ready: missing.length === 0,
      checks,
      missing,
      evaluatedAt: now()
    };
  }

  async prepare(input, actorId = null) {
    const homeProjectId = requiredString(input.homeProjectId, 'homeProjectId');
    const readiness = this.readiness(homeProjectId);
    if (!readiness.ready) throw new Error(`Settlement is not ready: ${readiness.missing.join(', ')}.`);
    const project = this.homeFinancingService.getProject(homeProjectId);
    const plan = this.homeFinancingService.getFundingPlan(project.fundingPlanId);
    const existing = this.listSettlements({ homeProjectId }).find((record) => !['FAILED', 'CANCELLED', 'ARCHIVED'].includes(record.state));
    if (existing) throw new Error('An active settlement already exists for this Home Project.');

    const settlementId = input.settlementId || id('SRA-STL');
    const timestamp = now();
    const packagePayload = {
      settlementId,
      homeProjectId,
      fundingPlanId: plan.fundingPlanId,
      snapshotId: project.snapshotId,
      valuePackageId: project.valuePackageId,
      customerId: project.customerId,
      enterpriseId: project.enterpriseId,
      property: project.property,
      purchasePrice: project.purchasePrice,
      verifiedBuyerFunds: project.verifiedBuyerFunds,
      sources: plan.sources,
      totalPlanned: plan.totalPlanned,
      settlementInstructionsReference: plan.settlementInstructionsReference,
      participantIds: project.participantIds,
      documentReferences: project.documentReferences,
      targetClosingDate: project.targetClosingDate,
      packageVersion: '1.0.0'
    };
    const settlementPackage = {
      settlementPackageId: id('SRA-SP'),
      ...packagePayload,
      packageHash: hash(packagePayload),
      state: 'IMMUTABLE_PREPARED_PACKAGE',
      preparedAt: timestamp,
      preparedBy: actorId
    };
    const settlement = {
      settlementId,
      homeProjectId,
      fundingPlanId: plan.fundingPlanId,
      customerId: project.customerId,
      enterpriseId: project.enterpriseId,
      state: 'READY',
      readiness,
      settlementPackage,
      executionReference: input.executionReference || id('SRA-EXEC'),
      assetId: null,
      settlementRecordId: null,
      lockedAt: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      failureReason: null,
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.domain.put(RECORD_TYPES.SRA_SETTLEMENT, settlementId, settlement, { actorId, eventType: 'SRA_SETTLEMENT_PREPARED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.SRA_SETTLEMENT, objectId: settlementId, eventType: 'SRA_SETTLEMENT_PREPARED', actorId, payload: { homeProjectId, settlementPackageId: settlementPackage.settlementPackageId, packageHash: settlementPackage.packageHash } });
    return settlement;
  }

  async lock(settlementId, actorId = null) {
    const current = this.getSettlement(settlementId);
    if (!current) throw new Error('SRA Settlement not found.');
    if (current.state !== 'READY') throw new Error('Only a ready settlement can be locked.');
    const timestamp = now();
    const locked = { ...current, state: 'LOCKED', lockedAt: timestamp, lockedBy: actorId, updatedAt: timestamp };
    await this.domain.put(RECORD_TYPES.SRA_SETTLEMENT, settlementId, locked, { actorId, eventType: 'SRA_SETTLEMENT_LOCKED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.SRA_SETTLEMENT, objectId: settlementId, eventType: 'SRA_SETTLEMENT_LOCKED', actorId, payload: { homeProjectId: current.homeProjectId } });
    return locked;
  }

  async execute(settlementId, input = {}, actorId = null) {
    const current = this.getSettlement(settlementId);
    if (!current) throw new Error('SRA Settlement not found.');
    if (current.state !== 'LOCKED') throw new Error('Settlement must be locked before execution.');
    const project = this.homeFinancingService.getProject(current.homeProjectId);
    const plan = this.homeFinancingService.getFundingPlan(current.fundingPlanId);
    if (!project || !plan) throw new Error('Settlement source records are unavailable.');
    const readiness = this.readiness(project.homeProjectId);
    if (!readiness.ready) throw new Error(`Settlement readiness changed: ${readiness.missing.join(', ')}.`);

    const startedAt = now();
    await this.domain.put(RECORD_TYPES.SRA_SETTLEMENT, settlementId, { ...current, state: 'EXECUTING', startedAt, startedBy: actorId, updatedAt: startedAt }, { actorId, eventType: 'SRA_SETTLEMENT_EXECUTION_STARTED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.SRA_SETTLEMENT, objectId: settlementId, eventType: 'SRA_SETTLEMENT_EXECUTION_STARTED', actorId, payload: { executionReference: current.executionReference } });

    try {
      const recordingReference = requiredString(input.recordingReference, 'recordingReference');
      const settlementReference = input.settlementReference || id('SRA-CLOSE');
      const assetId = input.assetId || id('ASSET-HOME');
      const completedAt = now();
      const asset = {
        id: assetId,
        assetId,
        name: input.assetName || project.title,
        type: project.property?.propertyType || 'RESIDENTIAL_REAL_ESTATE',
        classification: 'REAL_ESTATE',
        region: input.region || null,
        state: 'ACTIVE',
        status: 'ACTIVE',
        ownerId: project.customerId,
        homeProjectId: project.homeProjectId,
        settlementId,
        settlementReference,
        recordingReference,
        property: project.property,
        acquisitionValue: project.purchasePrice,
        verifiedValue: project.purchasePrice,
        fundingPlanId: plan.fundingPlanId,
        snapshotId: project.snapshotId,
        valuePackageId: project.valuePackageId,
        createdAt: completedAt,
        activatedAt: completedAt
      };
      await this.domain.put(RECORD_TYPES.ASSET_ACCOUNT, assetId, asset, { actorId, eventType: 'ASSET_ACCOUNT_CREATED_FROM_SETTLEMENT' });
      await this.domain.lifecycle({ objectType: RECORD_TYPES.ASSET_ACCOUNT, objectId: assetId, eventType: 'ASSET_ACCOUNT_CREATED_FROM_SETTLEMENT', actorId, payload: { settlementId, homeProjectId: project.homeProjectId, recordingReference } });

      const settledPlan = { ...plan, state: 'SETTLED', settlementId, settlementReference, settledAt: completedAt, updatedAt: completedAt };
      await this.domain.put(RECORD_TYPES.FUNDING_PLAN, plan.fundingPlanId, settledPlan, { actorId, eventType: 'FUNDING_PLAN_SETTLED_BY_SRA' });

      const settledProject = { ...project, state: 'SETTLED', settlementId, settlementReference, settlementRecordId: null, assetId, recordingReference, settledAt: completedAt, updatedAt: completedAt };
      await this.domain.put(RECORD_TYPES.HOME_PROJECT, project.homeProjectId, settledProject, { actorId, eventType: 'HOME_PROJECT_SETTLED_BY_SRA' });

      const settlementRecordId = id('SRA-SR');
      const recordPayload = {
        settlementRecordId,
        settlementId,
        homeProjectId: project.homeProjectId,
        fundingPlanId: plan.fundingPlanId,
        assetId,
        customerId: project.customerId,
        enterpriseId: project.enterpriseId,
        property: project.property,
        purchasePrice: project.purchasePrice,
        settlementPackageId: current.settlementPackage.settlementPackageId,
        settlementPackageHash: current.settlementPackage.packageHash,
        executionReference: current.executionReference,
        settlementReference,
        recordingReference,
        sourceAllocations: plan.sources,
        participantIds: project.participantIds,
        completedAt,
        completedBy: actorId,
        state: 'COMPLETED'
      };
      const settlementRecord = { ...recordPayload, recordHash: hash(recordPayload), immutable: true };
      await this.domain.put(RECORD_TYPES.SRA_SETTLEMENT_RECORD, settlementRecordId, settlementRecord, { actorId, eventType: 'SRA_SETTLEMENT_RECORD_CREATED' });
      await this.domain.lifecycle({ objectType: RECORD_TYPES.SRA_SETTLEMENT_RECORD, objectId: settlementRecordId, eventType: 'SRA_SETTLEMENT_RECORD_CREATED', actorId, payload: { settlementId, assetId, recordHash: settlementRecord.recordHash } });

      const finalProject = { ...settledProject, settlementRecordId };
      await this.domain.put(RECORD_TYPES.HOME_PROJECT, project.homeProjectId, finalProject, { actorId, eventType: 'HOME_PROJECT_CLOSEOUT_RECORDED' });

      const completed = {
        ...current,
        state: 'COMPLETED',
        readiness,
        assetId,
        settlementRecordId,
        settlementReference,
        recordingReference,
        completedAt,
        completedBy: actorId,
        updatedAt: completedAt
      };
      await this.domain.put(RECORD_TYPES.SRA_SETTLEMENT, settlementId, completed, { actorId, eventType: 'SRA_SETTLEMENT_COMPLETED' });
      await this.domain.lifecycle({ objectType: RECORD_TYPES.SRA_SETTLEMENT, objectId: settlementId, eventType: 'SRA_SETTLEMENT_COMPLETED', actorId, payload: { assetId, settlementRecordId, settlementReference, recordingReference } });
      return { settlement: completed, settlementRecord, assetAccount: asset, homeProject: finalProject, fundingPlan: settledPlan };
    } catch (error) {
      const failedAt = now();
      const failed = { ...current, state: 'FAILED', failedAt, failureReason: error.message, updatedAt: failedAt };
      await this.domain.put(RECORD_TYPES.SRA_SETTLEMENT, settlementId, failed, { actorId, eventType: 'SRA_SETTLEMENT_FAILED' });
      await this.domain.lifecycle({ objectType: RECORD_TYPES.SRA_SETTLEMENT, objectId: settlementId, eventType: 'SRA_SETTLEMENT_FAILED', actorId, payload: { reason: error.message } });
      throw error;
    }
  }

  async cancel(settlementId, input = {}, actorId = null) {
    const current = this.getSettlement(settlementId);
    if (!current) throw new Error('SRA Settlement not found.');
    if (!['READY', 'LOCKED'].includes(current.state)) throw new Error('Only a ready or locked settlement can be cancelled.');
    const timestamp = now();
    const cancelled = { ...current, state: 'CANCELLED', cancellationReason: input.reason || 'SETTLEMENT_CANCELLED', cancelledAt: timestamp, cancelledBy: actorId, updatedAt: timestamp };
    await this.domain.put(RECORD_TYPES.SRA_SETTLEMENT, settlementId, cancelled, { actorId, eventType: 'SRA_SETTLEMENT_CANCELLED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.SRA_SETTLEMENT, objectId: settlementId, eventType: 'SRA_SETTLEMENT_CANCELLED', actorId, payload: { reason: cancelled.cancellationReason } });
    return cancelled;
  }

  events(settlementId) {
    if (!this.getSettlement(settlementId)) throw new Error('SRA Settlement not found.');
    return this.domain.list(RECORD_TYPES.LIFECYCLE_EVENT)
      .filter((event) => event.objectId === settlementId || event.payload?.settlementId === settlementId)
      .sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  }
}

export const SRA_SETTLEMENT_STATES = Object.freeze([...SETTLEMENT_STATES]);
