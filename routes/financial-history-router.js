import { Router } from 'express';

export function createFinancialHistoryRouter(service, accessService) {
  const router = Router();

  async function requireSession(req, res) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-sra-session-token'] || '';
    const session = await accessService.getSession(token);
    if (!session) res.status(401).json({ error: 'Authentication is required.' });
    return session;
  }

  router.get('/', async (req, res) => {
    const session = await requireSession(req, res); if (!session) return;
    const ownerId = req.query.ownerId || session.id;
    return res.json({ records: service.list({ ownerId, historyType: req.query.historyType, recordOrigin: req.query.recordOrigin, state: req.query.state }) });
  });

  router.get('/summary', async (req, res) => {
    const session = await requireSession(req, res); if (!session) return;
    return res.json(service.summary(req.query.ownerId || session.id));
  });

  router.get('/:financialHistoryRecordId', async (req, res) => {
    const session = await requireSession(req, res); if (!session) return;
    const record = service.get(req.params.financialHistoryRecordId);
    if (!record) return res.status(404).json({ error: 'Financial history record not found.' });
    if (record.ownerId !== session.id && session.activeCapacity !== 'PLATFORM_ADMIN') return res.status(403).json({ error: 'This financial history record is outside the active account authority.' });
    return res.json(record);
  });

  router.post('/', async (req, res) => {
    const session = await requireSession(req, res); if (!session) return;
    try {
      const ownerId = session.activeCapacity === 'PLATFORM_ADMIN' && req.body?.ownerId ? req.body.ownerId : session.id;
      const result = await service.record({ ...req.body, ownerId }, session.id);
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      return res.status(400).json({ error: error.message, code: 'SRA_FINANCIAL_HISTORY_INTAKE_FAILED' });
    }
  });

  return router;
}
