import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createAgentMarketAccessRouter } from '../routes/agent-market-access-router.js';
import { AgentMarketAccessService } from '../services/agent-market-access-service.js';
import { AgentWorkforceService } from '../services/agent-workforce-service.js';

class Domain {
  constructor() { this.records=new Map(); }
  get(type,id) { return structuredClone(this.records.get(type)?.get(id)||null); }
  list(type) { return [...(this.records.get(type)?.values()||[])].map((x)=>structuredClone(x)); }
  async put(type,id,value) { if(!this.records.has(type))this.records.set(type,new Map());this.records.get(type).set(id,structuredClone(value)); }
  async hydrate() {}
}
async function setup() {
  const domain=new Domain();
  await domain.put('MARKETPLACE_LISTING','LIST-1',{listingId:'LIST-1',instrumentId:'INST-1',status:'LIVE',state:'PUBLISHED',quantity:100,unit:'SRA',updatedAt:'2026-09-29',blockers:[],title:'Position',access:{minimumOrder:1,maximumOrder:50},privateBankAccount:'hidden'});
  const workforce=new AgentWorkforceService({domain});
  await workforce.registerAgent({agentId:'AGENT-1',name:'Agent One',role:'MARKET'}, {id:'ADMIN-1'});
  await workforce.registerAgent({agentId:'AGENT-2',name:'Agent Two',role:'MARKET'}, {id:'ADMIN-1'});
  const access=new AgentMarketAccessService(domain,workforce);
  const read=await access.issue({agentId:'AGENT-1',scopes:['MARKET_READ']},'ADMIN-1');
  const prepare=await access.issue({agentId:'AGENT-1',scopes:['PROPOSAL_PREPARE']},'ADMIN-1');
  const app=express(); app.use(express.json()); app.use('/api/agent-market',await createAgentMarketAccessRouter(domain));
  return {app,domain,access,read,prepare};
}

test('agent API requires scoped bearer credential and exposes only selected fields', async () => {
  const {app,read,prepare}=await setup();
  await request(app).get('/api/agent-market/catalog').expect(401);
  await request(app).get('/api/agent-market/catalog').set('Authorization',`Bearer ${prepare.token}`).expect(401);
  const response=await request(app).get('/api/agent-market/catalog').set('Authorization',`Bearer ${read.token}`).expect(200);
  assert.equal(response.headers['cache-control'],'no-store');
  assert.equal(response.body.records[0].listingId,'LIST-1');
  assert.equal(JSON.stringify(response.body).includes('privateBankAccount'),false);
  await request(app).post('/api/agent-market/proposals').set('Authorization',`Bearer ${read.token}`).send({}).expect(401);
  await request(app).post('/api/agent-market/proposals/ID/review').set('Authorization',`Bearer ${prepare.token}`).send({decision:'APPROVE'}).expect(404);
});

test('proposal identity is bound to grant despite a spoofed body agentId', async () => {
  const {app,domain,prepare,access}=await setup();
  const body={agentId:'AGENT-2',listingId:'LIST-1',quantity:5,recipientId:'RECIPIENT-1',settlementRoute:'STELLAR',considerationUnit:'USDC',limitPrice:1,maximumFees:0,expiresAt:new Date(Date.now()+3600_000).toISOString()};
  const response=await request(app).post('/api/agent-market/proposals').set('Authorization',`Bearer ${prepare.token}`).send(body).expect(201);
  assert.equal(response.body.agentId,'AGENT-1');
  assert.equal(response.body.executionAuthorized,false);
  const grant=access.authenticate(`Bearer ${prepare.token}`,'PROPOSAL_PREPARE');
  assert.equal(domain.get('SRA_AGENT_MARKET_PROPOSAL',response.body.proposalId).requestedBy,`AGENT_GRANT:${grant.grantId}`);
});
