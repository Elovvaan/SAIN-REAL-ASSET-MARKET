import express from 'express';

const paths = (suffix) => [suffix, `/api/sain/intelligence${suffix}`];

export function createSainOperationsIntelligenceRouter(service) {
  const router = express.Router();

  router.get(paths('/status'), (_req, res) => res.json(service.status()));
  router.get(paths('/registry'), (_req, res) => res.json(service.registry()));
  router.get(paths('/metrics'), (_req, res) => res.json(service.metrics()));
  router.get(paths('/health'), (_req, res) => res.json(service.health()));
  router.get(paths('/bottlenecks'), (_req, res) => res.json(service.bottlenecks()));
  router.get(paths('/recommendations'), (_req, res) => res.json(service.recommendations()));
  router.get(paths('/summary'), (_req, res) => res.json(service.summary()));
  router.get(paths('/opportunities/:opportunityId'), (req, res) => {
    const explanation = service.explainOpportunity(req.params.opportunityId);
    if (!explanation) return res.status(404).json({ error: 'Funding opportunity was not found.' });
    return res.json(explanation);
  });
  router.post(paths('/ask'), (req, res) => res.json(service.ask(req.body?.question || '')));

  return router;
}
