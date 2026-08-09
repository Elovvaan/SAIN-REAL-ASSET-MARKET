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
    assessment: error.assessment || null,
  });
}

function normalizeDirectMount(req, _res, next) {
  const prefix = '/api/on-chain';
  if (req.url === prefix) req.url = '/';
  else if (req.url.startsWith(`${prefix}/`)) req.url = req.url.slice(prefix.length);
  next();
}

function text(value) { return String(value ?? '').trim(); }
function network(value) { return text(value).toUpperCase(); }

export function createOnChainProjectionRouter(service) {
  const router = express.Router();
  router.use(normalizeDirectMount);

  const solana = new SolanaTransferService({ domain: service.domain });
  const adapters = new Map([['SOLANA', solana]]);
  const transfers = new OnChainTransferService({
    domain: service.domain,
    adapters: { SOLANA: solana },
  });

  router.get('/status', (_req, res) => res.json({
    ...transfers.status(),
    representations: service.status(),
  }));

  router.get('/representations', (req, res) => {
    try {
      return res.json({ records: service.listProjections({
        status: req.query.status,
        instrumentId: req.query.instrumentId,
        network: req.query.network,
      }) });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.get('/representations/:projectionId', (req, res) => {
    try {
      const projection = service.getProjection(req.params.projectionId);
      return projection
        ? res.json(projection)
        : res.status(404).json({ error: 'On-chain representation not found.' });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.post('/representations/issue', async (req, res) => {
    const actor = actorId(req);
    try {
      const instrumentId = text(req.body?.instrumentId);
      if (!instrumentId) throw new Error('instrumentId is required.');
      if (req.body?.amount == null || text(req.body.amount) === '') throw new Error('amount is required.');
      if (req.body?.decimals == null || text(req.body.decimals) === '') throw new Error('decimals is required.');

      let projection = service.listProjections({ instrumentId })
        .find((item) => network(item.network) === network(req.body?.network || service.network)) || null;

      if (projection?.mintAddress) {
        return res.status(200).json({ created: false, projection, alreadyIssued: true });
      }

      if (!projection) {
        projection = await service.createProjection({
          instrumentId,
          cluster: req.body?.cluster,
          chainProgram: req.body?.chainProgram,
        }, actor);
      }

      if (['DRAFT', 'UNDER_REVIEW'].includes(String(projection.status).toUpperCase())) {
        projection = await service.approveProjection(projection.projectionId, actor);
      }
      if (String(projection.status).toUpperCase() !== 'APPROVED') {
        throw new Error(`On-chain representation cannot be issued from ${projection.status}.`);
      }

      const adapter = adapters.get(network(projection.network));
      if (!adapter || typeof adapter.issueRepresentation !== 'function') {
        const error = new Error(`On-chain issuance is not available for ${projection.network}.`);
        error.code = 'ON_CHAIN_ISSUANCE_UNSUPPORTED';
        throw error;
      }

      const issuance = await adapter.issueRepresentation(projection, {
        amount: req.body.amount,
        decimals: req.body.decimals,
      });
      const updatedAt = new Date().toISOString();
      const updated = {
        ...projection,
        mintAddress: issuance.mintAddress,
        platformTokenAccount: issuance.platformTokenAccount,
        mintAuthorityAddress: issuance.mintAuthorityAddress,
        freezeAuthorityAddress: issuance.freezeAuthorityAddress,
        decimals: issuance.decimals,
        issuedSupply: issuance.issuedSupply,
        issuanceTransactionId: issuance.issuanceTransactionId,
        issuanceConfirmation: issuance.confirmation,
        status: 'ACTIVE',
        settlementStatus: 'AVAILABLE',
        activatedAt: projection.activatedAt || updatedAt,
        issuedAt: issuance.issuedAt || updatedAt,
        updatedAt,
        history: [...(projection.history || []), {
          eventType: 'ON_CHAIN_REPRESENTATION_ISSUED',
          actorId: actor,
          occurredAt: updatedAt,
          transactionId: issuance.issuanceTransactionId,
          mintAddress: issuance.mintAddress,
          issuedSupply: issuance.issuedSupply,
        }],
      };
      await service.domain.put('ON_CHAIN_PROJECTION', projection.projectionId, updated, {
        actorId: actor,
        eventType: 'ON_CHAIN_REPRESENTATION_ISSUED',
      });
      await service.domain.lifecycle?.({
        objectType: 'ON_CHAIN_PROJECTION',
        objectId: projection.projectionId,
        eventType: 'ON_CHAIN_REPRESENTATION_ISSUED',
        actorId: actor,
        payload: {
          instrumentId,
          network: projection.network,
          mintAddress: issuance.mintAddress,
          issuedSupply: issuance.issuedSupply,
          transactionId: issuance.issuanceTransactionId,
        },
      });

      return res.status(201).json({ created: true, projection: updated, issuance });
    } catch (error) {
      return handle(res, error);
    }
  });

  router.get('/transfers', async (req, res) => {
    try {
      await transfers.ensure();
      return res.json({ records: transfers.list({ network: req.query.network, asset: req.query.asset, state: req.query.state }) });
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
