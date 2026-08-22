import crypto from 'node:crypto';
import express from 'express';
import { OnChainTransferService } from '../services/on-chain-transfer-service.js';
import { StellarTransferService } from '../services/stellar-transfer-service.js';

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
  return res.status(status).json({ error: error.message, code: error.code || 'ON_CHAIN_ERROR', transactionId: error.transactionId || error.transactionSignature || null });
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

async function adapterHealth(network, adapter) {
  const health = typeof adapter.health === 'function' ? await adapter.health() : adapter.status();
  return { network, ...health };
}

export function createOnChainProjectionRouter(service) {
  const router = express.Router();
  router.use(normalizeDirectMount);
  const stellar = new StellarTransferService({ domain: service.domain });
  const adapters = new Map([['STELLAR', stellar]]);
  const transfers = new OnChainTransferService({ domain: service.domain, adapters: { STELLAR: stellar } });

  router.get('/status', async (_req, res) => {
    try {
      const networks = await Promise.all([...adapters.entries()].map(([network, adapter]) => adapterHealth(network, adapter)));
      return res.json({ service: service.status(), networks, readyNetworks: networks.filter((item) => item.ready).map((item) => item.network), transfer: transfers.status() });
    } catch (error) { return handle(res, error); }
  });

  router.get('/assets', (req, res) => {
    try {
      return res.json({ records: service.listAssets({ network: req.query.network, asset: req.query.asset, instrumentId: req.query.instrumentId }) });
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

      const id = assetIdFor(instrumentId || requestedAsset, network);
      const existingById = service.getAsset(id);
      if (existingById) return res.status(200).json({ created: false, asset: existingById });

      const asset = requestedAsset || text(instrument?.assetCode) || text(instrument?.symbol) || text(instrument?.ticker);
      if (!asset) {
        const error = new Error('Asset code is required before creating this instrument on chain. Enter the network asset code explicitly.');
        error.code = 'ON_CHAIN_ASSET_CODE_REQUIRED';
        throw error;
      }
      const symbol = text(req.body?.symbol) || asset;
      const existing = service.findAsset({ instrumentId, asset, network });
      if (existing) return res.status(200).json({ created: false, asset: existing });

      const adapter = adapters.get(network);
      if (!adapter || typeof adapter.createAsset !== 'function') {
        const error = new Error(`Asset creation is not available for ${network}.`);
        error.code = 'ON_CHAIN_CREATE_UNSUPPORTED';
        throw error;
      }
      const health = await adapterHealth(network, adapter);
      if (!health.ready) {
        const missing = [];
        if (health.issuerConfigured === false) missing.push('issuer signer');
        if (health.distributorConfigured === false) missing.push('distribution signer');
        const reason = health.error || (missing.length ? `Missing ${missing.join(' and ')}.` : 'Network health check did not report ready.');
        const error = new Error(`${network} is not ready for on-chain asset creation. ${reason}`);
        error.code = 'ON_CHAIN_NETWORK_NOT_READY';
        throw error;
      }

      const created = await adapter.createAsset({ asset, symbol });
      const record = await service.recordCreated({ assetId: id, network, asset: created.asset || asset, instrumentId: instrumentId || null, symbol: created.symbol || symbol, assetAddress: created.assetAddress, sourceAccount: created.distributionAddress || null, decimals: created.decimals, transactionId: created.transactionId }, actor);
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
      const health = await adapterHealth(upper(asset.network), adapter);
      if (!health.ready) {
        const error = new Error(`${asset.network} is not ready for on-chain issuance. ${health.error || 'Network health check did not report ready.'}`);
        error.code = 'ON_CHAIN_NETWORK_NOT_READY';
        throw error;
      }
      const issuance = await adapter.issueAsset(asset, { amount: req.body.amount });
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
      const requestedTransferId = text(req.body?.transferId);
      if (requestedTransferId) {
        await transfers.ensure();
        const existing = transfers.get(requestedTransferId);
        if (existing) return res.status(200).json(existing);
      }
      const network = upper(req.body?.network);
      const adapter = adapters.get(network);
      if (adapter) {
        const health = await adapterHealth(network, adapter);
        if (!health.ready) {
          const error = new Error(`${network} is not ready for on-chain transfer. ${health.error || 'Network health check did not report ready.'}`);
          error.code = 'ON_CHAIN_NETWORK_NOT_READY';
          throw error;
        }
      }
      return res.status(201).json(await transfers.send(req.body || {}, actor));
    } catch (error) { return handle(res, error); }
  });

  return router;
}
