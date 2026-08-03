import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';

const actor={'x-sra-actor-id':'LEDGER-ADMIN'};

async function setupFee(app){
  await request(app).post('/api/economics/catalog').set(actor).send({feeCode:'SETTLEMENT_PROCESSING',name:'Settlement Processing',category:'SETTLEMENT',defaultPayerType:'CUSTOMER'}).expect(201);
  const schedule=await request(app).post('/api/economics/schedules').set(actor).send({name:'Ledger Test Schedule',version:'1.0.0',effectiveFrom:'2026-08-01T00:00:00.000Z',rules:[{feeCode:'SETTLEMENT_PROCESSING',method:'FIXED',amount:500,payerType:'CUSTOMER',trigger:'SETTLEMENT_PREPARED'}]}).expect(201);
  await request(app).post(`/api/economics/schedules/${schedule.body.scheduleId}/activate`).set(actor).send({}).expect(200);
  const charge=await request(app).post('/api/economics/charges').set(actor).send({subjectType:'SRA_SETTLEMENT',subjectId:'STL-19',payerId:'CUSTOMER-19',payerType:'CUSTOMER',trigger:'SETTLEMENT_PREPARED',context:{}}).expect(201);
  return charge.body;
}

test('fee invoice automatically posts balanced receivable and revenue entry',async()=>{
  const {app}=await createApp({serveStatic:false,seedMarketplace:false});
  const charge=await setupFee(app);
  const invoice=await request(app).post('/api/economics/invoices').set(actor).send({payerId:'CUSTOMER-19',payerType:'CUSTOMER',chargeIds:[charge.chargeId],dueDate:'2026-09-01'}).expect(201);
  const entries=await request(app).get(`/api/ledger/entries?referenceId=${invoice.body.invoiceId}`).expect(200);
  assert.equal(entries.body.entries.length,1);
  assert.equal(entries.body.entries[0].totalDebits,500);
  assert.equal(entries.body.entries[0].totalCredits,500);
  const trial=await request(app).get('/api/ledger/trial-balance').expect(200);
  assert.equal(trial.body.totalDebits,trial.body.totalCredits);
});

test('invoice payment moves receivable into cash',async()=>{
  const {app}=await createApp({serveStatic:false,seedMarketplace:false});
  const charge=await setupFee(app);
  const invoice=await request(app).post('/api/economics/invoices').send({payerId:'CUSTOMER-19',payerType:'CUSTOMER',chargeIds:[charge.chargeId],dueDate:'2026-09-01'}).expect(201);
  await request(app).post('/api/ledger/invoice-payments').set(actor).send({invoiceId:invoice.body.invoiceId,amount:500,cashAccountId:'GL-CASH-OPERATING'}).expect(201);
  const cash=await request(app).get('/api/ledger/accounts/GL-CASH-OPERATING/balance').expect(200);
  const ar=await request(app).get('/api/ledger/accounts/GL-AR/balance').expect(200);
  assert.equal(cash.body.balance,500);
  assert.equal(ar.body.balance,0);
});

test('unbalanced manual entries are rejected',async()=>{
  const {app}=await createApp({serveStatic:false,seedMarketplace:false});
  const result=await request(app).post('/api/ledger/entries').send({referenceType:'TEST',referenceId:'BAD-1',eventType:'BAD_ENTRY',description:'Unbalanced',lines:[{accountId:'GL-CASH-OPERATING',debit:100},{accountId:'GL-FEE-REVENUE',credit:90}]}).expect(400);
  assert.match(result.body.error,/not balanced/i);
});
