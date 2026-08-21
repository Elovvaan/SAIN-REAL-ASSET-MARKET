import crypto from 'node:crypto';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  EVIDENCE: 'FUNDING_OPPORTUNITY_EVIDENCE',
  REQUEST: 'FUNDING_OPPORTUNITY_VERIFICATION_REQUEST',
  FINDING: 'FUNDING_OPPORTUNITY_VERIFICATION_FINDING',
  DECISION: 'FUNDING_OPPORTUNITY_VERIFICATION_DECISION',
  VERIFIED_RECORD: 'FUNDING_OPPORTUNITY_VERIFIED_RECORD',
});

const FINDING_RESULTS = new Set(['VERIFIED', 'PARTIALLY_VERIFIED', 'UNVERIFIED', 'CONFLICT', 'NOT_APPLICABLE']);
const DECISIONS = new Set(['VERIFIED', 'MORE_EVIDENCE_REQUIRED', 'REJECTED_FOR_VERIFICATION']);
const PARTICIPANT_INFORMATION_ACTION = 'COMPLETE_APPLICANT_INFORMATION';

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function now() {
  return new Date().toISOString();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => payload?.[field] == null || payload?.[field] === '');
  if (missing.length) throw new Error(`Missing required fields: ${missing.join(', ')}`);
}

export class FundingOpportunityVerificationService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  async initialize() {
    await this.domain.hydrate(Object.values(TYPES));
    return this.status();
  }

  status() {
    return {
      service: 'SRA Funding Engine Phase 2',
      purpose: 'FUNDING_OPPORTUNITY_VERIFICATION',
      requests: this.domain.list(TYPES.REQUEST).length,
      findings: this.domain.list(TYPES.FINDING).length,
      decisions: this.domain.list(TYPES.DECISION).length,
      verifiedRecords: this.domain.list(TYPES.VERIFIED_RECORD).length,
    };
  }

  getRequest(requestId) {
    return this.domain.get(TYPES.REQUEST, requestId);
  }

  listRequests(filters = {}) {
    return this.domain.list(TYPES.REQUEST).filter((record) => {
      if (filters.opportunityId && record.opportunityId !== filters.opportunityId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  listFindings(requestId) {
    return this.domain.list(TYPES.FINDING).filter((record) => record.verificationRequestId === requestId);
  }

  getDecision(requestId) {
    return this.domain.list(TYPES.DECISION).find((record) => record.verificationRequestId === requestId) || null;
  }

  async startReview(requestId, actorId = null) {
    const request = this.getRequest(requestId);
    if (!request) throw new Error('Verification request was not found.');
    if (!['PENDING', 'MORE_EVIDENCE_REQUIRED'].includes(request.status)) throw new Error(`Verification review cannot begin from ${request.status}.`);

    const updated = {
      ...request,
      status: 'IN_REVIEW',
      reviewedBy: actorId,
      reviewStartedAt: now(),
      updatedAt: now(),
    };
    await this.domain.put(TYPES.REQUEST, requestId, updated, { actorId, eventType: 'FUNDING_VERIFICATION_REVIEW_STARTED' });
    return updated;
  }

  async recordFinding(requestId, input, actorId = null) {
    const request = this.getRequest(requestId);
    if (!request) throw new Error('Verification request was not found.');
    if (request.status !== 'IN_REVIEW') throw new Error('Verification request must be in review before findings are recorded.');
    requireFields(input, ['checkType', 'result']);
    if (!FINDING_RESULTS.has(input.result)) throw new Error(`Unsupported finding result: ${input.result}`);

    const finding = {
      findingId: input.findingId || id('FVF'),
      verificationRequestId: requestId,
      opportunityId: request.opportunityId,
      checkType: input.checkType,
      result: input.result,
      evidenceIds: unique(input.evidenceIds || []),
      sourceRecordIds: unique(input.sourceRecordIds || []),
      observedValue: input.observedValue ?? null,
      expectedValue: input.expectedValue ?? null,
      variance: input.variance ?? null,
      note: input.note || null,
      material: input.material !== false,
      recordedBy: actorId,
      recordedAt: now(),
    };
    await this.domain.put(TYPES.FINDING, finding.findingId, finding, { actorId, eventType: 'FUNDING_VERIFICATION_FINDING_RECORDED' });
    return finding;
  }

  summarize(requestId) {
    const request = this.getRequest(requestId);
    if (!request) throw new Error('Verification request was not found.');
    const findings = this.listFindings(requestId);
    const requestedChecks = request.requestedChecks || [];
    const coveredChecks = unique(findings.map((finding) => finding.checkType));
    const missingChecks = requestedChecks.filter((check) => !coveredChecks.includes(check));
    const conflicts = findings.filter((finding) => finding.result === 'CONFLICT' && finding.material);
    const unverified = findings.filter((finding) => finding.result === 'UNVERIFIED' && finding.material);
    const partial = findings.filter((finding) => finding.result === 'PARTIALLY_VERIFIED' && finding.material);
    const verified = findings.filter((finding) => finding.result === 'VERIFIED');

    return {
      verificationRequestId: requestId,
      opportunityId: request.opportunityId,
      requestedChecks,
      coveredChecks,
      missingChecks,
      counts: {
        total: findings.length,
        verified: verified.length,
        partiallyVerified: partial.length,
        unverified: unverified.length,
        conflicts: conflicts.length,
      },
      blockingFindings: [...conflicts, ...unverified],
      readyForVerifiedDecision: missingChecks.length === 0 && conflicts.length === 0 && unverified.length === 0,
      suggestedDecision: conflicts.length || unverified.length ? 'MORE_EVIDENCE_REQUIRED' : missingChecks.length ? 'MORE_EVIDENCE_REQUIRED' : 'VERIFIED',
    };
  }

  async decide(requestId, input, actorId = null) {
    const request = this.getRequest(requestId);
    if (!request) throw new Error('Verification request was not found.');
    if (request.status !== 'IN_REVIEW') throw new Error('Verification request must be in review before a decision is recorded.');
    requireFields(input, ['decision']);
    if (!DECISIONS.has(input.decision)) throw new Error(`Unsupported verification decision: ${input.decision}`);

    const summary = this.summarize(requestId);
    if (input.decision === 'VERIFIED' && !summary.readyForVerifiedDecision) {
      const error = new Error('Verification cannot be completed while requested checks or blocking findings remain.');
      error.code = 'VERIFICATION_INCOMPLETE';
      error.summary = summary;
      throw error;
    }

    const decision = {
      decisionId: id('FVD'),
      verificationRequestId: requestId,
      opportunityId: request.opportunityId,
      decision: input.decision,
      rationale: input.rationale || null,
      conditions: input.conditions || [],
      missingEvidence: input.missingEvidence || [],
      summary,
      decidedBy: actorId,
      decidedAt: now(),
    };
    await this.domain.put(TYPES.DECISION, decision.decisionId, decision, { actorId, eventType: 'FUNDING_VERIFICATION_DECISION_RECORDED' });

    const requestStatus = input.decision === 'VERIFIED' ? 'COMPLETED' : input.decision === 'MORE_EVIDENCE_REQUIRED' ? 'MORE_EVIDENCE_REQUIRED' : 'CLOSED_UNVERIFIED';
    const requestUpdate = {
      ...request,
      status: requestStatus,
      completedAt: input.decision === 'VERIFIED' ? decision.decidedAt : request.completedAt,
      decisionId: decision.decisionId,
      resultReference: decision.decisionId,
      updatedAt: now(),
    };
    await this.domain.put(TYPES.REQUEST, requestId, requestUpdate, { actorId, eventType: 'FUNDING_VERIFICATION_REQUEST_UPDATED' });

    const opportunity = this.domain.get(TYPES.OPPORTUNITY, request.opportunityId);
    if (!opportunity) throw new Error('Funding opportunity was not found.');

    let opportunityStatus = 'VERIFICATION_IN_PROGRESS';
    let fundingPhase = 'VERIFIED_TRANSACTION_REVIEW';
    if (input.decision === 'VERIFIED') {
      opportunityStatus = 'VERIFIED';
      fundingPhase = 'APPLICANT_INFORMATION_REQUIRED';
    } else if (input.decision === 'MORE_EVIDENCE_REQUIRED') {
      opportunityStatus = 'MORE_EVIDENCE_REQUIRED';
      fundingPhase = 'EVIDENCE_REMEDIATION';
    } else {
      opportunityStatus = 'VERIFICATION_CLOSED';
      fundingPhase = 'CLOSED';
    }

    const decidedAt = decision.decidedAt;
    const participantInformationRequirement = input.decision === 'VERIFIED'
      ? (opportunity.participantInformationRequirement || {
        type: PARTICIPANT_INFORMATION_ACTION,
        status: 'REQUIRED',
        requestedAt: decidedAt,
        requestedBy: actorId,
        alert: 'Action required: complete your applicant information so SRA can prepare the financing instrument.',
      })
      : opportunity.participantInformationRequirement;

    const opportunityUpdate = {
      ...opportunity,
      status: opportunityStatus,
      fundingPhase,
      verificationDecisionId: decision.decisionId,
      ...(participantInformationRequirement ? { participantInformationRequirement } : {}),
      updatedAt: decidedAt,
      history: [
        ...(opportunity.history || []),
        { from: opportunity.status, to: opportunityStatus, at: decidedAt, actorId, note: input.rationale || input.decision },
      ],
    };
    await this.domain.put(TYPES.OPPORTUNITY, opportunity.opportunityId, opportunityUpdate, { actorId, eventType: 'FUNDING_OPPORTUNITY_VERIFICATION_DECIDED' });

    let verifiedRecord = null;
    if (input.decision === 'VERIFIED') {
      verifiedRecord = {
        verifiedRecordId: id('FVRD'),
        opportunityId: opportunity.opportunityId,
        verificationRequestId: requestId,
        decisionId: decision.decisionId,
        applicantParticipantId: opportunity.applicantParticipantId,
        requestedAmount: opportunity.requestedAmount,
        currency: opportunity.currency,
        opportunityType: opportunity.opportunityType,
        purpose: opportunity.purpose,
        evidenceIds: unique(request.evidenceIds || []),
        agreementIds: unique(request.relatedAgreementIds || []),
        transactionIds: unique(request.sourceTransactionIds || []),
        verifiedFacts: summary.coveredChecks,
        status: 'FROZEN',
        frozenAt: decidedAt,
        createdBy: actorId,
      };
      await this.domain.put(TYPES.VERIFIED_RECORD, verifiedRecord.verifiedRecordId, verifiedRecord, { actorId, eventType: 'FUNDING_OPPORTUNITY_VERIFIED_RECORD_CREATED' });
      const verifiedOpportunity = { ...opportunityUpdate, verifiedRecordId: verifiedRecord.verifiedRecordId, updatedAt: decidedAt };
      await this.domain.put(TYPES.OPPORTUNITY, opportunity.opportunityId, verifiedOpportunity, { actorId, eventType: 'PARTICIPANT_APPLICANT_INFORMATION_REQUESTED' });
      await this.domain.lifecycle({
        objectType: TYPES.OPPORTUNITY,
        objectId: opportunity.opportunityId,
        eventType: 'PARTICIPANT_APPLICANT_INFORMATION_REQUESTED',
        actorId,
        payload: { actionType: PARTICIPANT_INFORMATION_ACTION, decisionId: decision.decisionId },
      });
    }

    await this.domain.lifecycle({
      objectType: TYPES.OPPORTUNITY,
      objectId: opportunity.opportunityId,
      eventType: input.decision === 'VERIFIED' ? 'FUNDING_OPPORTUNITY_VERIFIED' : 'FUNDING_OPPORTUNITY_VERIFICATION_EXCEPTION',
      actorId,
      payload: { decisionId: decision.decisionId, decision: input.decision, verifiedRecordId: verifiedRecord?.verifiedRecordId || null },
    });

    return { decision, verifiedRecord, opportunity: this.domain.get(TYPES.OPPORTUNITY, opportunity.opportunityId) };
  }
}

export { TYPES as FUNDING_VERIFICATION_RECORD_TYPES };
