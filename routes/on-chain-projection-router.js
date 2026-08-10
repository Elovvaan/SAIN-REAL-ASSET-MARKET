import crypto from 'node:crypto';
import express from 'express';
import { OnChainTransferService } from '../services/on-chain-transfer-service.js';
import { SolanaTransferService } from '../services/solana-transfer-service.js';

function actorId(req) {
  return req.sraOperationsAuth?.actorId || req.sraIdentity?.actorId || null;
}

function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).toUpperCase(); }
function assetIdFor(asset, network) {
  const digest = crypto.createHash('sha256').update(`${asset}|${network}`).digest('hex').slice(0, 16).toUpperCase();
  return `OCA-${digest}`;
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

function requireActor(req) {
  const actor = actorId(req);
  if (!actor) {
    const error = new Error('Authenticated SRA actor identity is required for on-chain writes.');
    error.code = 'SRA_AUTHENTICATION_REQUIRED';
    throw error;
  }
  return actor;
}

function approvalFor(domain, instrumentId) {
  return domain.get('INSTRUMENT_REPRESENTATION_APPROVAL', `IRA-${instrumentId}`) || null;
}

export function createOnChainProjectionRouter(service) {
  const router = express.Router();
  router.use(normalizeDirectMount);

  const solana = new SolanaTransferService({ domain: service.domain });
  const adapters = new Map([['SOLANA', solana]]);
  const transfers = new OnChainTransferService({ domain: service.domain, adapters: { SOLANA: solana } });

  router.get('/status', (_req, res) => {
    return res.json({
      service: service.status(),
      networks: [...adapters.entries()].map(([network, adapter]) => ({ network, ...adapter.status() })),
      transfer: transfers.status(),
    });
  });

  router.get('/assets', (req, res) => {
    try {
      return res.json({ records: service.listAssets({
        network: req.query.network,
        asset: req.query.asset,
        instrumentId: req.query.instrumentId,
      }) });
    } catch (error) { return handle(res, error); }
  });

  router.get('/assets/:assetId', (req, res) => {
    try {
      const asset = service.getAsset(req.params.assetId);
      return asset ? res.json(asset) : res.status(404).json({ error: 'On-chain asset not found.' });
    } catch (error) { return handle(res, error); }
  });

  router.post('/assets', async (req, res) => {
    try {
      const actor = requireActor(req);
      const network = upper(req.body?.network);
      const instrumentId = text(req.body?.instrumentId);
      const requestedAsset = text(req.body?.asset);
      if (!network) throw new Error('network is required.');
      if (!instrumentId && !requestedAsset) throw new Error('asset or instrumentId is required.');
      if (req.body?.decimals == null || text(req.body.decimals) === '') throw new Error('decimals is required.');

      const adapter = adapters.get(network);
      if (!adapter || typeof adapter.createAsset !== 'function') {
        const error = new Error(`Asset creation is not available for ${network}.`);
        error.code = 'ON_CHAIN_CREATE_UNSUPPORTED';
        throw error;
      }
      if (!adapter.status().ready) {
        const error = new Error(`${network} is not ready for on-chain asset creation.`);
        error.code = 'ON_CHAIN_NETWORK_NOT_READY';
        throw error;
      }

      let instrument = null;
      if (instrumentId) {
        instrument = service.domain.get('SRA_INSTRUMENT', instrumentId);
        if (!instrument) throw new Error('Instrument not found.');
        const approval = approvalFor(service.domain, instrumentId);
        if (approval?.state !== 'APPROVED') {
          const error = new Error('On-chain approval is required before creating this instrument on chain.');
          error.code = 'ON_CHAIN_APPROVAL_REQUIRED';
          throw error;
        }
      }

      const asset = requestedAsset
        || text(instrument?.assetCode)
        || text(instrument?.symbol)
        || text(instrument?.ticker)
        || instrumentId;
      const id = assetIdFor(instrumentId || asset, network);
      const existing = service.getAsset(id) || service.findAsset({ instrumentId, asset, network });
      if (existing) return res.status(200).json({ created: false, asset: existing });

      const created = await adapter.createAsset({
        decimals: Number(req.body.decimals),
        tokenProgram: req.body?.tokenProgram,
      });
      const record = await service.recordCreated({
        assetId: id,
        network,
        asset,
        instrumentId: instrumentId || null,
        symbol: text(req.body?.symbol) || text(instrument?.symbol) || text(instrument?.ticker) || asset,
        assetAddress: created.assetAddress,
        decimals: created.decimals,
        tokenProgram: created.tokenProgram,
        transactionId: created.transactionId,
      }, actor);

      return res.status(201).json({ created: true, asset: record, networkResult: created });
    } catch (error) { return handle(res, error); }
  });

  router.post('/assets/:assetId/issue', async (req, res) => {
    try {
      const actor = requireActor(req);
      const asset = service.getAsset(req.params.assetId);
      if (!asset) throw new Error('On-chain asset not found.');
      if (req.body?.amount == null || text(req.body.amount) === '') throw new Error('amount is required.');
      const adapter = adapters.get(upper(asset.network));
      if (!adapter || typeof adapter.issueAsset !== 'function') {
        const error = new Error(`Asset issuance is not available for ${asset.network}.`);
        error.code = 'ON_CHAIN_ISSUE_UNSUPPORTED';
        throw error;
      }
      const issuance = await adapter.issueAsset(asset, {
        amount: req.body.amount,
        destinationAddress: req.body?.destinationAddress,
      });
      const updated = await service.recordIssued(asset.assetId, issuance, actor);
      return res.status(201).json({ asset: updated, issuance });
    } catch (error) { return handle(res, error); }
  });

  router.get('/transfers', async (req, res) => {
    try {
      await transfers.ensure();
      return res.json({ records: transfers.list({ network: req.query.network, asset: req.query.asset, state: req.query.state }) });
    } catch (error) { return handle(res, error); }
  });

  router.get('/transfers/:transferId', async (req, res) => {
    try {
      await transfers.ensure();
      const transfer = transfers.get(req.params.transferId);
      return transfer ? res.json(transfer) : res.status(404).json({ error: 'On-chain transfer not found.' });
    } catch (error) { return handle(res, error); }
  });

  router.post('/transfers', async (req, res) => {
    try {
      const actor = requireActor(req);
      return res.status(201).json(await transfers.send(req.body || {}, actor));
    } catch (error) { return handle(res, error); }
  });

  return router;
}
