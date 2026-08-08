import test from 'node:test';
import assert from 'node:assert/strict';
import { PlatformChainOperationsAgentService } from '../services/platform-chain-operations-agent-service.js';

function domainFixture({ positions = [], projection = null } = {}) {
  return {
    list(type) { return type === 'COIN_POSITION' ? positions : []; },
    get(type, id) { return type === 'SRA_COIN_CHAIN_PROJECTION' && id === 'SRA-SOLANA' ? projection : null; },
  };
}

test('agent prepares an approval-gated job for newly produced SRA', () => {
  const domain = domainFixture({
    positions: [{ symbol: 'SRA', state: 'ACTIVE', quantity: 125.5 }],
    projection: { projectionId: 'SRA-SOLANA', mintAddress: 'mint-address', issuedOnChainSupply: 100 },
  });
  const agent = new PlatformChainOperationsAgentService({ domain, chainService: { putOnChain() {} } });
  const work = agent.workQueue();
  assert.equal(work.state, 'WORK_AVAILABLE');
  assert.equal(work.queue[0].jobType, 'SYNC_SRA_SUPPLY');
  assert.equal(work.queue[0].requestedQuantity, 25.5);
  assert.equal(work.queue[0].authority, 'ADMIN_APPROVAL_REQUIRED');
});

test('agent does not invent work when chain supply is synchronized', () => {
  const domain = domainFixture({
    positions: [{ symbol: 'SRA', state: 'ACTIVE', quantity: 100 }],
    projection: { projectionId: 'SRA-SOLANA', mintAddress: 'mint-address', issuedOnChainSupply: 100 },
  });
  const work = new PlatformChainOperationsAgentService({ domain }).workQueue();
  assert.equal(work.state, 'CLEAR');
  assert.equal(work.queue.length, 0);
});

test('agent blocks execution when chain supply exceeds platform truth', () => {
  const domain = domainFixture({
    positions: [{ symbol: 'SRA', state: 'ACTIVE', quantity: 90 }],
    projection: { projectionId: 'SRA-SOLANA', mintAddress: 'mint-address', issuedOnChainSupply: 100 },
  });
  const work = new PlatformChainOperationsAgentService({ domain }).workQueue();
  assert.equal(work.queue[0].jobType, 'RECONCILE_SRA_CHAIN_SUPPLY');
  assert.equal(work.queue[0].executable, false);
});

test('agent requires explicit approval before executing chain synchronization', async () => {
  const domain = domainFixture({ positions: [{ symbol: 'SRA', state: 'ACTIVE', quantity: 10 }] });
  const agent = new PlatformChainOperationsAgentService({ domain, chainService: { async putOnChain() { throw new Error('must not execute'); } } });
  await assert.rejects(() => agent.execute('CHAIN-SRA-SYNC', {}, { id: 'ADMIN-1' }), /Explicit administrator approval/);
});
