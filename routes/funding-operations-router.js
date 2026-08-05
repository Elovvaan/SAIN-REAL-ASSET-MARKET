import express from 'express';

export function createFundingOperationsRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));
  router.get('/dashboard', (_req, res) => res.json(service.dashboard()));
  router.get('/phases', (_req, res) => res.json({ records: service.phaseSummary() }));
  router.get('/queue', (req, res) => res.json({ records: service.queue({ status: req.query.status, limit: req.query.limit }) }));

  return router;
}
