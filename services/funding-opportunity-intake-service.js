import crypto from 'node:crypto';

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

    const record = {
      opportunityId: input.opportunityId || id('FOR'),
      applicantParticipantId: input.applicantParticipantId,
      applicantType: input.applicantType || participant.type || 'PARTICIPANT',
      title: input.title,
      opportunityType: input.opportunityType,
      purpose: input.purpose,
      description: input.description || null,
      requestedAmount,
      currency: String(input.currency).toUpperCase(),
      preferredFundingDate: input.preferredFundingDate || null,
      expectedCompletionDate: input.expectedCompletionDate || null,
      fundingStages: input.fundingStages || [],
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

    await this.domain.put(RECORD_TYPE, record.opportunityId, record, {
      actorId,
      eventType: 'FUNDING_OPPORTUNITY_CREATED',
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPE,
      objectId: record.opportunityId,
      eventType: 'FUNDING_OPPORTUNITY_INTAKE_STARTED',
      actorId,
      payload: {
        applicantParticipantId: record.applicantParticipantId,
        opportunityType: record.opportunityType,
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

    const updated = {
      ...current,
      title: input.title ?? current.title,
      opportunityType: input.opportunityType ?? current.opportunityType,
      purpose: input.purpose ?? current.purpose,
      description: input.description ?? current.description,
      requestedAmount: input.requestedAmount == null ? current.requestedAmount : Number(input.requestedAmount),
      currency: input.currency ? String(input.currency).toUpperCase() : current.currency,
      preferredFundingDate: input.preferredFundingDate ?? current.preferredFundingDate,
      expectedCompletionDate: input.expectedCompletionDate ?? current.expectedCompletionDate,
      fundingStages: input.fundingStages ?? current.fundingStages,
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
      eventType: 'FUNDING_OPPORTUNITY_UPDATED',
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

    const missingRequired = Object.entries(required).filter(([, present]) => !present).map(([field]) => field);
    const missingRecommended = Object.entries(recommended).filter(([, present]) => !present).map(([field]) => field);

    return {
      opportunityId,
      intakeComplete: missingRequired.length === 0,
      required,
      recommended,
      missingRequired,
      missingRecommended,
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
        { from: current.status, to: 'INTAKE_COMPLETE', at: completedAt, actorId, note: 'Standardized opportunity intake completed.' },
      ],
    };

    await this.domain.put(RECORD_TYPE, opportunityId, updated, {
      actorId,
      eventType: 'FUNDING_OPPORTUNITY_INTAKE_COMPLETED',
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

    const evidenceIds = unique(input.evidenceIds?.length ? input.evidenceIds : opportunity.evidenceRecordIds || []);
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
};
