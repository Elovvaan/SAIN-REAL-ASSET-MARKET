import crypto from 'node:crypto';
import express from 'express';
import { OnChainTransferService } from '../services/on-chain-transfer-service.js';
import { SolanaTransferService } from '../services/solana-transfer-service.js';

const localIssuanceLocks = new Set();

function actorId(req) {
  return req.sraOperationsAuth?.actorId || req.sraIdentity?.actorId || null;
}

function handle(res, error) {
  const status = /not found/i.test(error.message) ? 404 : (error.code === 'ON_CHAIN_ISSUANCE_IN_PROGRESS' ? 409 : 400);
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
function projectionIdFor(instrumentId, networkName) {
  const digest = crypto.createHash('sha256').update(`${instrumentId}|${networkName}`).digest('hex').slice(0, 16).toUpperCase();
  return `OCP-${digest}`;
}

async function withIssuanceLock(service, key, work) {
  const pool = service.domain?.database?.pool;
  if (pool) {
    const client = await pool.connect();
    let acquired = false;
    try {
      const result = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [`ON_CHAIN_ISSUANCE:${key}`]);
      acquired = Boolean(result.rows?.[0]?.acquired);
      if (!acquired) {
        const error = new Error('On-chain issuance for this instrument and network is already in progress.');
        error.code = 'ON_CHAIN_ISSUANCE_IN_PROGRESS';
        throw error;
      }
      await service.domain.hydrate?.(['ON_CHAIN_PROJECTION']);
      return await work();
    } finally {
      if (acquired) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`ON_CHAIN_ISSUANCE:${key}`]).catch(() => {});
      client.release();
    }
  }

  if (localIssuanceLocks.has(key)) {
    const error = new Error('On-chain issuance for this instrument and network is already in progress.');
    error.code = 'ON_CHAIN_ISSUANCE_IN_PROGRESS';
    throw error;
  }
  localIssuanceLocks.add(key);
  try { return await work(); }
  finally { localIssuanceLocks.delete(key); }
}

export function createOnChainProjectionRouter(service) {
  const router = express.Router();
  router.use(normalizeDirectMount);

  const solana = new SolanaTransferService({ domain: service.domain });
  const adapters = new Map([['SOLANA', solana]]);
  const transfers = new OnChainTransferService({ domain: service.domain, adapters: { SOLANA: solana } });

  router.get('/status', (_req, res) => res.json({ ...transfers.status(), representations: service.status() }));

  router.get('/representations', (req, res) => {
    try {
      return res.json({ records: service.listProjections({ status: req.query.status, instrumentId: req.query.instrumentId, network: req.query.network }) });
    } catch (error) { return handle(res, error); }
  });

  router.get('/representations/:projectionId', (req, res) => {
    try {
      const projection = service.getProjection(req.params.projectionId);
      return projection ? res.json(projection) : res.status(404).json({ error: 'On-chain representation not found.' });
    } catch (error) { return handle(res, error); }
  });

  router.post('/representations/issue', async (req, res) => {
    const actor = actorId(req);
    try {
      if (!actor) {
        const error = new Error('Authenticated SRA actor identity is required for on-chain issuance.');
        error.code = 'SRA_AUTHENTICATION_REQUIRED';
        throw error;
      }
      const instrumentId = text(req.body?.instrumentId);
      if (!instrumentId) throw new Error('instrumentId is required.');
      if (req.body?.amount == null || text(req.body.amount) === '') throw new Error('amount is required.');
      if (req.body?.decimals == null || text(req.body.decimals) === '') throw new Error('decimals is required.');

      const requestedNetwork = network(req.body?.network || service.network);
      const adapter = adapters.get(requestedNetwork);
      if (!adapter || typeof adapter.prepareIssuance !== 'function' || typeof adapter.submitPreparedIssuance !== 'function') {
        const error = new Error(`On-chain issuance is not available for ${requestedNetwork}.`);
        error.code = 'ON_CHAIN_ISSUANCE_UNSUPPORTED';
        throw error;
      }
      const adapterStatus = adapter.status();
      if (!adapterStatus.ready) {
        const error = new Error(`${requestedNetwork} is not ready for on-chain issuance.`);
        error.code = 'ON_CHAIN_NETWORK_NOT_READY';
        throw error;
      }
      const requestedCluster = text(req.body?.cluster);
      if (requestedCluster && requestedCluster !== adapterStatus.cluster) {
        const error = new Error(`Requested cluster ${requestedCluster} does not match the configured network cluster ${adapterStatus.cluster}.`);
        error.code = 'ON_CHAIN_CLUSTER_MISMATCH';
        throw error;
      }

      const lockKey = `${instrumentId}|${requestedNetwork}`;
      const result = await withIssuanceLock(service, lockKey, async () => {
        let projection = service.listProjections({ instrumentId })
          .find((item) => network(item.network) === requestedNetwork) || null;

        if (projection?.mintAddress && String(projection.status).toUpperCase() === 'ACTIVE') {
          return { created: false, projection, alreadyIssued: true };
        }

        if (!projection) {
          projection = await service.createProjection({
            projectionId: projectionIdFor(instrumentId, requestedNetwork),
            instrumentId,
            cluster: adapterStatus.cluster,
            chainProgram: req.body?.chainProgram,
            decimals: Number(req.body.decimals),
          }, actor);
        }

        if (text(projection.cluster) && text(projection.cluster) !== adapterStatus.cluster) {
          const error = new Error(`Projection cluster ${projection.cluster} does not match the configured network cluster ${adapterStatus.cluster}.`);
          error.code = 'ON_CHAIN_CLUSTER_MISMATCH';
          throw error;
        }

        const authorizedSupplyExact = text(
          projection.authorizedSupplyExact
          || service.authorizedSupplyExactFor(instrumentId),
        );
        if (!authorizedSupplyExact) throw new Error('Projection authorized supply is missing.');
        if (projection.authorizedSupplyExact !== authorizedSupplyExact || projection.cluster !== adapterStatus.cluster) {
          projection = {
            ...projection,
            authorizedSupplyExact,
            cluster: adapterStatus.cluster,
            updatedAt: new Date().toISOString(),
          };
          await service.domain.put('ON_CHAIN_PROJECTION', projection.projectionId, projection, {
            actorId: actor,
            eventType: 'ON_CHAIN_PROJECTION_ISSUANCE_PREPARED',
          });
        }

        if (['DRAFT', 'UNDER_REVIEW'].includes(String(projection.status).toUpperCase())) {
          projection = await service.approveProjection(projection.projectionId, actor);
        }
        if (String(projection.status).toUpperCase() !== 'APPROVED') throw new Error(`On-chain representation cannot be issued from ${projection.status}.`);

        adapter.validateIssuance(projection, { amount: req.body.amount, decimals: req.body.decimals });

        let pending = projection.pendingIssuance || null;
        if (pending) {
          if (text(pending.issuedSupplyExact) !== text(req.body.amount) || Number(pending.decimals) !== Number(req.body.decimals)) {
            const error = new Error('A different issuance is already pending for this instrument. Resume the pending issuance before changing amount or decimals.');
            error.code = 'ON_CHAIN_ISSUANCE_PENDING_CONFLICT';
            throw error;
          }
        } else {
          pending = await adapter.prepareIssuance(projection, { amount: req.body.amount, decimals: req.body.decimals });
          projection = await service.recordIssuancePending(projection.projectionId, pending, actor);
        }

        let issuance;
        try {
          issuance = await adapter.submitPreparedIssuance(pending);
        } catch (error) {
          // The exact signed transaction remains persisted on the projection. A retry
          // rebroadcasts those same bytes rather than creating a second mint.
          error.code = error.code || 'ON_CHAIN_ISSUANCE_SUBMISSION_UNCERTAIN';
          throw error;
        }

        if (issuance.confirmation?.state === 'FAILED') {
          const failed = {
            ...projection,
            issuanceState: 'FAILED',
            pendingIssuance: null,
            lastIssuanceFailure: {
              transactionId: issuance.issuanceTransactionId,
              confirmation: issuance.confirmation,
              failedAt: new Date().toISOString(),
            },
            updatedAt: new Date().toISOString(),
          };
          await service.domain.put('ON_CHAIN_PROJECTION', projection.projectionId, failed, {
            actorId: actor,
            eventType: 'ON_CHAIN_REPRESENTATION_ISSUANCE_FAILED',
          });
          const error = new Error('Atomic token issuance transaction failed on network. No mint or initial supply was committed.');
          error.code = 'ON_CHAIN_ISSUANCE_FAILED';
          error.transactionId = issuance.issuanceTransactionId;
          throw error;
        }

        if (issuance.confirmation?.state !== 'CONFIRMED') {
          const stillPending = {
            ...projection,
            issuanceState: 'PENDING_NETWORK',
            pendingIssuance: {
              ...pending,
              issuanceTransactionId: issuance.issuanceTransactionId,
              confirmation: issuance.confirmation,
              lastSubmittedAt: new Date().toISOString(),
            },
            updatedAt: new Date().toISOString(),
          };
          await service.domain.put('ON_CHAIN_PROJECTION', projection.projectionId, stillPending, {
            actorId: actor,
            eventType: 'ON_CHAIN_REPRESENTATION_ISSUANCE_PENDING',
          });
          return { created: false, pending: true, projection: stillPending, issuance };
        }

        const updated = await service.recordIssuance(projection.projectionId, issuance, actor);
        return { created: true, projection: updated, issuance };
      });

      return res.status(result.pending ? 202 : (result.created ? 201 : 200)).json(result);
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

  router.post('/transfers/prepare', async (req, res) => {
    try { return res.status(201).json(await transfers.prepare(req.body || {}, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  router.post('/transfers', async (req, res) => {
    try { return res.status(201).json(await transfers.send(req.body || {}, actorId(req))); }
    catch (error) { return handle(res, error); }
  });

  return router;
}
