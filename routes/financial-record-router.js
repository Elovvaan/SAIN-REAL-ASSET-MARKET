import express from 'express';

function fail(res, error) {
  return res.status(400).json({ error: error?.message || 'Financial record request failed.' });
}

export function createFinancialRecordRouter(service) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const financialRecords = service.list({ state: req.query.state, accountId: req.query.accountId, classification: req.query.classification });
    res.json({ financialRecords, count: financialRecords.length });
  });

  router.get('/summary', (_req, res) => res.json(service.summary()));
  router.get('/accounts', (_req, res) => res.json({ accounts: service.listAccounts() }));
  router.get('/accounts/:accountId', (req, res) => {
    const account = service.getAccount(req.params.accountId);
    if (!account) return res.status(404).json({ error: 'Financial record account not found.' });
    return res.json({ account, financialRecords: service.list({ accountId: req.params.accountId }) });
  });
  router.get('/:financialRecordId', (req, res) => {
    const financialRecord = service.get(req.params.financialRecordId);
    if (!financialRecord) return res.status(404).json({ error: 'Financial record not found.' });
    return res.json({ financialRecord });
  });
  router.post('/from-recognition/:recognitionId', async (req, res) => {
    try {
      const result = await service.createFromRecognition(req.params.recognitionId, req.body || {}, req.headers['x-sra-actor-id'] || 'SAIN_AGENT');
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) { return fail(res, error); }
  });
  router.post('/:financialRecordId/state', async (req, res) => {
    try {
      const financialRecord = await service.changeState(req.params.financialRecordId, req.body || {}, req.headers['x-sra-actor-id'] || 'SRA_PLATFORM');
      return res.json({ financialRecord });
    } catch (error) { return fail(res, error); }
  });

  return router;
}
