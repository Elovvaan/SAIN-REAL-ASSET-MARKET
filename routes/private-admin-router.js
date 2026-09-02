import crypto from 'node:crypto';
import express, { Router } from 'express';
import { AccessService } from '../services/access-service.js';
import { MarketplaceListingService } from '../services/marketplace-listing-service.js';
import { ListingReadinessBatchService } from '../services/listing-readiness-batch-service.js';
import { ListingPublicationBatchService } from '../services/listing-publication-batch-service.js';
import { AdminIntelligenceAgentService } from '../services/admin-intelligence-agent-service.js';
import { DeterminationEngineService } from '../services/determination-engine-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';
import { installDeterminationAdminRoutes } from './determination-admin-routes.js';
import { installInstrumentAdminRoutes } from './instrument-admin-routes.js';
import { installTreasuryAdminRoutes } from './treasury-admin-routes.js';
import { installTreasuryTransferReadinessRoutes } from './treasury-transfer-readiness-routes.js';
import { installAgentWorkforceAdminRoutes } from './agent-workforce-admin-routes.js';

function readCookie(req, name) {
  const cookie = req.headers.cookie || '';
  const entry = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}
function setAdminCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sra_admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=14400${secure}`);
}
function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', 'sra_admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
}
function hasAdminCapacity(subject) {
  return Boolean(subject?.capacities?.some((capacity) => (typeof capacity === 'string' ? capacity : capacity.id) === 'PLATFORM_ADMIN'));
}
function isDemoIdentity(subject) { return String(subject?.email || '').toLowerCase().endsWith('@sra.demo'); }
function isRealAdministrator(subject) { return hasAdminCapacity(subject) && !isDemoIdentity(subject); }
function count(domain, type) { return domain.list(type).length; }
function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function stateOf(record) { return String(record?.state || record?.status || record?.lifecycleState || 'UNKNOWN').toUpperCase(); }
function sortNewest(records = []) {
  const keys = ['updatedAt','createdAt','occurredAt','recordedAt','issuedAt','publishedAt','confirmedAt','settledAt'];
  return [...records].sort((left, right) => {
    const leftDate = keys.map((key) => left?.[key]).find(Boolean);
    const rightDate = keys.map((key) => right?.[key]).find(Boolean);
    return new Date(rightDate || 0) - new Date(leftDate || 0);
  });
}
function expose(records = [], limit = 250) { return sortNewest(records).slice(0, Math.max(1, Math.min(Number(limit) || 250, 1000))); }
function list(domain, type, limit) { return expose(domain.list(type), limit); }
function workspaceStatus(records, requiredKeys) {
  const missingSources = requiredKeys.filter((key) => !Array.isArray(records[key]));
  const recordCount = requiredKeys.reduce((sum, key) => sum + (records[key]?.length || 0), 0);
  return { state: missingSources.length ? 'MISCONFIGURED' : 'AVAILABLE', recordCount, missingSources };
}
function stateCounts(records = []) {
  const counts = {};
  for (const record of records) counts[stateOf(record)] = (counts[stateOf(record)] || 0) + 1;
  return counts;
}

const ADMIN_WORKSPACE_SOURCES = Object.freeze({
  dashboard: ['instruments','marketplaceListings','transactions','exportPackages','settlementInstructions','treasuryExceptions','lifecycleEvents'],
  operations: ['transactions','fundingInstructions','exportPackages','settlementInstructions','treasuryPaymentOrders','treasuryExceptions','marketplaceSettlementPreparations','marketplaceSettlementReviews','marketplaceSettlementAuthorizations','lifecycleEvents'],
  treasury: ['instruments','transactions','treasuryProfiles','ledgerAccounts','ledgerEntries','accountingPeriods','treasuryBankConnections','treasuryPaymentOrders','treasuryStatements','treasuryWallets','treasuryCryptoActivity','treasuryForecasts','treasuryExceptions','financialStatementSnapshots'],
  nativeAsset: ['instruments','marketplaceListings','recognitions','ownershipRecognitions','exportPackages','lifecycleEvents'],
  marketplace: ['marketplaceListings','marketplaceCommitmentWindows','marketplaceCommitments','marketplacePositions','marketplaceAllocations','marketplaceSettlementPreparations','marketplaceSettlementReviews','marketplaceSettlementAuthorizations','transactions','settlements','lifecycleEvents'],
  instruments: ['instruments','protectionInstruments','lifecycleEvents'],
  records: ['recognitions','ownershipRecognitions','observations','verifiedValueRecords','financialRecords','financialRecordAccounts','financialHistory','evidencePackages','assetRelationships','lifecycleEvents'],
  coinPositions: ['coinAccounts','coinPositions','recognitions','observations','lifecycleEvents'],
  transactions: ['transactions','fundingInstructions','paymentReceipts','settlements','settlementRecords','lifecycleEvents'],
  settlement: ['exportPackages','settlementInstructions','settlementAdapters','settlements','settlementRecords','paymentReceipts','lifecycleEvents'],
  agent: ['transactions','settlementInstructions','treasuryExceptions','lifecycleEvents'],
  connections: ['settlementAdapters','treasuryBankConnections','treasuryWallets','connectorDefinitions','enterpriseConnections','extractionRequests','extractionResults','outboundEvents','lifecycleEvents'],
  users: ['users','participants','lifecycleEvents'],
  system: ['treasuryExceptions','outboundEvents','lifecycleEvents'],
});

const ADMIN_RECORD_TYPES = Object.freeze({
  participants:RECORD_TYPES.PARTICIPANT, assetAccounts:RECORD_TYPES.ASSET_ACCOUNT, projectAccounts:RECORD_TYPES.PROJECT_ACCOUNT,
  instruments:RECORD_TYPES.SRA_INSTRUMENT, protectionInstruments:RECORD_TYPES.PROTECTION_INSTRUMENT, marketplaceListings:RECORD_TYPES.MARKETPLACE_LISTING,
  marketplaceCommitmentWindows:RECORD_TYPES.FUNDING_MARKETPLACE_COMMITMENT_WINDOW, marketplaceCommitments:RECORD_TYPES.FUNDING_MARKETPLACE_COMMITMENT,
  marketplacePositions:RECORD_TYPES.FUNDING_MARKETPLACE_POSITION, marketplaceAllocations:RECORD_TYPES.FUNDING_MARKETPLACE_ALLOCATION_REVIEW,
  marketplaceSettlementPreparations:RECORD_TYPES.FUNDING_MARKETPLACE_SETTLEMENT_PREPARATION, marketplaceSettlementReviews:RECORD_TYPES.FUNDING_MARKETPLACE_SETTLEMENT_REVIEW,
  marketplaceSettlementAuthorizations:RECORD_TYPES.FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZATION, recognitions:RECORD_TYPES.RECOGNITION_ASSESSMENT,
  ownershipRecognitions:RECORD_TYPES.OWNERSHIP_RECOGNITION, observations:RECORD_TYPES.MARKET_OBSERVATION, verifiedValueRecords:RECORD_TYPES.VERIFIED_VALUE_RECORD,
  financialRecords:RECORD_TYPES.FINANCIAL_RECORD, financialRecordAccounts:RECORD_TYPES.FINANCIAL_RECORD_ACCOUNT, financialHistory:RECORD_TYPES.FINANCIAL_HISTORY_RECORD,
  evidencePackages:RECORD_TYPES.EVIDENCE_PACKAGE, assetRelationships:RECORD_TYPES.ASSET_RELATIONSHIP, coinPositions:RECORD_TYPES.COIN_POSITION,
  coinAccounts:RECORD_TYPES.COIN_ACCOUNT, transactions:RECORD_TYPES.SRA_TRANSACTION, fundingInstructions:RECORD_TYPES.FUNDING_INSTRUCTION,
  paymentReceipts:RECORD_TYPES.PAYMENT_RECEIPT, exportPackages:RECORD_TYPES.EXPORT_PACKAGE, settlementInstructions:RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION,
  settlementAdapters:RECORD_TYPES.SETTLEMENT_RAIL_ADAPTER, settlements:RECORD_TYPES.SRA_SETTLEMENT, settlementRecords:RECORD_TYPES.SRA_SETTLEMENT_RECORD,
  treasuryProfiles:RECORD_TYPES.PLATFORM_TREASURY_PROFILE, treasuryForecasts:RECORD_TYPES.PLATFORM_TREASURY_FORECAST,
  treasuryExceptions:RECORD_TYPES.PLATFORM_TREASURY_EXCEPTION, treasuryBankConnections:RECORD_TYPES.TREASURY_BANK_CONNECTION,
  treasuryPaymentOrders:RECORD_TYPES.TREASURY_PAYMENT_ORDER, treasuryStatements:RECORD_TYPES.TREASURY_STATEMENT,
  treasuryWallets:RECORD_TYPES.TREASURY_CRYPTO_WALLET, treasuryCryptoActivity:RECORD_TYPES.TREASURY_CRYPTO_ACTIVITY,
  ledgerAccounts:RECORD_TYPES.LEDGER_ACCOUNT, ledgerEntries:RECORD_TYPES.LEDGER_ENTRY, accountingPeriods:RECORD_TYPES.ACCOUNTING_PERIOD,
  financialStatementSnapshots:RECORD_TYPES.FINANCIAL_STATEMENT_SNAPSHOT, connectorDefinitions:RECORD_TYPES.EDX_CONNECTOR_DEFINITION,
  enterpriseConnections:RECORD_TYPES.EDX_ENTERPRISE_CONNECTION, extractionRequests:RECORD_TYPES.EDX_EXTRACTION_REQUEST,
  extractionResults:RECORD_TYPES.EDX_EXTRACTION_RESULT, outboundEvents:RECORD_TYPES.EDX_OUTBOUND_EVENT, lifecycleEvents:RECORD_TYPES.LIFECYCLE_EVENT,
});
function compactMarketDashboard(domain) {
  const eventMarkets = domain.list(RECORD_TYPES.EVENT_MARKET);
  const eventSignals = domain.list(RECORD_TYPES.EVENT_MARKET_SIGNAL);
  const eventPositions = domain.list(RECORD_TYPES.EVENT_POSITION);
  const eventExecutions = domain.list(RECORD_TYPES.EVENT_EXECUTION);
  const eventSettlements = domain.list(RECORD_TYPES.EVENT_SETTLEMENT);
  const baskets = domain.list(RECORD_TYPES.PRODUCTIVE_BASKET);
  const admissions = domain.list(RECORD_TYPES.BASKET_ASSET_ADMISSION);
  const contributions = domain.list(RECORD_TYPES.BASKET_CONTRIBUTION);
  const basketPositions = domain.list(RECORD_TYPES.BASKET_PARTICIPATION_POSITION);
  const performance = domain.list(RECORD_TYPES.BASKET_PERFORMANCE_EVENT);
  const distributions = domain.list(RECORD_TYPES.BASKET_DISTRIBUTION);
  const signalsByMarket = new Map();
  for (const signal of eventSignals) {
    const current = signalsByMarket.get(signal.eventMarketId) || [];
    current.push(signal);
    signalsByMarket.set(signal.eventMarketId, current);
  }
  const eventItems = sortNewest(eventMarkets).slice(0, 12).map((market) => {
    const signals = sortNewest(signalsByMarket.get(market.eventMarketId) || []).slice(0, 24).reverse();
    const latest = signals.at(-1) || null;
    return {
      eventMarketId: market.eventMarketId, shortName: market.shortName, question: market.question,
      category: market.category, state: market.state, scheduledCloseAt: market.scheduledCloseAt,
      yesPrice: latest?.yesPrice ?? null, noPrice: latest?.noPrice ?? null, observedAt: latest?.observedAt ?? null,
      signalSource: latest?.sourceName ?? null,
      series: signals.map((signal) => ({ yesPrice: signal.yesPrice, observedAt: signal.observedAt })),
      openInterest: eventPositions.filter((item) => item.eventMarketId === market.eventMarketId && stateOf(item) === 'OPEN').reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      volume: eventExecutions.filter((item) => item.eventMarketId === market.eventMarketId).reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    };
  });
  const basketItems = sortNewest(baskets).slice(0, 12).map((basket) => {
    const basketAdmissions = admissions.filter((item) => item.basketId === basket.basketId);
    const basketContributions = contributions.filter((item) => item.basketId === basket.basketId);
    const basketPerformance = sortNewest(performance.filter((item) => item.basketId === basket.basketId));
    const basketDistributions = distributions.filter((item) => item.basketId === basket.basketId);
    const recognizedValue = basketContributions.reduce((sum, item) => sum + Number(item.recognizedValue || 0), 0);
    const distributable = basketPerformance.reduce((sum, item) => sum + Number(item.distributableValue || 0), 0);
    const distributed = basketDistributions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      basketId: basket.basketId, name: basket.name, symbol: basket.unitSymbol, model: basket.model, state: basket.state,
      recognizedValue, minimumCloseValue: Number(basket.minimumCloseValue || 0),
      positionCount: basketPositions.filter((item) => item.basketId === basket.basketId && stateOf(item) === 'ACTIVE').length,
      pendingAdmissions: basketAdmissions.filter((item) => ['SUBMITTED','PENDING','UNDER_REVIEW'].includes(stateOf(item))).length,
      undistributedValue: Math.max(0, Number((distributable - distributed).toFixed(8))),
      latestPerformanceAt: basketPerformance[0]?.recordedAt || null
    };
  });
  const workflow = [];
  for (const market of eventItems) {
    const action = market.state === 'DRAFT' ? 'Review market' : market.state === 'REVIEWED' ? 'List on venue' : market.state === 'RESOLVED' ? 'Settle positions' : ['OPEN','SUSPENDED','CLOSED'].includes(market.state) ? 'Monitor or resolve' : null;
    if (action) workflow.push({ kind:'EVENT', id:market.eventMarketId, title:market.shortName || market.question, state:market.state, action });
  }
  for (const basket of basketItems) {
    if (basket.pendingAdmissions) workflow.push({ kind:'BASKET', id:basket.basketId, title:basket.name || basket.basketId, state:basket.state, action:`Review ${basket.pendingAdmissions} admission${basket.pendingAdmissions === 1 ? '' : 's'}` });
    else if (basket.state === 'FORMATION' && basket.recognizedValue >= basket.minimumCloseValue) workflow.push({ kind:'BASKET', id:basket.basketId, title:basket.name || basket.basketId, state:basket.state, action:'Close formation' });
    else if (basket.state === 'ACTIVE' && basket.undistributedValue > 0) workflow.push({ kind:'BASKET', id:basket.basketId, title:basket.name || basket.basketId, state:basket.state, action:'Review distribution' });
  }
  return {
    eventMarkets: { counts:stateCounts(eventMarkets), total:eventMarkets.length, signalCount:eventSignals.length, settlementCount:eventSettlements.length, items:eventItems },
    productiveBaskets: { counts:stateCounts(baskets), total:baskets.length, admissionCount:admissions.length, contributionCount:contributions.length, items:basketItems },
    workflow: workflow.slice(0, 20)
  };
}

export async function createPrivateAdminRouter({ database, domain, coinbasePublicMarket = null, nativePlatformAsset = null }) {
  const access = new AccessService({ database });
  const marketplaceListings = new MarketplaceListingService(domain);
  const listingReadinessBatch = new ListingReadinessBatchService(domain);
  const listingPublicationBatch = new ListingPublicationBatchService(domain);
  const intelligenceAgent = new AdminIntelligenceAgentService({ domain, database });
  const determinationEngine = new DeterminationEngineService(domain);
  await access.initialize();
  await determinationEngine.initialize();
  const router = Router();
  router.use(express.json({ limit: '256kb' }));

  async function persistedUsers() { return database ? database.listUsers() : [...access.users.values()]; }
  async function realAdministrators() { return (await persistedUsers()).filter(isRealAdministrator); }
  async function bootstrapState() {
    const administrators = await realAdministrators();
    return { initialized: administrators.length > 0, setupAvailable: administrators.length === 0 && Boolean(process.env.SRA_ADMIN_SETUP_CODE), setupCodeConfigured: Boolean(process.env.SRA_ADMIN_SETUP_CODE), administratorCount: administrators.length };
  }
  async function adminSession(req) {
    const session = await access.getSession(readCookie(req, 'sra_admin_session'));
    return session?.activeCapacity === 'PLATFORM_ADMIN' && isRealAdministrator(session) ? session : null;
  }
  async function requireAdmin(req, res) {
    const session = await adminSession(req);
    if (!session) res.status(401).json({ error: 'Private Platform Administration authentication is required.' });
    return session;
  }

  router.get('/api/admin/bootstrap-status', async (_req, res) => res.json({ ...(await bootstrapState()), portal: 'PRIVATE_PLATFORM_ADMINISTRATION' }));

  router.post('/api/admin/bootstrap', async (req, res) => {
    try {
      const state = await bootstrapState();
      if (state.initialized) return res.status(409).json({ error: 'Platform Administration has already been initialized.' });
      if (!state.setupCodeConfigured) return res.status(503).json({ error: 'One-time administrator setup is not enabled. Configure SRA_ADMIN_SETUP_CODE in Railway.' });
      if (!safeEqual(req.body?.setupCode, process.env.SRA_ADMIN_SETUP_CODE)) return res.status(403).json({ error: 'The one-time setup code is incorrect.' });
      if (String(req.body?.password || '') !== String(req.body?.confirmPassword || '')) return res.status(400).json({ error: 'Password confirmation does not match.' });
      const user = await access.createUser({ displayName: req.body?.displayName, email: req.body?.email, password: req.body?.password, capacities: ['UNIVERSAL', 'PLATFORM_ADMIN'] });
      if (database) await database.audit({ actorId: user.id, eventType: 'PLATFORM_ADMINISTRATION_INITIALIZED', objectType: 'PLATFORM_ADMIN', objectId: user.id });
      const result = await access.signin({ email: user.email, password: req.body?.password });
      const session = await access.switchRole(result.token, 'PLATFORM_ADMIN');
      setAdminCookie(res, result.token);
      return res.status(201).json({ initialized: true, authenticated: true, session, portal: 'PRIVATE_PLATFORM_ADMINISTRATION' });
    } catch (error) { return res.status(400).json({ error: error.message || 'Platform Administration initialization failed.' }); }
  });

  router.post('/api/admin/signin', async (req, res) => {
    try {
      const state = await bootstrapState();
      if (!state.initialized) return res.status(409).json({ error: 'Create the first Platform Administrator before signing in.', requiresInitialization: true });
      const result = await access.signin(req.body || {});
      if (!isRealAdministrator(result.session)) { await access.signout(result.token); return res.status(403).json({ error: 'This identity is not authorized for Platform Administration.' }); }
      const session = await access.switchRole(result.token, 'PLATFORM_ADMIN');
      setAdminCookie(res, result.token);
      return res.json({ authenticated: true, session, portal: 'PRIVATE_PLATFORM_ADMINISTRATION' });
    } catch (error) { return res.status(401).json({ error: error.message || 'Administrator sign-in failed.' }); }
  });

  router.get('/api/admin/session', async (req, res) => {
    const session = await adminSession(req);
    return res.json({ authenticated: Boolean(session), session, bootstrap: await bootstrapState(), portal: 'PRIVATE_PLATFORM_ADMINISTRATION' });
  });
  router.post('/api/admin/signout', async (req, res) => { await access.signout(readCookie(req, 'sra_admin_session')); clearAdminCookie(res); return res.json({ signedOut: true }); });

  router.get('/api/admin/agent/capabilities', async (req, res) => { const session = await requireAdmin(req, res); if (!session) return; return res.json(intelligenceAgent.capabilities()); });
  router.post('/api/admin/agent/query', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(await intelligenceAgent.ask(req.body || {}, session)); }
    catch (error) { return res.status(400).json({ error: error.message, code: 'SRA_ADMIN_AGENT_QUERY_FAILED' }); }
  });

  router.get('/api/admin/platform-asset', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    if (!nativePlatformAsset) return res.status(503).json({ error: 'Native platform asset service is unavailable.' });
    return res.json(nativePlatformAsset.status());
  });
  router.post('/api/admin/platform-asset/bootstrap', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    if (!nativePlatformAsset) return res.status(503).json({ error: 'Native platform asset service is unavailable.' });
    if (String(req.body?.approval || '').toUpperCase() !== 'APPROVE') return res.status(409).json({ error: 'Explicit administrator approval is required.', code: 'SRA_PLATFORM_ASSET_APPROVAL_REQUIRED', requiredApproval: 'APPROVE', status: nativePlatformAsset.status() });
    try {
      const result = await nativePlatformAsset.bootstrap(req.body || {}, session.id);
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'SRA_NATIVE_PLATFORM_ASSET_BOOTSTRAP_APPROVED', objectType: 'SRA_PLATFORM_ASSET', objectId: result.status.platformAssetCode, payload: { created: result.created, exportPackageId: result.status.references.exportPackageId || null } });
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_NATIVE_PLATFORM_ASSET_BOOTSTRAP_FAILED' }); }
  });

  router.get('/api/admin/listing-readiness-batch', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json({ status: listingReadinessBatch.status(), preview: listingReadinessBatch.preview(req.query || {}) });
  });
  router.post('/api/admin/listing-readiness-batch/approve', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    if (String(req.body?.approval || '').toUpperCase() !== 'APPROVE') return res.status(409).json({ error: 'Explicit administrator approval is required.', code: 'SRA_LISTING_READINESS_BATCH_APPROVAL_REQUIRED', requiredApproval: 'APPROVE', preview: listingReadinessBatch.preview(req.body || {}) });
    try {
      const result = await listingReadinessBatch.approve(req.body || {}, session.id);
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'SRA_LISTING_READINESS_BATCH_APPROVED', objectType: 'SRA_LISTING_READINESS_BATCH', objectId: result.batchId, payload: { updatedListingCount: result.updatedListingCount, unitPrice: result.policy?.unitPrice, publicationExecuted: false } });
      return res.status(201).json(result);
    } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_LISTING_READINESS_BATCH_FAILED' }); }
  });

  router.get('/api/admin/listing-publication-batch', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json({ status: listingPublicationBatch.status(), preview: listingPublicationBatch.preview() });
  });
  router.post('/api/admin/listing-publication-batch/approve', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    if (String(req.body?.approval || '').toUpperCase() !== 'APPROVE') return res.status(409).json({ error: 'Explicit administrator publication approval is required.', code: 'SRA_LISTING_PUBLICATION_BATCH_APPROVAL_REQUIRED', requiredApproval: 'APPROVE', preview: listingPublicationBatch.preview() });
    try {
      const result = await listingPublicationBatch.approve(req.body || {}, session.id);
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'SRA_LISTING_PUBLICATION_BATCH_APPROVED', objectType: 'SRA_LISTING_PUBLICATION_BATCH', objectId: result.batchId, payload: { publishedListingCount: result.publishedListingCount, transactionsCreated: 0, settlementExecuted: false } });
      return res.status(201).json(result);
    } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_LISTING_PUBLICATION_BATCH_FAILED' }); }
  });

  const instrumentAdministration = await installInstrumentAdminRoutes({ router, domain, requireAdmin, database });
  const determinationAdministration = await installDeterminationAdminRoutes({ router, service: determinationEngine, requireAdmin });
  const treasuryAdministration = await installTreasuryAdminRoutes({ router, domain, requireAdmin, database });
  const treasuryTransferReadiness = await installTreasuryTransferReadinessRoutes({ router, domain, requireAdmin, database });
  const agentWorkforceAdministration = await installAgentWorkforceAdminRoutes({ router, domain, database, requireAdmin });

  router.get('/api/admin/dashboard', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    const market = compactMarketDashboard(domain);
    return res.json({
      generatedAt: new Date().toISOString(),
      administrator: { id: session.id, displayName: session.displayName },
      statuses: {
        treasury: { state:'AVAILABLE', recordCount:count(domain, RECORD_TYPES.LEDGER_ENTRY) + count(domain, RECORD_TYPES.TREASURY_PAYMENT_ORDER) },
        marketplace: { state:'AVAILABLE', recordCount:count(domain, RECORD_TYPES.MARKETPLACE_LISTING) },
        nativeAsset: { state:nativePlatformAsset ? 'AVAILABLE' : 'UNAVAILABLE', recordCount:count(domain, RECORD_TYPES.SRA_INSTRUMENT) },
        coinPositions: { state:'AVAILABLE', recordCount:count(domain, RECORD_TYPES.COIN_POSITION) },
        settlement: { state:'AVAILABLE', recordCount:count(domain, RECORD_TYPES.SRA_SETTLEMENT) + count(domain, RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION) },
        system: { state:'AVAILABLE', recordCount:count(domain, RECORD_TYPES.LIFECYCLE_EVENT) },
        operations: { state:'AVAILABLE', recordCount:count(domain, RECORD_TYPES.SRA_TRANSACTION) + market.eventMarkets.total + market.productiveBaskets.total }
      },
      market
    });
  });

  router.get('/api/admin/workspaces', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    const limit = req.query.limit;
    const requestedWorkspace = String(req.query.workspace || '').trim();
    if (requestedWorkspace && !ADMIN_WORKSPACE_SOURCES[requestedWorkspace]) return res.status(400).json({ error:'Unknown administration workspace.' });
    const requestedKeys = requestedWorkspace ? new Set(ADMIN_WORKSPACE_SOURCES[requestedWorkspace]) : new Set([...Object.keys(ADMIN_RECORD_TYPES),'users']);
    const records = {};
    for (const key of requestedKeys) {
      if (key === 'users') {
        records.users = (await persistedUsers()).map((user) => ({ id:user.id, displayName:user.displayName, email:user.email, capacities:user.capacities || [], state:user.state || 'ACTIVE', createdAt:user.createdAt || null }));
      } else if (ADMIN_RECORD_TYPES[key]) records[key] = list(domain, ADMIN_RECORD_TYPES[key], limit);
    }
    const counts = Object.fromEntries(Object.entries(records).map(([key, value]) => [key, value.length]));
    const states = Object.fromEntries(Object.entries(records).filter(([, value]) => Array.isArray(value)).map(([key, value]) => {
      const byState = {};
      for (const record of value) byState[stateOf(record)] = (byState[stateOf(record)] || 0) + 1;
      return [key, byState];
    }));
    const statusEntries = requestedWorkspace ? [[requestedWorkspace, ADMIN_WORKSPACE_SOURCES[requestedWorkspace]]] : Object.entries(ADMIN_WORKSPACE_SOURCES);
    const workspaces = Object.fromEntries(statusEntries.map(([key, required]) => [key, workspaceStatus(records, required)]));
    return res.json({ generatedAt: new Date().toISOString(), administrator: { id: session.id, displayName: session.displayName }, counts, states, workspaces, records });
  });

  router.get('/api/admin/summary', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    const coinbase = coinbasePublicMarket?.status?.() || null;
    const listingStatus = marketplaceListings.status();
    const listings = marketplaceListings.list();
    const blockedListings = listings.filter((listing) => Array.isArray(listing.blockers) && listing.blockers.length > 0).length;
    const readyListings = listings.filter((listing) => listing.status === 'READY_FOR_PUBLICATION_APPROVAL' && listing.state === 'PREPARED').length;
    const blockerCounts = {};
    for (const listing of listings) for (const blocker of listing.blockers || []) blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
    const treasury = treasuryAdministration.treasury.summary();
    return res.json({
      generatedAt: new Date().toISOString(),
      administrator: { id: session.id, displayName: session.displayName, capacity: session.activeCapacity },
      platform: {
        observations: count(domain, RECORD_TYPES.MARKET_OBSERVATION), recognitionAssessments: count(domain, RECORD_TYPES.RECOGNITION_ASSESSMENT), financialRecords: count(domain, RECORD_TYPES.FINANCIAL_RECORD), coinPositions: count(domain, RECORD_TYPES.COIN_POSITION), instruments: count(domain, RECORD_TYPES.SRA_INSTRUMENT), marketplaceListings: listingStatus.listingCount || 0, marketplaceListingsPrepared: listingStatus.byState?.PREPARED || 0, marketplaceListingsPublished: (listingStatus.byState?.PUBLISHED || 0) + (listingStatus.byState?.ACTIVE || 0), marketplaceListingsBlocked: blockedListings, marketplaceListingsReady: readyListings, marketplaceListingStoredRecords: listingStatus.storedRecordCount || listingStatus.listingCount || 0, marketplaceListingDuplicates: listingStatus.supersededDuplicateCount || 0, transactions: count(domain, RECORD_TYPES.SRA_TRANSACTION), fundingInstructions: count(domain, RECORD_TYPES.FUNDING_INSTRUCTION), treasuryWallets: treasury.accountCount, treasuryAccounts: treasury.accountCount, treasuryJournalEntries: treasury.journalCount, treasuryCashBalanceUsd: treasury.cashBalanceUsd, treasuryActivity: treasury.journalCount
      },
      marketplaceListings: { ...listingStatus, blockedListings, readyListings, blockerCounts },
      listingReadinessBatch: listingReadinessBatch.status(),
      listingPublicationBatch: listingPublicationBatch.status(),
      nativePlatformAsset: nativePlatformAsset?.status?.() || { state: 'UNAVAILABLE' },
      determinationEngine: determinationAdministration.status(),
      instrumentAdministration: { representationApprovalCount: instrumentAdministration.representations.list().length },
      treasury,
      treasuryTransferReadiness: treasuryTransferReadiness.status(),
      agentWorkforce: agentWorkforceAdministration.status(),
      recordedValueRepresentation: treasuryAdministration.recordedValue.preview(),
      connectors: { coinbasePublicMarket: coinbase },
      adminIntelligenceAgent: intelligenceAgent.capabilities(),
      approvalBoundary: { agentWriteAccess: 'HUMAN_IN_THE_LOOP', autonomousReadAndReason: true, stateChangesRequireApproval: true, protectedAreas: ['FINANCIAL_RECORDS','RECOGNITION','COIN_POSITIONS','INSTRUMENTS','MARKETPLACE_LISTINGS','TRANSACTIONS','TREASURY','SETTLEMENT','OWNERSHIP_RECOGNITION','EXPORT_PACKAGING','CONNECTORS','ACCOUNT_AUTHORITY','DETERMINATIONS'] }
    });
  });

  router.use('/admin', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
  }, express.static(new URL('../public/admin', import.meta.url).pathname, { index: 'index.html', etag: false, lastModified: false, maxAge: 0 }));
  return router;
}

export async function rejectPlatformAdminPublicSignin(req, res, next, database) {
  if (req.method !== 'POST' || req.path !== '/api/access/signin') return next();
  const access = new AccessService({ database });
  await access.initialize();
  try {
    const result = await access.signin(req.body || {});
    const isAdmin = hasAdminCapacity(result.session);
    await access.signout(result.token);
    if (isAdmin) return res.status(403).json({ error: 'Platform Administration identities must sign in through the private administration portal.' });
  } catch {}
  return next();
}
