import express from 'express';
import { OrcaExecutorWorker } from './orca-worker.js';

const port = Number(process.env.PORT || 3000);
const app = express();
const worker = new OrcaExecutorWorker(process.env);
let startupState = 'STARTING';
let startupError = null;

app.set('trust proxy', 1);
app.use(express.json({ limit:'256kb' }));

app.get('/health', (_req,res) => {
  const status = worker.status();
  const ok = startupState === 'READY' && status.ready;
  res.status(ok ? 200 : 503).json({ status:ok ? 'ok' : 'degraded', startupState, startupError, executor:status, timestamp:new Date().toISOString() });
});

app.post('/execute', async (req,res) => {
  if (startupState !== 'READY') return res.status(503).json({ error:'Executor is not ready.', startupState });
  if (!worker.authenticate(req.get('authorization'))) return res.status(401).json({ error:'Unauthorized.' });
  const idempotencyKey = String(req.get('idempotency-key') || '').trim();
  if (!idempotencyKey) return res.status(400).json({ error:'Idempotency-Key is required.' });
  try {
    const result = await worker.execute(req.body || {}, idempotencyKey);
    return res.json(result);
  } catch (error) {
    const message = String(error?.message || error);
    const status = /required|unsupported|invalid|must|precision|idempotency/i.test(message) ? 400 : /already exists/i.test(message) ? 409 : 502;
    console.error(JSON.stringify({ level:'error', event:'ORCA_EXECUTION_FAILED', idempotencyKey, message, at:new Date().toISOString() }));
    return res.status(status).json({ error:message, code:'ORCA_EXECUTION_FAILED' });
  }
});

const server = app.listen(port,'0.0.0.0',() => console.log(JSON.stringify({ level:'info', event:'ORCA_EXECUTOR_LISTENING', port })));
server.requestTimeout = Number(process.env.EXECUTOR_REQUEST_TIMEOUT_MS || 120000);
server.headersTimeout = server.requestTimeout + 5000;

try {
  await worker.initialize();
  startupState = 'READY';
  console.log(JSON.stringify({ level:'info', event:'ORCA_EXECUTOR_READY', cluster:worker.status().cluster, at:new Date().toISOString() }));
} catch (error) {
  startupState = 'FAILED';
  startupError = { name:error?.name || 'Error', message:String(error?.message || error) };
  console.error(JSON.stringify({ level:'error', event:'ORCA_EXECUTOR_STARTUP_FAILED', ...startupError, at:new Date().toISOString() }));
}

async function shutdown(signal) {
  startupState = 'STOPPING';
  server.close(async () => {
    try { await worker.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1),15000).unref();
  console.log(JSON.stringify({ level:'info', event:'ORCA_EXECUTOR_STOPPING', signal, at:new Date().toISOString() }));
}
process.once('SIGTERM',() => void shutdown('SIGTERM'));
process.once('SIGINT',() => void shutdown('SIGINT'));
