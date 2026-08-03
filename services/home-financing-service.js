import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const HOME_PROJECT_STATES = new Set([
  'DRAFT', 'DATA_COLLECTION', 'PACKAGE_READY', 'FUNDING_PLANNING',
  'FUNDING_APPROVED', 'SETTLEMENT_READY', 'SETTLED', 'CANCELLED', 'ARCHIVED'
]);

const FUNDING_PLAN_STATES = new Set([
  'DRAFT', 'READY_FOR_REVIEW', 'CUSTOMER_APPROVED', 'COMMITTED',
  'SETTLEMENT_READY', 'SETTLED', 'DECLINED', 'CANCELLED', 'ARCHIVED'
]);

const FUNDING_SOURCE_TYPES = new Set([
  'BUYER_FUNDS', 'INSTITUTION_FINANCING', 'PARTICIPATION_CAPITAL',
  'SELLER_FINANCING', 'PLATFORM_INSTRUMENT', 'GRANT', 'OTHER_APPROVED_SOURCE'
]);

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}
function money(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be a non-negative number.`);
  return Number(number.toFixed(2));
}
function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

export class HomeFinancingService {
  constructor(domain) { this.domain = domain; }

  listProjects(filters = {}) {
    return this.domain.list(RECORD_TYPES.HOME_PROJECT).filter((record) => {
      if (filters.customerId && record.customerId !== filters.customerId) return false;
      if (filters.enterpriseId && record.enterpriseId !== filters.enterpriseId) return false;
      if (filters.state && record.state !== filters.state) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getProject(homeProjectId) {
    return this.domain.get(RECORD_TYPES.HOME_PROJECT, homeProjectId);
  }

  async createProject(input, actorId = null) {
    const purchasePrice = money(input.purchasePrice, 'purchasePrice');
    const verifiedBuyerFunds = money(input.verifiedBuyerFunds || 0, 'verifiedBuyerFunds');
    const homeProjectId = input.homeProjectId || id('HOME');
    const timestamp = now();
    const record = {
      homeProjectId,
      customerId: requiredString(input.customerId, 'customerId'),
      enterpriseId: input.enterpriseId || null,
      title: input.title || 'Home Acquisition Project',
      property: {
        address: requiredString(input.property?.address, 'property.address'),
        parcelId: input.property?.parcelId || null,
        propertyType: input.property?.propertyType || 'RESIDENTIAL',
        sellerId: input.property?.sellerId || null
      },
      purchasePrice,
      verifiedBuyerFunds,
      fundingNeeded: Math.max(0, Number((purchasePrice - verifiedBuyerFunds).toFixed(2))),
      targetClosingDate: input.targetClosingDate || null,
      snapshotId: input.snapshotId || null,
      valuePackageId: input.valuePackageId || null,
      participantIds: uniqueStrings(input.participantIds),
      documentReferences: uniqueStrings(input.documentReferences),
      state: 'DRAFT',
      fundingPlanId: null,
      settlementReference: null,
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.domain.put(RECORD_TYPES.HOME_PROJECT, homeProjectId, record, { actorId, eventType: 'HOME_PROJECT_CREATED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.HOME_PROJECT, objectId: homeProjectId, eventType: 'HOME_PROJECT_CREATED', actorId, payload: { purchasePrice, verifiedBuyerFunds, fundingNeeded: record.fundingNeeded } });
    return record;
  }

  async updateProject(homeProjectId, input, actorId = null) {
    const current = this.getProject(homeProjectId);
    if (!current) throw new Error('Home Project not found.');
    if (['SETTLED', 'CANCELLED', 'ARCHIVED'].includes(current.state)) throw new Error(`Cannot edit a ${current.state.toLowerCase()} Home Project.`);
    const purchasePrice = input.purchasePrice == null ? current.purchasePrice : money(input.purchasePrice, 'purchasePrice');
    const verifiedBuyerFunds = input.verifiedBuyerFunds == null ? current.verifiedBuyerFunds : money(input.verifiedBuyerFunds, 'verifiedBuyerFunds');
    const updated = {
      ...current,
      purchasePrice,
      verifiedBuyerFunds,
      fundingNeeded: Math.max(0, Number((purchasePrice - verifiedBuyerFunds).toFixed(2))),
      targetClosingDate: input.targetClosingDate ?? current.targetClosingDate,
      snapshotId: input.snapshotId ?? current.snapshotId,
      valuePackageId: input.valuePackageId ?? current.valuePackageId,
      participantIds: input.participantIds == null ? current.participantIds : uniqueStrings(input.participantIds),
      documentReferences: input.documentReferences == null ? current.documentReferences : uniqueStrings(input.documentReferences),
      updatedAt: now()
    };
    await this.domain.put(RECORD_TYPES.HOME_PROJECT, homeProjectId, updated, { actorId, eventType: 'HOME_PROJECT_UPDATED' });
    return updated;
  }

  async transitionProject(homeProjectId, targetState, input = {}, actorId = null) {
    const current = this.getProject(homeProjectId);
    if (!current) throw new Error('Home Project not found.');
    const state = requiredString(targetState, 'state').toUpperCase();
    if (!HOME_PROJECT_STATES.has(state)) throw new Error(`Unsupported Home Project state: ${state}.`);
    const allowed = {
      DRAFT: ['DATA_COLLECTION', 'CANCELLED'],
      DATA_COLLECTION: ['PACKAGE_READY', 'CANCELLED'],
      PACKAGE_READY: ['FUNDING_PLANNING', 'CANCELLED'],
      FUNDING_PLANNING: ['FUNDING_APPROVED', 'CANCELLED'],
      FUNDING_APPROVED: ['SETTLEMENT_READY', 'CANCELLED'],
      SETTLEMENT_READY: ['SETTLED', 'CANCELLED'],
      SETTLED: ['ARCHIVED'],
      CANCELLED: ['ARCHIVED'],
      ARCHIVED: []
    };
    if (!allowed[current.state].includes(state)) throw new Error(`Invalid Home Project transition: ${current.state} -> ${state}.`);
    if (state === 'PACKAGE_READY' && (!current.snapshotId || !current.valuePackageId)) throw new Error('Verified Snapshot and Verified Value Package are required.');
    if (state === 'FUNDING_APPROVED' && !current.fundingPlanId) throw new Error('A Funding Plan is required.');
    if (state === 'SETTLEMENT_READY') {
      const plan = this.getFundingPlan(current.fundingPlanId);
      if (!plan || plan.state !== 'SETTLEMENT_READY') throw new Error('Funding Plan must be settlement ready.');
    }
    const timestamp = now();
    const updated = {
      ...current,
      state,
      settlementReference: state === 'SETTLED' ? requiredString(input.settlementReference, 'settlementReference') : current.settlementReference,
      settledAt: state === 'SETTLED' ? timestamp : current.settledAt || null,
      cancelledAt: state === 'CANCELLED' ? timestamp : current.cancelledAt || null,
      archivedAt: state === 'ARCHIVED' ? timestamp : current.archivedAt || null,
      updatedAt: timestamp
    };
    await this.domain.put(RECORD_TYPES.HOME_PROJECT, homeProjectId, updated, { actorId, eventType: `HOME_PROJECT_${state}` });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.HOME_PROJECT, objectId: homeProjectId, eventType: `HOME_PROJECT_${state}`, actorId, payload: { previousState: current.state, state } });
    return updated;
  }

  listFundingPlans(filters = {}) {
    return this.domain.list(RECORD_TYPES.FUNDING_PLAN).filter((record) => {
      if (filters.homeProjectId && record.homeProjectId !== filters.homeProjectId) return false;
      if (filters.customerId && record.customerId !== filters.customerId) return false;
      if (filters.state && record.state !== filters.state) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getFundingPlan(fundingPlanId) {
    return this.domain.get(RECORD_TYPES.FUNDING_PLAN, fundingPlanId);
  }

  async createFundingPlan(input, actorId = null) {
    const homeProject = this.getProject(requiredString(input.homeProjectId, 'homeProjectId'));
    if (!homeProject) throw new Error('Home Project not found.');
    if (!['PACKAGE_READY', 'FUNDING_PLANNING'].includes(homeProject.state)) throw new Error('Home Project is not ready for funding planning.');
    const sources = (input.sources || []).map((source, index) => {
      const type = requiredString(source.type, `sources[${index}].type`).toUpperCase();
      if (!FUNDING_SOURCE_TYPES.has(type)) throw new Error(`Unsupported funding source type: ${type}.`);
      return {
        sourceId: source.sourceId || id('FS'),
        type,
        providerId: source.providerId || null,
        instrumentId: source.instrumentId || null,
        amount: money(source.amount, `sources[${index}].amount`),
        status: source.status || 'PROPOSED',
        termsReference: source.termsReference || null
      };
    });
    if (!sources.length) throw new Error('At least one funding source is required.');
    const totalPlanned = Number(sources.reduce((sum, source) => sum + source.amount, 0).toFixed(2));
    const fundingPlanId = input.fundingPlanId || id('FP');
    const timestamp = now();
    const record = {
      fundingPlanId,
      homeProjectId: homeProject.homeProjectId,
      customerId: homeProject.customerId,
      enterpriseId: homeProject.enterpriseId,
      purchasePrice: homeProject.purchasePrice,
      verifiedBuyerFunds: homeProject.verifiedBuyerFunds,
      fundingNeeded: homeProject.fundingNeeded,
      sources,
      totalPlanned,
      remainingGap: Math.max(0, Number((homeProject.purchasePrice - totalPlanned).toFixed(2))),
      overage: Math.max(0, Number((totalPlanned - homeProject.purchasePrice).toFixed(2))),
      settlementInstructionsReference: input.settlementInstructionsReference || null,
      postSettlementObligations: input.postSettlementObligations || [],
      state: 'DRAFT',
      customerApprovalReference: null,
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.domain.put(RECORD_TYPES.FUNDING_PLAN, fundingPlanId, record, { actorId, eventType: 'FUNDING_PLAN_CREATED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.FUNDING_PLAN, objectId: fundingPlanId, eventType: 'FUNDING_PLAN_CREATED', actorId, payload: { homeProjectId: record.homeProjectId, totalPlanned, remainingGap: record.remainingGap } });
    const linkedProject = { ...homeProject, fundingPlanId, state: 'FUNDING_PLANNING', updatedAt: timestamp };
    await this.domain.put(RECORD_TYPES.HOME_PROJECT, homeProject.homeProjectId, linkedProject, { actorId, eventType: 'HOME_PROJECT_FUNDING_PLAN_LINKED' });
    return record;
  }

  async transitionFundingPlan(fundingPlanId, targetState, input = {}, actorId = null) {
    const current = this.getFundingPlan(fundingPlanId);
    if (!current) throw new Error('Funding Plan not found.');
    const state = requiredString(targetState, 'state').toUpperCase();
    if (!FUNDING_PLAN_STATES.has(state)) throw new Error(`Unsupported Funding Plan state: ${state}.`);
    const allowed = {
      DRAFT: ['READY_FOR_REVIEW', 'CANCELLED'],
      READY_FOR_REVIEW: ['CUSTOMER_APPROVED', 'DECLINED', 'CANCELLED'],
      CUSTOMER_APPROVED: ['COMMITTED', 'CANCELLED'],
      COMMITTED: ['SETTLEMENT_READY', 'CANCELLED'],
      SETTLEMENT_READY: ['SETTLED', 'CANCELLED'],
      SETTLED: ['ARCHIVED'],
      DECLINED: ['ARCHIVED'],
      CANCELLED: ['ARCHIVED'],
      ARCHIVED: []
    };
    if (!allowed[current.state].includes(state)) throw new Error(`Invalid Funding Plan transition: ${current.state} -> ${state}.`);
    if (state === 'READY_FOR_REVIEW' && current.remainingGap > 0) throw new Error('Funding Plan still has an uncovered funding gap.');
    if (state === 'CUSTOMER_APPROVED' && !input.customerApprovalReference) throw new Error('customerApprovalReference is required.');
    if (state === 'SETTLEMENT_READY' && !current.settlementInstructionsReference && !input.settlementInstructionsReference) throw new Error('Settlement instructions are required.');
    const timestamp = now();
    const updated = {
      ...current,
      state,
      customerApprovalReference: state === 'CUSTOMER_APPROVED' ? input.customerApprovalReference : current.customerApprovalReference,
      settlementInstructionsReference: input.settlementInstructionsReference || current.settlementInstructionsReference,
      approvedBy: state === 'CUSTOMER_APPROVED' ? actorId : current.approvedBy || null,
      approvedAt: state === 'CUSTOMER_APPROVED' ? timestamp : current.approvedAt || null,
      committedAt: state === 'COMMITTED' ? timestamp : current.committedAt || null,
      settlementReadyAt: state === 'SETTLEMENT_READY' ? timestamp : current.settlementReadyAt || null,
      settledAt: state === 'SETTLED' ? timestamp : current.settledAt || null,
      updatedAt: timestamp
    };
    await this.domain.put(RECORD_TYPES.FUNDING_PLAN, fundingPlanId, updated, { actorId, eventType: `FUNDING_PLAN_${state}` });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.FUNDING_PLAN, objectId: fundingPlanId, eventType: `FUNDING_PLAN_${state}`, actorId, payload: { previousState: current.state, state } });
    if (state === 'CUSTOMER_APPROVED') {
      const project = this.getProject(current.homeProjectId);
      await this.domain.put(RECORD_TYPES.HOME_PROJECT, project.homeProjectId, { ...project, state: 'FUNDING_APPROVED', updatedAt: timestamp }, { actorId, eventType: 'HOME_PROJECT_FUNDING_APPROVED' });
    }
    return updated;
  }

  workspace(homeProjectId) {
    const project = this.getProject(homeProjectId);
    if (!project) throw new Error('Home Project not found.');
    const fundingPlan = project.fundingPlanId ? this.getFundingPlan(project.fundingPlanId) : null;
    return {
      homeProject: project,
      fundingPlan,
      financingSummary: {
        purchasePrice: project.purchasePrice,
        verifiedBuyerFunds: project.verifiedBuyerFunds,
        fundingNeeded: project.fundingNeeded,
        totalPlanned: fundingPlan?.totalPlanned || 0,
        remainingGap: fundingPlan?.remainingGap ?? project.fundingNeeded,
        settlementReady: fundingPlan?.state === 'SETTLEMENT_READY',
        nextAction: this.nextAction(project, fundingPlan)
      }
    };
  }

  nextAction(project, plan) {
    if (project.state === 'DRAFT') return 'BEGIN_DATA_COLLECTION';
    if (project.state === 'DATA_COLLECTION') return 'GENERATE_VERIFIED_SNAPSHOT_AND_PACKAGE';
    if (project.state === 'PACKAGE_READY' && !plan) return 'CREATE_FUNDING_PLAN';
    if (plan?.state === 'DRAFT') return plan.remainingGap > 0 ? 'COVER_FUNDING_GAP' : 'SUBMIT_PLAN_FOR_REVIEW';
    if (plan?.state === 'READY_FOR_REVIEW') return 'REQUEST_CUSTOMER_APPROVAL';
    if (plan?.state === 'CUSTOMER_APPROVED') return 'COMMIT_FUNDING_SOURCES';
    if (plan?.state === 'COMMITTED') return 'ADD_SETTLEMENT_INSTRUCTIONS';
    if (plan?.state === 'SETTLEMENT_READY') return 'PROCEED_TO_SETTLEMENT';
    if (project.state === 'SETTLED') return 'CONVERT_TO_ONGOING_ASSET_RECORD';
    return 'REVIEW_PROJECT';
  }
}

export const HOME_FINANCING_SOURCE_TYPES = Object.freeze([...FUNDING_SOURCE_TYPES]);
