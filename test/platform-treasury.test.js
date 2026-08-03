import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';

const actor={'x-sra-actor-id':'TREASURY-ADMIN'};

async function setup(app){
  const profile=await request(app).post('/api/platform-treasury/profiles').set(actor).send({name:'SRA Operating Treasury',operatingCashAccountId:'GL-CASH-OPERATING',receivablesAccountId:'GL-AR',minimumOperatingReserve:25000,targetOperatingReserve:50000,forecastHorizonDays:90}).expect(201);
  return profile.body;
}

test('platform treasury reports reserve position and liquidity forecast',async()=>{
  const {app}=await createApp({serveStatic:false,seedMarketplace:false});
  const profile=await setup(app);
  await request(app).post('/api/ledger/entries').set(actor).send({referenceType:'CAPITAL_CONTRIBUTION',referenceId:'CAP-22',eventType:'CAPITAL_RECEIVED',description:'Initial operating capital',lines:[{accountId:'GL-CASH-OPERATING',debit:60000},{accountId:'GL-FEE-REVENUE',credit:60000}]}).expect(201);
  const forecast=await request(app).post('/api/platform-treasury/forecasts').set(actor).send({profileId:profile.profileId,asOfDate:'2026-08-03',inflows:[{type:'RECEIVABLE_COLLECTION',amount:10000}],outflows:[{type:'OPERATING_EXPENSE',amount:15000}]}).expect(201);
  assert.equal(forecast.body.openingCash,60000);
  assert.equal(forecast.body.projectedClosingCash,55000);
  assert.equal(forecast.body.reserveGap,0);
  const position=await request(app).get(`/api/platform-treasury/profiles/${profile.profileId}/position`).expect(200);
  assert.equal(position.body.reserveStatus,'AT_OR_ABOVE_TARGET');
  assert.equal(position.body.availableLiquidity,35000);
});

test('platform treasury exceptions can be opened and resolved',async()=>{
  const {app}=await createApp({serveStatic:false,seedMarketplace:false});
  const profile=await setup(app);
  const exception=await request(app).post('/api/platform-treasury/exceptions').set(actor).send({profileId:profile.profileId,type:'RESERVE_SHORTFALL',severity:'HIGH',description:'Projected cash below target reserve'}).expect(201);
  assert.equal(exception.body.state,'OPEN');
  const resolved=await request(app).post(`/api/platform-treasury/exceptions/${exception.body.exceptionId}/resolve`).set(actor).send({resolution:'Capital contribution scheduled'}).expect(200);
  assert.equal(resolved.body.state,'RESOLVED');
});
