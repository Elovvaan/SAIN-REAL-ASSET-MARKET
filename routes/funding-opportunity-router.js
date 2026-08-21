import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { PrivateDocumentService } from '../services/private-document-service.js';
import { FinancingLifecycleService, normalizeFinancingStage } from '../services/financing-lifecycle-service.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 10 } });
const STAFF_ROLES = new Set(['PLATFORM_ADMIN','OPERATIONS_ADMIN','FUNDING_OPERATIONS','FUNDING_ANALYST','VERIFICATION_REVIEWER','INSTRUMENT_REVIEWER','ISSUANCE_REVIEWER','MARKETPLACE_OPERATOR','SETTLEMENT_OPERATOR','AUDITOR']);
const PARTICIPANT_TYPE = 'PARTICIPANT';
const LINE_OF_CREDIT_TYPE = 'LINE_OF_CREDIT';

function actorId(req) {
  return req.sraIdentity?.actorId || req.get('x-sra-actor-id') || req.body?.actorId || null;
}
function isStaffRequest(req) {
  return (req.sraOperationsAuth?.roles || []).some((role) => STAFF_ROLES.has(String(role).toUpperCase()));
}
function hasExplicitApplicantInput(body = {}) {
  return Boolean(
    body?.applicantParticipantId ||
    body?.applicantReference ||
    body?.manualApplicant ||
    body?.applicantDisplayName ||
    body?.applicantSource
  );
}
function createParticipantId() {
  return `P-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}
function createFacilityEventId(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}
function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}
function isLineOfCredit(record) {
  return String(record?.opportunityType || '').toUpperCase() === LINE_OF_CREDIT_TYPE;
}
function findParticipant(service, reference) {
  if (!reference) return null;
  const participants = service.domain.list(PARTICIPANT_TYPE);
  const raw = String(reference).trim();
  const email = normalizeEmail(raw);
  return participants.find((record) => record?.id === raw)
    || participants.find((record) => record?.metadata?.accessAccountId === raw)
    || participants.find((record) => record?.metadata?.universalAccountId === raw)
    || participants.find((record) => normalizeEmail(record?.metadata?.contactEmail || record?.metadata?.email) === email)
    || participants.find((record) => String(record?.displayName || '').trim().toLowerCase() === raw.toLowerCase())
    || null;
}
async function createManualParticipant(service, input, operatorId) {
  const manual = input?.manualApplicant && typeof input.manualApplicant === 'object' ? input.manualApplicant : {};
  const displayName = String(manual.displayName || input?.applicantDisplayName || '').trim();
  if (!displayName) throw new Error('Manual applicant name is required.');
  const contactEmail = normalizeEmail(manual.contactEmail || input?.applicantEmail) || null;
  const existing = service.domain.list(PARTICIPANT_TYPE).find((record) => {
    if (contactEmail && normalizeEmail(record?.metadata?.contactEmail || record?.metadata?.email) === contactEmail) return true;
    return String(record?.displayName || '').trim().toLowerCase() === displayName.toLowerCase();
  });
  if (existing) return existing.id;
  const participantId = createParticipantId();
  const created = {
    id: participantId,
    displayName,
    type: String(manual.type || input?.applicantType || 'ORGANIZATION').toUpperCase(),
    roles: ['FUNDING_APPLICANT'],
    metadata: {
      contactEmail,
      contactPhone: manual.contactPhone || input?.applicantPhone || null,
      legalName: manual.legalName || displayName,
      source: 'ADMIN_MANUAL_FUNDING_INTAKE',
      createdByAccessAccountId: operatorId || null,
    },
    createdAt: new Date().toISOString(),
  };
  await service.domain.put(PARTICIPANT_TYPE, participantId, created, { actorId: operatorId, eventType: 'ADMIN_MANUAL_PARTICIPANT_CREATED' });
  return participantId;
}
async function resolveParticipantForIdentity(service, identity) {
  if (!identity?.actorId) return null;
  const participants = service.domain.list(PARTICIPANT_TYPE);
  const email = normalizeEmail(identity.email);
  let participant = participants.find((record) =>
    record?.metadata?.accessAccountId === identity.actorId ||
    (identity.universalAccountId && record?.metadata?.universalAccountId === identity.universalAccountId)
  );
  if (!participant && email) {
    const emailMatches = participants.filter((record) => normalizeEmail(record?.metadata?.contactEmail || record?.metadata?.email) === email);
    if (emailMatches.length === 1) participant = emailMatches[0];
  }
  if (participant) {
    const linked = {
      ...participant,
      metadata: {
        ...(participant.metadata || {}),
        accessAccountId: identity.actorId,
        universalAccountId: identity.universalAccountId || participant.metadata?.universalAccountId || null,
        contactEmail: participant.metadata?.contactEmail || identity.email || null,
      },
    };
    await service.domain.put(PARTICIPANT_TYPE, linked.id, linked, { actorId: identity.actorId, eventType: 'ACCESS_ACCOUNT_PARTICIPANT_LINKED' });
    return linked.id;
  }
  const participantId = createParticipantId();
  const created = {
    id: participantId,
    displayName: identity.displayName || identity.email || 'SRA Participant',
    type: 'PERSON',
    roles: ['FUNDING_APPLICANT'],
    metadata: {
      accessAccountId: identity.actorId,
      universalAccountId: identity.universalAccountId || null,
      contactEmail: identity.email || null,
      linkageSource: 'AUTHENTICATED_FUNDING_INTAKE',
    },
    createdAt: new Date().toISOString(),
  };
  await service.domain.put(PARTICIPANT_TYPE, participantId, created, { actorId: identity.actorId, eventType: 'AUTHENTICATED_PARTICIPANT_CREATED' });
  return participantId;
}
async function resolveAdminApplicant(service, body, operatorId) {
  const mode = String(body?.applicantSource || '').trim().toUpperCase();
  if (mode === 'MANUAL' || body?.manualApplicant || body?.applicantDisplayName) {
    return createManualParticipant(service, body, operatorId);
  }
  const reference = body?.applicantParticipantId || body?.applicantReference || null;
  const participant = findParticipant(service, reference);
  return participant?.id || null;
}
function initialCreditFacility(record) {
  return {
    requestedLimit: Number(record.requestedAmount || 0),
    approvedLimit: null,
    outstandingPrincipal: 0,
    availableCredit: 0,
    status: 'REQUESTED',
    draws: [],
    repayments: [],
    openedAt: null,
    updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
  };
}
function facilityFor(record) {
  return {
    ...initialCreditFacility(record),
    ...(record.creditFacility || {}),
    draws: Array.isArray(record.creditFacility?.draws) ? record.creditFacility.draws : [],
    repayments: Array.isArray(record.creditFacility?.repayments) ? record.creditFacility.repayments : [],
  };
}

function handle(res, error) {
  const status = error.code === 'INTAKE_INCOMPLETE' ? 422 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({
    error: error.message,
    code: error.code || 'FUNDING_OPPORTUNITY_ERROR',
    completeness: error.completeness || null,
  });
}

export function createFundingOpportunityRouter(service, documentService = null) {
  const router = express.Router();
  const privateDocuments = documentService || new PrivateDocumentService({ database: service?.domain?.database || null });
  const lifecycleService = new FinancingLifecycleService(service.domain);

  router.get('/status', (_req, res) => res.json(service.status()));

  router.get('/opportunities', (req, res) => {
    res.json({
      records: service.list({
        status: req.query.status,
        applicantParticipantId: req.query.applicantParticipantId,
        opportunityType: req.query.opportunityType,
      }),
    });
  });

  router.get('/opportunities/:opportunityId', (req, res) => {
    try {
      const record = service.get(req.params.opportunityId);
      if (!record) return res.status(404).json({ error: 'Funding opportunity was not found.' });
      return res.json({ ...record, financingStage: normalizeFinancingStage(record) });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.post('/opportunities', async (req, res) => {
    try {
      const staff = isStaffRequest(req);
      const serverSession = req.sraOperationsAuth?.source === 'SERVER_SESSION';
      const explicitApplicant = hasExplicitApplicantInput(req.body);
      const participantSelfService = serverSession && !explicitApplicant;
      const authenticatedParticipantId = participantSelfService ? await resolveParticipantForIdentity(service, req.sraIdentity) : null;
      const adminParticipantId = staff && explicitApplicant ? await resolveAdminApplicant(service, req.body, actorId(req)) : null;
      const resolvedParticipantId = authenticatedParticipantId || adminParticipantId || req.body?.applicantParticipantId || null;
      const input = resolvedParticipantId
        ? { ...req.body, applicantParticipantId: resolvedParticipantId, relatedParticipantIds: [resolvedParticipantId, ...(req.body?.relatedParticipantIds || [])] }
        : req.body;
      const created = await service.create(input, actorId(req));
      if (!isLineOfCredit(created)) return res.status(201).json(created);
      const timestamp = new Date().toISOString();
      const updated = { ...created, creditFacility: initialCreditFacility(created), updatedAt: timestamp };
      await service.domain.put('FUNDING_OPPORTUNITY', created.opportunityId, updated, { actorId: actorId(req), eventType: 'LINE_OF_CREDIT_REQUEST_CREATED' });
      return res.status(201).json(updated);
    } catch (error) {
      return handle(res, error);
    }
  });

  router.patch('/opportunities/:opportunityId', async (req, res) => {
    try {
      return res.json(await service.update(req.params.opportunityId, req.body, actorId(req)));
    } catch (error) {
      return handle(res, error);
    }
  });

  router.post('/opportunities/:opportunityId/underwriting', async (req, res) => {
    try {
      if (!isStaffRequest(req)) return res.status(403).json({ error: 'Staff authorization is required.' });
      const record = service.get(req.params.opportunityId);
      if (!record) return res.status(404).json({ error: 'Funding opportunity was not found.' });
      if (String(record.status || '').toUpperCase() === 'WITHDRAWN') return res.status(409).json({ error: 'A withdrawn opportunity cannot be underwritten.' });
      const current = await lifecycleService.ensure(req.params.opportunityId, actorId(req));
      if (current.financingStage !== 'UNDERWRITING') return res.status(409).json({ error: `Underwriting is not available from ${current.financingStage}.` });
      const recommendedAmount = Number(req.body?.recommendedAmount ?? current.requestedAmount);
      if (!Number.isFinite(recommendedAmount) || recommendedAmount <= 0 || recommendedAmount > Number(current.requestedAmount || 0)) {
        return res.status(400).json({ error: 'Recommended amount must be greater than zero and cannot exceed the requested amount.' });
      }
      const timestamp = new Date().toISOString();
      const updated = {
        ...current,
        underwriting: {
          recommendedAmount,
          conclusion: String(req.body?.conclusion || '').trim() || null,
          completedBy: actorId(req),
          completedAt: timestamp,
        },
        updatedAt: timestamp,
      };
      await service.domain.put('FUNDING_OPPORTUNITY', current.opportunityId, updated, { actorId: actorId(req), eventType: 'FINANCING_UNDERWRITING_COMPLETED' });
      const advanced = await lifecycleService.transition(current.opportunityId, 'DECISION', { source: 'ADMIN_UNIFIED_OPERATIONS' }, actorId(req));
      return res.json({ opportunity: advanced });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.post('/opportunities/:opportunityId/credit-decision', async (req, res) => {
    try {
      if (!isStaffRequest(req)) return res.status(403).json({ error: 'Staff authorization is required.' });
      const record = service.get(req.params.opportunityId);
      if (!record) return res.status(404).json({ error: 'Funding opportunity was not found.' });
      if (String(record.status || '').toUpperCase() === 'WITHDRAWN') return res.status(409).json({ error: 'A withdrawn opportunity cannot receive a credit decision.' });
      const current = await lifecycleService.ensure(req.params.opportunityId, actorId(req));
      if (current.financingStage !== 'DECISION') return res.status(409).json({ error: `Credit decision is not available from ${current.financingStage}.` });
      const decision = String(req.body?.decision || '').trim().toUpperCase();
      if (!['APPROVE', 'DECLINE'].includes(decision)) return res.status(400).json({ error: 'Decision must be APPROVE or DECLINE.' });
      const approvedAmount = decision === 'APPROVE'
        ? Number(req.body?.approvedAmount ?? current.underwriting?.recommendedAmount ?? current.requestedAmount)
        : 0;
      if (decision === 'APPROVE' && (!Number.isFinite(approvedAmount) || approvedAmount <= 0 || approvedAmount > Number(current.requestedAmount || 0))) {
        return res.status(400).json({ error: 'Approved amount must be greater than zero and cannot exceed the requested amount.' });
      }
      const timestamp = new Date().toISOString();
      const facility = isLineOfCredit(current) ? facilityFor(current) : null;
      const updated = {
        ...current,
        creditDecision: {
          decision,
          approvedAmount,
          rationale: String(req.body?.rationale || '').trim() || null,
          decidedBy: actorId(req),
          decidedAt: timestamp,
        },
        ...(facility ? {
          creditFacility: {
            ...facility,
            approvedLimit: decision === 'APPROVE' ? approvedAmount : null,
            availableCredit: decision === 'APPROVE' ? approvedAmount : 0,
            outstandingPrincipal: 0,
            status: decision === 'APPROVE' ? 'APPROVED' : 'DECLINED',
            updatedAt: timestamp,
          },
        } : {}),
        updatedAt: timestamp,
      };
      await service.domain.put('FUNDING_OPPORTUNITY', current.opportunityId, updated, { actorId: actorId(req), eventType: `FINANCING_CREDIT_DECISION_${decision}` });
      const advanced = await lifecycleService.transition(current.opportunityId, decision === 'APPROVE' ? 'CLOSING' : 'CLOSED', { source: 'ADMIN_UNIFIED_OPERATIONS' }, actorId(req));
      return res.json({ opportunity: advanced });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.get('/opportunities/:opportunityId/line-of-credit', (req, res) => {
    try {
      const record = service.get(req.params.opportunityId);
      if (!record) return res.status(404).json({ error: 'Funding opportunity was not found.' });
      if (!isLineOfCredit(record)) return res.status(409).json({ error: 'This funding opportunity is not a line of credit.' });
      return res.json({ opportunityId: record.opportunityId, financingStage: normalizeFinancingStage(record), currency: record.currency, facility: facilityFor(record) });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.post('/opportunities/:opportunityId/line-of-credit/draws', async (req, res) => {
    try {
      if (!isStaffRequest(req)) return res.status(403).json({ error: 'Staff authorization is required.' });
      const current = await lifecycleService.ensure(req.params.opportunityId, actorId(req));
      if (!isLineOfCredit(current)) return res.status(409).json({ error: 'This funding opportunity is not a line of credit.' });
      if (!['READY_TO_FUND', 'FUNDED', 'SERVICING'].includes(current.financingStage)) return res.status(409).json({ error: `A line-of-credit draw cannot be recorded from ${current.financingStage}.` });
      const facility = facilityFor(current);
      if (!facility.approvedLimit || facility.status === 'DECLINED') return res.status(409).json({ error: 'The line of credit has not been approved.' });
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Draw amount must be greater than zero.' });
      if (amount > Number(facility.availableCredit || 0)) return res.status(400).json({ error: 'Draw amount cannot exceed available credit.' });
      const settlementReference = String(req.body?.settlementReference || '').trim();
      if (!settlementReference) return res.status(400).json({ error: 'A settlement reference is required before a draw can be recorded as funded.' });
      const timestamp = new Date().toISOString();
      const draw = {
        drawId: createFacilityEventId('LCD'),
        amount,
        currency: current.currency,
        status: 'SETTLED',
        settlementReference,
        memo: String(req.body?.memo || '').trim() || null,
        recordedBy: actorId(req),
        recordedAt: timestamp,
      };
      const updated = {
        ...current,
        creditFacility: {
          ...facility,
          outstandingPrincipal: Number((Number(facility.outstandingPrincipal || 0) + amount).toFixed(2)),
          availableCredit: Number((Number(facility.availableCredit || 0) - amount).toFixed(2)),
          status: 'ACTIVE',
          openedAt: facility.openedAt || timestamp,
          draws: [...facility.draws, draw],
          updatedAt: timestamp,
        },
        updatedAt: timestamp,
      };
      await service.domain.put('FUNDING_OPPORTUNITY', current.opportunityId, updated, { actorId: actorId(req), eventType: 'LINE_OF_CREDIT_DRAW_SETTLED' });
      await service.domain.lifecycle({ objectType: 'FUNDING_OPPORTUNITY', objectId: current.opportunityId, eventType: 'LINE_OF_CREDIT_DRAW_SETTLED', actorId: actorId(req), payload: { drawId: draw.drawId, amount, currency: current.currency, settlementReference } });
      const advanced = current.financingStage === 'READY_TO_FUND'
        ? await lifecycleService.transition(current.opportunityId, 'FUNDED', { source: 'LINE_OF_CREDIT_DRAW', referenceId: draw.drawId }, actorId(req))
        : service.get(current.opportunityId);
      return res.status(201).json({ draw, opportunity: advanced, facility: facilityFor(advanced) });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.post('/opportunities/:opportunityId/line-of-credit/repayments', async (req, res) => {
    try {
      if (!isStaffRequest(req)) return res.status(403).json({ error: 'Staff authorization is required.' });
      const current = await lifecycleService.ensure(req.params.opportunityId, actorId(req));
      if (!isLineOfCredit(current)) return res.status(409).json({ error: 'This funding opportunity is not a line of credit.' });
      if (!['FUNDED', 'SERVICING'].includes(current.financingStage)) return res.status(409).json({ error: `A line-of-credit repayment cannot be recorded from ${current.financingStage}.` });
      const facility = facilityFor(current);
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Repayment amount must be greater than zero.' });
      if (amount > Number(facility.outstandingPrincipal || 0)) return res.status(400).json({ error: 'Repayment amount cannot exceed outstanding principal.' });
      const settlementReference = String(req.body?.settlementReference || '').trim();
      if (!settlementReference) return res.status(400).json({ error: 'A settlement reference is required before a repayment can be recorded.' });
      const timestamp = new Date().toISOString();
      const repayment = {
        repaymentId: createFacilityEventId('LCR'),
        amount,
        currency: current.currency,
        status: 'SETTLED',
        settlementReference,
        memo: String(req.body?.memo || '').trim() || null,
        recordedBy: actorId(req),
        recordedAt: timestamp,
      };
      const outstandingPrincipal = Number((Number(facility.outstandingPrincipal || 0) - amount).toFixed(2));
      const availableCredit = Math.min(Number(facility.approvedLimit || 0), Number((Number(facility.availableCredit || 0) + amount).toFixed(2)));
      const updated = {
        ...current,
        creditFacility: {
          ...facility,
          outstandingPrincipal,
          availableCredit,
          status: 'ACTIVE',
          repayments: [...facility.repayments, repayment],
          updatedAt: timestamp,
        },
        updatedAt: timestamp,
      };
      await service.domain.put('FUNDING_OPPORTUNITY', current.opportunityId, updated, { actorId: actorId(req), eventType: 'LINE_OF_CREDIT_REPAYMENT_SETTLED' });
      await service.domain.lifecycle({ objectType: 'FUNDING_OPPORTUNITY', objectId: current.opportunityId, eventType: 'LINE_OF_CREDIT_REPAYMENT_SETTLED', actorId: actorId(req), payload: { repaymentId: repayment.repaymentId, amount, currency: current.currency, settlementReference } });
      return res.status(201).json({ repayment, opportunity: updated, facility: facilityFor(updated) });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.get('/opportunities/:opportunityId/evidence', (req, res) => {
    try {
      const opportunity = service.get(req.params.opportunityId);
      if (!opportunity) return res.status(404).json({ error: 'Funding opportunity was not found.' });
      return res.json({ records: service.listEvidence(req.params.opportunityId) });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.post('/opportunities/:opportunityId/evidence', async (req, res) => {
    try {
      return res.status(201).json(await service.registerEvidence(req.params.opportunityId, req.body, actorId(req)));
    } catch (error) {
      return handle(res, error);
    }
  });

  router.post('/opportunities/:opportunityId/documents', upload.array('documents', 10), async (req, res) => {
    try {
      const opportunity = service.get(req.params.opportunityId);
      if (!opportunity) return res.status(404).json({ error: 'Funding opportunity was not found.' });
      if (opportunity.status === 'WITHDRAWN') return res.status(409).json({ error: 'Evidence cannot be added to a withdrawn opportunity.' });
      const staff = isStaffRequest(req);
      if (!staff) {
        const participantId = await resolveParticipantForIdentity(service, req.sraIdentity);
        if (!participantId || opportunity.applicantParticipantId !== participantId) return res.status(403).json({ error: 'That funding opportunity does not belong to the authenticated participant.' });
      }
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ error: 'At least one evidence document is required.' });
      const documentTypes = Array.isArray(req.body.documentTypes) ? req.body.documentTypes : req.body.documentTypes ? [req.body.documentTypes] : [];
      const validationErrors = files.map((file, index) => ({ index, error: privateDocuments.validateFile(file) })).filter((item) => item.error);
      if (validationErrors.length) {
        return res.status(400).json({
          error: 'The evidence upload batch contains invalid files. No documents were stored.',
          invalidFiles: validationErrors.map(({ index, error }) => ({ index, name: files[index]?.originalname || null, error })),
        });
      }
      const records = [];
      for (let index = 0; index < files.length; index += 1) {
        const evidenceType = documentTypes[index] || 'FINANCING_SUPPORT';
        const stored = await privateDocuments.store({
          file: files[index],
          documentType: evidenceType,
          uploaderId: actorId(req),
          retentionPolicy: 'FINANCING_APPLICATION_EVIDENCE',
          retentionReferenceId: opportunity.opportunityId,
        });
        if (!stored.ok) throw new Error(stored.error);
        const evidence = await service.registerEvidence(opportunity.opportunityId, {
          evidenceType,
          title: files[index].originalname,
          sourceReference: stored.document.id,
          documentId: stored.document.id,
          participantIds: [opportunity.applicantParticipantId],
          provenance: { source: 'PARTICIPANT_UPLOAD', sha256: stored.document.sha256, retainedAs: 'PRIVATE_EVIDENCE' },
        }, actorId(req));
        records.push({ document: stored.document, evidence });
      }
      const lifecycle = await lifecycleService.ensure(opportunity.opportunityId, actorId(req));
      const advanced = lifecycle.financingStage === 'APPLICATION'
        ? await lifecycleService.transition(opportunity.opportunityId, 'UNDERWRITING', { source: 'EVIDENCE_INGESTION' }, actorId(req))
        : lifecycle;
      return res.status(201).json({ records, retentionPolicy: 'FINANCING_APPLICATION_EVIDENCE', financingStage: advanced.financingStage });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.get('/opportunities/:opportunityId/completeness', (req, res) => {
    try {
      return res.json(service.assessCompleteness(req.params.opportunityId));
    } catch (error) {
      return handle(res, error);
    }
  });

  router.post('/opportunities/:opportunityId/complete-intake', async (req, res) => {
    try {
      return res.json(await service.completeIntake(req.params.opportunityId, actorId(req)));
    } catch (error) {
      return handle(res, error);
    }
  });

  router.get('/opportunities/:opportunityId/verification-requests', (req, res) => {
    try {
      const opportunity = service.get(req.params.opportunityId);
      if (!opportunity) return res.status(404).json({ error: 'Funding opportunity was not found.' });
      return res.json({ records: service.listVerificationRequests(req.params.opportunityId) });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.post('/opportunities/:opportunityId/verification-requests', async (req, res) => {
    try {
      return res.status(201).json(await service.createVerificationRequest(req.params.opportunityId, req.body, actorId(req)));
    } catch (error) {
      return handle(res, error);
    }
  });

  router.post('/opportunities/:opportunityId/withdraw', async (req, res) => {
    try {
      const withdrawn = await service.withdraw(req.params.opportunityId, req.body?.reason, actorId(req));
      const closed = await lifecycleService.transition(req.params.opportunityId, 'CLOSED', { source: 'WITHDRAWAL' }, actorId(req));
      return res.json({ ...withdrawn, financingStage: closed.financingStage });
    } catch (error) {
      return handle(res, error);
    }
  });

  return router;
}
