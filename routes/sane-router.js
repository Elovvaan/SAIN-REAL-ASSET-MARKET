import { Router } from 'express';
import { SaneSkillService } from '../services/sane-skill-service.js';

function actorId(req) {
  return req.headers['x-sra-actor-id'] || req.body?.actorId || null;
}

export function createSaneRouter(service = new SaneSkillService(), edxOperationsService = null, sraAgentService = null) {
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

  router.get('/agent/status', (_req, res) => {
    res.json({
      agent: 'SANE',
      available: Boolean(sraAgentService?.available()),
      model: sraAgentService?.model || null,
      writeAccess: 'DISABLED',
      approvalRequiredForStateChanges: true
    });
  });

  router.post('/agent/chat', async (req, res) => {
    if (!sraAgentService) return res.status(503).json({ error: 'SRA agent service is unavailable.' });
    try {
      return res.json(await sraAgentService.chat(req.body || {}));
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message });
    }
  });

  router.get('/edx/enterprises/:enterpriseId/publication-review', (req, res) => {
    if (!edxOperationsService) return res.status(503).json({ error: 'Sane EDX operations are unavailable.' });
    try {
      return res.json(edxOperationsService.preparePublicationPrompt(req.params.enterpriseId));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post('/edx/publication-choice', async (req, res) => {
    if (!edxOperationsService) return res.status(503).json({ error: 'Sane EDX operations are unavailable.' });
    try {
      return res.json(await edxOperationsService.recordChoice(req.body || {}, actorId(req)));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  return router;
}
