import express from 'express';

const PARTICIPANT_TYPE = 'PARTICIPANT';
const OPPORTUNITY_TYPE = 'FUNDING_OPPORTUNITY';
const ACTION_TYPE = 'COMPLETE_APPLICANT_INFORMATION';

function actorId(req) {
  return req.sraIdentity?.actorId || req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveParticipantForIdentity(service, identity) {
  if (!identity?.actorId) return null;
  const participants = service.domain.list(PARTICIPANT_TYPE);
  const direct = participants.find((record) => record?.metadata?.accessAccountId === identity.actorId);
  if (direct) return direct;
  const universal = participants.find((record) => identity.universalAccountId && record?.metadata?.universalAccountId === identity.universalAccountId);
  if (universal) return universal;
  const email = normalizeEmail(identity.email);
  if (!email) return null;
  const emailMatches = participants.filter((record) => normalizeEmail(record?.metadata?.contactEmail || record?.metadata?.email) === email);
  return emailMatches.length === 1 ? emailMatches[0] : null;
}

function participantAction(opportunity) {
  return opportunity?.participantInformationRequirement || null;
}

function cleanApplicantInformation(input = {}) {
  const applicantType = String(input.applicantType || '').trim().toUpperCase();
  if (!['PERSON', 'ORGANIZATION', 'TRUST', 'SPV'].includes(applicantType)) throw new Error('Applicant type is required.');
  const legalName = String(input.legalName || '').trim();
  const email = normalizeEmail(input.email);
  const phone = String(input.phone || '').trim();
  const addressLine1 = String(input.addressLine1 || '').trim();
  const city = String(input.city || '').trim();
  const state = String(input.state || '').trim();
  const postalCode = String(input.postalCode || '').trim();
  if (!legalName || !email || !phone || !addressLine1 || !city || !state || !postalCode) {
    throw new Error('Legal name, email, phone, and physical address are required.');
  }
  const common = { applicantType, legalName, email, phone, physicalAddress: { addressLine1, addressLine2: String(input.addressLine2 || '').trim() || null, city, state, postalCode, country: String(input.country || 'US').trim().toUpperCase() || 'US' } };
  if (applicantType === 'PERSON') {
    const dateOfBirth = String(input.dateOfBirth || '').trim();
    if (!dateOfBirth) throw new Error('Date of birth is required for an individual applicant.');
    return { ...common, dateOfBirth };
  }
  const jurisdiction = String(input.jurisdiction || '').trim();
  const authorizedSignerName = String(input.authorizedSignerName || '').trim();
  const authorizedSignerTitle = String(input.authorizedSignerTitle || '').trim();
  if (!jurisdiction || !authorizedSignerName || !authorizedSignerTitle) {
    throw new Error('Formation jurisdiction and authorized signer information are required for an entity applicant.');
  }
  return { ...common, jurisdiction, authorizedSignerName, authorizedSignerTitle };
}

function handle(res, error) {
  const status = error.code === 'VERIFICATION_INCOMPLETE' ? 422 : /not found/i.test(error.message) ? 404 : /belong/i.test(error.message) ? 403 : 400;
  return res.status(status).json({
    error: error.message,
    code: error.code || 'FUNDING_VERIFICATION_ERROR',
    summary: error.summary || null,
  });
}

export function createFundingOpportunityVerificationRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));

  router.get('/participant-actions', (req, res) => {
    try {
      const participant = resolveParticipantForIdentity(service, req.sraIdentity);
      if (!participant) return res.json({ records: [] });
      const records = service.domain.list(OPPORTUNITY_TYPE)
        .filter((opportunity) => opportunity.applicantParticipantId === participant.id)
        .filter((opportunity) => participantAction(opportunity))
        .map((opportunity) => ({
          opportunityId: opportunity.opportunityId,
          title: opportunity.title,
          requestedAmount: opportunity.requestedAmount,
          currency: opportunity.currency,
          status: opportunity.status,
          fundingPhase: opportunity.fundingPhase,
          action: participantAction(opportunity),
        }));
      return res.json({ records });
    } catch (error) { return handle(res, error); }
  });

  router.post('/opportunities/:opportunityId/applicant-information', async (req, res) => {
    try {
      const participant = resolveParticipantForIdentity(service, req.sraIdentity);
      if (!participant) throw new Error('Authenticated participant was not found.');
      const opportunity = service.domain.get(OPPORTUNITY_TYPE, req.params.opportunityId);
      if (!opportunity) throw new Error('Funding opportunity was not found.');
      if (opportunity.applicantParticipantId !== participant.id) throw new Error('That funding opportunity does not belong to the authenticated participant.');
      const requirement = participantAction(opportunity);
      if (!requirement || requirement.type !== ACTION_TYPE) throw new Error('Applicant information is not currently requested for this opportunity.');
      if (requirement.status === 'COMPLETED') return res.json({ opportunityId: opportunity.opportunityId, action: requirement });
      const applicantInformation = cleanApplicantInformation(req.body);
      const submittedAt = new Date().toISOString();
      const updated = {
        ...opportunity,
        fundingPhase: 'VERIFIED_VALUE_PREPARATION',
        applicantInstrumentInformation: {
          ...applicantInformation,
          submittedBy: actorId(req),
          submittedAt,
        },
        participantInformationRequirement: {
          ...requirement,
          status: 'COMPLETED',
          completedAt: submittedAt,
          completedBy: actorId(req),
          alert: 'Applicant information received. SRA will continue the financing review.',
        },
        updatedAt: submittedAt,
      };
      await service.domain.put(OPPORTUNITY_TYPE, opportunity.opportunityId, updated, { actorId: actorId(req), eventType: 'PARTICIPANT_APPLICANT_INFORMATION_COMPLETED' });
      await service.domain.lifecycle({ objectType: OPPORTUNITY_TYPE, objectId: opportunity.opportunityId, eventType: 'PARTICIPANT_APPLICANT_INFORMATION_COMPLETED', actorId: actorId(req), payload: { applicantType: applicantInformation.applicantType } });
      return res.json({ opportunityId: opportunity.opportunityId, action: updated.participantInformationRequirement });
    } catch (error) { return handle(res, error); }
  });

  router.get('/requests', (req, res) => {
    res.json({ records: service.listRequests({ opportunityId: req.query.opportunityId, status: req.query.status }) });
  });

  router.get('/requests/:requestId', (req, res) => {
    const record = service.getRequest(req.params.requestId);
    if (!record) return res.status(404).json({ error: 'Verification request was not found.' });
    return res.json(record);
  });

  router.post('/requests/:requestId/start', async (req, res) => {
    try { return res.json(await service.startReview(req.params.requestId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/requests/:requestId/findings', (req, res) => {
    try {
      const request = service.getRequest(req.params.requestId);
      if (!request) return res.status(404).json({ error: 'Verification request was not found.' });
      return res.json({ records: service.listFindings(req.params.requestId) });
    } catch (error) { return handle(res, error); }
  });

  router.post('/requests/:requestId/findings', async (req, res) => {
    try { return res.status(201).json(await service.recordFinding(req.params.requestId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/requests/:requestId/summary', (req, res) => {
    try { return res.json(service.summarize(req.params.requestId)); }
    catch (error) { return handle(res, error); }
  });

  router.get('/requests/:requestId/decision', (req, res) => {
    try {
      const request = service.getRequest(req.params.requestId);
      if (!request) return res.status(404).json({ error: 'Verification request was not found.' });
      return res.json(service.getDecision(req.params.requestId));
    } catch (error) { return handle(res, error); }
  });

  router.post('/requests/:requestId/decision', async (req, res) => {
    try { return res.status(201).json(await service.decide(req.params.requestId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  return router;
}
