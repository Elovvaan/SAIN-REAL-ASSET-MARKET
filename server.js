import express from 'express';
import { createApp } from './app.js';
import { createUniversalAccountBlockchainRouter } from './routes/universal-account-blockchain-router.js';
import { createCoinbasePublicMarketRouter } from './routes/coinbase-public-market-router.js';
import { createPrivateAdminRouter, rejectPlatformAdminPublicSignin } from './routes/private-admin-router.js';
import { createOnChainProjectionRouter } from './routes/on-chain-projection-router.js';
import { createFundingOpportunityRouter } from './routes/funding-opportunity-router.js';
import { createFundingOpportunityVerificationRouter } from './routes/funding-opportunity-verification-router.js';
import { createFundingOpportunityValuePreparationRouter } from './routes/funding-opportunity-value-preparation-router.js';
import { createFundingModelSelectionRouter } from './routes/funding-model-selection-router.js';
import { createFundingInstrumentSelectionRouter } from './routes/funding-instrument-selection-router.js';
import { createFundingInstrumentReviewRouter } from './routes/funding-instrument-review-router.js';
import { createFundingInstrumentIssuanceRouter } from './routes/funding-instrument-issuance-router.js';
import { createFundingMarketplacePreparationRouter } from './routes/funding-marketplace-preparation-router.js';
import { createFundingMarketplacePublicationRouter } from './routes/funding-marketplace-publication-router.js';
import { createFundingMarketplaceCommitmentRouter } from './routes/funding-marketplace-commitment-router.js';
import { createFundingMarketplaceAllocationRouter } from './routes/funding-marketplace-allocation-router.js';
import { createFundingMarketplaceSettlementRouter } from './routes/funding-marketplace-settlement-router.js';
import { createFundingOperationsRouter } from './routes/funding-operations-router.js';
import { createFinancingClosingRouter } from './routes/financing-closing-router.js';
import { createSainOperationsIntelligenceRouter } from './routes/sain-operations-intelligence-router.js';
import { createProductionReadinessRouter } from './routes/production-readiness-router.js';
import { authorizeOperationsRequest } from './middleware/operations-authorization.js';
import { operationsIdempotency } from './middleware/operations-idempotency.js';
import { productionRuntime, runtimeMetrics, dependencyHealth, emitOperationalAlert } from './middleware/production-runtime.js';
import { CoinbasePublicMarketService } from './services/coinbase-public-market-service.js';
import { CoinbaseTransactionAssetPipelineService } from './services/coinbase-transaction-asset-pipeline-service.js';
import { MarketplaceListingService } from './services/marketplace-listing-service.js';
import { OnChainProjectionService } from './services/on-chain-projection-service.js';
import { FundingOpportunityIntakeService } from './services/funding-opportunity-intake-service.js';
import { FundingOpportunityVerificationService } from './services/funding-opportunity-verification-service.js';
import { FundingOpportunityValuePreparationService } from './services/funding-opportunity-value-preparation-service.js';
import { FundingModelSelectionService } from './services/funding-model-selection-service.js';
import { FundingInstrumentSelectionService } from './services/funding-instrument-selection-service.js';
import { FundingInstrumentReviewService } from './services/funding-instrument-review-service.js';
import { FundingInstrumentIssuanceService } from './services/funding-instrument-issuance-service.js';
import { FundingMarketplacePreparationService } from './services/funding-marketplace-preparation-service.js';
import { FundingMarketplacePublicationService } from './services/funding-marketplace-publication-service.js';
import { FundingMarketplaceCommitmentService } from './services/funding-marketplace-commitment-service.js';
import { FundingMarketplaceAllocationService } from './services/funding-marketplace-allocation-service.js';
import { FundingMarketplaceSettlementService } from './services/funding-marketplace-settlement-service.js';
import { FundingOperationsService } from './services/funding-operations-service.js';
import { FinancingClosingService } from './services/financing-closing-service.js';
import { AssetServicingService } from './services/asset-servicing-service.js';
import { SainOperationsIntelligenceService } from './services/sain-operations-intelligence-service.js';
import { ProductionReadinessService } from './services/production-readiness-service.js';
import { NativePlatformAssetService } from './services/native-platform-asset-service.js';

const port = Number(process.env.PORT) || 3000;
const bootstrap = express();
bootstrap.set('trust proxy', 1);
bootstrap.use(express.json({ limit: process.env.SRA_JSON_LIMIT || '1mb' }));
bootstrap.use(productionRuntime);
bootstrap.use(authorizeOperationsRequest);
bootstrap.use(operationsIdempotency);

function mountExtension(prefix, router) {
  const mounted = express.Router();
  mounted.use(prefix, router);
  return mounted;
}

function createSingleFlightInitializer(label, initializer) {
  let value = null;
  let pending = null;
  return async () => {
    if (value) return value;
    if (!pending) {
      pending = Promise.resolve()
        .then(initializer)
        .then((created) => {
          value = created;
          console.log(JSON.stringify({ level: 'info', event: 'LAZY_SERVICE_READY', service: label, at: new Date().toISOString() }));
          return created;
        })
        .catch((error) => {
          pending = null;
          console.error(JSON.stringify({ level: 'error', event: 'LAZY_SERVICE_FAILED', service: label, message: error?.message || String(error), at: new Date().toISOString() }));
          throw error;
        });
    }
    return pending;
  };
}

let createdApp = null;
let platformApp = null;
let coinbaseExtension = null;
let privateAdminExtension = null;
let sainOperationsIntelligenceExtension = null;
let productionReadinessExtension = null;
let onChainProjectionService = null;
let sainOperationsIntelligenceService = null;
let productionReadinessService = null;
let nativePlatformAssetService = null;
let coinbasePublicMarket = null;
let coinbaseTransactionAssetPipeline = null;
let marketplaceListingService = null;
let marketplaceListingTimer = null;
let database = null;
let startupState = 'STARTING';
let startupError = null;
const startedAt = new Date().toISOString();
const startupMilestones = {
  serverListeningAt: null,
  coreAppReadyAt: null,
  adminReadyAt: null,
  fullyReadyAt: null,
};
const deployment = Object.freeze({
  commitSha: process.env.RAILWAY_GIT_COMMIT_SHA || null,
  branch: process.env.RAILWAY_GIT_BRANCH || null,
  deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null,
  service: process.env.RAILWAY_SERVICE_NAME || null,
  environment: process.env.RAILWAY_ENVIRONMENT_NAME || null,
});
function startupSnapshot() {
  return { startedAt, milestones: { ...startupMilestones }, deployment };
}

bootstrap.get('/api/health', async (_req, res) => {
  const dependencies = await dependencyHealth({ database, startupState });
  return res.status(dependencies.status === 'READY' ? 200 : 503).json({
    status: dependencies.status === 'READY' ? 'ok' : 'degraded',
    service: 'SAIN Real Asset Market',
    startupState,
    ...startupSnapshot(),
    timestamp: new Date().toISOString(),
  });
});
bootstrap.get('/api/production/dependencies', async (_req, res) => {
  const report = await dependencyHealth({ database, startupState, connectors: { COINBASE_PUBLIC_MARKET: coinbasePublicMarket, MARKETPLACE_LISTING: marketplaceListingService, ON_CHAIN_PROJECTION: onChainProjectionService } });
  return res.status(report.status === 'READY' ? 200 : 503).json(report);
});
bootstrap.get('/api/production/metrics', (_req, res) => res.json(runtimeMetrics()));
bootstrap.post('/api/production/alerts/test', async (req, res) => {
  await emitOperationalAlert({ severity: 'TEST', event: 'SRA_ALERT_TEST', requestId: req.sraRequestId, actorId: req.sraIdentity?.actorId || null, at: new Date().toISOString() });
  return res.json({ delivered: Boolean(process.env.SRA_ALERT_WEBHOOK_URL), requestId: req.sraRequestId });
});
bootstrap.get('/api/startup', (_req, res) => {
  const statusCode = startupState === 'READY' ? 200 : startupState === 'FAILED' ? 500 : 503;
  return res.status(statusCode).json({ startupState, startupError, nativePlatformAsset: nativePlatformAssetService?.status?.() || null, ...startupSnapshot(), timestamp: new Date().toISOString() });
});
bootstrap.get('/api/marketplace-listings/status', (_req, res) => marketplaceListingService ? res.json(marketplaceListingService.status()) : res.status(503).json({ error: 'Marketplace Listing Layer is still initializing.' }));
bootstrap.get('/api/marketplace-listings', (req, res) => marketplaceListingService ? res.json(marketplaceListingService.page({ state: req.query.state, instrumentId: req.query.instrumentId }, { page: req.query.page, limit: req.query.limit })) : res.status(503).json({ error: 'Marketplace Listing Layer is still initializing.' }));

let ensurePlatformExtensions;
let ensureFundingOpportunity;
let ensureFundingVerification;
let ensureFundingValuePreparation;
let ensureFundingModelSelection;
let ensureFundingInstrumentSelection;
let ensureFundingInstrumentReview;
let ensureFundingInstrumentIssuance;
let ensureFundingMarketplacePreparation;
let ensureFundingMarketplacePublication;
let ensureFundingMarketplaceCommitment;
let ensureFundingMarketplaceAllocation;
let ensureFundingMarketplaceSettlement;
let ensureFundingOperations;
let ensureFinancingClosing;
let ensureOnChainProjection;

async function routeLazy(req, res, next, ensureExtension) {
  try {
    const extension = await ensureExtension();
    return extension(req, res, next);
  } catch (error) {
    return next(error);
  }
}

bootstrap.use(async (req, res, next) => {
  if (privateAdminExtension && (req.path === '/admin' || req.path.startsWith('/admin/') || req.path.startsWith('/api/admin/'))) return privateAdminExtension(req, res, next);
  if (database && req.method === 'POST' && req.path === '/api/access/signin') return rejectPlatformAdminPublicSignin(req, res, next, database);
  if (productionReadinessExtension && req.path.startsWith('/api/production')) return productionReadinessExtension(req, res, next);
  if (sainOperationsIntelligenceExtension && req.path.startsWith('/api/sain/intelligence')) return sainOperationsIntelligenceExtension(req, res, next);

  if (ensureFinancingClosing && req.path.startsWith('/api/financing-closing')) return routeLazy(req, res, next, ensureFinancingClosing);
  if (ensureFundingOperations && req.path.startsWith('/api/funding-operations')) return routeLazy(req, res, next, ensureFundingOperations);
  if (ensureFundingMarketplaceSettlement && req.path.startsWith('/api/funding-marketplace-settlement')) return routeLazy(req, res, next, ensureFundingMarketplaceSettlement);
  if (ensureFundingMarketplaceAllocation && req.path.startsWith('/api/funding-marketplace-allocation')) return routeLazy(req, res, next, ensureFundingMarketplaceAllocation);
  if (ensureFundingMarketplaceCommitment && req.path.startsWith('/api/funding-marketplace-commitment')) return routeLazy(req, res, next, ensureFundingMarketplaceCommitment);
  if (ensureFundingMarketplacePublication && req.path.startsWith('/api/funding-marketplace-publication')) return routeLazy(req, res, next, ensureFundingMarketplacePublication);
  if (ensureFundingMarketplacePreparation && req.path.startsWith('/api/funding-marketplace')) return routeLazy(req, res, next, ensureFundingMarketplacePreparation);
  if (ensureFundingInstrumentIssuance && req.path.startsWith('/api/funding-instrument-issuance')) return routeLazy(req, res, next, ensureFundingInstrumentIssuance);
  if (ensureFundingInstrumentReview && req.path.startsWith('/api/funding-instrument-review')) return routeLazy(req, res, next, ensureFundingInstrumentReview);
  if (ensureFundingInstrumentSelection && req.path.startsWith('/api/funding-instrument')) return routeLazy(req, res, next, ensureFundingInstrumentSelection);
  if (ensureFundingModelSelection && req.path.startsWith('/api/funding-model')) return routeLazy(req, res, next, ensureFundingModelSelection);
  if (ensureFundingValuePreparation && req.path.startsWith('/api/funding-value')) return routeLazy(req, res, next, ensureFundingValuePreparation);
  if (ensureFundingVerification && req.path.startsWith('/api/funding-verification')) return routeLazy(req, res, next, ensureFundingVerification);
  if (ensureFundingOpportunity && req.path.startsWith('/api/funding')) return routeLazy(req, res, next, ensureFundingOpportunity);
  if (ensureOnChainProjection && req.path.startsWith('/api/on-chain')) return routeLazy(req, res, next, ensureOnChainProjection);
  if (coinbaseExtension && req.path.startsWith('/api/connectors/coinbase-public')) return coinbaseExtension(req, res, next);
  if (ensurePlatformExtensions && (req.path.startsWith('/api/blockchain-accounts') || (req.method === 'POST' && req.path === '/api/access/funding/crypto-instructions'))) return routeLazy(req, res, next, ensurePlatformExtensions);
  if (platformApp) return platformApp(req, res, next);
  return res.status(503).json({ error: startupState === 'FAILED' ? 'The platform failed during initialization. Check /api/startup.' : 'The platform is still initializing.', startupState });
});

const server = bootstrap.listen(port, '0.0.0.0', () => {
  startupMilestones.serverListeningAt = new Date().toISOString();
  console.log(JSON.stringify({ level: 'info', event: 'SERVER_LISTENING', port, service: 'SAIN_REAL_ASSET_MARKET', deployment }));
});
server.requestTimeout = Number(process.env.SRA_REQUEST_TIMEOUT_MS) || 30000;
server.headersTimeout = Number(process.env.SRA_HEADERS_TIMEOUT_MS) || 35000;
server.keepAliveTimeout = Number(process.env.SRA_KEEP_ALIVE_TIMEOUT_MS) || 5000;
function stopConnectors() { coinbasePublicMarket?.stop?.(); if (marketplaceListingTimer) clearInterval(marketplaceListingTimer); }
async function shutdown(signal) { startupState = 'STOPPING'; stopConnectors(); server.close(async () => { try { await database?.pool?.end?.(); } catch {} process.exit(0); }); setTimeout(() => process.exit(1), 15000).unref(); }
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  createdApp = await createApp();
  database = createdApp.database;
  platformApp = createdApp.app;
  startupMilestones.coreAppReadyAt = new Date().toISOString();

  sainOperationsIntelligenceService = new SainOperationsIntelligenceService(createdApp.persistentDomain);
  await sainOperationsIntelligenceService.initialize();
  sainOperationsIntelligenceExtension = createSainOperationsIntelligenceRouter(sainOperationsIntelligenceService);
  productionReadinessService = new ProductionReadinessService({ database: createdApp.database, domain: createdApp.persistentDomain, intelligence: sainOperationsIntelligenceService });
  productionReadinessExtension = createProductionReadinessRouter({ readinessService: productionReadinessService, database: createdApp.database });
  nativePlatformAssetService = new NativePlatformAssetService(createdApp.persistentDomain, productionReadinessService.internalLifecycle);

  coinbaseTransactionAssetPipeline = new CoinbaseTransactionAssetPipelineService({ observationLayerService: createdApp.observationLayerService, financialRecordService: createdApp.financialRecordService, persistentDomain: createdApp.persistentDomain });
  marketplaceListingService = new MarketplaceListingService(createdApp.persistentDomain);
  coinbasePublicMarket = new CoinbasePublicMarketService({ observationLayerService: createdApp.observationLayerService, transactionAssetPipeline: coinbaseTransactionAssetPipeline });
  coinbaseExtension = createCoinbasePublicMarketRouter(coinbasePublicMarket);
  privateAdminExtension = await createPrivateAdminRouter({ database: createdApp.database, domain: createdApp.persistentDomain, coinbasePublicMarket, nativePlatformAsset: nativePlatformAssetService });
  coinbasePublicMarket.start();
  startupMilestones.adminReadyAt = new Date().toISOString();

  const domain = createdApp.persistentDomain;

  ensurePlatformExtensions = createSingleFlightInitializer('Universal Account Blockchain Router', async () => createUniversalAccountBlockchainRouter(domain, createdApp.database));

  ensureFundingOpportunity = createSingleFlightInitializer('Funding Opportunity Intake', async () => {
    const service = new FundingOpportunityIntakeService(domain);
    await service.initialize();
    return mountExtension('/api/funding', createFundingOpportunityRouter(service));
  });
  ensureFundingVerification = createSingleFlightInitializer('Funding Opportunity Verification', async () => {
    const service = new FundingOpportunityVerificationService(domain);
    await service.initialize();
    return mountExtension('/api/funding-verification', createFundingOpportunityVerificationRouter(service));
  });
  ensureFundingValuePreparation = createSingleFlightInitializer('Funding Value Preparation', async () => {
    const service = new FundingOpportunityValuePreparationService(domain);
    await service.initialize();
    return mountExtension('/api/funding-value', createFundingOpportunityValuePreparationRouter(service));
  });
  ensureFundingModelSelection = createSingleFlightInitializer('Funding Model Selection', async () => {
    const service = new FundingModelSelectionService(domain);
    await service.initialize();
    return mountExtension('/api/funding-model', createFundingModelSelectionRouter(service));
  });
  ensureFundingInstrumentSelection = createSingleFlightInitializer('Funding Instrument Selection', async () => {
    const service = new FundingInstrumentSelectionService(domain);
    await service.initialize();
    return mountExtension('/api/funding-instrument', createFundingInstrumentSelectionRouter(service));
  });
  ensureFundingInstrumentReview = createSingleFlightInitializer('Funding Instrument Review', async () => {
    const service = new FundingInstrumentReviewService(domain);
    await service.initialize();
    return mountExtension('/api/funding-instrument-review', createFundingInstrumentReviewRouter(service));
  });
  ensureFundingInstrumentIssuance = createSingleFlightInitializer('Funding Instrument Issuance', async () => {
    const service = new FundingInstrumentIssuanceService(domain);
    await service.initialize();
    return mountExtension('/api/funding-instrument-issuance', createFundingInstrumentIssuanceRouter(service));
  });
  ensureFundingMarketplacePreparation = createSingleFlightInitializer('Funding Marketplace Preparation', async () => {
    const service = new FundingMarketplacePreparationService(domain);
    await service.initialize();
    return mountExtension('/api/funding-marketplace', createFundingMarketplacePreparationRouter(service));
  });
  ensureFundingMarketplacePublication = createSingleFlightInitializer('Funding Marketplace Publication', async () => {
    const service = new FundingMarketplacePublicationService(domain);
    await service.initialize();
    return mountExtension('/api/funding-marketplace-publication', createFundingMarketplacePublicationRouter(service));
  });
  ensureFundingMarketplaceCommitment = createSingleFlightInitializer('Funding Marketplace Commitment', async () => {
    const service = new FundingMarketplaceCommitmentService(domain);
    await service.initialize();
    return mountExtension('/api/funding-marketplace-commitment', createFundingMarketplaceCommitmentRouter(service));
  });
  ensureFundingMarketplaceAllocation = createSingleFlightInitializer('Funding Marketplace Allocation', async () => {
    const service = new FundingMarketplaceAllocationService(domain);
    await service.initialize();
    return mountExtension('/api/funding-marketplace-allocation', createFundingMarketplaceAllocationRouter(service));
  });
  ensureFundingMarketplaceSettlement = createSingleFlightInitializer('Funding Marketplace Settlement', async () => {
    const service = new FundingMarketplaceSettlementService(domain);
    await service.initialize();
    return mountExtension('/api/funding-marketplace-settlement', createFundingMarketplaceSettlementRouter(service));
  });
  ensureFundingOperations = createSingleFlightInitializer('Funding Operations', async () => {
    const service = new FundingOperationsService(domain);
    await service.initialize();
    return mountExtension('/api/funding-operations', createFundingOperationsRouter(service));
  });
  ensureFinancingClosing = createSingleFlightInitializer('Financing Closing', async () => {
    const service = new FinancingClosingService(domain, new AssetServicingService(domain));
    await service.initialize();
    return mountExtension('/api/financing-closing', createFinancingClosingRouter(service));
  });
  ensureOnChainProjection = createSingleFlightInitializer('On-Chain Projection', async () => {
    onChainProjectionService = new OnChainProjectionService(domain);
    await onChainProjectionService.initialize();
    return createOnChainProjectionRouter(onChainProjectionService);
  });

  startupState = 'READY';
  startupError = null;
  startupMilestones.fullyReadyAt = new Date().toISOString();
  console.log(JSON.stringify({ level: 'info', event: 'PLATFORM_INITIALIZATION_COMPLETED', mode: 'ROUTE_SCOPED_HEAVY_SERVICES', nativePlatformAsset: nativePlatformAssetService.status(), ...startupSnapshot() }));
} catch (error) {
  startupState = 'FAILED';
  startupError = { name: error?.name || 'Error', message: error?.message || String(error), stack: process.env.NODE_ENV === 'production' ? undefined : error?.stack };
  console.error(JSON.stringify({ level: 'error', event: 'PLATFORM_INITIALIZATION_FAILED', error: startupError, ...startupSnapshot() }));
}