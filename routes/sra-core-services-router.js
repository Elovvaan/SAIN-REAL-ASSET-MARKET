import { Router } from 'express';

export function createSraCoreServicesRouter(heartbeat) {
  const router = Router();

  router.get('/status', (_req, res) => res.json(heartbeat.status()));
  router.get('/cycles', (_req, res) => {
    const cycles = heartbeat.domain.list('SRA_CORE_HEARTBEAT_CYCLE')
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
      .slice(0, 100);
    res.json({ cycles, status: heartbeat.status() });
  });
  router.post('/run', async (req, res) => {
    try {
      const result = await heartbeat.runCycle(req.body?.trigger || 'ADMIN_REQUEST');
      return res.json(result);
    } catch (error) {
      return res.status(422).json({ error: error.message, code: 'SRA_CORE_CYCLE_FAILED' });
    }
  });

  return router;
}
