import { Router } from 'express';
import { SaneSkillService } from '../services/sane-skill-service.js';

export function createSaneRouter(service = new SaneSkillService()) {
  const router = Router();

  router.get('/skills', (req, res) => {
    const tier = typeof req.query?.operatingTier === 'string' ? req.query.operatingTier : 'UNIVERSAL';
    res.json({ architectureVersion: 'V14', operatingTier: tier, skills: service.listSkills(tier) });
  });

  router.post('/message', (req, res) => {
    try {
      res.json(service.dispatch(req.body));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
