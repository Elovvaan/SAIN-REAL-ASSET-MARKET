import express from 'express';

export function createFundingOperationsRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));
  router.get('/dashboard', (_req, res) => res.json(service.dashboard()));
  router.get('/phases', (_req, res) => res.json({ records: service.phaseSummary() }));
  router.get('/queue', (req, res) => res.json({ records: service.queue({ status: req.query.status, limit: req.query.limit }) }));
  router.get('/opportunities/:opportunityId', (req, res) => {
    const detail = service.opportunityDetail(req.params.opportunityId);
    if (!detail) return res.status(404).json({ error: 'Funding opportunity was not found.' });
    return res.json(detail);
  });

  return router;
}
