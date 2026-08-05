import express from 'express';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = error.code === 'INTAKE_INCOMPLETE' ? 422 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({
    error: error.message,
    code: error.code || 'FUNDING_OPPORTUNITY_ERROR',
    completeness: error.completeness || null,
  });
}

export function createFundingOpportunityRouter(service) {
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
      return res.status(201).json(await service.create(req.body, actorId(req)));
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
