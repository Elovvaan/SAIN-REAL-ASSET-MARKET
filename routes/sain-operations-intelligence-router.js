import express from 'express';

export function createSainOperationsIntelligenceRouter(service) {
  const router = express.Router();

  router.get('/status', (_req, res) => res.json(service.status()));
  router.get('/registry', (_req, res) => res.json(service.registry()));
  router.get('/metrics', (_req, res) => res.json(service.metrics()));
  router.get('/health', (_req, res) => res.json(service.health()));
  router.get('/bottlenecks', (_req, res) => res.json(service.bottlenecks()));
  router.get('/recommendations', (_req, res) => res.json(service.recommendations()));
  router.get('/summary', (_req, res) => res.json(service.summary()));
  router.get('/opportunities/:opportunityId', (req, res) => {
    const explanation = service.explainOpportunity(req.params.opportunityId);
    if (!explanation) return res.status(404).json({ error: 'Funding opportunity was not found.' });
    return res.json(explanation);
  });
  router.post('/ask', (req, res) => res.json(service.ask(req.body?.question || '')));

  return router;
}
