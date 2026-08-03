import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';

const actor={'x-sra-actor-id':'FINANCE-ADMIN'};

test('financial statements produce a balanced balance sheet and income statement',async()=>{
  const {app}=await createApp({serveStatic:false,seedMarketplace:false});
  const period=await request(app).post('/api/financial-statements/periods').set(actor).send({name:'August 2026',startDate:'2026-08-01',endDate:'2026-08-31'}).expect(201);
  await request(app).post('/api/ledger/entries').set(actor).send({referenceType:'CAPITAL_CONTRIBUTION',referenceId:'CAP-23',eventType:'CAPITAL_RECEIVED',description:'Owner capital',lines:[{accountId:'GL-CASH-OPERATING',debit:100000},{accountId:'GL-CONTRIBUTED-CAPITAL',credit:100000}]}).expect(201);
  await request(app).post('/api/ledger/entries').set(actor).send({referenceType:'OPERATING_EXPENSE',referenceId:'EXP-23',eventType:'EXPENSE_RECORDED',description:'Operating expense',lines:[{accountId:'GL-OPERATING-EXPENSE',debit:12000},{accountId:'GL-CASH-OPERATING',credit:12000}]}).expect(201);
  await request(app).post('/api/ledger/entries').set(actor).send({referenceType:'FEE_REVENUE',referenceId:'REV-23',eventType:'REVENUE_RECORDED',description:'Platform fee revenue',lines:[{accountId:'GL-CASH-OPERATING',debit:20000},{accountId:'GL-FEE-REVENUE',credit:20000}]}).expect(201);
  const statements=await request(app).get(`/api/financial-statements/periods/${period.body.periodId}/statements`).expect(200);
  assert.equal(statements.body.incomeStatement.netIncome,8000);
  assert.equal(statements.body.balanceSheet.totalAssets,108000);
  assert.equal(statements.body.balanceSheet.totalLiabilitiesAndEquity,108000);
  assert.equal(statements.body.balanceSheet.balanced,true);
});

test('accounting periods can be snapshotted and explicitly closed',async()=>{
  const {app}=await createApp({serveStatic:false,seedMarketplace:false});
  const period=await request(app).post('/api/financial-statements/periods').send({name:'September 2026',startDate:'2026-09-01',endDate:'2026-09-30'}).expect(201);
  const snapshot=await request(app).post(`/api/financial-statements/periods/${period.body.periodId}/snapshots`).set(actor).send({}).expect(201);
  assert.equal(snapshot.body.state,'FINAL');
  const closed=await request(app).post(`/api/financial-statements/periods/${period.body.periodId}/close`).set(actor).send({closeReference:'CLOSE-2026-09'}).expect(200);
  assert.equal(closed.body.state,'CLOSED');
  assert.equal(closed.body.closeReference,'CLOSE-2026-09');
  await request(app).post(`/api/financial-statements/periods/${period.body.periodId}/close`).send({}).expect(400);
});
