import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SraCoinAgentService } from '../services/sra-coin-agent-service.js';
import { SraAgentOperatingSystemService } from '../services/sra-agent-operating-system-service.js';

class Domain {
  constructor(records = {}) { this.records = records; }
  list(type) { return structuredClone(this.records[type] || []); }
  get(type, id) { return this.list(type).find((item) => [item.id,item.coinPositionId,item.instrumentId,item.observationId,item.assetId].includes(id)) || null; }
}

function records() {
  return {
    MARKET_OBSERVATION:[{ observationId:'OBS-CB', sourceMarket:'COINBASE' }],
    COIN_POSITION:[{ coinPositionId:'CP-CB', symbol:'SRA', quantity:1000, financialRecordId:'FR-CB', recognitionId:'REC-CB', observationId:'OBS-CB', ownerId:'SRA_PLATFORM', state:'REPRESENTED' }],
    SRA_INSTRUMENT:[], MARKETPLACE_LISTING:[], SRA_TRANSACTION:[], EXPORT_PACKAGE:[], OWNERSHIP_RECOGNITION:[], ON_CHAIN_ASSET:[], ON_CHAIN_MARKET_OFFER:[],
  };
}

test('Coin Agent treats Coinbase-derived Coin Position as direct representation work rather than missing-instrument failure', () => {
  const agent = new SraCoinAgentService(new Domain(records())).explain('CP-CB');
  assert.equal(agent.sourceClass, 'COINBASE_RECOGNIZED_MARKET_TRANSACTION');
  assert.deepEqual(agent.blockers, []);
  assert.equal(agent.nextEligibleAction, 'PREPARE_DIRECT_COIN_REPRESENTATION');
  assert.equal(agent.humanApprovalRequired, true);
});

test('all seven operating agents expose assigned workflow stages', () => {
  const registry = new SraAgentOperatingSystemService(new Domain(records())).registry();
  assert.equal(registry.length, 7);
  for (const agent of registry) assert.ok(agent.workflowStages.length > 0, `${agent.agentId} must own workflow stages`);
});

test('unified operations queue hands direct Coin Position representation to Coin Agent', () => {
  const queue = fs.readFileSync(new URL('../services/unified-market-operations-queue-service.js', import.meta.url), 'utf8');
  const workforce = fs.readFileSync(new URL('../services/agent-workforce-service.js', import.meta.url), 'utf8');
  assert.match(queue, /PREPARE_DIRECT_COIN_REPRESENTATION/);
  assert.match(queue, /agentId:'SRA-COIN-AGENT'/);
  assert.match(queue, /sourceClass:agent\.sourceClass/);
  assert.match(workforce, /COIN_POSITION:'SRA-COIN-AGENT'/);
});

test('admin workforce UI exposes agents, stages, work counts, and manual run control', () => {
  const shell = fs.readFileSync(new URL('../public/admin/admin-suite-shell.js', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../public/admin/admin-agent-operations-workstation.js', import.meta.url), 'utf8');
  assert.match(shell, /'Conversation','Capital Activation','Workforce','Suggested Actions'/);
  assert.match(ui, /SRA Agent Workforce/);
  assert.match(ui, /Assigned stages/);
  assert.match(ui, /Run Workforce Now/);
  assert.match(ui, /\/api\/admin\/agent-workforce\/run/);
});
