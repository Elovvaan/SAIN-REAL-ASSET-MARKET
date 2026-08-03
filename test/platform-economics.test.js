import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';

const actor={'x-sra-actor-id':'ECONOMICS-ADMIN'};

async function setup(app){
  const items=[
    {feeCode:'SETTLEMENT_PROCESSING',name:'Settlement Processing',category:'SETTLEMENT',defaultPayerType:'CUSTOMER'},
    {feeCode:'TREASURY_EXECUTION',name:'Treasury Execution',category:'TREASURY',defaultPayerType:'CUSTOMER'},
    {feeCode:'INSTITUTION_PARTICIPATION',name:'Institution Participation Administration',category:'MARKETPLACE',defaultPayerType:'INSTITUTION'}
  ];
  for(const item of items)await request(app).post('/api/economics/catalog').set(actor).send(item).expect(201);
  const schedule=await request(app).post('/api/economics/schedules').set(actor).send({
    name:'SRA Core Fee Schedule',version:'1.0.0',effectiveFrom:'2026-08-01T00:00:00.000Z',rules:[
      {feeCode:'SETTLEMENT_PROCESSING',method:'PERCENTAGE',rate:0.0025,minimum:250,maximum:2500,payerType:'CUSTOMER',trigger:'SETTLEMENT_PREPARED'},
      {feeCode:'TREASURY_EXECUTION',method:'FIXED',amount:35,payerType:'CUSTOMER',trigger:'TREASURY_PAYMENT_SUBMITTED'},
      {feeCode:'INSTITUTION_PARTICIPATION',method:'PERCENTAGE',rate:0.001,payerType:'INSTITUTION',trigger:'PARTICIPATION_COMMITTED',conditions:{participantType:'INSTITUTION'}}
    ]
  }).expect(201);
  await request(app).post(`/api/economics/schedules/${schedule.body.scheduleId}/activate`).set(actor).send({}).expect(200);
  return schedule.body.scheduleId;
}

test('fee engine calculates fixed, percentage, limits, conditions, charges, and invoices',async()=>{
  const {app}=await createApp({serveStatic:false,seedMarketplace:false});
  await setup(app);
  const calc=await request(app).post('/api/economics/calculate').send({trigger:'SETTLEMENT_PREPARED',context:{baseAmount:400000}}).expect(200);
  assert.equal(calc.body.total,1000);
  assert.equal(calc.body.lines[0].feeCode,'SETTLEMENT_PROCESSING');

  const charge=await request(app).post('/api/economics/charges').set(actor).send({subjectType:'SRA_SETTLEMENT',subjectId:'STL-18',payerId:'CUSTOMER-18',payerType:'CUSTOMER',trigger:'SETTLEMENT_PREPARED',context:{baseAmount:400000}}).expect(201);
  assert.equal(charge.body.state,'ASSESSED');
  assert.equal(charge.body.total,1000);

  const invoice=await request(app).post('/api/economics/invoices').set(actor).send({payerId:'CUSTOMER-18',payerType:'CUSTOMER',chargeIds:[charge.body.chargeId],dueDate:'2026-09-01'}).expect(201);
  assert.equal(invoice.body.total,1000);
  const updated=await request(app).get(`/api/economics/charges/${charge.body.chargeId}`).expect(200);
  assert.equal(updated.body.state,'INVOICED');
});

test('fee engine enforces conditional rules and supports documented waivers',async()=>{
  const {app}=await createApp({serveStatic:false,seedMarketplace:false});
  await setup(app);
  const noMatch=await request(app).post('/api/economics/calculate').send({trigger:'PARTICIPATION_COMMITTED',context:{baseAmount:100000,participantType:'CUSTOMER'}}).expect(200);
  assert.equal(noMatch.body.total,0);
  const match=await request(app).post('/api/economics/charges').send({subjectType:'HOME_PARTICIPATION_COMMITMENT',subjectId:'HPC-18',payerId:'INSTITUTION-18',payerType:'INSTITUTION',trigger:'PARTICIPATION_COMMITTED',context:{baseAmount:100000,participantType:'INSTITUTION'}}).expect(201);
  assert.equal(match.body.total,100);
  const waived=await request(app).post(`/api/economics/charges/${match.body.chargeId}/waive`).set(actor).send({reason:'Pilot institution launch waiver'}).expect(200);
  assert.equal(waived.body.state,'WAIVED');
  assert.equal(waived.body.waiverReason,'Pilot institution launch waiver');
});
