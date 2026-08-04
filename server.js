import express from 'express';
import { createApp } from './app.js';
import { createUniversalAccountBlockchainRouter } from './routes/universal-account-blockchain-router.js';
import { createCoinbasePublicMarketRouter } from './routes/coinbase-public-market-router.js';
import { createPrivateAdminRouter, rejectPlatformAdminPublicSignin } from './routes/private-admin-router.js';
import { CoinbasePublicMarketService } from './services/coinbase-public-market-service.js';
import { CoinbaseTransactionAssetPipelineService } from './services/coinbase-transaction-asset-pipeline-service.js';
import { MarketplaceListingService } from './services/marketplace-listing-service.js';

const port = Number(process.env.PORT) || 3000;
const bootstrap = express();
bootstrap.use(express.json({ limit: '1mb' }));

let platformApp = null;
let platformExtensions = null;
let coinbaseExtension = null;
let privateAdminExtension = null;
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
  const listings = marketplaceListingService.list({ state: req.query.state, instrumentId: req.query.instrumentId });
  return res.json({ listings, count: listings.length });
});

bootstrap.use(async (req, res, next) => {
  if (privateAdminExtension && (req.path === '/admin' || req.path.startsWith('/admin/') || req.path.startsWith('/api/admin/'))) return privateAdminExtension(req, res, next);
  if (database && req.method === 'POST' && req.path === '/api/access/signin') return rejectPlatformAdminPublicSignin(req, res, next, database);
  if (database && req.method === 'POST' && ['/api/access/capacity', '/api/access/role'].includes(req.path) && String(req.body?.capacity || req.body?.role || '').toUpperCase() === 'PLATFORM_ADMIN') return res.status(403).json({ error: 'Platform Administration is available only through the private administration portal.' });
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
