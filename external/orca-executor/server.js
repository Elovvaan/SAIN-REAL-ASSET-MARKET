import crypto from 'node:crypto';
import express from 'express';
import { SraTokenWorker } from './sra-token-worker.js';

const port = Number(process.env.PORT || 3000);
const app = express();
const chain = new SraTokenWorker(process.env);
let startupState = 'STARTING';
let startupError = null;

app.set('trust proxy', 1);
app.use(express.json({ limit:'256kb' }));

function text(value) { return String(value ?? '').trim(); }
function tokenMatches(provided, expected) {
  const a = Buffer.from(`Bearer ${text(expected)}`);
  const b = Buffer.from(text(provided));
  return Boolean(expected) && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function authorized(req) { return tokenMatches(req.get('authorization'), process.env.SOLANA_EXECUTOR_TOKEN); }
function ready(res) {
  if (startupState === 'READY') return true;
  res.status(503).json({ error:'Executor is not ready.', startupState, startupError });
  return false;
}
function key(req, res) {
  const value = text(req.get('idempotency-key'));
  if (!value) res.status(400).json({ error:'Idempotency-Key is required.' });
  return value;
}
function fail(res, error, code) {
  const message = String(error?.message || error);
  const status = /required|invalid|must|address|amount|idempotency|supply|decimal|quantity/i.test(message) ? 400 : 502;
  return res.status(status).json({ error:message, code, transactionSignature:error?.transactionSignature || null });
}

app.get('/health', async (_req, res) => {
  const ok = startupState === 'READY';
  res.status(ok ? 200 : 503).json({
    status:ok ? 'ok' : 'degraded',
    startupState,
    startupError,
    executor:chain.status(),
    wallet:ok ? chain.platformWallet() : null,
    sraToken:ok ? await chain.state().catch(() => null) : null,
    timestamp:new Date().toISOString(),
  });
});
app.get('/wallet', (req, res) => {
  if (!ready(res)) return;
  if (!authorized(req)) return res.status(401).json({ error:'Unauthorized.' });
  return res.json(chain.platformWallet());
});
app.post('/transfer', async (req, res) => {
  if (!ready(res)) return;
  if (!authorized(req)) return res.status(401).json({ error:'Unauthorized.' });
  const id = key(req, res); if (!id) return;
  try { return res.json(await chain.transferSol(req.body || {}, id)); }
  catch (error) { return fail(res, error, 'SOLANA_TRANSFER_FAILED'); }
});
app.post('/tokens/sra/mint', async (req, res) => {
  if (!ready(res)) return;
  if (!authorized(req)) return res.status(401).json({ error:'Unauthorized.' });
  const id = key(req, res); if (!id) return;
  try { return res.json(await chain.createSraMint(req.body || {}, id)); }
  catch (error) { return fail(res, error, 'SRA_TOKEN_MINT_FAILED'); }
});
app.post('/tokens/sra/transfer', async (req, res) => {
  if (!ready(res)) return;
  if (!authorized(req)) return res.status(401).json({ error:'Unauthorized.' });
  const id = key(req, res); if (!id) return;
  try { return res.json(await chain.transferSra(req.body || {}, id)); }
  catch (error) { return fail(res, error, 'SRA_TOKEN_TRANSFER_FAILED'); }
});

const server = app.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ level:'info', event:'SRA_CHAIN_EXECUTOR_LISTENING', port })));
server.requestTimeout = Number(process.env.EXECUTOR_REQUEST_TIMEOUT_MS || 120000);
server.headersTimeout = server.requestTimeout + 5000;

try {
  if (!process.env.SOLANA_EXECUTOR_TOKEN) throw new Error('SOLANA_EXECUTOR_TOKEN is required.');
  await chain.initialize();
  startupState = 'READY';
  console.log(JSON.stringify({ level:'info', event:'SRA_CHAIN_EXECUTOR_READY', platformAddress:chain.platformWallet().address, at:new Date().toISOString() }));
} catch (error) {
  startupState = 'FAILED';
  startupError = { name:error?.name || 'Error', message:String(error?.message || error) };
  console.error(JSON.stringify({ level:'error', event:'SRA_CHAIN_EXECUTOR_STARTUP_FAILED', ...startupError, at:new Date().toISOString() }));
}

async function shutdown(signal) {
  startupState = 'STOPPING';
  server.close(async () => {
    try { await chain.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15000).unref();
  console.log(JSON.stringify({ level:'info', event:'SRA_CHAIN_EXECUTOR_STOPPING', signal, at:new Date().toISOString() }));
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));