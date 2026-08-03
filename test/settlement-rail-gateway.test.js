import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';

const actor={'x-sra-actor-id':'SRA-RAIL-OPERATOR'};

async function createLockedSettlement(app){
  const project=await request(app).post('/api/financing/home-projects').set(actor).send({customerId:'CUSTOMER-RAIL-001',title:'Rail Test Home',property:{address:'616 Rail Avenue, Ogden, Utah',propertyType:'RESIDENTIAL'},purchasePrice:300000,verifiedBuyerFunds:50000}).expect(201);
  const homeProjectId=project.body.homeProjectId;
  await request(app).post(`/api/financing/home-projects/${homeProjectId}/transition`).set(actor).send({state:'DATA_COLLECTION'}).expect(200);
  await request(app).put(`/api/financing/home-projects/${homeProjectId}`).set(actor).send({snapshotId:'EDX-SNAPSHOT-RAIL',valuePackageId:'EDX-VVP-RAIL'}).expect(200);
  await request(app).post(`/api/financing/home-projects/${homeProjectId}/transition`).set(actor).send({state:'PACKAGE_READY'}).expect(200);
  const plan=await request(app).post('/api/financing/funding-plans').set(actor).send({homeProjectId,settlementInstructionsReference:'SETTLEMENT-INSTRUCTIONS-RAIL',sources:[{type:'BUYER_FUNDS',amount:50000,status:'VERIFIED'},{type:'PARTICIPATION_CAPITAL',providerId:'INSTITUTION-RAIL',amount:250000,status:'COMMITTED'}]}).expect(201);
  const fundingPlanId=plan.body.fundingPlanId;
  await request(app).post(`/api/financing/funding-plans/${fundingPlanId}/transition`).set(actor).send({state:'READY_FOR_REVIEW'}).expect(200);
  await request(app).post(`/api/financing/funding-plans/${fundingPlanId}/transition`).set(actor).send({state:'CUSTOMER_APPROVED',customerApprovalReference:'CUSTOMER-APPROVAL-RAIL'}).expect(200);
  await request(app).post(`/api/financing/funding-plans/${fundingPlanId}/transition`).set(actor).send({state:'COMMITTED'}).expect(200);
  await request(app).post(`/api/financing/funding-plans/${fundingPlanId}/transition`).set(actor).send({state:'SETTLEMENT_READY'}).expect(200);
  await request(app).post(`/api/financing/home-projects/${homeProjectId}/transition`).set(actor).send({state:'SETTLEMENT_READY'}).expect(200);
  const settlement=await request(app).post('/api/settlement/settlements/prepare').set(actor).send({homeProjectId}).expect(201);
  await request(app).post(`/api/settlement/settlements/${settlement.body.settlementId}/lock`).set(actor).send({}).expect(200);
  return settlement.body.settlementId;
}

test('SRA creates, dispatches, executes, and reconciles a wire instruction against a locked settlement',async()=>{
  const {app}=await createApp({serveStatic:false,seedMarketplace:false});
  const settlementId=await createLockedSettlement(app);
  const adapter=await request(app).post('/api/settlement-rails/adapters').set(actor).send({institutionId:'INSTITUTION-RAIL',institutionName:'Rail Institution',rail:'WIRE',endpointReference:'BANK-WIRE-ENDPOINT-001',messageStandard:'ISO_20022_COMPATIBLE',senderAccountReference:'SENDER-ACCOUNT-001',permittedReceivingAccountReferences:['ESCROW-ACCOUNT-001']}).expect(201);
  const instruction=await request(app).post('/api/settlement-rails/instructions').set(actor).send({settlementId,adapterId:adapter.body.adapterId,amount:300000,receivingInstitutionReference:'TITLE-ESCROW-BANK',receivingAccountReference:'ESCROW-ACCOUNT-001',settlementInstrumentReference:'SRA-INSTRUMENT-001'}).expect(201);
  assert.equal(instruction.body.state,'READY');
  assert.equal(instruction.body.rail,'WIRE');
  assert.equal(typeof instruction.body.messageHash,'string');
  await request(app).post(`/api/settlement-rails/instructions/${instruction.body.instructionId}/transition`).set(actor).send({state:'DISPATCHED'}).expect(200);
  await request(app).post(`/api/settlement-rails/instructions/${instruction.body.instructionId}/transition`).set(actor).send({state:'ACCEPTED',institutionTransactionReference:'BANK-TXN-001'}).expect(200);
  await request(app).post(`/api/settlement-rails/instructions/${instruction.body.instructionId}/transition`).set(actor).send({state:'EXECUTED',institutionTransactionReference:'BANK-TXN-001',networkReference:'WIRE-NETWORK-001'}).expect(200);
  const reconciled=await request(app).post(`/api/settlement-rails/instructions/${instruction.body.instructionId}/transition`).set(actor).send({state:'RECONCILED',institutionTransactionReference:'BANK-TXN-001',networkReference:'WIRE-NETWORK-001',receivingConfirmationReference:'ESCROW-CONFIRM-001',confirmedAmount:300000}).expect(200);
  assert.equal(reconciled.body.state,'RECONCILED');
  const status=await request(app).get(`/api/settlement-rails/settlements/${settlementId}/status`).expect(200);
  assert.equal(status.body.allExecuted,true);
  assert.equal(status.body.allReconciled,true);
  assert.equal(status.body.remainingToReconcile,0);
});

test('gateway blocks over-allocation and requires execution evidence',async()=>{
  const {app}=await createApp({serveStatic:false,seedMarketplace:false});
  const settlementId=await createLockedSettlement(app);
  const adapter=await request(app).post('/api/settlement-rails/adapters').send({institutionId:'INSTITUTION-RAIL',rail:'FEDWIRE',endpointReference:'FEDWIRE-ADAPTER-001',senderAccountReference:'MASTER-ACCOUNT-REF',permittedReceivingAccountReferences:['ESCROW-ACCOUNT-002']}).expect(201);
  const blocked=await request(app).post('/api/settlement-rails/instructions').send({settlementId,adapterId:adapter.body.adapterId,amount:300001,receivingInstitutionReference:'RECEIVING-BANK',receivingAccountReference:'ESCROW-ACCOUNT-002'}).expect(400);
  assert.match(blocked.body.error,/exceeds/i);
  const instruction=await request(app).post('/api/settlement-rails/instructions').send({settlementId,adapterId:adapter.body.adapterId,amount:300000,receivingInstitutionReference:'RECEIVING-BANK',receivingAccountReference:'ESCROW-ACCOUNT-002'}).expect(201);
  await request(app).post(`/api/settlement-rails/instructions/${instruction.body.instructionId}/transition`).send({state:'DISPATCHED'}).expect(200);
  const missingEvidence=await request(app).post(`/api/settlement-rails/instructions/${instruction.body.instructionId}/transition`).send({state:'ACCEPTED'}).expect(400);
  assert.match(missingEvidence.body.error,/institutionTransactionReference/i);
});
