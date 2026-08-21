import express from 'express';

const OPPORTUNITY_TYPE = 'FUNDING_OPPORTUNITY';

function actorId(req) {
  return req.sraOperationsAuth?.actorId || null;
}

function requireAuthenticatedActor(req, res, next) {
  if (!actorId(req)) {
    return res.status(401).json({
      error: 'An active authenticated SRA session is required for funding value mutations.',
      code: 'SRA_AUTHENTICATION_REQUIRED',
    });
  }
  return next();
}

function requireApplicantInformationComplete(service, opportunityId) {
  const opportunity = service.domain.get(OPPORTUNITY_TYPE, opportunityId);
  if (!opportunity) throw new Error('Funding opportunity was not found.');
  const requirement = opportunity.participantInformationRequirement;
  if (requirement?.type === 'COMPLETE_APPLICANT_INFORMATION' && requirement.status !== 'COMPLETED') {
    const error = new Error('Applicant information must be completed before Verified Value preparation can begin.');
    error.code = 'APPLICANT_INFORMATION_REQUIRED';
    throw error;
  }
}

function handle(res, error) {
  const status = error.code === 'APPLICANT_INFORMATION_REQUIRED' ? 409 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({ error: error.message, code: error.code || 'FUNDING_VALUE_PREPARATION_ERROR' });
}

export function createFundingOpportunityValuePreparationRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));

  router.get('/preparations', (req, res) => {
    res.json({ records: service.listPreparations({ opportunityId: req.query.opportunityId, status: req.query.status }) });
  });

  router.get('/preparations/:preparationId', (req, res) => {
    const record = service.getPreparation(req.params.preparationId);
    if (!record) return res.status(404).json({ error: 'Value preparation record was not found.' });
    return res.json(record);
  });

  router.post('/opportunities/:opportunityId/preparations', requireAuthenticatedActor, async (req, res) => {
    try {
      requireApplicantInformationComplete(service, req.params.opportunityId);
      return res.status(201).json(await service.createPreparation(req.params.opportunityId, req.body, actorId(req)));
    }
    catch (error) { return handle(res, error); }
  });

  router.patch('/preparations/:preparationId', requireAuthenticatedActor, async (req, res) => {
    try { return res.json(await service.updatePreparation(req.params.preparationId, req.body, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.get('/preparations/:preparationId/model-assessment', (req, res) => {
    try { return res.json(service.assessModels(req.params.preparationId)); }
    catch (error) { return handle(res, error); }
  });

  router.get('/preparations/:preparationId/model-assessments', (req, res) => {
    try {
      const preparation = service.getPreparation(req.params.preparationId);
      if (!preparation) return res.status(404).json({ error: 'Value preparation record was not found.' });
      return res.json({ records: service.listModelAssessments(req.params.preparationId) });
    } catch (error) { return handle(res, error); }
  });

  router.post('/preparations/:preparationId/model-assessment', requireAuthenticatedActor, async (req, res) => {
    try { return res.status(201).json(await service.saveModelAssessment(req.params.preparationId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/preparations/:preparationId/complete', requireAuthenticatedActor, async (req, res) => {
    try { return res.json(await service.completePreparation(req.params.preparationId, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  return router;
}
