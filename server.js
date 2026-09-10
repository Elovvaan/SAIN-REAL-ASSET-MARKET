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

let platformApp = null;
let platformExtensions = null;
let coinbaseExtension = null;
let privateAdminExtension = null;
let onChainProjectionExtension = null;
let fundingOpportunityExtension = null;
let fundingVerificationExtension = null;
let fundingValuePreparationExtension = null;
let fundingModelSelectionExtension = null;
let fundingInstrumentSelectionExtension = null;
let fundingInstrumentReviewExtension = null;
let fundingInstrumentIssuanceExtension = null;
let fundingMarketplacePreparationExtension = null;
let fundingMarketplacePublicationExtension = null;
let fundingMarketplaceCommitmentExtension = null;
let fundingMarketplaceAllocationExtension = null;
let fundingMarketplaceSettlementExtension = null;
let fundingOperationsExtension = null;
let financingClosingExtension = null;
let sainOperationsIntelligenceExtension = null;
let productionReadinessExtension = null;
let onChainProjectionService = null;
let fundingOpportunityService = null;
let fundingVerificationService = null;
let fundingValuePreparationService = null;
let fundingModelSelectionService = null;
let fundingInstrumentSelectionService = null;
let fundingInstrumentReviewService = null;
let fundingInstrumentIssuanceService = null;
let fundingMarketplacePreparationService = null;
let fundingMarketplacePublicationService = null;
let fundingMarketplaceCommitmentService = null;
let fundingMarketplaceAllocationService = null;
let fundingMarketplaceSettlementService = null;
let fundingOperationsService = null;
let financingClosingService = null;
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

bootstrap.use(async (req, res, next) => {
  if (privateAdminExtension && (req.path === '/admin' || req.path.startsWith('/admin/') || req.path.startsWith('/api/admin/'))) return privateAdminExtension(req, res, next);
  if (database && req.method === 'POST' && req.path === '/api/access/signin') return rejectPlatformAdminPublicSignin(req, res, next, database);
  if (productionReadinessExtension && req.path.startsWith('/api/production')) return productionReadinessExtension(req, res, next);
  if (sainOperationsIntelligenceExtension && req.path.startsWith('/api/sain/intelligence')) return sainOperationsIntelligenceExtension(req, res, next);
  if (financingClosingExtension && req.path.startsWith('/api/financing-closing')) return financingClosingExtension(req, res, next);
  if (fundingOperationsExtension && req.path.startsWith('/api/funding-operations')) return fundingOperationsExtension(req, res, next);
  if (fundingMarketplaceSettlementExtension && req.path.startsWith('/api/funding-marketplace-settlement')) return fundingMarketplaceSettlementExtension(req, res, next);
  if (fundingMarketplaceAllocationExtension && req.path.startsWith('/api/funding-marketplace-allocation')) return fundingMarketplaceAllocationExtension(req, res, next);
  if (fundingMarketplaceCommitmentExtension && req.path.startsWith('/api/funding-marketplace-commitment')) return fundingMarketplaceCommitmentExtension(req, res, next);
  if (fundingMarketplacePublicationExtension && req.path.startsWith('/api/funding-marketplace-publication')) return fundingMarketplacePublicationExtension(req, res, next);
  if (fundingMarketplacePreparationExtension && req.path.startsWith('/api/funding-marketplace')) return fundingMarketplacePreparationExtension(req, res, next);
  if (fundingInstrumentIssuanceExtension && req.path.startsWith('/api/funding-instrument-issuance')) return fundingInstrumentIssuanceExtension(req, res, next);
  if (fundingInstrumentReviewExtension && req.path.startsWith('/api/funding-instrument-review')) return fundingInstrumentReviewExtension(req, res, next);
  if (fundingInstrumentSelectionExtension && req.path.startsWith('/api/funding-instrument')) return fundingInstrumentSelectionExtension(req, res, next);
  if (fundingModelSelectionExtension && req.path.startsWith('/api/funding-model')) return fundingModelSelectionExtension(req, res, next);
  if (fundingValuePreparationExtension && req.path.startsWith('/api/funding-value')) return fundingValuePreparationExtension(req, res, next);
  if (fundingVerificationExtension && req.path.startsWith('/api/funding-verification')) return fundingVerificationExtension(req, res, next);
  if (fundingOpportunityExtension && req.path.startsWith('/api/funding')) return fundingOpportunityExtension(req, res, next);
  if (onChainProjectionExtension && req.path.startsWith('/api/on-chain')) return onChainProjectionExtension(req, res, next);
  if (coinbaseExtension && req.path.startsWith('/api/connectors/coinbase-public')) return coinbaseExtension(req, res, next);
  if (platformExtensions && (req.path.startsWith('/api/blockchain-accounts') || (req.method === 'POST' && req.path === '/api/access/funding/crypto-instructions'))) return platformExtensions(req, res, next);
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
  const created = await createApp();
  database = created.database;
  platformApp = created.app;
  startupMilestones.coreAppReadyAt = new Date().toISOString();

  sainOperationsIntelligenceService = new SainOperationsIntelligenceService(created.persistentDomain);
  await sainOperationsIntelligenceService.initialize();
  sainOperationsIntelligenceExtension = createSainOperationsIntelligenceRouter(sainOperationsIntelligenceService);
  productionReadinessService = new ProductionReadinessService({ database: created.database, domain: created.persistentDomain, intelligence: sainOperationsIntelligenceService });
  productionReadinessExtension = createProductionReadinessRouter({ readinessService: productionReadinessService, database: created.database });
  nativePlatformAssetService = new NativePlatformAssetService(created.persistentDomain, productionReadinessService.internalLifecycle);

  coinbaseTransactionAssetPipeline = new CoinbaseTransactionAssetPipelineService({ observationLayerService: created.observationLayerService, financialRecordService: created.financialRecordService, persistentDomain: created.persistentDomain });
  marketplaceListingService = new MarketplaceListingService(created.persistentDomain);
  coinbasePublicMarket = new CoinbasePublicMarketService({ observationLayerService: created.observationLayerService, transactionAssetPipeline: coinbaseTransactionAssetPipeline });
  coinbaseExtension = createCoinbasePublicMarketRouter(coinbasePublicMarket);
  privateAdminExtension = await createPrivateAdminRouter({ database: created.database, domain: created.persistentDomain, coinbasePublicMarket, nativePlatformAsset: nativePlatformAssetService });
  coinbasePublicMarket.start();
  startupMilestones.adminReadyAt = new Date().toISOString();

  platformExtensions = await createUniversalAccountBlockchainRouter(created.persistentDomain, created.database);

  fundingOpportunityService = new FundingOpportunityIntakeService(created.persistentDomain);
  fundingVerificationService = new FundingOpportunityVerificationService(created.persistentDomain);
  fundingValuePreparationService = new FundingOpportunityValuePreparationService(created.persistentDomain);
  fundingModelSelectionService = new FundingModelSelectionService(created.persistentDomain);
  fundingInstrumentSelectionService = new FundingInstrumentSelectionService(created.persistentDomain);
  fundingInstrumentReviewService = new FundingInstrumentReviewService(created.persistentDomain);
  fundingInstrumentIssuanceService = new FundingInstrumentIssuanceService(created.persistentDomain);
  fundingMarketplacePreparationService = new FundingMarketplacePreparationService(created.persistentDomain);
  fundingMarketplacePublicationService = new FundingMarketplacePublicationService(created.persistentDomain);
  fundingMarketplaceCommitmentService = new FundingMarketplaceCommitmentService(created.persistentDomain);
  fundingMarketplaceAllocationService = new FundingMarketplaceAllocationService(created.persistentDomain);
  fundingMarketplaceSettlementService = new FundingMarketplaceSettlementService(created.persistentDomain);
  fundingOperationsService = new FundingOperationsService(created.persistentDomain);
  financingClosingService = new FinancingClosingService(created.persistentDomain, new AssetServicingService(created.persistentDomain));
  onChainProjectionService = new OnChainProjectionService(created.persistentDomain);

  await Promise.all([
    fundingOpportunityService.initialize(),
    fundingVerificationService.initialize(),
    fundingValuePreparationService.initialize(),
    fundingModelSelectionService.initialize(),
    fundingInstrumentSelectionService.initialize(),
    fundingInstrumentReviewService.initialize(),
    fundingInstrumentIssuanceService.initialize(),
    fundingMarketplacePreparationService.initialize(),
    fundingMarketplacePublicationService.initialize(),
    fundingMarketplaceCommitmentService.initialize(),
    fundingMarketplaceAllocationService.initialize(),
    fundingMarketplaceSettlementService.initialize(),
    fundingOperationsService.initialize(),
    financingClosingService.initialize(),
    onChainProjectionService.initialize(),
  ]);

  fundingOpportunityExtension = mountExtension('/api/funding', createFundingOpportunityRouter(fundingOpportunityService));
  fundingVerificationExtension = mountExtension('/api/funding-verification', createFundingOpportunityVerificationRouter(fundingVerificationService));
  fundingValuePreparationExtension = mountExtension('/api/funding-value', createFundingOpportunityValuePreparationRouter(fundingValuePreparationService));
  fundingModelSelectionExtension = mountExtension('/api/funding-model', createFundingModelSelectionRouter(fundingModelSelectionService));
  fundingInstrumentSelectionExtension = mountExtension('/api/funding-instrument', createFundingInstrumentSelectionRouter(fundingInstrumentSelectionService));
  fundingInstrumentReviewExtension = mountExtension('/api/funding-instrument-review', createFundingInstrumentReviewRouter(fundingInstrumentReviewService));
  fundingInstrumentIssuanceExtension = mountExtension('/api/funding-instrument-issuance', createFundingInstrumentIssuanceRouter(fundingInstrumentIssuanceService));
  fundingMarketplacePreparationExtension = mountExtension('/api/funding-marketplace', createFundingMarketplacePreparationRouter(fundingMarketplacePreparationService));
  fundingMarketplacePublicationExtension = mountExtension('/api/funding-marketplace-publication', createFundingMarketplacePublicationRouter(fundingMarketplacePublicationService));
  fundingMarketplaceCommitmentExtension = mountExtension('/api/funding-marketplace-commitment', createFundingMarketplaceCommitmentRouter(fundingMarketplaceCommitmentService));
  fundingMarketplaceAllocationExtension = mountExtension('/api/funding-marketplace-allocation', createFundingMarketplaceAllocationRouter(fundingMarketplaceAllocationService));
  fundingMarketplaceSettlementExtension = mountExtension('/api/funding-marketplace-settlement', createFundingMarketplaceSettlementRouter(fundingMarketplaceSettlementService));
  fundingOperationsExtension = mountExtension('/api/funding-operations', createFundingOperationsRouter(fundingOperationsService));
  financingClosingExtension = mountExtension('/api/financing-closing', createFinancingClosingRouter(financingClosingService));
  onChainProjectionExtension = createOnChainProjectionRouter(onChainProjectionService);

  startupState = 'READY';
  startupError = null;
  startupMilestones.fullyReadyAt = new Date().toISOString();
  console.log(JSON.stringify({ level: 'info', event: 'PLATFORM_INITIALIZATION_COMPLETED', nativePlatformAsset: nativePlatformAssetService.status(), ...startupSnapshot() }));
} catch (error) {
  startupState = 'FAILED';
  startupError = { name: error?.name || 'Error', message: error?.message || String(error), stack: process.env.NODE_ENV === 'production' ? undefined : error?.stack };
  console.error(JSON.stringify({ level: 'error', event: 'PLATFORM_INITIALIZATION_FAILED', error: startupError, ...startupSnapshot() }));
}