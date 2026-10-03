import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';
import { billingAdmin } from './helpers/billing-admin.js';
import { RECORD_TYPES as T } from '../services/persistent-domain-service.js';

async function fixture() {
  const context=await createApp({serveStatic:false,seedMarketplace:false});
  const admin=await billingAdmin(context.accessService);
  await request(context.app).post('/api/economics/agent-schedule').set(admin).send({}).expect(200);
  await context.persistentDomain.put(T.SRA_AGENT_WORK_ORDER,'WORK-BILL',{workOrderId:'WORK-BILL',agentId:'SRA-COIN-AGENT',state:'ACCEPTED',serviceFeePayerId:'BUYER'});
  const charge=await request(context.app).post('/api/economics/charges').set(admin).send({scheduleId:'SRA-AGENT-SERVICE-FEES-2026-08-21',trigger:'AGENT_WORK_ACCEPTED',subjectType:'SRA_AGENT_WORK_ORDER',subjectId:'WORK-BILL',payerId:'BUYER',payerType:'PARTICIPANT',context:{agentId:'SRA-COIN-AGENT'}}).expect(201);
  const invoice=await request(context.app).post('/api/economics/invoices').set(admin).send({payerId:'BUYER',payerType:'PARTICIPANT',chargeIds:[charge.body.chargeId],dueDate:'2026-11-01'}).expect(201);
  return {...context,admin,charge:charge.body,invoice:invoice.body};
}
const payment=(amount,externalReference='PAY-ONE')=>({amount,currency:'USD',externalReference,evidenceReference:'BANK-STATEMENT-2026-10',cashAccountId:'GL-CASH-OPERATING'});

test('billing records and financial mutations require real administrator sessions',async()=>{
  const {app,accessService}=await createApp({serveStatic:false,seedMarketplace:false});
  await request(app).get('/api/economics/report').set('x-sra-actor-id','PLATFORM_ADMIN').expect(401);
  await request(app).post('/api/economics/catalog').set('x-sra-actor-id','PLATFORM_ADMIN').send({}).expect(401);
  await request(app).get('/api/institution-billing/profiles').expect(401);
  const user=await accessService.signup({displayName:'User',email:'billing-user@example.test',password:'Test12345!'});
  await request(app).get('/api/economics/report').set('Cookie',`sra_session=${user.token}`).expect(403);
});

test('partial and final receipts reconcile collections and persist across restart; retry does not duplicate',async()=>{
  const {app,admin,invoice,database,persistentDomain}=await fixture();
  await persistentDomain.put(T.SRA_AGENT_COMPENSATION_RECORD,'COMP-BILL',{compensationId:'COMP-BILL',workOrderId:'WORK-BILL',amount:16.5,currency:'USD',state:'EARNED'});
  const path=`/api/economics/invoices/${invoice.invoiceId}/payments`;
  const first=await request(app).post(path).set(admin).send(payment(5)).expect(200);
  assert.equal(first.body.invoice.state,'PARTIALLY_PAID');
  await request(app).post(path).set(admin).send(payment(99,'OVERPAY')).expect(400);
  const retry=await request(app).post(path).set(admin).send(payment(5)).expect(200);
  assert.equal(retry.body.reused,true);
  await request(app).post(path).set(admin).send(payment(11.5,'PAY-TWO')).expect(200);
  const restarted=await createApp({database,serveStatic:false,seedMarketplace:false});
  const report=await request(restarted.app).get('/api/economics/report').set(admin).expect(200);
  assert.equal(report.body.invoices.length,1);
  assert.equal(report.body.charges[0].state,'PAID');
  assert.equal(report.body.totals[0].invoicedGross,16.5);
  assert.equal(report.body.totals[0].collected,16.5);
  assert.equal(report.body.totals[0].outstanding,0);
  assert.equal(report.body.totals[0].compensationAccrued,16.5);
  assert.equal(report.body.payments.length,2);
  assert.equal(report.body.serviceRates.find(rate=>rate.agentId==='SRA-COIN-AGENT').acceptedWorkCount,1);
  assert.equal(report.body.fundingTarget,5000000);
});

test('invoice validation prevents duplicate charges, currency mismatch, and draft billing',async()=>{
  const {app,admin,charge}=await fixture();
  await request(app).post('/api/economics/invoices').set(admin).send({payerId:'BUYER',payerType:'PARTICIPANT',chargeIds:[charge.chargeId,charge.chargeId],dueDate:'2026-11-01'}).expect(400);
  await request(app).post('/api/economics/invoices').set(admin).send({payerId:'BUYER',payerType:'PARTICIPANT',chargeIds:[charge.chargeId],dueDate:'2026-11-01'}).expect(400);
  const draft=await request(app).post('/api/economics/schedules').set(admin).send({name:'Unapproved draft',version:'1',effectiveFrom:'2026-08-01T00:00:00.000Z',rules:[{feeCode:'SRA-SERVICE-COIN-OPS',method:'FIXED',amount:16.5,payerType:'PARTICIPANT',trigger:'TEST'}]}).expect(201);
  await request(app).post('/api/economics/calculate').set(admin).send({scheduleId:draft.body.scheduleId,trigger:'TEST'}).expect(400);
  await request(app).post('/api/economics/calculate').set(admin).send({scheduleId:'MISSING-SCHEDULE',trigger:'TEST'}).expect(404);
});

test('payment recording requires evidence and forbids changing a previously used receipt',async()=>{
  const {app,admin,invoice}=await fixture();
  const path=`/api/economics/invoices/${invoice.invoiceId}/payments`;
  await request(app).post(path).set(admin).send({...payment(5),evidenceReference:''}).expect(400);
  await request(app).post(path).set(admin).send({...payment(5),currency:'EUR'}).expect(400);
  await request(app).post(path).set(admin).send(payment(5)).expect(200);
  await request(app).post(path).set(admin).send(payment(6)).expect(400);
});

test('capability fees hydrate after restart and use the same receipt and journal workflow',async()=>{
  const {app,admin,database,accessService}=await fixture();
  await request(app).post('/api/economics/catalog').set(admin).send({feeCode:'PROVIDER-ACTIVATION',name:'Provider activation',category:'CAPABILITY',defaultPayerType:'PARTICIPANT'}).expect(201);
  const schedule=await request(app).post('/api/economics/schedules').set(admin).send({name:'Capability test schedule',version:'1',effectiveFrom:'2026-08-01T00:00:00.000Z',rules:[{feeCode:'PROVIDER-ACTIVATION',method:'FIXED',amount:16.5,payerType:'PARTICIPANT',trigger:'ASSET_PROVIDER_CAPABILITY_ACTIVATION'}]}).expect(201);
  await request(app).post(`/api/economics/schedules/${schedule.body.scheduleId}/activate`).set(admin).send({}).expect(200);
  const user=await accessService.signup({displayName:'Provider',email:'provider-billing@example.test',password:'ProviderTest123!'});
  const restarted=await createApp({database,serveStatic:false,seedMarketplace:false});
  const cookie={Cookie:`sra_session=${user.token}`};
  const applied=await request(restarted.app).post('/api/access/capacity-upgrade/apply').set(cookie).send({capacity:'ASSET_PROVIDER'}).expect(202);
  assert.equal(applied.body.invoice.total,16.5);
  const instruction=await request(restarted.app).post('/api/access/capacity-upgrade/payment/ASSET_PROVIDER').set(cookie).send({}).expect(201);
  const confirmed=await request(restarted.app).post('/api/access/capacity-upgrade/admin-confirm-payment').set(admin).send({fundingInstructionId:instruction.body.paymentInstruction.fundingInstructionId,externalReference:'PROVIDER-RECEIPT'}).expect(200);
  assert.equal(confirmed.body.invoice.state,'PAID');
  const report=await request(restarted.app).get('/api/economics/report').set(admin).expect(200);
  assert.equal(report.body.totals[0].collected,16.5);
  assert.equal(report.body.payments[0].receiptBacked,true);
});

test('hydration preserves multiple work orders, compensation records, and receipts sharing related IDs',async()=>{
  const {database}=await createApp({serveStatic:false,seedMarketplace:false});
  for(const suffix of ['ONE','TWO']){
    await database.putRecord(T.SRA_AGENT_WORK_ORDER,`WORK-${suffix}`,{workOrderId:`WORK-${suffix}`,agentId:'SAME-AGENT',state:'ACCEPTED'});
    await database.putRecord(T.SRA_AGENT_COMPENSATION_RECORD,`COMP-${suffix}`,{compensationId:`COMP-${suffix}`,workOrderId:`WORK-${suffix}`,agentId:'SAME-AGENT',amount:1,state:'EARNED'});
    await database.putRecord(T.PAYMENT_RECEIPT,`RCPT-${suffix}`,{paymentReceiptId:`RCPT-${suffix}`,fundingInstructionId:'SAME-INSTRUCTION',invoiceId:'SAME-INVOICE',state:'RECORDED'});
  }
  const {persistentDomain}=await createApp({database,serveStatic:false,seedMarketplace:false});
  await persistentDomain.hydrate([T.SRA_AGENT_WORK_ORDER,T.SRA_AGENT_COMPENSATION_RECORD,T.PAYMENT_RECEIPT]);
  await persistentDomain.loadTypes([T.SRA_AGENT_WORK_ORDER,T.SRA_AGENT_COMPENSATION_RECORD,T.PAYMENT_RECEIPT]);
  for(const type of [T.SRA_AGENT_WORK_ORDER,T.SRA_AGENT_COMPENSATION_RECORD,T.PAYMENT_RECEIPT])assert.equal(persistentDomain.list(type).length,2);
  assert.equal(persistentDomain.get(T.SRA_AGENT_WORK_ORDER,'WORK-ONE').workOrderId,'WORK-ONE');
  assert.equal(persistentDomain.get(T.PAYMENT_RECEIPT,'RCPT-TWO').paymentReceiptId,'RCPT-TWO');
});

test('payment journals without matching receipts are flagged and excluded from collections',async()=>{
  const {app,admin,invoice,persistentDomain}=await fixture();
  await persistentDomain.put(T.LEDGER_ENTRY,'JE-UNMATCHED',{entryId:'JE-UNMATCHED',referenceType:'FEE_INVOICE',referenceId:invoice.invoiceId,eventType:'FEE_INVOICE_PAYMENT_RECEIVED',currency:'USD',state:'POSTED',postedAt:'2026-10-03T00:00:00.000Z',lines:[{accountId:'GL-CASH-OPERATING',debit:5,credit:0},{accountId:'GL-AR',credit:5,debit:0}]});
  const report=await request(app).get('/api/economics/report').set(admin).expect(200);
  assert.equal(report.body.totals[0].collected,0);
  assert.equal(report.body.totals[0].unmatchedPaymentJournals,5);
  assert.equal(report.body.payments[0].receiptBacked,false);
});

test('saved revenue scenarios use established prices and keep unentered volumes and repayment capacity unset',async()=>{
  const {app,admin,database}=await fixture();
  const saved=await request(app).post('/api/economics/revenue-models').set(admin).send({name:'Owner revenue scenario',period:'2026-11',workCounts:{'SRA-COIN-AGENT':2}}).expect(201);
  assert.equal(saved.body.grossCharges,33);
  assert.equal(saved.body.coverage,'PARTIAL_SERVICE_COUNTS');
  assert.equal(saved.body.repaymentCapacity,null);
  assert.equal(saved.body.lines.find(line=>line.agentId==='SRA-LISTING-AGENT').units,null);
  const restarted=await createApp({database,serveStatic:false,seedMarketplace:false});
  const report=await request(restarted.app).get('/api/economics/report').set(admin).expect(200);
  assert.equal(report.body.models[0].modelId,saved.body.modelId);
  assert.equal(report.body.totals[0].collected,0);
  await request(app).post('/api/economics/revenue-models').set(admin).send({name:'Invalid volume',period:'2026-11',workCounts:{'SRA-COIN-AGENT':1.5}}).expect(400);
});
