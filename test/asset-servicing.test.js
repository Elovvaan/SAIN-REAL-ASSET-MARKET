import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';

const actor={'x-sra-actor-id':'SERVICING-ADMIN'};

async function setup(app){
  const account=await request(app).post('/api/servicing/accounts').set(actor).send({assetAccountId:'A-1042',ownerId:'OWNER-21',nextReviewDate:'2027-08-01',insuranceRequired:true,taxMonitoringRequired:true,inspectionFrequencyMonths:12}).expect(201);
  return account.body;
}

test('asset servicing tracks obligations, events, and account summary',async()=>{
  const {app}=await createApp({serveStatic:false});
  const account=await setup(app);
  const insurance=await request(app).post('/api/servicing/obligations').set(actor).send({servicingAccountId:account.servicingAccountId,type:'INSURANCE',description:'Annual property insurance evidence',dueDate:'2026-09-01'}).expect(201);
  const tax=await request(app).post('/api/servicing/obligations').set(actor).send({servicingAccountId:account.servicingAccountId,type:'TAX',description:'Property tax payment',amount:4200,dueDate:'2026-11-30'}).expect(201);
  await request(app).post(`/api/servicing/obligations/${insurance.body.obligationId}/transition`).set(actor).send({state:'PAID',paymentReference:'INS-POLICY-21',evidenceReference:'DOC-INS-21'}).expect(200);
  await request(app).post(`/api/servicing/obligations/${tax.body.obligationId}/transition`).set(actor).send({state:'PAST_DUE',reason:'Payment evidence not received'}).expect(200);
  await request(app).post('/api/servicing/events').set(actor).send({servicingAccountId:account.servicingAccountId,type:'PAYMENT',amount:1800,referenceType:'ASSET_PAYMENT',referenceId:'PAY-21'}).expect(201);
  await request(app).post('/api/servicing/events').set(actor).send({servicingAccountId:account.servicingAccountId,type:'INSPECTION',status:'COMPLETED',evidenceReference:'INSPECTION-REPORT-21'}).expect(201);
  const summary=await request(app).get(`/api/servicing/accounts/${account.servicingAccountId}/summary`).expect(200);
  assert.equal(summary.body.obligations.total,2);
  assert.equal(summary.body.obligations.paid,1);
  assert.equal(summary.body.obligations.pastDue,1);
  assert.equal(summary.body.events.totalPayments,1800);
  assert.equal(summary.body.events.inspections,1);
});

test('paid obligations require a payment reference and account states are controlled',async()=>{
  const {app}=await createApp({serveStatic:false});
  const account=await setup(app);
  const obligation=await request(app).post('/api/servicing/obligations').send({servicingAccountId:account.servicingAccountId,type:'MAINTENANCE',description:'Roof maintenance',dueDate:'2026-12-01'}).expect(201);
  await request(app).post(`/api/servicing/obligations/${obligation.body.obligationId}/transition`).send({state:'PAID'}).expect(400);
  const watch=await request(app).post(`/api/servicing/accounts/${account.servicingAccountId}/transition`).send({state:'WATCH',reason:'Past due tax obligation'}).expect(200);
  assert.equal(watch.body.state,'WATCH');
  await request(app).post(`/api/servicing/accounts/${account.servicingAccountId}/transition`).send({state:'UNKNOWN'}).expect(400);
});
