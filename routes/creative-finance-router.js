import { Router } from 'express';

function actorFromRequest(req) {
  return {
    userId: typeof req.body?.userId === 'string' ? req.body.userId : typeof req.query?.userId === 'string' ? req.query.userId : 'SANE'
  };
}

export function createCreativeFinanceRouter(service) {
  const router = Router();

  router.get('/configuration', (_req, res) => {
    res.json({
      architectureVersion: 'V15',
      contributionMedia: service.listContributionMedia(),
      sequence: ['IDENTIFY_VALUE','IDENTIFY_GAP','ASSEMBLE_POSITIONS','AUTHORIZE','DEPLOY','RECONCILE','SETTLE','DISCHARGE']
    });
  });

  router.get('/positions', (req, res) => {
    res.json({ positions: service.listPositions(typeof req.query.projectId === 'string' ? req.query.projectId : '') });
  });

  router.post('/positions', (req, res) => {
    try {
      res.status(201).json({ position: service.createPosition(req.body, actorFromRequest(req)) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/positions/:positionId/assign', (req, res) => {
    try {
      res.status(201).json(service.assignPosition(req.params.positionId, req.body, actorFromRequest(req)));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/structures', (req, res) => {
    try {
      res.status(201).json({ structure: service.buildStructure(req.body, actorFromRequest(req)) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/structures/:structureId/reconcile', (req, res) => {
    try {
      res.json({ structure: service.reconcile(req.params.structureId, req.body) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/structures/:structureId/settle', (req, res) => {
    try {
      res.json({ structure: service.settle(req.params.structureId) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/structures/:structureId/discharge', (req, res) => {
    try {
      res.json({ structure: service.discharge(req.params.structureId, req.body) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
