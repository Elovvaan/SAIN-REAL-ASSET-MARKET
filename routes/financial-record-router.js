import express from 'express';
import { InstrumentEngineService } from '../services/instrument-engine-service.js';

function fail(res, error) {
  return res.status(400).json({ error: error?.message || 'Financial record request failed.' });
}

export function createFinancialRecordRouter(service) {
  const router = express.Router();
  const instrumentEngine = new InstrumentEngineService(service.persistentDomain);

  router.get('/', (req, res) => {
    const financialRecords = service.list({ state: req.query.state, accountId: req.query.accountId, classification: req.query.classification });
    res.json({ financialRecords, count: financialRecords.length });
  });

  router.get('/summary', (_req, res) => res.json({ ...service.summary(), instrumentEngine: instrumentEngine.summary(), phase: 5, layer: 'INSTRUMENT_ENGINE' }));
  router.get('/accounts', (_req, res) => res.json({ accounts: service.listAccounts() }));
  router.get('/accounts/:accountId', (req, res) => {
    const account = service.getAccount(req.params.accountId);
    if (!account) return res.status(404).json({ error: 'Financial record account not found.' });
    return res.json({ account, financialRecords: service.list({ accountId: req.params.accountId }) });
  });

  router.get('/coin-accounts', (_req, res) => res.json({ coinAccounts: service.listCoinAccounts() }));
  router.get('/coin-accounts/:coinAccountId', (req, res) => {
    const coinAccount = service.getCoinAccount(req.params.coinAccountId);
    if (!coinAccount) return res.status(404).json({ error: 'Coin account not found.' });
    return res.json({ coinAccount, coinPositions: service.listCoinPositions({ coinAccountId: req.params.coinAccountId }) });
  });
  router.get('/coin-positions', (req, res) => {
    const coinPositions = service.listCoinPositions({ state: req.query.state, coinAccountId: req.query.coinAccountId, financialRecordId: req.query.financialRecordId });
    return res.json({ coinPositions, count: coinPositions.length });
  });
  router.get('/coin-positions/:coinPositionId', (req, res) => {
    const coinPosition = service.getCoinPosition(req.params.coinPositionId);
    if (!coinPosition) return res.status(404).json({ error: 'Coin position not found.' });
    return res.json({ coinPosition });
  });
  router.post('/coin-positions/from-financial-record/:financialRecordId', async (req, res) => {
    try {
      const result = await service.representAsCoin(req.params.financialRecordId, req.body || {}, req.headers['x-sra-actor-id'] || 'SAIN_AGENT');
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) { return fail(res, error); }
  });
  router.post('/coin-positions/:coinPositionId/state', async (req, res) => {
    try {
      const coinPosition = await service.changeCoinState(req.params.coinPositionId, req.body || {}, req.headers['x-sra-actor-id'] || 'SRA_PLATFORM');
      return res.json({ coinPosition });
    } catch (error) { return fail(res, error); }
  });

  router.get('/instruments', (req, res) => {
    const instruments = instrumentEngine.list({ state: req.query.state, instrumentType: req.query.instrumentType, coinPositionId: req.query.coinPositionId });
    return res.json({ instruments, count: instruments.length });
  });
  router.get('/instruments/summary', (_req, res) => res.json(instrumentEngine.summary()));
  router.get('/instruments/:instrumentId', (req, res) => {
    const instrument = instrumentEngine.get(req.params.instrumentId);
    if (!instrument) return res.status(404).json({ error: 'Instrument not found.' });
    return res.json({ instrument });
  });
  router.post('/instruments/from-coin-position/:coinPositionId', async (req, res) => {
    try {
      const result = await instrumentEngine.createFromCoinPosition(req.params.coinPositionId, req.body || {}, req.headers['x-sra-actor-id'] || 'SAIN_AGENT');
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) { return fail(res, error); }
  });
  router.post('/instruments/:instrumentId/state', async (req, res) => {
    try {
      const instrument = await instrumentEngine.changeState(req.params.instrumentId, req.body || {}, req.headers['x-sra-actor-id'] || 'SRA_PLATFORM');
      return res.json({ instrument });
    } catch (error) { return fail(res, error); }
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
