import express from 'express';

const paths = (suffix) => [suffix, `/api/sain/intelligence${suffix}`];

export function createSainOperationsIntelligenceRouter(service) {
  const router = express.Router();

  const withIntelligence = (handler) => async (req, res, next) => {
    try {
      await service.hydrate();
      return handler(req, res);
    } catch (error) {
      return next(error);
    }
  };

  router.get(paths('/status'), (_req, res) => res.json(service.status()));
  router.get(paths('/registry'), withIntelligence((_req, res) => res.json(service.registry())));
  router.get(paths('/metrics'), withIntelligence((_req, res) => res.json(service.metrics())));
  router.get(paths('/health'), withIntelligence((_req, res) => res.json(service.health())));
  router.get(paths('/bottlenecks'), withIntelligence((_req, res) => res.json(service.bottlenecks())));
  router.get(paths('/recommendations'), withIntelligence((_req, res) => res.json(service.recommendations())));
  router.get(paths('/summary'), withIntelligence((_req, res) => res.json(service.summary())));
  router.get(paths('/opportunities/:opportunityId'), withIntelligence((req, res) => {
    const explanation = service.explainOpportunity(req.params.opportunityId);
    if (!explanation) return res.status(404).json({ error: 'Funding opportunity was not found.' });
    return res.json(explanation);
  }));
  router.post(paths('/ask'), withIntelligence((req, res) => res.json(service.ask(req.body?.question || ''))));

  return router;
}
