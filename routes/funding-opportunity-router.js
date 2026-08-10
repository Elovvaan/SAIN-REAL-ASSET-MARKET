import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { PrivateDocumentService } from '../services/private-document-service.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 10 } });
const STAFF_ROLES = new Set(['PLATFORM_ADMIN','OPERATIONS_ADMIN','FUNDING_OPERATIONS','FUNDING_ANALYST','VERIFICATION_REVIEWER','INSTRUMENT_REVIEWER','ISSUANCE_REVIEWER','MARKETPLACE_OPERATOR','SETTLEMENT_OPERATOR','AUDITOR']);
const PARTICIPANT_TYPE = 'PARTICIPANT';

function actorId(req) {
  return req.sraIdentity?.actorId || req.get('x-sra-actor-id') || req.body?.actorId || null;
}
function isStaffRequest(req) {
  return (req.sraOperationsAuth?.roles || []).some((role) => STAFF_ROLES.has(String(role).toUpperCase()));
}
function createParticipantId() {
  return `P-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}
async function resolveParticipantForIdentity(service, identity) {
  if (!identity?.actorId) return null;
  const participants = service.domain.list(PARTICIPANT_TYPE);
  const email = String(identity.email || '').trim().toLowerCase();
  let participant = participants.find((record) =>
    record?.metadata?.accessAccountId === identity.actorId ||
    (identity.universalAccountId && record?.metadata?.universalAccountId === identity.universalAccountId)
  );
  if (!participant && email) {
    const emailMatches = participants.filter((record) => String(record?.metadata?.contactEmail || record?.metadata?.email || '').trim().toLowerCase() === email);
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
    const record = service.get(req.params.opportunityId);
    if (!record) return res.status(404).json({ error: 'Funding opportunity was not found.' });
    return res.json(record);
  });

  router.post('/opportunities', async (req, res) => {
    try {
      const participantSelfService = req.sraOperationsAuth?.source === 'SERVER_SESSION' && !isStaffRequest(req);
      const authenticatedParticipantId = participantSelfService ? await resolveParticipantForIdentity(service, req.sraIdentity) : null;
      const input = authenticatedParticipantId
        ? { ...req.body, applicantParticipantId: authenticatedParticipantId, relatedParticipantIds: [authenticatedParticipantId, ...(req.body?.relatedParticipantIds || [])] }
        : req.body;
      return res.status(201).json(await service.create(input, actorId(req)));
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
      return res.status(201).json({ records, retentionPolicy: 'FINANCING_APPLICATION_EVIDENCE' });
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
      return res.json(await service.withdraw(req.params.opportunityId, req.body?.reason, actorId(req)));
    } catch (error) {
      return handle(res, error);
    }
  });

  return router;
}
