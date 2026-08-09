import express from 'express';
import { OnChainTransferService } from '../services/on-chain-transfer-service.js';
import { SolanaTransferService } from '../services/solana-transfer-service.js';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || null;
}

function handle(res, error) {
  const status = /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({
    error: error.message,
    code: error.code || 'ON_CHAIN_ERROR',
    transactionId: error.transactionId || error.transactionSignature || null,
  });
}

function normalizeDirectMount(req, _res, next) {
  const prefix = '/api/on-chain';
  if (req.url === prefix) req.url = '/';
  else if (req.url.startsWith(`${prefix}/`)) req.url = req.url.slice(prefix.length);
  next();
}

export function createOnChainProjectionRouter(service) {
  const router = express.Router();
  router.use(normalizeDirectMount);

  const transfers = new OnChainTransferService({
    domain: service.domain,
    adapters: {
      SOLANA: new SolanaTransferService({ domain: service.domain }),
    },
  });

  router.get('/status', (_req, res) => res.json(transfers.status()));

  router.get('/transfers', async (req, res) => {
    try {
      await transfers.ensure();
      return res.json({
        records: transfers.list({
          network: req.query.network,
          asset: req.query.asset,
          state: req.query.state,
        }),
      });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.get('/transfers/:transferId', async (req, res) => {
    try {
      await transfers.ensure();
      const transfer = transfers.get(req.params.transferId);
      return transfer
        ? res.json(transfer)
        : res.status(404).json({ error: 'On-chain transfer not found.' });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.post('/transfers/prepare', async (req, res) => {
    try {
      return res.status(201).json(await transfers.prepare(req.body || {}, actorId(req)));
    } catch (error) {
      return handle(res, error);
    }
  });

  router.post('/transfers', async (req, res) => {
    try {
      return res.status(201).json(await transfers.send(req.body || {}, actorId(req)));
    } catch (error) {
      return handle(res, error);
    }
  });

  return router;
}
