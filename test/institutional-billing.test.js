import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';
import { billingAdmin } from './helpers/billing-admin.js';

const actor={'x-sra-actor-id':'BILLING-ADMIN'};

async function setup(app){
  await request(app).post('/api/economics/catalog').set(actor).send({feeCode:'API_USAGE',name:'API Usage',category:'API',defaultPayerType:'INSTITUTION'}).expect(201);
  await request(app).post('/api/economics/catalog').set(actor).send({feeCode:'REPORTING_USAGE',name:'Reporting Usage',category:'REPORTING',defaultPayerType:'INSTITUTION'}).expect(201);
  const schedule=await request(app).post('/api/economics/schedules').set(actor).send({name:'Institution Billing Schedule',version:'1.0.0',effectiveFrom:'2026-08-01T00:00:00.000Z',rules:[{feeCode:'API_USAGE',method:'USAGE',unitPrice:2,payerType:'INSTITUTION',trigger:'API_USAGE_RECORDED'},{feeCode:'REPORTING_USAGE',method:'FIXED',amount:75,payerType:'INSTITUTION',trigger:'REPORTING_USAGE_RECORDED'}]}).expect(201);
  await request(app).post(`/api/economics/schedules/${schedule.body.scheduleId}/activate`).set(actor).send({}).expect(200);
  const profile=await request(app).post('/api/institution-billing/profiles').set(actor).send({institutionId:'INST-20',institutionName:'Institution Twenty',billingEmail:'billing@example.com',billingCycle:'MONTHLY',paymentTermsDays:30,feeScheduleId:schedule.body.scheduleId}).expect(201);
  return profile.body;
}

test('institutional billing aggregates usage, creates charges, invoice, and ledger posting',async()=>{
  const {app,accessService}=await createApp({serveStatic:false,seedMarketplace:false});
  const admin=await billingAdmin(accessService);
  Object.assign(actor,admin);
  const profile=await setup(app);
  await request(app).post('/api/institution-billing/usage').set(actor).send({institutionId:'INST-20',metric:'API_USAGE',units:10,occurredAt:'2026-08-05T10:00:00.000Z'}).expect(201);
  await request(app).post('/api/institution-billing/usage').set(actor).send({institutionId:'INST-20',metric:'API_USAGE',units:5,occurredAt:'2026-08-10T10:00:00.000Z'}).expect(201);
  await request(app).post('/api/institution-billing/usage').set(actor).send({institutionId:'INST-20',metric:'REPORTING_USAGE',units:1,occurredAt:'2026-08-12T10:00:00.000Z'}).expect(201);
  const run=await request(app).post('/api/institution-billing/runs').set(actor).send({profileId:profile.profileId,periodStart:'2026-08-01T00:00:00.000Z',periodEnd:'2026-08-31T23:59:59.999Z'}).expect(201);
  assert.equal(run.body.state,'INVOICED');
  assert.equal(run.body.total,105);
  assert.ok(run.body.invoiceId);
  const entries=await request(app).get(`/api/ledger/entries?referenceId=${run.body.invoiceId}`).set(actor).expect(200);
  assert.equal(entries.body.entries.length,1);
  assert.equal(entries.body.entries[0].totalDebits,105);
  assert.equal(entries.body.entries[0].totalCredits,105);
});

test('institutional billing ignores usage outside the billing period',async()=>{
  const {app,accessService}=await createApp({serveStatic:false,seedMarketplace:false});
  const admin=await billingAdmin(accessService);
  Object.assign(actor,admin);
  const profile=await setup(app);
  await request(app).post('/api/institution-billing/usage').set(actor).send({institutionId:'INST-20',metric:'API_USAGE',units:20,occurredAt:'2026-07-20T10:00:00.000Z'}).expect(201);
  const run=await request(app).post('/api/institution-billing/runs').set(actor).send({profileId:profile.profileId,periodStart:'2026-08-01T00:00:00.000Z',periodEnd:'2026-08-31T23:59:59.999Z'}).expect(201);
  assert.equal(run.body.state,'NO_CHARGES');
  assert.equal(run.body.total,0);
});

test('institutional billing retries reuse the existing run and reject overlapping periods',async()=>{
  const {app,accessService}=await createApp({serveStatic:false,seedMarketplace:false});
  Object.assign(actor,await billingAdmin(accessService));
  const profile=await setup(app);
  await request(app).post('/api/institution-billing/usage').set(actor).send({institutionId:'INST-20',metric:'API_USAGE',units:10,occurredAt:'2026-08-05T10:00:00.000Z'}).expect(201);
  const input={profileId:profile.profileId,periodStart:'2026-08-01T00:00:00.000Z',periodEnd:'2026-08-31T23:59:59.999Z'};
  const first=await request(app).post('/api/institution-billing/runs').set(actor).send(input).expect(201);
  const retry=await request(app).post('/api/institution-billing/runs').set(actor).send(input).expect(201);
  assert.equal(retry.body.billingRunId,first.body.billingRunId);
  const invoices=await request(app).get('/api/economics/invoices').set(actor).expect(200);
  assert.equal(invoices.body.invoices.length,1);
  await request(app).post('/api/institution-billing/runs').set(actor).send({...input,periodEnd:'2026-09-01T23:59:59.999Z'}).expect(400);
});
