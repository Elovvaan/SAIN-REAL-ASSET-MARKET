import express from 'express';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 10 } });

function actorId(req) {
  return req.sraIdentity?.actorId || req.get('x-sra-actor-id') || req.body?.actorId || null;
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
      const authenticatedParticipantId = req.sraIdentity?.actorId || null;
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
      if (!documentService) return res.status(503).json({ error: 'Private funding evidence storage is not available.' });
      const opportunity = service.get(req.params.opportunityId);
      if (!opportunity) return res.status(404).json({ error: 'Funding opportunity was not found.' });
      const identity = req.sraIdentity?.actorId || null;
      const staff = Array.isArray(req.sraOperationsAuth?.roles) && req.sraOperationsAuth.roles.length > 0;
      if (identity && !staff && opportunity.applicantParticipantId !== identity) return res.status(403).json({ error: 'That funding opportunity does not belong to the authenticated participant.' });
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ error: 'At least one evidence document is required.' });
      const documentTypes = Array.isArray(req.body.documentTypes) ? req.body.documentTypes : req.body.documentTypes ? [req.body.documentTypes] : [];
      const records = [];
      for (let index = 0; index < files.length; index += 1) {
        const stored = await documentService.store({
          file: files[index],
          documentType: documentTypes[index] || 'FINANCING_SUPPORT',
          uploaderId: actorId(req),
          retentionPolicy: 'FINANCING_APPLICATION_EVIDENCE',
          retentionReferenceId: opportunity.opportunityId,
        });
        if (!stored.ok) return res.status(400).json({ error: stored.error });
        const evidence = await service.registerEvidence(opportunity.opportunityId, {
          evidenceType: documentTypes[index] || 'FINANCING_SUPPORT',
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
