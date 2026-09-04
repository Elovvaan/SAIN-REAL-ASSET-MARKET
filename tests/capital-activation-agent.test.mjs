import test from 'node:test';
import assert from 'node:assert/strict';
import { CapitalActivationAgentService } from '../services/capital-activation-agent-service.js';

class Domain {
  constructor(records = {}) { this.records = records; }
  list(type) { return this.records[type] || []; }
  async put(type, id, payload) { this.records[type] ||= []; this.records[type].push(payload); return payload; }
}

test('classifies issued inventory without a market as market ready', () => {
  const service = new CapitalActivationAgentService(new Domain({ ON_CHAIN_ASSET:[{assetId:'A-1',instrumentId:'INS-1',network:'STELLAR',asset:'SRAUSD',issuedSupply:100000}], COIN_POSITION:[], SRA_COIN_POSITION:[], ON_CHAIN_USDC_MARKET:[], ON_CHAIN_USDC_MARKET_READINESS:[], ON_CHAIN_MARKET_OFFER:[], POSITION_RESERVATION:[] }));
  const snapshot = service.snapshot();
  assert.equal(snapshot.queue[0].classification, 'MARKET_READY');
  assert.equal(snapshot.queue[0].executionAuthorized, false);
});

test('distinguishes liquidity-blocked and active market inventory', () => {
  const records = { ON_CHAIN_ASSET:[{assetId:'A-1',instrumentId:'INS-1',issuedSupply:25},{assetId:'A-2',instrumentId:'INS-2',issuedSupply:50}], COIN_POSITION:[], SRA_COIN_POSITION:[], ON_CHAIN_USDC_MARKET_READINESS:[{assetId:'A-1'}], ON_CHAIN_USDC_MARKET:[{assetId:'A-2',state:'ACTIVE'}], ON_CHAIN_MARKET_OFFER:[], POSITION_RESERVATION:[] };
  const snapshot = new CapitalActivationAgentService(new Domain(records)).snapshot();
  assert.equal(snapshot.queue.find((item)=>item.assetId === 'A-1').classification, 'LIQUIDITY_BLOCKED');
  assert.equal(snapshot.queue.find((item)=>item.assetId === 'A-2').classification, 'DEPLOYABLE');
});

test('prepares but never authorizes a capital proposal', async () => {
  const domain = new Domain({ ON_CHAIN_ASSET:[], COIN_POSITION:[{coinPositionId:'CP-1',instrumentId:'INS-1',availableQuantity:100,state:'ACTIVE'}], SRA_COIN_POSITION:[], ON_CHAIN_USDC_MARKET:[], ON_CHAIN_USDC_MARKET_READINESS:[], ON_CHAIN_MARKET_OFFER:[], POSITION_RESERVATION:[] });
  const proposal = await new CapitalActivationAgentService(domain).prepareProposal('CP-1',{amount:20},'ADMIN-1');
  assert.equal(proposal.amount, 20);
  assert.equal(proposal.state, 'PREPARED');
  assert.equal(proposal.executionAuthorized, false);
  assert.equal(domain.list('CAPITAL_ACTIVATION_PROPOSAL').length, 1);
});
