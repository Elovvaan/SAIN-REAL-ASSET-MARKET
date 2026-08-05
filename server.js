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

const port = Number(process.env.PORT) || 3000;
const bootstrap = express();
bootstrap.use(express.json({ limit: '1mb' }));

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
let onChainProjectionService = null;
let fundingOpportunityService = null;
let fundingVerificationService = null;
let fundingValuePreparationService = null;
let fundingModelSelectionService = null;
let fundingInstrumentSelectionService = null;
let fundingInstrumentReviewService = null;
let fundingInstrumentIssuanceService = null;
let fundingMarketplacePreparationService = null;
let coinbasePublicMarket = null;
let coinbaseTransactionAssetPipeline = null;
let marketplaceListingService = null;
let marketplaceListingTimer = null;
let database = null;
let startupState = 'STARTING';
let startupError = null;
let startedAt = new Date().toISOString();

bootstrap.get('/api/health', (req, res, next) => {
  if (platformApp) return platformApp(req, res, next);
  return res.status(200).json({ status: startupState === 'FAILED' ? 'degraded' : 'starting', service: 'SAIN Real Asset Market', bootstrap: true, startupState, startupError, startedAt, timestamp: new Date().toISOString() });
});

bootstrap.get('/api/startup', (_req, res) => {
  return res.status(startupState === 'FAILED' ? 500 : 200).json({
    startupState,
    startupError,
    coinbasePublicMarket: coinbasePublicMarket?.status?.() || null,
    coinbaseTransactionAssetPipeline: coinbaseTransactionAssetPipeline?.status?.() || null,
    marketplaceListingPreparation: marketplaceListingService?.status?.() || null,
    onChainProjection: onChainProjectionService?.status?.() || null,
    fundingOpportunityIntake: fundingOpportunityService?.status?.() || null,
    fundingOpportunityVerification: fundingVerificationService?.status?.() || null,
    fundingOpportunityValuePreparation: fundingValuePreparationService?.status?.() || null,
    fundingModelSelection: fundingModelSelectionService?.status?.() || null,
    fundingInstrumentSelection: fundingInstrumentSelectionService?.status?.() || null,
    fundingInstrumentReview: fundingInstrumentReviewService?.status?.() || null,
    fundingInstrumentIssuance: fundingInstrumentIssuanceService?.status?.() || null,
    fundingMarketplacePreparation: fundingMarketplacePreparationService?.status?.() || null,
    startedAt,
    timestamp: new Date().toISOString()
  });
});

bootstrap.get('/api/marketplace-listings/status', (_req, res) => {
  if (!marketplaceListingService) return res.status(503).json({ error: 'Marketplace Listing Layer is still initializing.' });
  return res.json(marketplaceListingService.status());
});

bootstrap.get('/api/marketplace-listings', (req, res) => {
  if (!marketplaceListingService) return res.status(503).json({ error: 'Marketplace Listing Layer is still initializing.' });
  return res.json(marketplaceListingService.page(
    { state: req.query.state, instrumentId: req.query.instrumentId },
    { page: req.query.page, limit: req.query.limit }
  ));
});

bootstrap.use(async (req, res, next) => {
  if (privateAdminExtension && (req.path === '/admin' || req.path.startsWith('/admin/') || req.path.startsWith('/api/admin/'))) return privateAdminExtension(req, res, next);
  if (database && req.method === 'POST' && req.path === '/api/access/signin') return rejectPlatformAdminPublicSignin(req, res, next, database);
  if (database && req.method === 'POST' && ['/api/access/capacity', '/api/access/role'].includes(req.path) && String(req.body?.capacity || req.body?.role || '').toUpperCase() === 'PLATFORM_ADMIN') return res.status(403).json({ error: 'Platform Administration is available only through the private administration portal.' });
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

bootstrap.listen(port, '0.0.0.0', () => console.log(`SRA bootstrap server is listening on port ${port}`));

function stopConnectors() {
  coinbasePublicMarket?.stop?.();
  if (marketplaceListingTimer) clearInterval(marketplaceListingTimer);
}
process.once('SIGTERM', stopConnectors);
process.once('SIGINT', stopConnectors);

try {
  const created = await createApp();
  database = created.database;
  platformExtensions = await createUniversalAccountBlockchainRouter(created.persistentDomain, created.database);
  fundingOpportunityService = new FundingOpportunityIntakeService(created.persistentDomain);
  await fundingOpportunityService.initialize();
  fundingOpportunityExtension = createFundingOpportunityRouter(fundingOpportunityService);
  fundingVerificationService = new FundingOpportunityVerificationService(created.persistentDomain);
  await fundingVerificationService.initialize();
  fundingVerificationExtension = createFundingOpportunityVerificationRouter(fundingVerificationService);
  fundingValuePreparationService = new FundingOpportunityValuePreparationService(created.persistentDomain);
  await fundingValuePreparationService.initialize();
  fundingValuePreparationExtension = createFundingOpportunityValuePreparationRouter(fundingValuePreparationService);
  fundingModelSelectionService = new FundingModelSelectionService(created.persistentDomain);
  await fundingModelSelectionService.initialize();
  fundingModelSelectionExtension = createFundingModelSelectionRouter(fundingModelSelectionService);
  fundingInstrumentSelectionService = new FundingInstrumentSelectionService(created.persistentDomain);
  await fundingInstrumentSelectionService.initialize();
  fundingInstrumentSelectionExtension = createFundingInstrumentSelectionRouter(fundingInstrumentSelectionService);
  fundingInstrumentReviewService = new FundingInstrumentReviewService(created.persistentDomain);
  await fundingInstrumentReviewService.initialize();
  fundingInstrumentReviewExtension = createFundingInstrumentReviewRouter(fundingInstrumentReviewService);
  fundingInstrumentIssuanceService = new FundingInstrumentIssuanceService(created.persistentDomain);
  await fundingInstrumentIssuanceService.initialize();
  fundingInstrumentIssuanceExtension = createFundingInstrumentIssuanceRouter(fundingInstrumentIssuanceService);
  fundingMarketplacePreparationService = new FundingMarketplacePreparationService(created.persistentDomain);
  await fundingMarketplacePreparationService.initialize();
  fundingMarketplacePreparationExtension = createFundingMarketplacePreparationRouter(fundingMarketplacePreparationService);
  onChainProjectionService = new OnChainProjectionService(created.persistentDomain);
  await onChainProjectionService.initialize();
  onChainProjectionExtension = createOnChainProjectionRouter(onChainProjectionService);
  coinbaseTransactionAssetPipeline = new CoinbaseTransactionAssetPipelineService({ observationLayerService: created.observationLayerService, financialRecordService: created.financialRecordService, persistentDomain: created.persistentDomain });
  marketplaceListingService = new MarketplaceListingService(created.persistentDomain);
  coinbasePublicMarket = new CoinbasePublicMarketService({ observationLayerService: created.observationLayerService, transactionAssetPipeline: coinbaseTransactionAssetPipeline });
  coinbaseExtension = createCoinbasePublicMarketRouter(coinbasePublicMarket);
  privateAdminExtension = await createPrivateAdminRouter({ database: created.database, domain: created.persistentDomain, coinbasePublicMarket });
  coinbasePublicMarket.start();
  setImmediate(async () => {
    try {
      const assetStatus = await coinbaseTransactionAssetPipeline.backfill();
      console.log('Coinbase transaction asset backfill completed.', assetStatus);
      const listingStatus = await marketplaceListingService.backfill();
      console.log('Marketplace listing preparation backfill completed.', listingStatus);
    } catch (error) { console.error('Startup pipeline backfill failed:', error); }
  });
  marketplaceListingTimer = setInterval(() => marketplaceListingService.backfill().catch((error) => console.error('Marketplace listing preparation cycle failed:', error)), 30000);
  marketplaceListingTimer.unref?.();
  platformApp = created.app;
  startupState = 'READY';
  startupError = null;
  console.log('SRA platform initialization completed.');
} catch (error) {
  startupState = 'FAILED';
  startupError = { name: error?.name || 'Error', message: error?.message || 'Unknown startup error', stack: process.env.NODE_ENV === 'production' ? undefined : error?.stack };
  console.error('SRA platform initialization failed:', error);
}