import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const PLAN_STATES = new Set(['DRAFT', 'OPEN', 'FULLY_SUBSCRIBED', 'CLOSED', 'CANCELLED', 'ARCHIVED']);
const COMMITMENT_STATES = new Set(['INTERESTED', 'UNDER_REVIEW', 'INFORMATION_REQUESTED', 'COMMITTED', 'DECLINED', 'WITHDRAWN', 'SETTLED']);

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}
function amount(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be greater than zero.`);
  return Number(number.toFixed(2));
}

export class InstitutionParticipationService {
  constructor(domain, homeFinancingService, settlementService) {
    this.domain = domain;
    this.homeFinancingService = homeFinancingService;
    this.settlementService = settlementService;
  }

  listPlans(filters = {}) {
    return this.domain.list(RECORD_TYPES.HOME_PARTICIPATION_PLAN).filter((record) => {
      if (filters.homeProjectId && record.homeProjectId !== filters.homeProjectId) return false;
      if (filters.state && record.state !== filters.state) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getPlan(planId) {
    return this.domain.get(RECORD_TYPES.HOME_PARTICIPATION_PLAN, planId);
  }

  listCommitments(filters = {}) {
    return this.domain.list(RECORD_TYPES.HOME_PARTICIPATION_COMMITMENT).filter((record) => {
      if (filters.planId && record.planId !== filters.planId) return false;
      if (filters.institutionId && record.institutionId !== filters.institutionId) return false;
      if (filters.state && record.state !== filters.state) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getCommitment(commitmentId) {
    return this.domain.get(RECORD_TYPES.HOME_PARTICIPATION_COMMITMENT, commitmentId);
  }

  summary(planId) {
    const plan = this.getPlan(planId);
    if (!plan) throw new Error('Participation Plan not found.');
    const commitments = this.listCommitments({ planId });
    const committedAmount = Number(commitments.filter((item) => ['COMMITTED', 'SETTLED'].includes(item.state)).reduce((sum, item) => sum + item.amount, 0).toFixed(2));
    const underReviewAmount = Number(commitments.filter((item) => ['INTERESTED', 'UNDER_REVIEW', 'INFORMATION_REQUESTED'].includes(item.state)).reduce((sum, item) => sum + item.amount, 0).toFixed(2));
    return {
      plan,
      commitments,
      committedAmount,
      underReviewAmount,
      remainingAmount: Math.max(0, Number((plan.targetAmount - committedAmount).toFixed(2))),
      fullySubscribed: committedAmount >= plan.targetAmount
    };
  }

  async createPlan(input, actorId = null) {
    const homeProjectId = requiredString(input.homeProjectId, 'homeProjectId');
    const project = this.homeFinancingService.getProject(homeProjectId);
    if (!project) throw new Error('Home Project not found.');
    if (!['PACKAGE_READY', 'FUNDING_PLANNING', 'FUNDING_APPROVED', 'SETTLEMENT_READY'].includes(project.state)) {
      throw new Error('Home Project is not ready for institutional participation.');
    }
    if (!project.snapshotId || !project.valuePackageId) throw new Error('Verified Snapshot and Verified Value Package are required.');
    const fundingPlan = project.fundingPlanId ? this.homeFinancingService.getFundingPlan(project.fundingPlanId) : null;
    if (!fundingPlan) throw new Error('Funding Plan is required before institutional participation.');
    const publicationAuthorizationReference = requiredString(input.publicationAuthorizationReference, 'publicationAuthorizationReference');
    const targetAmount = amount(input.targetAmount ?? project.fundingNeeded, 'targetAmount');
    const existing = this.listPlans({ homeProjectId }).find((record) => !['CANCELLED', 'ARCHIVED'].includes(record.state));
    if (existing) throw new Error('An active Participation Plan already exists for this Home Project.');
    const timestamp = now();
    const planId = input.planId || id('HPP');
    const plan = {
      planId,
      homeProjectId,
      fundingPlanId: fundingPlan.fundingPlanId,
      customerId: project.customerId,
      enterpriseId: project.enterpriseId,
      title: project.title,
      propertySummary: { address: project.property?.address, propertyType: project.property?.propertyType, region: input.region || null },
      snapshotId: project.snapshotId,
      valuePackageId: project.valuePackageId,
      purchasePrice: project.purchasePrice,
      verifiedBuyerFunds: project.verifiedBuyerFunds,
      targetAmount,
      participationTermsReference: input.participationTermsReference || null,
      riskDisclosureReference: input.riskDisclosureReference || null,
      publicationAuthorizationReference,
      participationWindowEndsAt: input.participationWindowEndsAt || null,
      permittedInstitutionIds: Array.isArray(input.permittedInstitutionIds) ? [...new Set(input.permittedInstitutionIds)] : [],
      state: 'DRAFT',
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.domain.put(RECORD_TYPES.HOME_PARTICIPATION_PLAN, planId, plan, { actorId, eventType: 'HOME_PARTICIPATION_PLAN_CREATED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.HOME_PARTICIPATION_PLAN, objectId: planId, eventType: 'HOME_PARTICIPATION_PLAN_CREATED', actorId, payload: { homeProjectId, targetAmount, publicationAuthorizationReference } });
    return plan;
  }

  async openPlan(planId, actorId = null) {
    const plan = this.getPlan(planId);
    if (!plan) throw new Error('Participation Plan not found.');
    if (plan.state !== 'DRAFT') throw new Error('Only a draft Participation Plan can be opened.');
    if (!plan.participationTermsReference || !plan.riskDisclosureReference) throw new Error('Participation terms and risk disclosure references are required.');
    const timestamp = now();
    const opened = { ...plan, state: 'OPEN', openedAt: timestamp, openedBy: actorId, updatedAt: timestamp };
    await this.domain.put(RECORD_TYPES.HOME_PARTICIPATION_PLAN, planId, opened, { actorId, eventType: 'HOME_PARTICIPATION_PLAN_OPENED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.HOME_PARTICIPATION_PLAN, objectId: planId, eventType: 'HOME_PARTICIPATION_PLAN_OPENED', actorId, payload: { homeProjectId: plan.homeProjectId } });
    return opened;
  }

  opportunities(institutionId) {
    return this.listPlans({ state: 'OPEN' }).filter((plan) => {
      return !plan.permittedInstitutionIds.length || plan.permittedInstitutionIds.includes(institutionId);
    }).map((plan) => {
      const summary = this.summary(plan.planId);
      return {
        ...plan,
        committedAmount: summary.committedAmount,
        remainingAmount: summary.remainingAmount,
        institutionCommitment: summary.commitments.find((item) => item.institutionId === institutionId) || null
      };
    });
  }

  async createCommitment(input, actorId = null) {
    const institutionId = requiredString(input.institutionId, 'institutionId');
    const plan = this.getPlan(requiredString(input.planId, 'planId'));
    if (!plan) throw new Error('Participation Plan not found.');
    if (plan.state !== 'OPEN') throw new Error('Participation Plan is not open.');
    if (plan.permittedInstitutionIds.length && !plan.permittedInstitutionIds.includes(institutionId)) throw new Error('Institution is not permitted for this opportunity.');
    const existing = this.listCommitments({ planId: plan.planId, institutionId }).find((record) => !['DECLINED', 'WITHDRAWN'].includes(record.state));
    if (existing) throw new Error('Institution already has an active response for this opportunity.');
    const requestedAmount = amount(input.amount, 'amount');
    const summary = this.summary(plan.planId);
    if (requestedAmount > summary.remainingAmount) throw new Error('Commitment amount exceeds the remaining participation amount.');
    const timestamp = now();
    const commitmentId = input.commitmentId || id('HPC');
    const commitment = {
      commitmentId,
      planId: plan.planId,
      homeProjectId: plan.homeProjectId,
      institutionId,
      institutionName: input.institutionName || institutionId,
      amount: requestedAmount,
      termsAcknowledgementReference: input.termsAcknowledgementReference || null,
      capitalSourceReference: input.capitalSourceReference || null,
      informationRequest: null,
      state: 'INTERESTED',
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
      history: [{ state: 'INTERESTED', at: timestamp, actorId }]
    };
    await this.domain.put(RECORD_TYPES.HOME_PARTICIPATION_COMMITMENT, commitmentId, commitment, { actorId, eventType: 'HOME_PARTICIPATION_INTEREST_RECORDED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.HOME_PARTICIPATION_COMMITMENT, objectId: commitmentId, eventType: 'HOME_PARTICIPATION_INTEREST_RECORDED', actorId, payload: { planId: plan.planId, institutionId, amount: requestedAmount } });
    return commitment;
  }

  async transitionCommitment(commitmentId, targetState, input = {}, actorId = null) {
    const current = this.getCommitment(commitmentId);
    if (!current) throw new Error('Participation Commitment not found.');
    const state = requiredString(targetState, 'state').toUpperCase();
    if (!COMMITMENT_STATES.has(state)) throw new Error(`Unsupported Commitment state: ${state}.`);
    const allowed = {
      INTERESTED: ['UNDER_REVIEW', 'INFORMATION_REQUESTED', 'DECLINED', 'WITHDRAWN'],
      UNDER_REVIEW: ['INFORMATION_REQUESTED', 'COMMITTED', 'DECLINED', 'WITHDRAWN'],
      INFORMATION_REQUESTED: ['UNDER_REVIEW', 'COMMITTED', 'DECLINED', 'WITHDRAWN'],
      COMMITTED: ['SETTLED', 'WITHDRAWN'],
      DECLINED: [],
      WITHDRAWN: [],
      SETTLED: []
    };
    if (!allowed[current.state].includes(state)) throw new Error(`Invalid Commitment transition: ${current.state} -> ${state}.`);
    if (state === 'COMMITTED') {
      if (!input.termsAcknowledgementReference && !current.termsAcknowledgementReference) throw new Error('termsAcknowledgementReference is required.');
      if (!input.capitalSourceReference && !current.capitalSourceReference) throw new Error('capitalSourceReference is required.');
      const summary = this.summary(current.planId);
      const otherCommitted = summary.committedAmount;
      if (otherCommitted + current.amount > summary.plan.targetAmount) throw new Error('Commitment exceeds the remaining participation amount.');
    }
    if (state === 'SETTLED') {
      const settlements = this.settlementService.listSettlements({ homeProjectId: current.homeProjectId });
      if (!settlements.some((record) => record.state === 'COMPLETED')) throw new Error('SRA Settlement must be completed before a commitment can be settled.');
    }
    const timestamp = now();
    const updated = {
      ...current,
      state,
      termsAcknowledgementReference: input.termsAcknowledgementReference || current.termsAcknowledgementReference,
      capitalSourceReference: input.capitalSourceReference || current.capitalSourceReference,
      informationRequest: state === 'INFORMATION_REQUESTED' ? requiredString(input.informationRequest, 'informationRequest') : current.informationRequest,
      committedAt: state === 'COMMITTED' ? timestamp : current.committedAt || null,
      settledAt: state === 'SETTLED' ? timestamp : current.settledAt || null,
      declinedAt: state === 'DECLINED' ? timestamp : current.declinedAt || null,
      withdrawnAt: state === 'WITHDRAWN' ? timestamp : current.withdrawnAt || null,
      updatedAt: timestamp,
      history: [...(current.history || []), { state, at: timestamp, actorId, note: input.note || null }]
    };
    await this.domain.put(RECORD_TYPES.HOME_PARTICIPATION_COMMITMENT, commitmentId, updated, { actorId, eventType: `HOME_PARTICIPATION_${state}` });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.HOME_PARTICIPATION_COMMITMENT, objectId: commitmentId, eventType: `HOME_PARTICIPATION_${state}`, actorId, payload: { planId: current.planId, institutionId: current.institutionId, amount: current.amount } });

    if (state === 'COMMITTED') {
      const summary = this.summary(current.planId);
      if (summary.fullySubscribed) {
        const plan = summary.plan;
        const full = { ...plan, state: 'FULLY_SUBSCRIBED', fullySubscribedAt: timestamp, updatedAt: timestamp };
        await this.domain.put(RECORD_TYPES.HOME_PARTICIPATION_PLAN, plan.planId, full, { actorId, eventType: 'HOME_PARTICIPATION_PLAN_FULLY_SUBSCRIBED' });
        await this.domain.lifecycle({ objectType: RECORD_TYPES.HOME_PARTICIPATION_PLAN, objectId: plan.planId, eventType: 'HOME_PARTICIPATION_PLAN_FULLY_SUBSCRIBED', actorId, payload: { committedAmount: summary.committedAmount } });
      }
    }
    return updated;
  }

  institutionWorkspace(institutionId) {
    const opportunities = this.opportunities(institutionId);
    const commitments = this.listCommitments({ institutionId });
    const settlementIds = this.settlementService.listSettlements().filter((record) => commitments.some((commitment) => commitment.homeProjectId === record.homeProjectId)).map((record) => record.settlementId);
    return {
      institutionId,
      opportunities,
      commitments,
      queues: {
        incoming: opportunities.filter((item) => !item.institutionCommitment),
        underReview: commitments.filter((item) => ['INTERESTED', 'UNDER_REVIEW', 'INFORMATION_REQUESTED'].includes(item.state)),
        committed: commitments.filter((item) => item.state === 'COMMITTED'),
        settled: commitments.filter((item) => item.state === 'SETTLED')
      },
      settlementIds
    };
  }
}

export const HOME_PARTICIPATION_PLAN_STATES = Object.freeze([...PLAN_STATES]);
export const HOME_PARTICIPATION_COMMITMENT_STATES = Object.freeze([...COMMITMENT_STATES]);
