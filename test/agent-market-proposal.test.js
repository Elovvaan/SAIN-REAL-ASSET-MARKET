import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentMarketProposalService } from '../services/agent-market-proposal-service.js';
import { AgentWorkforceService } from '../services/agent-workforce-service.js';

class Domain {
  constructor() { this.data = new Map(); }
  list(type) { return [...(this.data.get(type)?.values() || [])].map((x) => structuredClone(x)); }
  get(type, id) { return structuredClone(this.data.get(type)?.get(id) || null); }
  async put(type, id, record) { if (!this.data.has(type)) this.data.set(type, new Map()); this.data.get(type).set(id, structuredClone(record)); }
}
function setup() {
  const domain = new Domain();
  const workforce = new AgentWorkforceService({ domain });
  const service = new AgentMarketProposalService(domain, workforce);
  const listing = { listingId:'LIST-1', instrumentId:'INST-1', title:'Verified position', unit:'SRA', quantity:100, status:'LIVE', state:'PUBLISHED', blockers:[], updatedAt:'2026-09-28T00:00:00Z', pricing:{unitPrice:1,currency:'USD'}, access:{minimumOrder:1,maximumOrder:50}, privateBankAccount:'never expose' };
  return { domain, workforce, service, listing };
}
const input = () => ({ agentId:'AGENT-1', listingId:'LIST-1', quantity:10, recipientId:'PARTICIPANT-1', settlementRoute:'STELLAR', considerationUnit:'USDC', limitPrice:1.02, maximumFees:0.25, expiresAt:new Date(Date.now()+3600_000).toISOString() });

test('catalog exposes only live verified records and selected market fields', async () => {
  const { domain, service, listing } = setup();
  await domain.put('MARKETPLACE_LISTING', listing.listingId, listing);
  await domain.put('MARKETPLACE_LISTING', 'DRAFT', {...listing, listingId:'DRAFT', status:'DRAFT', state:'PREPARED'});
  await domain.put('MARKETPLACE_LISTING', 'BLOCKED', {...listing, listingId:'BLOCKED', blockers:['HOLD']});
  assert.deepEqual(service.catalog().map((x)=>x.listingId), ['LIST-1']);
  assert.equal(JSON.stringify(service.catalog()).includes('privateBankAccount'), false);
});

test('agent prepares exact terms; administrator reviews without executing', async () => {
  const { domain, workforce, service, listing } = setup();
  await domain.put('MARKETPLACE_LISTING', listing.listingId, listing);
  await workforce.registerAgent({agentId:'AGENT-1',name:'Market assistant',role:'MARKET'}, {id:'ADMIN-1'});
  const proposal = await service.prepare(input(), 'ADMIN-1');
  assert.equal(proposal.state, 'PREPARED');
  await assert.rejects(service.review(proposal.proposalId,{decision:'APPROVE',termsHash:'wrong'},'ADMIN-1'), /Exact proposal/);
  const approved = await service.review(proposal.proposalId,{decision:'APPROVE',termsHash:proposal.termsHash},'ADMIN-1');
  assert.equal(approved.state, 'APPROVED_FOR_HANDOFF');
  assert.equal(approved.executionAuthorized, false);
  await assert.rejects(service.review(proposal.proposalId,{decision:'APPROVE',termsHash:proposal.termsHash},'ADMIN-1'), /already been reviewed/);
});

test('paused agents and changed listings block proposal progression', async () => {
  const { domain, workforce, service, listing } = setup();
  await domain.put('MARKETPLACE_LISTING', listing.listingId, listing);
  await workforce.registerAgent({agentId:'AGENT-1',name:'Market assistant',role:'MARKET'}, {id:'ADMIN-1'});
  const proposal = await service.prepare(input(), 'ADMIN-1');
  await domain.put('MARKETPLACE_LISTING', listing.listingId, {...listing, updatedAt:'2026-09-29T00:00:00Z'});
  await assert.rejects(service.review(proposal.proposalId,{decision:'APPROVE',termsHash:proposal.termsHash},'ADMIN-1'), /Listing changed/);
  await domain.put('MARKETPLACE_LISTING', listing.listingId, listing);
  await workforce.setAgentState('AGENT-1','PAUSED',{id:'ADMIN-1'});
  await assert.rejects(service.prepare(input(),'ADMIN-1'), /Active agent/);
  await assert.rejects(service.review(proposal.proposalId,{decision:'APPROVE',termsHash:proposal.termsHash},'ADMIN-1'), /paused/);
  await workforce.synchronizeOperatingAgents([{agentId:'AGENT-1',name:'Market assistant',agentType:'MARKET',scope:'MARKET'}],{id:'ADMIN-1'});
  assert.equal(workforce.getAgent('AGENT-1').state, 'PAUSED');
});

test('proposal rejects quantities outside listing access and expired terms', async () => {
  const { domain, workforce, service, listing } = setup();
  await domain.put('MARKETPLACE_LISTING', listing.listingId, listing);
  await workforce.registerAgent({agentId:'AGENT-1',name:'Market assistant',role:'MARKET'}, {id:'ADMIN-1'});
  await assert.rejects(service.prepare({...input(),quantity:51},'ADMIN-1'), /Quantity/);
  await assert.rejects(service.prepare({...input(),expiresAt:'2020-01-01'},'ADMIN-1'), /future date/);
});

test('paused operating agent is skipped by workforce execution after synchronization', async () => {
  const { workforce } = setup();
  await workforce.registerAgent({agentId:'SRA-LISTING-AGENT',name:'Listing',role:'LISTING'}, {id:'ADMIN-1'});
  await workforce.setAgentState('SRA-LISTING-AGENT','PAUSED',{id:'ADMIN-1'});
  await workforce.synchronizeOperatingAgents([{agentId:'SRA-LISTING-AGENT',name:'Listing',agentType:'LISTING',scope:'MARKET'}],{id:'ADMIN-1'});
  const result = await workforce.runOperationalQueue({queue:[{id:'LIST-1',stage:'LISTING_PREPARATION',nextAction:'PREPARE'}]}, {id:'ADMIN-1'});
  assert.equal(result.createdCount, 0);
  assert.equal(result.skipped[0].reason, 'AGENT_PAUSED');
});
