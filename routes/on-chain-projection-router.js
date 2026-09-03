import crypto from 'node:crypto';
import express from 'express';
import { OnChainTransferService } from '../services/on-chain-transfer-service.js';
import { StableSettlementAssetService } from '../services/stable-settlement-asset-service.js';
import { generateOnChainAssetCode, isValidOnChainAssetCode, resolveOnChainAssetCode } from '../services/on-chain-asset-code-service.js';
import { StellarTransferService } from '../services/stellar-transfer-service.js';
import { BitcoinTransferService } from '../services/bitcoin-transfer-service.js';
import { EthereumTransferService } from '../services/ethereum-transfer-service.js';
import { XrplTransferService } from '../services/xrpl-transfer-service.js';
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
function positionIdOf(record) { return record?.coinPositionId || record?.positionId || record?.id || null; }
function allCoinPositions(domain) {
  const records = new Map();
  for (const type of ['COIN_POSITION', 'SRA_COIN_POSITION']) {
    for (const position of domain.list(type)) {
      const id = positionIdOf(position);
      if (id && !records.has(id)) records.set(id, position);
    }
  }
  return [...records.values()];
}
function coinPositionById(domain, positionId) {
  return domain.get('COIN_POSITION', positionId) || domain.get('SRA_COIN_POSITION', positionId) || null;
}
function positionAvailable(record) {
  const total = Number(record?.availableQuantity ?? record?.quantityAvailable ?? record?.quantity ?? record?.balance ?? 0);
  const reserved = Number(record?.reservedQuantity || 0);
  return Math.max(0, total - reserved);
}
function positionDenomination(position, instrument = null) {
  const raw = position?.symbol || position?.unit || position?.denomination?.symbol || position?.denomination || position?.assetCode
    || instrument?.denomination?.symbol || instrument?.symbol || '';
  return upper(raw).replace(/[^A-Z0-9]/g, '');
}
function isSraPosition(position, instrument = null) {
  return ['SRA','SRAUSD'].includes(positionDenomination(position, instrument));
}
function sourceClass(domain, position) {
  const observation = position?.observationId ? domain.get('MARKET_OBSERVATION', position.observationId) : null;
  return observation?.sourceMarket === 'COINBASE' ? 'COINBASE_RECOGNIZED_MARKET_TRANSACTION'
    : position?.instrumentId || position?.linkedInstrumentId ? 'INSTRUMENT_LINKED_POSITION' : 'RECOGNIZED_FINANCIAL_RECORD_POSITION';
}
function eligibleSourcePositions(domain) {
  const instruments = domain.list('SRA_INSTRUMENT');
  const approvals = domain.list('INSTRUMENT_REPRESENTATION_APPROVAL');
  const linkedInstrument = (position) => {
    const positionId = positionIdOf(position);
    const direct = instruments.find((item) => item.coinPositionId === positionId || item.instrumentId === position.instrumentId);
    if (direct) return direct;
    const approval = approvals.find((item) => (item.linkedCoinPositionIds || []).includes(positionId));
    return approval ? instruments.find((item) => item.instrumentId === approval.instrumentId) || null : null;
  };
  return allCoinPositions(domain).filter((position) => {
    const instrument = linkedInstrument(position);
    return isSraPosition(position, instrument) && !['RETIRED','FROZEN','EXTERNALLY_TRANSFERRED'].includes(String(position.state || '').toUpperCase());
  }).map((position) => {
    const positionId = positionIdOf(position);
    const instrument = linkedInstrument(position);
    return { positionId, coinPositionId:positionId, instrumentId:instrument?.instrumentId || position.instrumentId || null, sourceClass:sourceClass(domain, position), quantity:Number(position.quantity || 0), availableQuantity:positionAvailable(position), reservedQuantity:Number(position.reservedQuantity || 0), externalizedQuantity:Number(position.externalizedQuantity || 0), financialRecordId:position.financialRecordId || null, recognitionId:position.recognitionId || null, observationId:position.observationId || null, state:position.state };
  }).filter((position) => position.positionId && position.availableQuantity > 0).sort((left,right) => right.availableQuantity-left.availableQuantity);
}
function resolveIssuanceSource(domain, asset, requestedPositionId) {
  let sourcePositionId = text(requestedPositionId || asset.sourcePositionId || asset.coinPositionId);
  if (!sourcePositionId && asset.instrumentId) {
    const instrument = domain.get('SRA_INSTRUMENT', asset.instrumentId);
    const approval = domain.get('INSTRUMENT_REPRESENTATION_APPROVAL', `IRA-${asset.instrumentId}`);
    sourcePositionId = text(instrument?.coinPositionId || approval?.linkedCoinPositionIds?.[0]);
  }
  if (!sourcePositionId) throw new Error('sourcePositionId is required so on-chain issuance remains linked to available SRA Coin Position supply.');
  const position = coinPositionById(domain, sourcePositionId);
  if (!position) throw new Error('Source SRA Coin Position was not found.');
  const instrument = asset.instrumentId ? domain.get('SRA_INSTRUMENT', asset.instrumentId) : domain.list('SRA_INSTRUMENT').find((item) => item.coinPositionId === sourcePositionId) || null;
  if (!isSraPosition(position, instrument)) throw new Error('Source Coin Position must use the canonical SRA or SRA/USD denomination.');
  if (position.frozen || position.complianceHold || position.transferRestricted || position.externalTransferRestricted || position.disputeState === 'OPEN') throw new Error('Source Coin Position is restricted from on-chain representation.');
  return { sourcePositionId, position };
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
  const issuanceSourcesInFlight = new Set();
  const swapsInFlight = new Set();
  const marketActivationsInFlight = new Set();

  const stellar = new StellarTransferService({ domain: service.domain });
  const bitcoin = new BitcoinTransferService();
  const ethereum = new EthereumTransferService();
  const xrpl = new XrplTransferService({ domain: service.domain });
  const solana = new SolanaTransferService();
  const adapters = new Map([
    ['STELLAR', stellar],
    ['BITCOIN', bitcoin],
    ['ETHEREUM', ethereum],
    ['XRPL', xrpl],
    ['SOLANA', solana],
  ]);
  const transferAdapters = Object.fromEntries(adapters.entries());
  const transfers = new OnChainTransferService({ domain: service.domain, adapters: transferAdapters });
  const stableSettlementAssets = new StableSettlementAssetService(service.domain);
  const networkHealthCache = new Map();
  const NETWORK_HEALTH_TTL_MS = 15_000;
  const NETWORK_HEALTH_TIMEOUT_MS = 4_000;

  async function boundedNetworkHealth(network, adapter) {
    const cached = networkHealthCache.get(network);
    if (cached && Date.now() - cached.recordedAt < NETWORK_HEALTH_TTL_MS) return cached.value;
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ network, ...adapter.status(), ready:false, reachable:false, healthTimedOut:true, error:`Network health check exceeded ${NETWORK_HEALTH_TIMEOUT_MS / 1000} seconds.` }), NETWORK_HEALTH_TIMEOUT_MS);
      timer.unref?.();
    });
    const value = await Promise.race([adapterHealth(network, adapter).catch((error) => ({ network, ...adapter.status(), ready:false, reachable:false, error:String(error?.message || error) })), timeout]);
    clearTimeout(timer);
    networkHealthCache.set(network, { value, recordedAt:Date.now() });
    return value;
  }

  router.get('/status', async (req, res) => {
    try {
      await stableSettlementAssets.ensure();
      const requested = new Set(text(req.query.networks).split(',').map(upper).filter(Boolean));
      const selectedAdapters = [...adapters.entries()].filter(([network]) => !requested.size || requested.has(network));
      const networks = await Promise.all(selectedAdapters.map(([network, adapter]) => boundedNetworkHealth(network, adapter)));
      return res.json({
        service: service.status(),
        networks,
        readyNetworks: networks.filter((item) => item.ready).map((item) => item.network),
        transfer: transfers.status(),
        stableSettlementAssets: stableSettlementAssets.list().map((definition) => stableSettlementAssets.status(definition.assetCode)),
      });
    } catch (error) { return handle(res, error); }
  });

  router.get('/assets', (req, res) => {
    try {
      return res.json({ records: service.listAssets({ network: req.query.network, asset: req.query.asset, instrumentId: req.query.instrumentId }) });
    } catch (error) { return handle(res, error); }
  });

  router.get('/source-positions', (_req, res) => {
    try { return res.json({ records:eligibleSourcePositions(service.domain) }); }
    catch (error) { return handle(res, error); }
  });

  router.get('/assets/code-preview/:instrumentId', (req, res) => {
    try {
      const instrumentId = text(req.params.instrumentId);
      const instrument = service.domain.get('SRA_INSTRUMENT', instrumentId);
      if (!instrument) return res.status(404).json({ error: 'Instrument not found.' });
      const assetCode = resolveOnChainAssetCode({ instrumentId, instrument });
      return res.json({ instrumentId, assetCode, generated: !text(instrument.assetCode || instrument.symbol || instrument.ticker) });
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
        const linkedCoinPositionId = text(instrument.coinPositionId || approval.linkedCoinPositionIds?.[0]);
        const linkedCoinPosition = linkedCoinPositionId ? coinPositionById(service.domain, linkedCoinPositionId) : null;
        if (!linkedCoinPosition || ![linkedCoinPosition.instrumentId, linkedCoinPosition.linkedInstrumentId].includes(instrumentId)) {
          const error = new Error('Register an SRA Coin Position to this instrument before creating its on-chain asset identity.');
          error.code = 'INSTRUMENT_COIN_POSITION_LINKAGE_REQUIRED';
          throw error;
        }
        const existingRepresentation = service.listAssets({ instrumentId })[0] || null;
        const selectedNetwork = upper(instrument.selectedOnChainNetwork || existingRepresentation?.network);
        if (selectedNetwork && selectedNetwork !== network) {
          const error = new Error(`This instrument is already bound to ${selectedNetwork}. Create and use its market workflow on that network.`);
          error.code = 'INSTRUMENT_ON_CHAIN_NETWORK_ALREADY_SELECTED';
          throw error;
        }
      }

      const asset = resolveOnChainAssetCode({ instrumentId, instrument, requestedAsset });
      if (!asset) {
        const error = new Error('Asset code could not be generated because the instrument identity is missing.');
        error.code = 'ON_CHAIN_ASSET_CODE_REQUIRED';
        throw error;
      }
      if (!isValidOnChainAssetCode(asset)) {
        const error = new Error('Asset code must be 1–12 letters or numbers.');
        error.code = 'ON_CHAIN_ASSET_CODE_INVALID';
        throw error;
      }

      const id = assetIdFor(instrumentId || asset, network);
      const existingById = service.getAsset(id);
      if (existingById) return res.status(200).json({ created: false, asset: existingById });

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
      if (instrument) await service.domain.put('SRA_INSTRUMENT', instrument.instrumentId, { ...instrument, selectedOnChainNetwork: network, onChainAssetId: record.assetId, onChainNetworkSelectedAt: new Date().toISOString(), onChainNetworkSelectedBy: actor }, { actorId: actor, eventType: 'INSTRUMENT_ON_CHAIN_NETWORK_SELECTED' });
      return res.status(201).json({ created: true, asset: record, networkResult: created, generatedAssetCode: requestedAsset ? null : generateOnChainAssetCode(instrumentId) });
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
      const resolvedSource = resolveIssuanceSource(service.domain, asset, req.body?.sourcePositionId);
      const { sourcePositionId } = resolvedSource;
      if (issuanceSourcesInFlight.has(sourcePositionId)) {
        const error = new Error('This source Coin Position already has an on-chain issuance in progress. Wait for it to finish before issuing again.');
        error.code = 'ON_CHAIN_ISSUANCE_SOURCE_BUSY';
        throw error;
      }
      issuanceSourcesInFlight.add(sourcePositionId);
      try {
      const { position } = resolveIssuanceSource(service.domain, asset, sourcePositionId);
      const issueAmount = Number(req.body.amount);
      const availableBefore = positionAvailable(position);
      const recordedAvailableBefore = Number(position.availableQuantity ?? position.quantityAvailable ?? position.quantity ?? position.balance ?? 0);
      if (!Number.isFinite(issueAmount) || issueAmount <= 0) throw new Error('amount must be greater than zero.');
      if (issueAmount > availableBefore) throw new Error(`Issuance amount exceeds the source Coin Position's available ${availableBefore} SRA.`);
      const issuance = await adapter.issueAsset(asset, { amount: req.body.amount });
      if (issuance?.state !== 'CONFIRMED' || issuance?.confirmation?.state !== 'CONFIRMED') {
        const error = new Error('On-chain issuance was not confirmed. Source Coin Position supply was not externalized.');
        error.code = 'ON_CHAIN_ISSUANCE_NOT_CONFIRMED';
        error.transactionId = issuance?.transactionId || null;
        throw error;
      }
      const completedAt = new Date().toISOString();
      const availableAfter = Number((recordedAvailableBefore - issueAmount).toFixed(8));
      const updatedPosition = { ...position, availableQuantity:availableAfter, externalizedQuantity:Number((Number(position.externalizedQuantity || 0)+issueAmount).toFixed(8)), state:availableAfter > 0 ? 'ACTIVE' : 'EXTERNALLY_TRANSFERRED', onChainRepresentationState:'CONFIRMED', updatedAt:completedAt, statusHistory:[...(position.statusHistory||[]),{state:'COIN_POSITION_EXTERNALIZED_ON_CHAIN',actorId:actor,occurredAt:completedAt,assetId:asset.assetId,network:asset.network,amount:issueAmount,transactionId:issuance.transactionId}] };
      const updatedAsset = { ...asset, sourcePositionId, sourcePositionIds:[...new Set([...(asset.sourcePositionIds||[]),sourcePositionId])], issuedSupply:String(Number(asset.issuedSupply||0)+issueAmount), lastIssueTransactionId:issuance.transactionId, lastIssuedAmount:String(req.body.amount), state:'ISSUED', updatedAt:completedAt };
      const sourceRecordId = `OCIS-${issuance.transactionId}`;
      const sourceRecord = { id:sourceRecordId, issuanceSourceId:sourceRecordId, assetId:asset.assetId, network:asset.network, asset:asset.asset, sourcePositionId, instrumentId:position.instrumentId || asset.instrumentId || null, financialRecordId:position.financialRecordId || null, recognitionId:position.recognitionId || null, observationId:position.observationId || null, sourceClass:sourceClass(service.domain, position), amount:String(req.body.amount), transactionId:issuance.transactionId, state:'CONFIRMED', createdBy:actor, createdAt:completedAt };
      await service.domain.atomicPut([
        { type:'COIN_POSITION', id:sourcePositionId, payload:updatedPosition, actorId:actor, eventType:'COIN_POSITION_EXTERNALIZED_ON_CHAIN' },
        { type:'ON_CHAIN_ASSET', id:asset.assetId, payload:updatedAsset, actorId:actor, eventType:'ON_CHAIN_ASSET_ISSUED_FROM_COIN_POSITION' },
        { type:'ON_CHAIN_ISSUANCE_SOURCE', id:sourceRecordId, payload:sourceRecord, actorId:actor, eventType:'ON_CHAIN_ISSUANCE_SOURCE_CONFIRMED' },
      ]);
      return res.status(201).json({ asset:updatedAsset, issuance:{...issuance,sourcePositionId,sourceRecordId}, sourcePosition:{ positionId:sourcePositionId, availableBefore, availableAfter, externalizedQuantity:updatedPosition.externalizedQuantity } });
      } finally {
        issuanceSourcesInFlight.delete(sourcePositionId);
      }
    } catch (error) { return handle(res, error); }
  });

  router.post('/assets/:assetId/markets/offers', async (req, res) => {
    try {
      const actor = requireActor(req);
      const asset = service.getAsset(req.params.assetId);
      if (!asset) throw new Error('On-chain asset not found.');
      const adapter = adapters.get(upper(asset.network));
      if (!adapter || typeof adapter.createOffer !== 'function') {
        const error = new Error(`Market offers are not available for ${asset.network}.`);
        error.code = 'ON_CHAIN_MARKET_OFFER_UNSUPPORTED';
        throw error;
      }
      const health = await adapterHealth(upper(asset.network), adapter);
      if (!health.issuanceReady) {
        const error = new Error(`${asset.network} issuance accounts are not ready for market offers. ${health.issuerError || health.error || ''}`.trim());
        error.code = 'ON_CHAIN_NETWORK_NOT_READY';
        throw error;
      }
      const sellAmount = Number(req.body?.sellAmount);
      if (!Number.isFinite(sellAmount) || sellAmount <= 0) throw new Error('sellAmount must be greater than zero.');
      if (sellAmount > Number(asset.issuedSupply || 0)) throw new Error(`Offer exceeds the recorded issued supply of ${asset.issuedSupply || 0}.`);
      const offer = await adapter.createOffer(asset, req.body || {});
      if (offer?.state !== 'CONFIRMED' || offer?.confirmation?.state !== 'CONFIRMED') {
        const error = new Error(`${asset.network} market offer was not confirmed.`);
        error.code = 'ON_CHAIN_MARKET_OFFER_NOT_CONFIRMED';
        error.transactionId = offer?.transactionId || null;
        throw error;
      }
      const offerId = `OCMO-${offer.transactionId}`;
      const record = { id: offerId, offerId, assetId: asset.assetId, instrumentId: asset.instrumentId || null, ...offer, createdBy: actor, createdAt: new Date().toISOString() };
      await service.domain.put('ON_CHAIN_MARKET_OFFER', offerId, record, { actorId: actor, eventType: `ON_CHAIN_MARKET_OFFER_${offer.state}` });
      return res.status(201).json(record);
    } catch (error) { return handle(res, error); }
  });

  router.get('/assets/:assetId/markets/offers', (req, res) => {
    try {
      const asset = service.getAsset(req.params.assetId);
      if (!asset) throw new Error('On-chain asset not found.');
      const records = service.domain.list('ON_CHAIN_MARKET_OFFER')
        .filter((record) => record.assetId === asset.assetId)
        .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
      return res.json({ records });
    } catch (error) { return handle(res, error); }
  });

  router.get('/market-offers', (req, res) => {
    try {
      const requested = new Set(text(req.query.assetIds).split(',').filter(Boolean));
      const records = service.domain.list('ON_CHAIN_MARKET_OFFER')
        .filter((record) => !requested.size || requested.has(record.assetId))
        .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
      return res.json({ records });
    } catch (error) { return handle(res, error); }
  });

  router.get('/usdc-markets', (req, res) => {
    try {
      const requested = new Set(text(req.query.assetIds).split(',').filter(Boolean));
      const records = service.domain.list('ON_CHAIN_USDC_MARKET')
        .filter((record)=>!requested.size || requested.has(record.assetId))
        .sort((left,right)=>String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
      return res.json({ records });
    } catch (error) { return handle(res, error); }
  });

  router.post('/assets/:assetId/markets/usdc/activate', async (req, res) => {
    const assetId = req.params.assetId;
    try {
      const actor = requireActor(req);
      if (req.body?.confirmMarketActivation !== true) throw new Error('Explicit SRAUSD/USDC market activation confirmation is required.');
      const asset = service.getAsset(assetId);
      if (!asset) throw new Error('On-chain asset not found.');
      if (upper(asset.network) !== 'STELLAR') throw new Error('SRAUSD/USDC market activation currently requires a Stellar-issued SRA asset.');
      if (Number(asset.issuedSupply || 0) <= 0) throw new Error('Issue SRAUSD supply before activating its USDC market.');
      if (marketActivationsInFlight.has(assetId)) throw Object.assign(new Error('This SRAUSD/USDC market activation is already in progress.'), {code:'SRAUSD_USDC_MARKET_IN_PROGRESS'});
      marketActivationsInFlight.add(assetId);
      try {
        const activation = await adapters.get('STELLAR').activateUsdcMarket(asset, req.body || {});
        if (activation?.confirmation?.state !== 'CONFIRMED') throw Object.assign(new Error('Stellar SRAUSD/USDC market activation was not confirmed.'), {code:'SRAUSD_USDC_MARKET_NOT_CONFIRMED'});
        const createdAt = new Date().toISOString();
        const marketId = `OCUSM-${activation.transactionId}`;
        const record = {id:marketId,marketId,assetId:asset.assetId,instrumentId:asset.instrumentId || null,...activation,createdBy:actor,createdAt,updatedAt:createdAt};
        await service.domain.put('ON_CHAIN_USDC_MARKET',marketId,record,{actorId:actor,eventType:'SRAUSD_USDC_MARKET_ACTIVATED'});
        return res.status(201).json(record);
      } finally { marketActivationsInFlight.delete(assetId); }
    } catch (error) { return handle(res, error); }
  });

  router.post('/assets/:assetId/markets/usdc/:marketId/reconcile', async (req, res) => {
    try {
      const actor = requireActor(req);
      const asset = service.getAsset(req.params.assetId);
      if (!asset) throw new Error('On-chain asset not found.');
      const market = service.domain.get('ON_CHAIN_USDC_MARKET',req.params.marketId);
      if (!market || market.assetId !== asset.assetId) throw new Error('SRAUSD/USDC market record was not found for this asset.');
      const inspection = await adapters.get('STELLAR').inspectUsdcMarket(asset);
      const updated = {...market,...inspection,state:inspection.state,updatedBy:actor,updatedAt:new Date().toISOString()};
      await service.domain.put('ON_CHAIN_USDC_MARKET',market.marketId,updated,{actorId:actor,eventType:'SRAUSD_USDC_MARKET_RECONCILED'});
      return res.json(updated);
    } catch (error) { return handle(res, error); }
  });

  router.post('/assets/:assetId/markets/usdc/quotes', async (req, res) => {
    try {
      const actor = requireActor(req);
      const asset = service.getAsset(req.params.assetId);
      if (!asset) throw new Error('On-chain asset not found.');
      if (upper(asset.network) !== 'STELLAR') throw new Error('This SRAUSD/USDC conversion workflow currently requires a Stellar-issued SRA asset.');
      if (Number(asset.issuedSupply || 0) <= 0) throw new Error('Issue SRAUSD supply before requesting a USDC conversion quote.');
      const adapter = adapters.get('STELLAR');
      const health = await adapterHealth('STELLAR', adapter);
      if (!health.ready) throw Object.assign(new Error(`Stellar distribution account is not ready. ${health.error || ''}`.trim()), { code:'ON_CHAIN_NETWORK_NOT_READY' });
      const quote = await adapter.quoteUsdcSwap(asset, req.body || {});
      const quoteId = `OCSQ-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
      const record = { id:quoteId, quoteId, assetId:asset.assetId, instrumentId:asset.instrumentId || null, ...quote, createdBy:actor, createdAt:new Date().toISOString() };
      await service.domain.put('ON_CHAIN_SWAP_QUOTE', quoteId, record, { actorId:actor, eventType:'SRAUSD_USDC_SWAP_QUOTED' });
      return res.status(201).json(record);
    } catch (error) { return handle(res, error); }
  });

  router.post('/assets/:assetId/markets/usdc/swaps', async (req, res) => {
    const quoteId = text(req.body?.quoteId);
    try {
      const actor = requireActor(req);
      if (req.body?.confirmSwap !== true) throw new Error('Explicit SRAUSD/USDC swap confirmation is required.');
      const asset = service.getAsset(req.params.assetId);
      if (!asset) throw new Error('On-chain asset not found.');
      const quote = service.domain.get('ON_CHAIN_SWAP_QUOTE', quoteId);
      if (!quote || quote.assetId !== asset.assetId) throw new Error('SRAUSD/USDC quote was not found for this asset.');
      if (quote.state !== 'QUOTED') throw new Error(`SRAUSD/USDC quote is ${quote.state || 'unavailable'} and cannot be executed.`);
      if (swapsInFlight.has(quoteId)) throw Object.assign(new Error('This SRAUSD/USDC quote is already being executed.'), { code:'SRAUSD_USDC_SWAP_IN_PROGRESS' });
      swapsInFlight.add(quoteId);
      try {
        const execution = await adapters.get('STELLAR').executeUsdcSwap(asset, quote);
        if (execution?.confirmation?.state !== 'CONFIRMED') throw Object.assign(new Error('Stellar SRAUSD/USDC swap was not confirmed.'), { code:'SRAUSD_USDC_SWAP_NOT_CONFIRMED', transactionId:execution?.transactionId });
        const completedAt = new Date().toISOString();
        const swapId = `OCSW-${execution.transactionId}`;
        const swap = { id:swapId, swapId, quoteId, assetId:asset.assetId, instrumentId:asset.instrumentId || null, ...execution, approvedBy:actor, executedAt:completedAt, createdAt:completedAt };
        const consumedQuote = { ...quote, state:'EXECUTED', swapId, transactionId:execution.transactionId, executedBy:actor, executedAt:completedAt };
        await service.domain.atomicPut([
          { type:'ON_CHAIN_SWAP_QUOTE', id:quoteId, payload:consumedQuote, actorId:actor, eventType:'SRAUSD_USDC_SWAP_QUOTE_EXECUTED' },
          { type:'ON_CHAIN_ASSET_SWAP', id:swapId, payload:swap, actorId:actor, eventType:'SRAUSD_USDC_SWAP_CONFIRMED' },
        ]);
        return res.status(201).json(swap);
      } finally { swapsInFlight.delete(quoteId); }
    } catch (error) { return handle(res, error); }
  });

  router.get('/market-swaps', (req, res) => {
    try {
      const requested = new Set(text(req.query.assetIds).split(',').filter(Boolean));
      const records = service.domain.list('ON_CHAIN_ASSET_SWAP').filter((record)=>!requested.size || requested.has(record.assetId))
        .sort((left,right)=>String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
      return res.json({ records });
    } catch (error) { return handle(res, error); }
  });

  router.post('/assets/:assetId/markets/usdc/swaps/:swapId/reconcile', async (req, res) => {
    try {
      const actor = requireActor(req);
      const asset = service.getAsset(req.params.assetId);
      if (!asset) throw new Error('On-chain asset not found.');
      const swap = service.domain.get('ON_CHAIN_ASSET_SWAP', req.params.swapId);
      if (!swap || swap.assetId !== asset.assetId) throw new Error('SRAUSD/USDC swap was not found for this asset.');
      const reconciliation = await adapters.get('STELLAR').reconcileUsdcSwap(asset, swap);
      const updated = { ...swap, ...reconciliation, reconciledBy:actor, updatedAt:new Date().toISOString() };
      await service.domain.put('ON_CHAIN_ASSET_SWAP', swap.swapId, updated, { actorId:actor, eventType:'SRAUSD_USDC_SWAP_RECONCILED' });
      return res.json(updated);
    } catch (error) { return handle(res, error); }
  });

  router.post('/assets/:assetId/markets/offers/:offerId/reconcile', async (req, res) => {
    try {
      const actor = requireActor(req);
      const asset = service.getAsset(req.params.assetId);
      if (!asset) throw new Error('On-chain asset not found.');
      const offer = service.domain.get('ON_CHAIN_MARKET_OFFER', req.params.offerId);
      if (!offer || offer.assetId !== asset.assetId) throw new Error('On-chain market offer not found.');
      const adapter = adapters.get(upper(asset.network));
      if (!adapter || typeof adapter.reconcileOffer !== 'function') {
        const error = new Error(`Market offer reconciliation is not available for ${asset.network}.`);
        error.code = 'ON_CHAIN_MARKET_RECONCILIATION_UNSUPPORTED';
        throw error;
      }
      const reconciliation = await adapter.reconcileOffer(asset, offer);
      const updated = { ...offer, ...reconciliation, updatedAt:new Date().toISOString(), updatedBy:actor };
      await service.domain.put('ON_CHAIN_MARKET_OFFER', offer.offerId, updated, { actorId:actor, eventType:`ON_CHAIN_MARKET_OFFER_${updated.marketState}` });
      return res.json(updated);
    } catch (error) { return handle(res, error); }
  });

  router.post('/assets/:assetId/markets/offers/:offerId/cancel', async (req, res) => {
    try {
      const actor = requireActor(req);
      const asset = service.getAsset(req.params.assetId);
      if (!asset) throw new Error('On-chain asset not found.');
      const offer = service.domain.get('ON_CHAIN_MARKET_OFFER', req.params.offerId);
      if (!offer || offer.assetId !== asset.assetId) throw new Error('On-chain market offer not found.');
      const adapter = adapters.get(upper(asset.network));
      if (!adapter || typeof adapter.cancelOffer !== 'function') {
        const error = new Error(`Market offer cancellation is not available for ${asset.network}.`);
        error.code = 'ON_CHAIN_MARKET_CANCELLATION_UNSUPPORTED';
        throw error;
      }
      const cancellation = await adapter.cancelOffer(asset, offer);
      if (cancellation?.cancelConfirmation?.state !== 'CONFIRMED') {
        const error = new Error(`${asset.network} market offer cancellation was not confirmed.`);
        error.code = 'ON_CHAIN_MARKET_CANCELLATION_NOT_CONFIRMED';
        error.transactionId = cancellation?.cancelTransactionId || null;
        throw error;
      }
      const updated = { ...offer, ...cancellation, updatedAt:new Date().toISOString(), updatedBy:actor };
      await service.domain.put('ON_CHAIN_MARKET_OFFER', offer.offerId, updated, { actorId:actor, eventType:'ON_CHAIN_MARKET_OFFER_CANCELLED' });
      return res.json(updated);
    } catch (error) { return handle(res, error); }
  });

  router.post('/assets/:assetId/markets/offers/:offerId/replace', async (req, res) => {
    try {
      const actor = requireActor(req);
      const asset = service.getAsset(req.params.assetId);
      if (!asset) throw new Error('On-chain asset not found.');
      const offer = service.domain.get('ON_CHAIN_MARKET_OFFER', req.params.offerId);
      if (!offer || offer.assetId !== asset.assetId) throw new Error('On-chain market offer not found.');
      const adapter = adapters.get(upper(asset.network));
      if (!adapter || typeof adapter.cancelOffer !== 'function' || typeof adapter.createOffer !== 'function') {
        const error = new Error(`Market offer replacement is not available for ${asset.network}.`);
        error.code = 'ON_CHAIN_MARKET_REPLACEMENT_UNSUPPORTED';
        throw error;
      }
      const sellAmount = Number(req.body?.sellAmount);
      const buyAmountNative = Number(req.body?.buyAmountNative);
      if (!Number.isFinite(sellAmount) || sellAmount <= 0 || !Number.isFinite(buyAmountNative) || buyAmountNative <= 0) throw new Error('Replacement sell and requested amounts must be greater than zero.');
      if (sellAmount > Number(asset.issuedSupply || 0)) throw new Error(`Replacement offer exceeds the recorded issued supply of ${asset.issuedSupply || 0}.`);
      const cancellation = await adapter.cancelOffer(asset, offer);
      if (cancellation?.cancelConfirmation?.state !== 'CONFIRMED') {
        const error = new Error(`${asset.network} market offer cancellation was not confirmed, so no replacement was submitted.`);
        error.code = 'ON_CHAIN_MARKET_CANCELLATION_NOT_CONFIRMED';
        error.transactionId = cancellation?.cancelTransactionId || null;
        throw error;
      }
      const cancelled = { ...offer, ...cancellation, updatedAt:new Date().toISOString(), updatedBy:actor };
      await service.domain.put('ON_CHAIN_MARKET_OFFER', offer.offerId, cancelled, { actorId:actor, eventType:'ON_CHAIN_MARKET_OFFER_CANCELLED_FOR_REPLACEMENT' });
      const replacement = await adapter.createOffer(asset, req.body || {});
      if (replacement?.state !== 'CONFIRMED' || replacement?.confirmation?.state !== 'CONFIRMED') {
        const error = new Error(`${asset.network} replacement offer was not confirmed. The original offer remains cancelled.`);
        error.code = 'ON_CHAIN_MARKET_REPLACEMENT_NOT_CONFIRMED';
        error.transactionId = replacement?.transactionId || null;
        throw error;
      }
      const replacementOfferId = `OCMO-${replacement.transactionId}`;
      const replacementRecord = { id:replacementOfferId, offerId:replacementOfferId, assetId:asset.assetId, instrumentId:asset.instrumentId || null, ...replacement, replacesOfferId:offer.offerId, createdBy:actor, createdAt:new Date().toISOString() };
      await service.domain.put('ON_CHAIN_MARKET_OFFER', replacementOfferId, replacementRecord, { actorId:actor, eventType:'ON_CHAIN_MARKET_OFFER_REPLACED' });
      return res.status(201).json({ cancelled, replacement:replacementRecord });
    } catch (error) { return handle(res, error); }
  });

  router.get('/stable-settlement-assets', async (_req, res) => {
    try {
      await stableSettlementAssets.ensure();
      return res.json({ records: stableSettlementAssets.list().map((definition) => stableSettlementAssets.status(definition.assetCode)) });
    } catch (error) { return handle(res, error); }
  });

  router.get('/stable-settlement-assets/:assetCode', async (req, res) => {
    try {
      await stableSettlementAssets.ensure();
      const status = stableSettlementAssets.status(req.params.assetCode);
      return status ? res.json(status) : res.status(404).json({ error: 'Stable settlement asset not found.' });
    } catch (error) { return handle(res, error); }
  });

  router.post('/stable-settlement-assets', async (req, res) => {
    try {
      const actor = requireActor(req);
      const definition = await stableSettlementAssets.define(req.body || {}, actor);
      return res.status(201).json(stableSettlementAssets.status(definition.assetCode));
    } catch (error) { return handle(res, error); }
  });

  router.post('/stable-settlement-assets/:assetCode/reserves', async (req, res) => {
    try {
      const actor = requireActor(req);
      return res.status(201).json(await stableSettlementAssets.recordReserve(req.params.assetCode, req.body || {}, actor));
    } catch (error) { return handle(res, error); }
  });

  router.post('/stable-settlement-assets/:assetCode/representations', async (req, res) => {
    try {
      const actor = requireActor(req);
      const representation = await stableSettlementAssets.registerRepresentation(req.params.assetCode, req.body || {}, actor);
      return res.status(201).json({ representation, status: stableSettlementAssets.status(req.params.assetCode) });
    } catch (error) { return handle(res, error); }
  });

  router.post('/stable-settlement-assets/:assetCode/issue', async (req, res) => {
    try {
      const actor = requireActor(req);
      return res.status(201).json(await stableSettlementAssets.issue(req.params.assetCode, req.body || {}, actor));
    } catch (error) { return handle(res, error); }
  });

  router.post('/stable-settlement-assets/:assetCode/redeem', async (req, res) => {
    try {
      const actor = requireActor(req);
      return res.status(201).json(await stableSettlementAssets.redeem(req.params.assetCode, req.body || {}, actor));
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
