import crypto from 'node:crypto';
import { assertFundingTransactionStructure, normalizeFundingTransactionStructure } from './funding-transaction-structure.js';

const RECORD_TYPE = 'FUNDING_OPPORTUNITY';
const EVIDENCE_RECORD_TYPE = 'FUNDING_OPPORTUNITY_EVIDENCE';
const VERIFICATION_REQUEST_TYPE = 'FUNDING_OPPORTUNITY_VERIFICATION_REQUEST';
const STATES = Object.freeze([
  'DRAFT',
  'INTAKE_IN_PROGRESS',
  'INTAKE_COMPLETE',
  'PENDING_VERIFICATION',
  'VERIFICATION_IN_PROGRESS',
  'WITHDRAWN',
]);
const STARTUP_TYPE = 'STARTUP_BUSINESS';
const HOME_EQUITY_TYPE = 'HOME_EQUITY';
const HOME_EQUITY_OCCUPANCY_TYPES = new Set(['PRIMARY_RESIDENCE', 'SECOND_HOME', 'INVESTMENT_PROPERTY']);
const HOME_EQUITY_SETTLEMENT_ASSETS = new Set(['SRA_COIN', 'EXTERNAL_DIGITAL_ASSET']);
const HOME_EQUITY_REPAYMENT_DENOMINATIONS = new Set(['SRA_COIN', 'USD_REFERENCE', 'SETTLEMENT_ASSET']);
const STARTUP_READINESS_KEYS = Object.freeze([
  'entityFormation', 'equipmentIdentified', 'suppliersIdentified', 'pricingEstablished',
  'workspaceIdentified', 'salesChannelPlan', 'licensesPermitsResearched', 'insuranceNeedsIdentified',
  'initialCustomersOrLeads', 'ownerContribution',
]);

function now() {
  return new Date().toISOString();
}

function id(prefix = 'FOR') {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => payload?.[field] == null || payload?.[field] === '');
  if (missing.length) throw new Error(`Missing required fields: ${missing.join(', ')}`);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function numericOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function normalizeUseOfFunds(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item = {}) => ({
    item: String(item.item || item.use || '').trim(),
    estimatedCost: numericOrNull(item.estimatedCost ?? item.cost),
    evidenceSource: String(item.evidenceSource || item.source || '').trim() || null,
  })).filter((item) => item.item || item.estimatedCost != null || item.evidenceSource);
}

function normalizeStartupPackage(input = {}, current = {}) {
  const startup = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const previous = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const revenue = { ...(previous.revenueRepaymentModel || {}), ...(startup.revenueRepaymentModel || {}) };
  const customer = { ...(previous.customerSalesPlan || {}), ...(startup.customerSalesPlan || {}) };
  const readinessInput = startup.startupReadiness || {};
  const readinessPrevious = previous.startupReadiness || {};
  const readiness = Object.fromEntries(STARTUP_READINESS_KEYS.map((key) => [key, Boolean(readinessInput[key] ?? readinessPrevious[key] ?? false)]));
  return {
    applicantBusiness: {
      ...(previous.applicantBusiness || {}),
      ...(startup.applicantBusiness || {}),
    },
    businessDescription: startup.businessDescription ?? previous.businessDescription ?? null,
    requestedLaunchDate: startup.requestedLaunchDate ?? previous.requestedLaunchDate ?? null,
    exactFundingPurpose: startup.exactFundingPurpose ?? previous.exactFundingPurpose ?? null,
    useOfFunds: startup.useOfFunds === undefined ? normalizeUseOfFunds(previous.useOfFunds || []) : normalizeUseOfFunds(startup.useOfFunds),
    revenueRepaymentModel: {
      primaryProductService: revenue.primaryProductService ?? null,
      averageSellingPrice: numericOrNull(revenue.averageSellingPrice),
      estimatedDirectCostPerSale: numericOrNull(revenue.estimatedDirectCostPerSale),
      expectedMonthlySalesVolume: numericOrNull(revenue.expectedMonthlySalesVolume),
      expectedMonthlyRevenue: numericOrNull(revenue.expectedMonthlyRevenue),
      expectedMonthlyOperatingExpenses: numericOrNull(revenue.expectedMonthlyOperatingExpenses),
      expectedMonthlyAvailableBeforeDebtPayments: numericOrNull(revenue.expectedMonthlyAvailableBeforeDebtPayments),
    },
    customerSalesPlan: {
      targetCustomer: customer.targetCustomer ?? null,
      salesChannel: customer.salesChannel ?? null,
      demandEvidence: customer.demandEvidence ?? null,
    },
    startupReadiness: readiness,
    supportingEvidenceChecklist: Array.isArray(startup.supportingEvidenceChecklist)
      ? unique(startup.supportingEvidenceChecklist)
      : unique(previous.supportingEvidenceChecklist || []),
    applicantStatement: {
      ...(previous.applicantStatement || {}),
      ...(startup.applicantStatement || {}),
      certifiedAccurate: Boolean(startup.applicantStatement?.certifiedAccurate ?? previous.applicantStatement?.certifiedAccurate ?? false),
    },
  };
}

function requiredText(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function positiveNumber(value, field) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) throw new Error(`${field} must be greater than zero.`);
  return Number(normalized.toFixed(2));
}

function nonNegativeNumber(value, field) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) throw new Error(`${field} must be zero or greater.`);
  return Number(normalized.toFixed(2));
}

function allowedValue(value, field, allowed) {
  const normalized = requiredText(value, field).toUpperCase();
  if (!allowed.has(normalized)) throw new Error(`${field} is not supported.`);
  return normalized;
}

function normalizeHomeEquityPackage(input = {}, requestedAmount, current = {}) {
  const merged = { ...(current || {}), ...(input || {}) };
  const property = { ...(current?.property || {}), ...(input?.property || {}) };
  const appraisedValue = positiveNumber(merged.appraisedValue, 'homeEquityFunding.appraisedValue');
  const existingLienBalance = nonNegativeNumber(merged.existingLienBalance, 'homeEquityFunding.existingLienBalance');
  const maxCombinedLtvPercent = positiveNumber(merged.maxCombinedLtvPercent, 'homeEquityFunding.maxCombinedLtvPercent');
  if (maxCombinedLtvPercent >= 100) throw new Error('homeEquityFunding.maxCombinedLtvPercent must be less than 100.');
  const principalAdvance = positiveNumber(requestedAmount, 'requestedAmount');
  const fixedReturnAmount = nonNegativeNumber(merged.fixedReturnAmount, 'homeEquityFunding.fixedReturnAmount');
  const termMonths = Number(merged.termMonths);
  if (!Number.isInteger(termMonths) || termMonths <= 0) throw new Error('homeEquityFunding.termMonths must be a positive whole number.');
  const verifiedEquity = Number(Math.max(0, appraisedValue - existingLienBalance).toFixed(2));
  const requiredEquityCushion = Number((appraisedValue * (1 - maxCombinedLtvPercent / 100)).toFixed(2));
  const maximumPrincipalAdvance = Number(Math.max(0, appraisedValue * (maxCombinedLtvPercent / 100) - existingLienBalance).toFixed(2));
  const projectedCombinedLtvPercent = Number((((existingLienBalance + principalAdvance) / appraisedValue) * 100).toFixed(4));
  const withinAdvanceLimit = principalAdvance <= maximumPrincipalAdvance;
  if (!withinAdvanceLimit) {
    const error = new Error(`Requested amount exceeds the home equity advance limit of ${maximumPrincipalAdvance.toFixed(2)}.`);
    error.code = 'HOME_EQUITY_LIMIT_EXCEEDED';
    throw error;
  }
  const settlementAsset = allowedValue(merged.settlementAsset, 'homeEquityFunding.settlementAsset', HOME_EQUITY_SETTLEMENT_ASSETS);
  const repaymentSupportInput = { ...(current?.repaymentSupport || {}), ...(input?.repaymentSupport || {}) };
  const verifiedMonthlyIncome = positiveNumber(repaymentSupportInput.verifiedMonthlyIncome, 'homeEquityFunding.repaymentSupport.verifiedMonthlyIncome');
  const monthlyHousingExpense = nonNegativeNumber(repaymentSupportInput.monthlyHousingExpense, 'homeEquityFunding.repaymentSupport.monthlyHousingExpense');
  const otherMonthlyObligations = nonNegativeNumber(repaymentSupportInput.otherMonthlyObligations, 'homeEquityFunding.repaymentSupport.otherMonthlyObligations');
  const monthlyAvailableForRepayment = Number((verifiedMonthlyIncome - monthlyHousingExpense - otherMonthlyObligations).toFixed(2));
  const monthlyEquivalentPayment = Number(((principalAdvance + fixedReturnAmount) / termMonths).toFixed(2));
  const paymentCoverageRatio = monthlyEquivalentPayment > 0 ? Number((monthlyAvailableForRepayment / monthlyEquivalentPayment).toFixed(4)) : null;
  return {
    transactionForm: 'CLOSED_END_FIXED_RETURN',
    property: {
      address: requiredText(property.address, 'homeEquityFunding.property.address'),
      parcelId: requiredText(property.parcelId, 'homeEquityFunding.property.parcelId'),
      ownerName: requiredText(property.ownerName, 'homeEquityFunding.property.ownerName'),
      occupancyType: allowedValue(property.occupancyType, 'homeEquityFunding.property.occupancyType', HOME_EQUITY_OCCUPANCY_TYPES),
    },
    appraisedValue,
    valuationDate: requiredText(merged.valuationDate, 'homeEquityFunding.valuationDate'),
    valuationReference: requiredText(merged.valuationReference, 'homeEquityFunding.valuationReference'),
    existingLienBalance,
    existingLienReference: requiredText(merged.existingLienReference, 'homeEquityFunding.existingLienReference'),
    lienPosition: requiredText(merged.lienPosition, 'homeEquityFunding.lienPosition').toUpperCase(),
    maxCombinedLtvPercent,
    principalAdvance,
    fixedReturnAmount,
    totalRepaymentObligation: Number((principalAdvance + fixedReturnAmount).toFixed(2)),
    termMonths,
    repaymentFrequency: requiredText(merged.repaymentFrequency, 'homeEquityFunding.repaymentFrequency').toUpperCase(),
    settlementAsset,
    settlementAssetCode: settlementAsset === 'SRA_COIN'
      ? 'SRA'
      : requiredText(merged.settlementAssetCode, 'homeEquityFunding.settlementAssetCode').toUpperCase(),
    settlementNetwork: requiredText(merged.settlementNetwork, 'homeEquityFunding.settlementNetwork'),
    repaymentDenomination: allowedValue(merged.repaymentDenomination, 'homeEquityFunding.repaymentDenomination', HOME_EQUITY_REPAYMENT_DENOMINATIONS),
    repaymentSupport: {
      verifiedMonthlyIncome,
      monthlyHousingExpense,
      otherMonthlyObligations,
      evidenceReference: requiredText(repaymentSupportInput.evidenceReference, 'homeEquityFunding.repaymentSupport.evidenceReference'),
      monthlyAvailableForRepayment,
      monthlyEquivalentPayment,
      paymentCoverageRatio,
    },
    verifiedEquity,
    requiredEquityCushion,
    maximumPrincipalAdvance,
    projectedCombinedLtvPercent,
    withinAdvanceLimit,
  };
}

function startupCompleteness(record) {
  const startup = record.startupFundingRequest || {};
  const business = startup.applicantBusiness || {};
  const revenue = startup.revenueRepaymentModel || {};
  const customer = startup.customerSalesPlan || {};
  const statement = startup.applicantStatement || {};
  const useOfFunds = Array.isArray(startup.useOfFunds) ? startup.useOfFunds : [];
  const useOfFundsTotal = Number(useOfFunds.reduce((sum, line) => sum + Number(line.estimatedCost || 0), 0).toFixed(2));
  const requestedAmount = Number(record.requestedAmount || 0);
  const useOfFundsMatchesRequest = requestedAmount > 0 && Math.abs(useOfFundsTotal - requestedAmount) < 0.01;
  return {
    required: {
      businessLegalEntityName: hasValue(business.businessLegalEntityName),
      businessLocation: hasValue(business.businessLocation),
      applicantContact: hasValue(business.emailPhone),
      businessFormationStatus: hasValue(business.businessFormationStatus),
      businessDescription: hasValue(startup.businessDescription),
      requestedLaunchDate: hasValue(startup.requestedLaunchDate),
      exactFundingPurpose: hasValue(startup.exactFundingPurpose),
      useOfFunds: useOfFunds.length > 0 && useOfFunds.every((line) => hasValue(line.item) && Number(line.estimatedCost) >= 0),
      useOfFundsMatchesRequest,
      primaryProductService: hasValue(revenue.primaryProductService),
      averageSellingPrice: revenue.averageSellingPrice != null,
      estimatedDirectCostPerSale: revenue.estimatedDirectCostPerSale != null,
      expectedMonthlySalesVolume: revenue.expectedMonthlySalesVolume != null,
      expectedMonthlyRevenue: revenue.expectedMonthlyRevenue != null,
      expectedMonthlyOperatingExpenses: revenue.expectedMonthlyOperatingExpenses != null,
      expectedMonthlyAvailableBeforeDebtPayments: revenue.expectedMonthlyAvailableBeforeDebtPayments != null,
      targetCustomer: hasValue(customer.targetCustomer),
      salesChannel: hasValue(customer.salesChannel),
      demandEvidence: hasValue(customer.demandEvidence),
      applicantCertification: statement.certifiedAccurate === true,
      applicantPrintedName: hasValue(statement.printedName),
      applicantCertificationDate: hasValue(statement.date),
    },
    recommended: {
      tradeName: hasValue(business.businessTradeName),
      evidenceForUseOfFunds: useOfFunds.some((line) => hasValue(line.evidenceSource)),
      supportingEvidenceRegistered: Array.isArray(record.evidenceRecordIds) && record.evidenceRecordIds.length > 0,
      supportingEvidenceChecklist: Array.isArray(startup.supportingEvidenceChecklist) && startup.supportingEvidenceChecklist.length > 0,
    },
    useOfFundsTotal,
    useOfFundsDifference: Number((requestedAmount - useOfFundsTotal).toFixed(2)),
    readiness: startup.startupReadiness || {},
  };
}

export class FundingOpportunityIntakeService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  async initialize() {
    await this.domain.hydrate([RECORD_TYPE, EVIDENCE_RECORD_TYPE, VERIFICATION_REQUEST_TYPE]);
    return this.status();
  }

  status() {
    return {
      service: 'SRA Funding Engine Phase 1',
      recordType: RECORD_TYPE,
      purpose: 'STANDARDIZED_FUNDING_OPPORTUNITY_INTAKE',
      count: this.domain.list(RECORD_TYPE).length,
      evidenceCount: this.domain.list(EVIDENCE_RECORD_TYPE).length,
      verificationRequestCount: this.domain.list(VERIFICATION_REQUEST_TYPE).length,
      startupBusinessCount: this.domain.list(RECORD_TYPE).filter((record) => record.opportunityType === STARTUP_TYPE).length,
      homeEquityCount: this.domain.list(RECORD_TYPE).filter((record) => record.opportunityType === HOME_EQUITY_TYPE).length,
    };
  }

  list(filters = {}) {
    return this.domain.list(RECORD_TYPE).filter((record) => {
      if (filters.status && record.status !== filters.status) return false;
      if (filters.applicantParticipantId && record.applicantParticipantId !== filters.applicantParticipantId) return false;
      if (filters.opportunityType && record.opportunityType !== filters.opportunityType) return false;
      return true;
    });
  }

  get(opportunityId) {
    return this.domain.get(RECORD_TYPE, opportunityId);
  }

  listEvidence(opportunityId) {
    return this.domain.list(EVIDENCE_RECORD_TYPE).filter((record) => record.opportunityId === opportunityId);
  }

  listVerificationRequests(opportunityId) {
    return this.domain.list(VERIFICATION_REQUEST_TYPE).filter((record) => record.opportunityId === opportunityId);
  }

  async create(input, actorId = null) {
    requireFields(input, ['applicantParticipantId', 'title', 'opportunityType', 'purpose', 'requestedAmount', 'currency']);
    const participant = this.domain.get('PARTICIPANT', input.applicantParticipantId);
    if (!participant) throw new Error('Applicant participant was not found.');

    const requestedAmount = Number(input.requestedAmount);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw new Error('Requested amount must be greater than zero.');
    }
    const opportunityType = String(input.opportunityType).toUpperCase();
    const proposedTransactionStructure = input.proposedTransactionStructure
      ? assertFundingTransactionStructure(input.proposedTransactionStructure, opportunityType)
      : null;
    const startupFundingRequest = opportunityType === STARTUP_TYPE ? normalizeStartupPackage(input.startupFundingRequest || {}) : null;
    const homeEquityFunding = opportunityType === HOME_EQUITY_TYPE
      ? normalizeHomeEquityPackage(input.homeEquityFunding || {}, requestedAmount)
      : null;

    const record = {
      opportunityId: input.opportunityId || id('FOR'),
      applicantParticipantId: input.applicantParticipantId,
      applicantType: input.applicantType || participant.type || 'PARTICIPANT',
      title: input.title,
      opportunityType,
      purpose: input.purpose,
      proposedTransactionStructure,
      approvedTransactionStructure: null,
      description: input.description || startupFundingRequest?.businessDescription || null,
      requestedAmount,
      currency: String(input.currency).toUpperCase(),
      preferredFundingDate: input.preferredFundingDate || startupFundingRequest?.requestedLaunchDate || null,
      expectedCompletionDate: input.expectedCompletionDate || null,
      fundingStages: input.fundingStages || [],
      startupFundingRequest,
      homeEquityFunding,
      supportingDocumentIds: unique(input.supportingDocumentIds || []),
      evidenceRecordIds: [],
      relatedParticipantIds: unique([input.applicantParticipantId, ...(input.relatedParticipantIds || [])]),
      relatedAgreementIds: unique(input.relatedAgreementIds || []),
      relatedAssetIds: unique(input.relatedAssetIds || []),
      relatedProjectIds: unique(input.relatedProjectIds || []),
      sourceTransactionIds: unique(input.sourceTransactionIds || []),
      verificationRequestIds: [],
      intakeNotes: input.intakeNotes || null,
      status: 'INTAKE_IN_PROGRESS',
      fundingPhase: 'OPPORTUNITY_INTAKE',
      completeness: null,
      submittedBy: actorId || input.applicantParticipantId,
      createdAt: now(),
      updatedAt: now(),
      intakeCompletedAt: null,
      withdrawnAt: null,
      history: [],
    };

    if (opportunityType === STARTUP_TYPE) {
      const startup = startupCompleteness(record);
      const missingRequired = Object.entries(startup.required).filter(([, present]) => !present).map(([field]) => `startup.${field}`);
      if (missingRequired.length) {
        const error = new Error(`Startup business funding request is incomplete: ${missingRequired.join(', ')}`);
        error.code = 'INTAKE_INCOMPLETE';
        error.completeness = { opportunityId: record.opportunityId, intakeComplete: false, missingRequired, startup };
        throw error;
      }
    }

    await this.domain.put(RECORD_TYPE, record.opportunityId, record, {
      actorId,
      eventType: opportunityType === STARTUP_TYPE ? 'STARTUP_BUSINESS_FUNDING_REQUEST_CREATED' : 'FUNDING_OPPORTUNITY_CREATED',
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPE,
      objectId: record.opportunityId,
      eventType: 'FUNDING_OPPORTUNITY_INTAKE_STARTED',
      actorId,
      payload: {
        applicantParticipantId: record.applicantParticipantId,
        opportunityType: record.opportunityType,
        proposedTransactionStructure: record.proposedTransactionStructure,
        requestedAmount: record.requestedAmount,
        currency: record.currency,
      },
    });
    return record;
  }

  async update(opportunityId, input, actorId = null) {
    const current = this.get(opportunityId);
    if (!current) throw new Error('Funding opportunity was not found.');
    if (current.status === 'WITHDRAWN') throw new Error('A withdrawn opportunity cannot be updated.');
    const opportunityType = String(input.opportunityType ?? current.opportunityType).toUpperCase();
    const proposedTransactionStructure = input.proposedTransactionStructure === undefined
      ? current.proposedTransactionStructure || null
      : assertFundingTransactionStructure(input.proposedTransactionStructure, opportunityType);
    const startupFundingRequest = opportunityType === STARTUP_TYPE
      ? normalizeStartupPackage(input.startupFundingRequest === undefined ? current.startupFundingRequest || {} : input.startupFundingRequest, current.startupFundingRequest || {})
      : null;
    const nextRequestedAmount = input.requestedAmount == null ? current.requestedAmount : Number(input.requestedAmount);
    const homeEquityFunding = opportunityType === HOME_EQUITY_TYPE
      ? normalizeHomeEquityPackage(input.homeEquityFunding === undefined ? current.homeEquityFunding || {} : input.homeEquityFunding, nextRequestedAmount, current.homeEquityFunding || {})
      : null;

    const updated = {
      ...current,
      title: input.title ?? current.title,
      opportunityType,
      purpose: input.purpose ?? current.purpose,
      proposedTransactionStructure,
      description: input.description ?? startupFundingRequest?.businessDescription ?? current.description,
      requestedAmount: nextRequestedAmount,
      currency: input.currency ? String(input.currency).toUpperCase() : current.currency,
      preferredFundingDate: input.preferredFundingDate ?? startupFundingRequest?.requestedLaunchDate ?? current.preferredFundingDate,
      expectedCompletionDate: input.expectedCompletionDate ?? current.expectedCompletionDate,
      fundingStages: input.fundingStages ?? current.fundingStages,
      startupFundingRequest,
      homeEquityFunding,
      supportingDocumentIds: unique(input.supportingDocumentIds ?? current.supportingDocumentIds),
      relatedParticipantIds: unique(input.relatedParticipantIds ?? current.relatedParticipantIds),
      relatedAgreementIds: unique(input.relatedAgreementIds ?? current.relatedAgreementIds),
      relatedAssetIds: unique(input.relatedAssetIds ?? current.relatedAssetIds),
      relatedProjectIds: unique(input.relatedProjectIds ?? current.relatedProjectIds),
      sourceTransactionIds: unique(input.sourceTransactionIds ?? current.sourceTransactionIds),
      intakeNotes: input.intakeNotes ?? current.intakeNotes,
      updatedAt: now(),
    };

    if (!Number.isFinite(updated.requestedAmount) || updated.requestedAmount <= 0) {
      throw new Error('Requested amount must be greater than zero.');
    }

    await this.domain.put(RECORD_TYPE, opportunityId, updated, {
      actorId,
      eventType: opportunityType === STARTUP_TYPE ? 'STARTUP_BUSINESS_FUNDING_REQUEST_UPDATED' : 'FUNDING_OPPORTUNITY_UPDATED',
    });
    return updated;
  }

  async registerEvidence(opportunityId, input, actorId = null) {
    const opportunity = this.get(opportunityId);
    if (!opportunity) throw new Error('Funding opportunity was not found.');
    if (opportunity.status === 'WITHDRAWN') throw new Error('Evidence cannot be added to a withdrawn opportunity.');
    requireFields(input, ['evidenceType', 'sourceReference']);

    const evidence = {
      evidenceId: input.evidenceId || id('FOE'),
      opportunityId,
      evidenceType: input.evidenceType,
      title: input.title || null,
      sourceReference: input.sourceReference,
      documentId: input.documentId || null,
      agreementId: input.agreementId || null,
      transactionId: input.transactionId || null,
      participantIds: unique(input.participantIds || []),
      assetIds: unique(input.assetIds || []),
      projectIds: unique(input.projectIds || []),
      provenance: input.provenance || {},
      status: input.status || 'REGISTERED',
      verificationStatus: 'NOT_STARTED',
      submittedBy: actorId,
      submittedAt: now(),
      updatedAt: now(),
    };

    await this.domain.put(EVIDENCE_RECORD_TYPE, evidence.evidenceId, evidence, {
      actorId,
      eventType: 'FUNDING_OPPORTUNITY_EVIDENCE_REGISTERED',
    });

    const updated = {
      ...opportunity,
      evidenceRecordIds: unique([...(opportunity.evidenceRecordIds || []), evidence.evidenceId]),
      supportingDocumentIds: unique([...(opportunity.supportingDocumentIds || []), evidence.documentId]),
      relatedAgreementIds: unique([...(opportunity.relatedAgreementIds || []), evidence.agreementId]),
      sourceTransactionIds: unique([...(opportunity.sourceTransactionIds || []), evidence.transactionId]),
      relatedParticipantIds: unique([...(opportunity.relatedParticipantIds || []), ...evidence.participantIds]),
      relatedAssetIds: unique([...(opportunity.relatedAssetIds || []), ...evidence.assetIds]),
      relatedProjectIds: unique([...(opportunity.relatedProjectIds || []), ...evidence.projectIds]),
      updatedAt: now(),
    };
    await this.domain.put(RECORD_TYPE, opportunityId, updated, {
      actorId,
      eventType: 'FUNDING_OPPORTUNITY_EVIDENCE_LINKED',
    });
    return evidence;
  }

  assessCompleteness(opportunityId) {
    const record = this.get(opportunityId);
    if (!record) throw new Error('Funding opportunity was not found.');

    const required = {
      applicantParticipantId: Boolean(record.applicantParticipantId),
      title: Boolean(record.title),
      opportunityType: Boolean(record.opportunityType),
      purpose: Boolean(record.purpose),
      proposedTransactionStructure: Boolean(normalizeFundingTransactionStructure(record.proposedTransactionStructure)),
      requestedAmount: Number(record.requestedAmount) > 0,
      currency: Boolean(record.currency),
      relatedParticipants: Array.isArray(record.relatedParticipantIds) && record.relatedParticipantIds.length > 0,
    };

    const recommended = {
      description: Boolean(record.description),
      preferredFundingDate: Boolean(record.preferredFundingDate),
      expectedCompletionDate: Boolean(record.expectedCompletionDate),
      supportingDocumentsRegistered: Array.isArray(record.supportingDocumentIds) && record.supportingDocumentIds.length > 0,
      agreementsRegistered: Array.isArray(record.relatedAgreementIds) && record.relatedAgreementIds.length > 0,
      sourceTransactionsRegistered: Array.isArray(record.sourceTransactionIds) && record.sourceTransactionIds.length > 0,
      evidenceRecordsRegistered: Array.isArray(record.evidenceRecordIds) && record.evidenceRecordIds.length > 0,
    };

    let startup = null;
    if (record.opportunityType === STARTUP_TYPE) {
      startup = startupCompleteness(record);
      Object.assign(required, Object.fromEntries(Object.entries(startup.required).map(([key, value]) => [`startup.${key}`, value])));
      Object.assign(recommended, Object.fromEntries(Object.entries(startup.recommended).map(([key, value]) => [`startup.${key}`, value])));
    }
    if (record.opportunityType === HOME_EQUITY_TYPE) {
      const homeEquity = record.homeEquityFunding || {};
      Object.assign(required, {
        'homeEquity.transactionForm': homeEquity.transactionForm === 'CLOSED_END_FIXED_RETURN',
        'homeEquity.propertyAddress': hasValue(homeEquity.property?.address),
        'homeEquity.parcelId': hasValue(homeEquity.property?.parcelId),
        'homeEquity.ownerName': hasValue(homeEquity.property?.ownerName),
        'homeEquity.valuationReference': hasValue(homeEquity.valuationReference),
        'homeEquity.existingLienReference': hasValue(homeEquity.existingLienReference),
        'homeEquity.withinAdvanceLimit': homeEquity.withinAdvanceLimit === true,
        'homeEquity.settlementAsset': hasValue(homeEquity.settlementAsset),
        'homeEquity.repaymentDenomination': hasValue(homeEquity.repaymentDenomination),
        'homeEquity.repaymentSupport': hasValue(homeEquity.repaymentSupport?.evidenceReference) && Number(homeEquity.repaymentSupport?.verifiedMonthlyIncome) > 0,
      });
    }

    const missingRequired = Object.entries(required).filter(([, present]) => !present).map(([field]) => field);
    const missingRecommended = Object.entries(recommended).filter(([, present]) => !present).map(([field]) => field);

    return {
      opportunityId,
      intakeComplete: missingRequired.length === 0,
      required,
      recommended,
      missingRequired,
      missingRecommended,
      startup,
      nextPhase: missingRequired.length === 0 ? 'PENDING_VERIFICATION' : 'OPPORTUNITY_INTAKE',
    };
  }

  async completeIntake(opportunityId, actorId = null) {
    const current = this.get(opportunityId);
    if (!current) throw new Error('Funding opportunity was not found.');
    const completeness = this.assessCompleteness(opportunityId);
    if (!completeness.intakeComplete) {
      const error = new Error(`Funding opportunity intake is incomplete: ${completeness.missingRequired.join(', ')}`);
      error.code = 'INTAKE_INCOMPLETE';
      error.completeness = completeness;
      throw error;
    }

    const completedAt = now();
    const updated = {
      ...current,
      status: 'INTAKE_COMPLETE',
      fundingPhase: 'PENDING_VERIFICATION',
      completeness,
      intakeCompletedAt: completedAt,
      updatedAt: completedAt,
      history: [
        ...(current.history || []),
        { from: current.status, to: 'INTAKE_COMPLETE', at: completedAt, actorId, note: current.opportunityType === STARTUP_TYPE ? 'Startup Business Funding Request Package intake completed.' : 'Standardized opportunity intake completed.' },
      ],
    };

    await this.domain.put(RECORD_TYPE, opportunityId, updated, {
      actorId,
      eventType: current.opportunityType === STARTUP_TYPE ? 'STARTUP_BUSINESS_FUNDING_INTAKE_COMPLETED' : 'FUNDING_OPPORTUNITY_INTAKE_COMPLETED',
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPE,
      objectId: opportunityId,
      eventType: 'FUNDING_OPPORTUNITY_READY_FOR_VERIFICATION',
      actorId,
      payload: {
        nextPhase: 'PENDING_VERIFICATION',
        supportingDocumentCount: updated.supportingDocumentIds.length,
        evidenceRecordCount: updated.evidenceRecordIds.length,
        relatedAgreementCount: updated.relatedAgreementIds.length,
        sourceTransactionCount: updated.sourceTransactionIds.length,
        startupBusiness: current.opportunityType === STARTUP_TYPE,
      },
    });
    return updated;
  }

  async createVerificationRequest(opportunityId, input = {}, actorId = null) {
    const opportunity = this.get(opportunityId);
    if (!opportunity) throw new Error('Funding opportunity was not found.');
    if (!['INTAKE_COMPLETE', 'PENDING_VERIFICATION'].includes(opportunity.status)) {
      throw new Error(`Verification cannot begin from ${opportunity.status}.`);
    }
    const completeness = this.assessCompleteness(opportunityId);
    if (!completeness.intakeComplete) {
      const error = new Error(`Funding opportunity intake is incomplete: ${completeness.missingRequired.join(', ')}`);
      error.code = 'INTAKE_INCOMPLETE';
      error.completeness = completeness;
      throw error;
    }

    const evidenceIds = unique(input.evidenceIds?.length ? input.evidenceIds : opportunity.evidenceRecordIds || []);
    const startupChecks = opportunity.opportunityType === STARTUP_TYPE ? [
      'STARTUP_USE_OF_FUNDS_SUPPORT',
      'STARTUP_REVENUE_ASSUMPTIONS',
      'STARTUP_DEMAND_EVIDENCE',
      'STARTUP_READINESS_EVIDENCE',
    ] : [];
    const homeEquityChecks = opportunity.opportunityType === HOME_EQUITY_TYPE ? [
      'PROPERTY_OWNERSHIP_AND_TITLE',
      'PROPERTY_VALUATION',
      'EXISTING_LIENS_AND_PRIORITY',
      'EQUITY_AND_COMBINED_LTV',
      'PROPERTY_TAX_AND_INSURANCE_STATUS',
      'SETTLEMENT_ASSET_AND_REPAYMENT_TERMS',
    ] : [];
    const request = {
      verificationRequestId: input.verificationRequestId || id('FVR'),
      opportunityId,
      applicantParticipantId: opportunity.applicantParticipantId,
      evidenceIds,
      supportingDocumentIds: unique(opportunity.supportingDocumentIds || []),
      relatedAgreementIds: unique(opportunity.relatedAgreementIds || []),
      sourceTransactionIds: unique(opportunity.sourceTransactionIds || []),
      verificationScope: input.verificationScope || 'FUNDING_OPPORTUNITY_FACTS_AND_RELATIONSHIPS',
      requestedChecks: input.requestedChecks || [
        'PARTICIPANT_IDENTITY',
        'DOCUMENT_PROVENANCE',
        'AGREEMENT_EXISTENCE',
        'TRANSACTION_EXISTENCE',
        'AMOUNT_CONSISTENCY',
        'RELATIONSHIP_CONSISTENCY',
        ...startupChecks,
        ...homeEquityChecks,
      ],
      status: 'PENDING',
      requestedBy: actorId,
      requestedAt: now(),
      completedAt: null,
      resultReference: null,
    };

    await this.domain.put(VERIFICATION_REQUEST_TYPE, request.verificationRequestId, request, {
      actorId,
      eventType: 'FUNDING_OPPORTUNITY_VERIFICATION_REQUESTED',
    });

    const updated = {
      ...opportunity,
      status: 'VERIFICATION_IN_PROGRESS',
      fundingPhase: 'VERIFIED_TRANSACTION_REVIEW',
      verificationRequestIds: unique([...(opportunity.verificationRequestIds || []), request.verificationRequestId]),
      updatedAt: now(),
      history: [
        ...(opportunity.history || []),
        { from: opportunity.status, to: 'VERIFICATION_IN_PROGRESS', at: now(), actorId, note: 'Verification request created.' },
      ],
    };
    await this.domain.put(RECORD_TYPE, opportunityId, updated, {
      actorId,
      eventType: 'FUNDING_OPPORTUNITY_VERIFICATION_STARTED',
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPE,
      objectId: opportunityId,
      eventType: 'FUNDING_OPPORTUNITY_HANDED_TO_VERIFICATION',
      actorId,
      payload: {
        verificationRequestId: request.verificationRequestId,
        evidenceCount: request.evidenceIds.length,
        requestedChecks: request.requestedChecks,
      },
    });
    return request;
  }

  async withdraw(opportunityId, reason, actorId = null) {
    const current = this.get(opportunityId);
    if (!current) throw new Error('Funding opportunity was not found.');
    const at = now();
    const updated = {
      ...current,
      status: 'WITHDRAWN',
      fundingPhase: 'CLOSED',
      withdrawnAt: at,
      withdrawalReason: reason || null,
      updatedAt: at,
      history: [
        ...(current.history || []),
        { from: current.status, to: 'WITHDRAWN', at, actorId, note: reason || null },
      ],
    };
    await this.domain.put(RECORD_TYPE, opportunityId, updated, {
      actorId,
      eventType: 'FUNDING_OPPORTUNITY_WITHDRAWN',
    });
    return updated;
  }
}

export {
  RECORD_TYPE as FUNDING_OPPORTUNITY_RECORD_TYPE,
  EVIDENCE_RECORD_TYPE as FUNDING_OPPORTUNITY_EVIDENCE_RECORD_TYPE,
  VERIFICATION_REQUEST_TYPE as FUNDING_OPPORTUNITY_VERIFICATION_REQUEST_TYPE,
  STATES as FUNDING_OPPORTUNITY_STATES,
  STARTUP_TYPE as STARTUP_BUSINESS_OPPORTUNITY_TYPE,
};
