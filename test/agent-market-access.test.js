import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentMarketAccessService, AGENT_MARKET_GRANT_TYPE } from '../services/agent-market-access-service.js';
import { AgentMarketProposalService } from '../services/agent-market-proposal-service.js';
import { AgentWorkforceService } from '../services/agent-workforce-service.js';
import { PersistentDomainService, RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor() { this.records=new Map(); }
  get(type,id) { return structuredClone(this.records.get(type)?.get(id)||null); }
  list(type) { return [...(this.records.get(type)?.values()||[])].map((record)=>structuredClone(record)); }
  async put(type,id,record) { if(!this.records.has(type))this.records.set(type,new Map());this.records.get(type).set(id,structuredClone(record)); }
}
async function setup() {
  const domain=new Domain();
  const workforce=new AgentWorkforceService({domain});
  await workforce.registerAgent({agentId:'AGENT-1',name:'Market agent',role:'MARKET'}, {id:'ADMIN-1'});
  const access=new AgentMarketAccessService(domain,workforce);
  return {domain,workforce,access};
}

test('credential is shown once while only a hash is persisted', async () => {
  const {domain,access}=await setup();
  const {grant,token}=await access.issue({agentId:'AGENT-1',scopes:['MARKET_READ']},'ADMIN-1');
  assert.match(token,/^sraam\.AMG-/);
  assert.equal(JSON.stringify(domain.list(AGENT_MARKET_GRANT_TYPE)).includes(token),false);
  assert.equal(JSON.stringify(access.list()).includes('secretHash'),false);
  assert.deepEqual(access.authenticate(`Bearer ${token}`,'MARKET_READ'),grant);
  assert.equal(access.authenticate(`Bearer ${token}`,'PROPOSAL_PREPARE'),null);
  assert.equal(access.authenticate(`Bearer ${token.slice(0,-1)}Z`,'MARKET_READ'),null);
});

test('revocation, expiration, agent pause and scope all deny access', async () => {
  const {domain,workforce,access}=await setup();
  const {grant,token}=await access.issue({agentId:'AGENT-1',scopes:['MARKET_READ','PROPOSAL_PREPARE']},'ADMIN-1');
  assert.ok(access.authenticate(`Bearer ${token}`,'PROPOSAL_PREPARE'));
  await workforce.setAgentState('AGENT-1','PAUSED',{id:'ADMIN-1'});
  assert.equal(access.authenticate(`Bearer ${token}`,'MARKET_READ'),null);
  await workforce.setAgentState('AGENT-1','ACTIVE',{id:'ADMIN-1'});
  const stored=domain.get(AGENT_MARKET_GRANT_TYPE,grant.grantId);
  await domain.put(AGENT_MARKET_GRANT_TYPE,grant.grantId,{...stored,expiresAt:'2020-01-01T00:00:00Z'});
  assert.equal(access.authenticate(`Bearer ${token}`,'MARKET_READ'),null);
  await domain.put(AGENT_MARKET_GRANT_TYPE,grant.grantId,stored);
  await access.revoke(grant.grantId,'ADMIN-1');
  assert.equal(access.authenticate(`Bearer ${token}`,'MARKET_READ'),null);
});

test('only a scoped active registered agent receives a bounded grant', async () => {
  const {access,workforce}=await setup();
  await assert.rejects(access.issue({agentId:'UNKNOWN',scopes:['MARKET_READ']},'ADMIN-1'),/active registered/);
  await assert.rejects(access.issue({agentId:'AGENT-1',scopes:['EXECUTE']},'ADMIN-1'),/Select MARKET_READ/);
  await assert.rejects(access.issue({agentId:'AGENT-1',scopes:['MARKET_READ'],expiresAt:'2050-01-01'},'ADMIN-1'),/30 days/);
  await workforce.setAgentState('AGENT-1','PAUSED',{id:'ADMIN-1'});
  await assert.rejects(access.issue({agentId:'AGENT-1',scopes:['MARKET_READ']},'ADMIN-1'),/active registered/);
});

test('external proposal is tied to the credential agent and still requires admin review', async () => {
  const {domain,access,workforce}=await setup();
  await domain.put('MARKETPLACE_LISTING','LIST-1',{listingId:'LIST-1',instrumentId:'INST-1',status:'LIVE',state:'PUBLISHED',quantity:100,unit:'SRA',updatedAt:'2026-09-29',blockers:[],access:{minimumOrder:1,maximumOrder:50}});
  const issued=await access.issue({agentId:'AGENT-1',scopes:['PROPOSAL_PREPARE']},'ADMIN-1');
  const grant=access.authenticate(`Bearer ${issued.token}`,'PROPOSAL_PREPARE');
  const market=new AgentMarketProposalService(domain,workforce);
  const proposal=await market.prepare({agentId:grant.agentId,listingId:'LIST-1',quantity:5,recipientId:'RECIPIENT-1',settlementRoute:'STELLAR',considerationUnit:'USDC',limitPrice:1,maximumFees:1,expiresAt:new Date(Date.now()+3600_000).toISOString()},`AGENT_GRANT:${grant.grantId}`);
  assert.equal(proposal.agentId,'AGENT-1');
  assert.equal(proposal.executionAuthorized,false);
  await assert.rejects(market.review(proposal.proposalId,{decision:'APPROVE',termsHash:proposal.termsHash},'AGENT-1'),/creator cannot approve/);
});

test('grant and proposal identifiers survive persistent-domain hydration', async () => {
  const {domain,access}=await setup();
  const issued=await access.issue({agentId:'AGENT-1',scopes:['MARKET_READ']},'ADMIN-1');
  await domain.put(RECORD_TYPES.SRA_AGENT_MARKET_PROPOSAL,'AMP-RESTART',{proposalId:'AMP-RESTART',agentId:'AGENT-1',state:'PREPARED'});
  const records=[
    {recordType:RECORD_TYPES.SRA_AGENT_MARKET_ACCESS_GRANT,payload:domain.get(RECORD_TYPES.SRA_AGENT_MARKET_ACCESS_GRANT,issued.grant.grantId)},
    {recordType:RECORD_TYPES.SRA_AGENT_MARKET_PROPOSAL,payload:domain.get(RECORD_TYPES.SRA_AGENT_MARKET_PROPOSAL,'AMP-RESTART')},
  ];
  const reloaded=new PersistentDomainService({listRecordsByTypes:async()=>records});
  await reloaded.hydrate([RECORD_TYPES.SRA_AGENT_MARKET_ACCESS_GRANT,RECORD_TYPES.SRA_AGENT_MARKET_PROPOSAL]);
  assert.equal(reloaded.get(RECORD_TYPES.SRA_AGENT_MARKET_ACCESS_GRANT,issued.grant.grantId).agentId,'AGENT-1');
  assert.equal(reloaded.get(RECORD_TYPES.SRA_AGENT_MARKET_PROPOSAL,'AMP-RESTART').state,'PREPARED');
});
