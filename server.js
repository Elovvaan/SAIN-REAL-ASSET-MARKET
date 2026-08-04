import express from 'express';
import { createApp } from './app.js';
import { createUniversalAccountBlockchainRouter } from './routes/universal-account-blockchain-router.js';
import { createCoinbasePublicMarketRouter } from './routes/coinbase-public-market-router.js';
import { CoinbasePublicMarketService } from './services/coinbase-public-market-service.js';

const port = Number(process.env.PORT) || 3000;
const bootstrap = express();

let platformApp = null;
let platformExtensions = null;
let coinbaseExtension = null;
let coinbasePublicMarket = null;
let startupState = 'STARTING';
let startupError = null;
let startedAt = new Date().toISOString();

bootstrap.get('/api/health', (req, res, next) => {
  if (platformApp) return platformApp(req, res, next);

  return res.status(200).json({
    status: startupState === 'FAILED' ? 'degraded' : 'starting',
    service: 'SAIN Real Asset Market',
    bootstrap: true,
    startupState,
    startupError,
    startedAt,
    timestamp: new Date().toISOString()
  });
});

bootstrap.get('/api/startup', (_req, res) => {
  return res.status(startupState === 'FAILED' ? 500 : 200).json({
    startupState,
    startupError,
    coinbasePublicMarket: coinbasePublicMarket?.status?.() || null,
    startedAt,
    timestamp: new Date().toISOString()
  });
});

bootstrap.use((req, res, next) => {
  if (coinbaseExtension && req.path.startsWith('/api/connectors/coinbase-public')) {
    return coinbaseExtension(req, res, next);
  }

  if (platformExtensions && (
    req.path.startsWith('/api/blockchain-accounts')
    || (req.method === 'POST' && req.path === '/api/access/funding/crypto-instructions')
  )) return platformExtensions(req, res, next);

  if (platformApp) return platformApp(req, res, next);

  return res.status(503).json({
    error: startupState === 'FAILED'
      ? 'The platform failed during initialization. Check /api/startup.'
      : 'The platform is still initializing.',
    startupState
  });
});

bootstrap.listen(port, '0.0.0.0', () => {
  console.log(`SRA bootstrap server is listening on port ${port}`);
});

function stopConnectors() {
  coinbasePublicMarket?.stop?.();
}
process.once('SIGTERM', stopConnectors);
process.once('SIGINT', stopConnectors);

try {
  const created = await createApp();
  platformExtensions = await createUniversalAccountBlockchainRouter(created.persistentDomain, created.database);
  coinbasePublicMarket = new CoinbasePublicMarketService({ observationLayerService: created.observationLayerService });
  coinbaseExtension = createCoinbasePublicMarketRouter(coinbasePublicMarket);
  coinbasePublicMarket.start();
  platformApp = created.app;
  startupState = 'READY';
  startupError = null;
  console.log('SRA platform initialization completed.');
} catch (error) {
  startupState = 'FAILED';
  startupError = {
    name: error?.name || 'Error',
    message: error?.message || 'Unknown startup error',
    stack: process.env.NODE_ENV === 'production' ? undefined : error?.stack
  };
  console.error('SRA platform initialization failed:', error);
}
