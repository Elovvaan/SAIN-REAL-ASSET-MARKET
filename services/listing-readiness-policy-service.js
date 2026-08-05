import crypto from 'node:crypto';
import { ListingReadinessBatchService } from './listing-readiness-batch-service.js';

export const LISTING_READINESS_POLICY_TYPE = 'SRA_CORE_POLICY';
export const LISTING_READINESS_POLICY_ID = 'POLICY-LISTING-READINESS-SRA-USD';

function now() { return new Date().toISOString(); }
function positive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be greater than zero.`);
  return number;
}

export class ListingReadinessPolicyService {
  constructor(domain) {
    this.domain = domain;
    this.readiness = new ListingReadinessBatchService(domain);
  }

  current() {
    return this.domain.get(LISTING_READINESS_POLICY_TYPE, LISTING_READINESS_POLICY_ID) || null;
  }

  preview(input = {}) {
    const readiness = this.readiness.preview(input);
    return {
      action: 'STANDING_LISTING_READINESS_POLICY_PREVIEW',
      readOnly: true,
      policyId: LISTING_READINESS_POLICY_ID,
      state: 'DRAFT',
      policyType: 'LISTING_READINESS',
      market: 'SRA / USD',
      terms: readiness.policy,
      currentlyEligibleListings: readiness.eligibleListingCount,
      automaticEffect: 'Each heartbeat applies these approved readiness terms to newly eligible prepared listings.',
      protectedBoundary: 'Publication remains a separate administrator approval.',
      doesNot: readiness.doesNot,
      approvalRequired: true,
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator approval is required.');
    const preview = this.preview(input);
    const approvedAt = now();
    const policy = {
      policyId: LISTING_READINESS_POLICY_ID,
      policyType: 'LISTING_READINESS',
      state: 'ACTIVE',
      version: crypto.randomUUID(),
      market: preview.market,
      terms: {
        ...preview.terms,
        unitPrice: positive(preview.terms.unitPrice, 'unitPrice'),
        minimumOrder: positive(preview.terms.minimumOrder, 'minimumOrder'),
      },
      automaticReadinessEnabled: true,
      automaticPublicationEnabled: false,
      approvedBy: actorId,
      approvedAt,
      updatedAt: approvedAt,
    };
    await this.domain.put(LISTING_READINESS_POLICY_TYPE, LISTING_READINESS_POLICY_ID, policy, {
      actorId,
      eventType: 'SRA_LISTING_READINESS_POLICY_APPROVED',
    });
    return policy;
  }

  async disable(actorId = 'SRA_PLATFORM_ADMIN') {
    const current = this.current();
    if (!current) return null;
    const disabledAt = now();
    const next = { ...current, state: 'DISABLED', automaticReadinessEnabled: false, disabledBy: actorId, disabledAt, updatedAt: disabledAt };
    await this.domain.put(LISTING_READINESS_POLICY_TYPE, LISTING_READINESS_POLICY_ID, next, {
      actorId,
      eventType: 'SRA_LISTING_READINESS_POLICY_DISABLED',
    });
    return next;
  }

  async apply(actorId = 'SRA_CORE_POLICY_ENGINE') {
    const policy = this.current();
    if (!policy || policy.state !== 'ACTIVE' || !policy.automaticReadinessEnabled) {
      return { policyActive: false, eligibleListingCount: this.readiness.eligibleListings().length, updatedListingCount: 0 };
    }
    const preview = this.readiness.preview(policy.terms);
    if (!preview.eligibleListingCount) {
      return { policyActive: true, policyId: policy.policyId, eligibleListingCount: 0, updatedListingCount: 0 };
    }
    const batch = await this.readiness.approve({ ...policy.terms, approval: 'APPROVE' }, actorId);
    return {
      policyActive: true,
      policyId: policy.policyId,
      policyVersion: policy.version,
      eligibleListingCount: preview.eligibleListingCount,
      updatedListingCount: batch.updatedListingCount,
      readinessBatchId: batch.batchId,
      publicationExecuted: false,
      protectedNextAction: 'SEPARATE_PUBLICATION_APPROVAL_REQUIRED',
    };
  }

  status() {
    const policy = this.current();
    return {
      policy,
      active: policy?.state === 'ACTIVE' && policy?.automaticReadinessEnabled === true,
      automaticPublicationEnabled: false,
      eligibleListingCount: this.readiness.eligibleListings().length,
      readyForPublicationApproval: this.readiness.status().readyForPublicationApproval,
    };
  }
}
