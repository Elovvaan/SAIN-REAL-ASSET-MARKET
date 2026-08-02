import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const DECISIONS = new Set(['PUBLISH_TODAY', 'KEEP_PRIVATE']);
const DECISION_STATES = new Set(['PENDING', 'APPROVED', 'DECLINED', 'EXECUTED', 'CANCELLED']);
const PROJECTION_STATES = new Set(['PUBLISHED', 'WITHDRAWN', 'ARCHIVED']);

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim().toUpperCase()))];
}

function marketplaceMetrics(valuePackage) {
  const metrics = valuePackage.metrics || {};
  return {
    revenue: metrics.revenue ?? 0,
    expenses: metrics.expenses ?? 0,
    assets: metrics.assets ?? 0,
    inventory: metrics.inventory ?? 0,
    production: metrics.production ?? 0,
    growthPercent: metrics.growthPercent ?? 0,
    cashPosition: metrics.cashPosition ?? 0,
    verifiedValue: metrics.verifiedValue ?? 0
  };
}

export class EdxMarketplacePublisherService {
  constructor(persistentDomain, valuePackageService) {
    this.domain = persistentDomain;
    this.valuePackageService = valuePackageService;
  }

  listDecisions(filters = {}) {
    return this.domain.list(RECORD_TYPES.EDX_PUBLICATION_DECISION).filter((record) => {
      if (filters.enterpriseId && record.enterpriseId !== filters.enterpriseId) return false;
      if (filters.valuePackageId && record.valuePackageId !== filters.valuePackageId) return false;
      if (filters.state && record.state !== filters.state) return false;
      if (filters.decision && record.decision !== filters.decision) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getDecision(publicationDecisionId) {
    return this.domain.get(RECORD_TYPES.EDX_PUBLICATION_DECISION, publicationDecisionId);
  }

  listProjections(filters = {}) {
    return this.domain.list(RECORD_TYPES.EDX_MARKETPLACE_PROJECTION).filter((record) => {
      if (filters.enterpriseId && record.enterpriseId !== filters.enterpriseId) return false;
      if (filters.valuePackageId && record.valuePackageId !== filters.valuePackageId) return false;
      if (filters.state && record.state !== filters.state) return false;
      return true;
    }).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  }

  getProjection(projectionId) {
    return this.domain.get(RECORD_TYPES.EDX_MARKETPLACE_PROJECTION, projectionId);
  }

  async createDecision(input, actorId = null) {
    const valuePackageId = requiredString(input.valuePackageId, 'valuePackageId');
    const valuePackage = this.valuePackageService.getPackage(valuePackageId);
    if (!valuePackage) throw new Error('Verified Value Package not found.');
    if (valuePackage.state !== 'ACTIVE') throw new Error('Only an active Verified Value Package can enter publication review.');

    const decision = requiredString(input.decision, 'decision').toUpperCase();
    if (!DECISIONS.has(decision)) throw new Error(`Unsupported publication decision: ${decision}.`);
    if (decision === 'PUBLISH_TODAY' && !['MARKETPLACE', 'PUBLIC'].includes(valuePackage.visibility)) {
      throw new Error('Package visibility must be MARKETPLACE or PUBLIC before publication approval.');
    }

    const publicationDecisionId = input.publicationDecisionId || id('EDX-PD');
    if (this.getDecision(publicationDecisionId)) throw new Error('Publication decision already exists.');
    const timestamp = now();
    const record = {
      publicationDecisionId,
      enterpriseId: valuePackage.enterpriseId,
      valuePackageId,
      snapshotId: valuePackage.snapshotId,
      decision,
      state: decision === 'KEEP_PRIVATE' ? 'EXECUTED' : 'PENDING',
      requestedBy: actorId,
      companyApprovalReference: null,
      approvalScope: null,
      distributionTargets: [],
      reason: input.reason || null,
      createdAt: timestamp,
      approvedAt: null,
      executedAt: decision === 'KEEP_PRIVATE' ? timestamp : null,
      cancelledAt: null,
      updatedAt: timestamp
    };

    await this.domain.put(RECORD_TYPES.EDX_PUBLICATION_DECISION, publicationDecisionId, record, {
      actorId,
      eventType: decision === 'KEEP_PRIVATE' ? 'EDX_PUBLICATION_KEPT_PRIVATE' : 'EDX_PUBLICATION_DECISION_REQUESTED'
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.EDX_PUBLICATION_DECISION,
      objectId: publicationDecisionId,
      eventType: decision === 'KEEP_PRIVATE' ? 'EDX_PUBLICATION_KEPT_PRIVATE' : 'EDX_PUBLICATION_DECISION_REQUESTED',
      actorId,
      payload: { valuePackageId, decision }
    });
    return record;
  }

  async approveDecision(publicationDecisionId, input, actorId = null) {
    const current = this.getDecision(publicationDecisionId);
    if (!current) throw new Error('Publication decision not found.');
    if (current.decision !== 'PUBLISH_TODAY') throw new Error('Only a publish decision can be approved.');
    if (current.state !== 'PENDING') throw new Error('Publication decision must be pending.');
    const companyApprovalReference = requiredString(input.companyApprovalReference, 'companyApprovalReference');
    const distributionTargets = uniqueStrings(input.distributionTargets || ['SRA_MARKETPLACE']);
    const timestamp = now();
    const approved = {
      ...current,
      state: 'APPROVED',
      companyApprovalReference,
      approvalScope: input.approvalScope || 'PUBLISH_CURRENT_PACKAGE_ONLY',
      distributionTargets,
      approvedBy: actorId,
      approvedAt: timestamp,
      updatedAt: timestamp
    };
    await this.domain.put(RECORD_TYPES.EDX_PUBLICATION_DECISION, publicationDecisionId, approved, { actorId, eventType: 'EDX_PUBLICATION_APPROVED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_PUBLICATION_DECISION, objectId: publicationDecisionId, eventType: 'EDX_PUBLICATION_APPROVED', actorId, payload: { companyApprovalReference, distributionTargets } });
    return approved;
  }

  async executeDecision(publicationDecisionId, actorId = null) {
    const decision = this.getDecision(publicationDecisionId);
    if (!decision) throw new Error('Publication decision not found.');
    if (decision.decision !== 'PUBLISH_TODAY' || decision.state !== 'APPROVED') {
      throw new Error('Publication requires an approved PUBLISH_TODAY decision.');
    }
    const valuePackage = this.valuePackageService.getPackage(decision.valuePackageId);
    if (!valuePackage || valuePackage.state !== 'ACTIVE') throw new Error('Verified Value Package is not available for publication.');

    const publishedPackage = await this.valuePackageService.publishPackage(valuePackage.valuePackageId, {
      distributionTargets: decision.distributionTargets,
      publicationReference: id('EDX-PUB')
    }, actorId);

    const projectionId = id('EDX-MP');
    const projection = {
      projectionId,
      enterpriseId: valuePackage.enterpriseId,
      valuePackageId: valuePackage.valuePackageId,
      snapshotId: valuePackage.snapshotId,
      publicationDecisionId,
      state: 'PUBLISHED',
      title: valuePackage.title,
      packageVersion: valuePackage.version,
      verificationStatus: valuePackage.verificationStatus,
      verificationScore: valuePackage.verificationScore,
      coveragePercent: valuePackage.coveragePercent,
      primaryCurrency: valuePackage.primaryCurrency,
      metrics: marketplaceMetrics(valuePackage),
      marketplaceReadiness: valuePackage.marketplaceReadiness,
      supportedUses: valuePackage.supportedUses,
      distributionTargets: decision.distributionTargets,
      publicationReference: publishedPackage.publicationReference,
      companyApprovalReference: decision.companyApprovalReference,
      publishedBy: actorId,
      publishedAt: now(),
      withdrawnAt: null,
      archivedAt: null
    };
    await this.domain.put(RECORD_TYPES.EDX_MARKETPLACE_PROJECTION, projectionId, projection, { actorId, eventType: 'EDX_MARKETPLACE_PROJECTION_PUBLISHED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_MARKETPLACE_PROJECTION, objectId: projectionId, eventType: 'EDX_MARKETPLACE_PROJECTION_PUBLISHED', actorId, payload: { valuePackageId: valuePackage.valuePackageId, publicationDecisionId } });

    const executed = { ...decision, state: 'EXECUTED', projectionId, publicationReference: publishedPackage.publicationReference, executedBy: actorId, executedAt: now(), updatedAt: now() };
    await this.domain.put(RECORD_TYPES.EDX_PUBLICATION_DECISION, publicationDecisionId, executed, { actorId, eventType: 'EDX_PUBLICATION_EXECUTED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_PUBLICATION_DECISION, objectId: publicationDecisionId, eventType: 'EDX_PUBLICATION_EXECUTED', actorId, payload: { projectionId, publicationReference: executed.publicationReference } });
    return { decision: executed, projection, valuePackage: publishedPackage };
  }

  async declineDecision(publicationDecisionId, input = {}, actorId = null) {
    const current = this.getDecision(publicationDecisionId);
    if (!current) throw new Error('Publication decision not found.');
    if (current.state !== 'PENDING') throw new Error('Only a pending decision can be declined.');
    const declined = { ...current, state: 'DECLINED', reason: input.reason || 'COMPANY_DECLINED', declinedBy: actorId, declinedAt: now(), updatedAt: now() };
    await this.domain.put(RECORD_TYPES.EDX_PUBLICATION_DECISION, publicationDecisionId, declined, { actorId, eventType: 'EDX_PUBLICATION_DECLINED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_PUBLICATION_DECISION, objectId: publicationDecisionId, eventType: 'EDX_PUBLICATION_DECLINED', actorId, payload: { reason: declined.reason } });
    return declined;
  }

  async withdrawProjection(projectionId, input = {}, actorId = null) {
    const current = this.getProjection(projectionId);
    if (!current) throw new Error('Marketplace projection not found.');
    if (current.state !== 'PUBLISHED') throw new Error('Only a published projection can be withdrawn.');
    const withdrawn = { ...current, state: 'WITHDRAWN', withdrawalReason: input.reason || 'COMPANY_WITHDRAWN', withdrawnBy: actorId, withdrawnAt: now() };
    await this.domain.put(RECORD_TYPES.EDX_MARKETPLACE_PROJECTION, projectionId, withdrawn, { actorId, eventType: 'EDX_MARKETPLACE_PROJECTION_WITHDRAWN' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_MARKETPLACE_PROJECTION, objectId: projectionId, eventType: 'EDX_MARKETPLACE_PROJECTION_WITHDRAWN', actorId, payload: { reason: withdrawn.withdrawalReason } });
    return withdrawn;
  }
}

export const EDX_PUBLICATION_DECISIONS = Object.freeze([...DECISIONS]);
export const EDX_PUBLICATION_DECISION_STATES = Object.freeze([...DECISION_STATES]);
export const EDX_MARKETPLACE_PROJECTION_STATES = Object.freeze([...PROJECTION_STATES]);
