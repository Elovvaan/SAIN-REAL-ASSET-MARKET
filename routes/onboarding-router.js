import { Router } from 'express';
import { AssetOnboardingService } from '../services/asset-onboarding-service.js';

export function createOnboardingRouter(domainStore) {
  const router = Router();
  const service = new AssetOnboardingService(domainStore);

  router.get('/configuration', (_req, res) => {
    res.json(service.getConfiguration());
  });

  router.get('/applications', (_req, res) => {
    res.json({ applications: service.listApplications() });
  });

  router.post('/assets', (req, res) => {
    try {
      const result = service.onboard(req.body);
      if (!result.ok) return res.status(400).json(result);
      return res.status(201).json(result);
    } catch (error) {
      console.error('Asset onboarding failed:', error);
      return res.status(500).json({ ok: false, errors: ['Asset onboarding could not be completed.'] });
    }
  });

  return router;
}
