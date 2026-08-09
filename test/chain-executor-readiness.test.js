import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SolanaTransferService } from '../services/solana-transfer-service.js';
import { PlatformChainOperationsAgentService } from '../services/platform-chain-operations-agent-service.js';

class Domain {
  list(type) { return type === 'COIN_POSITION' ? [{ coinPositionId:'CP-1', symbol:'SRA', state:'ACTIVE', quantity:10 }] : []; }
  get() { return null; }
}

test('chain job is not executable when executor endpoint or credential is missing', () => {
  const chainService = { executionReadiness: () => new SolanaTransferService({ environment:{} }).status() };
  const agent = new PlatformChainOperationsAgentService({ domain:new Domain(), chainService });
  const job = agent.workQueue().queue[0];
  assert.equal(job.jobType, 'PUT_SRA_ON_CHAIN');
  assert.equal(job.executable, false);
  assert.equal(job.priority, 'BLOCKED');
  assert.equal(job.blocker, 'SOLANA_EXECUTOR_NOT_CONFIGURED');
});

test('configured executor connection makes reviewed chain work executable', () => {
  const status = new SolanaTransferService({ environment:{ SOLANA_EXECUTOR_ENDPOINT:'https://executor.example', SOLANA_EXECUTOR_TOKEN:'secret' } }).status();
  const chainService = { executionReadiness: () => status };
  const agent = new PlatformChainOperationsAgentService({ domain:new Domain(), chainService });
  const job = agent.workQueue().queue[0];
  assert.equal(job.executable, true);
  assert.equal(job.priority, 'READY');
});

test('Solana health reports remote executor and worker readiness without exposing secrets', async () => {
  const service = new SolanaTransferService({
    environment:{ SOLANA_EXECUTOR_ENDPOINT:'https://executor.example', SOLANA_EXECUTOR_TOKEN:'secret' },
    fetchImpl: async () => ({ ok:true, json:async () => ({ status:'ok', startupState:'READY', executor:{ network:'SOLANA', cluster:'mainnet', rpcConfigured:true, databaseConfigured:true, signerConfigured:true, initialized:true, platformAddress:'WALLET' }, wallet:{ address:'WALLET' } }) })
  });
  const health = await service.health();
  assert.equal(health.ready, true);
  assert.equal(health.reachable, true);
  assert.equal(health.executorReady, true);
  assert.equal(health.worker.signerConfigured, true);
  assert.equal(JSON.stringify(health).includes('secret'), false);
});

test('administrative incomplete workflows surface chain readiness before approval', () => {
  const ui = fs.readFileSync(new URL('../public/admin/admin-agent-operations-workstation.js', import.meta.url), 'utf8');
  const router = fs.readFileSync(new URL('../routes/on-chain-projection-router.js', import.meta.url), 'utf8');
  const worker = fs.readFileSync(new URL('../external/orca-executor/sra-token-worker.js', import.meta.url), 'utf8');
  assert.match(ui, /Chain Execution Readiness/);
  assert.match(ui, /Executor reachable/);
  assert.match(ui, /Platform wallet/);
  assert.match(router, /await solana\.health\(\)/);
  assert.match(worker, /rpcConfigured/);
  assert.match(worker, /signerConfigured/);
  assert.match(worker, /databaseConfigured/);
});