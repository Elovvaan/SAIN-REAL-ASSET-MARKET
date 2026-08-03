import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';

async function setup(app){
  const actor={'x-sra-actor-id':'TREASURY-TEST'};
  const project=await request(app).post('/api/financing/home-projects').set(actor).send({customerId:'C-17',property:{address:'717 Treasury Way'},purchasePrice:100000,verifiedBuyerFunds:100000}).expect(201);
  const id=project.body.homeProjectId;
  await request(app).post(`/api/financing/home-projects/${id}/transition`).set(actor).send({state:'DATA_COLLECTION'}).expect(200);
  await request(app).put(`/api/financing/home-projects/${id}`).set(actor).send({snapshotId:'VS17',valuePackageId:'VVP17'}).expect(200);
  await request(app).post(`/api/financing/home-projects/${id}/transition`).set(actor).send({state:'PACKAGE_READY'}).expect(200);
  const plan=await request(app).post('/api/financing/funding-plans').set(actor).send({homeProjectId:id,settlementInstructionsReference:'SI17',sources:[{type:'BUYER_FUNDS',amount:100000}]}).expect(201);
  for(const [state,body] of [['READY_FOR_REVIEW',{}],['CUSTOMER_APPROVED',{customerApprovalReference:'CA17'}],['COMMITTED',{}],['SETTLEMENT_READY',{}]]) await request(app).post(`/api/financing/funding-plans/${plan.body.fundingPlanId}/transition`).set(actor).send({state,...body}).expect(200);
  await request(app).post(`/api/financing/home-projects/${id}/transition`).set(actor).send({state:'SETTLEMENT_READY'}).expect(200);
  const settlement=await request(app).post('/api/settlement/settlements/prepare').set(actor).send({homeProjectId:id}).expect(201);
  const adapter=await request(app).post('/api/settlement-rails/adapters').set(actor).send({institutionId:'BANK17',rail:'WIRE',endpointReference:'WIRE17',senderAccountReference:'ORIG17',permittedReceivingAccountReferences:['BENACCT17']}).expect(201);
  const instruction=await request(app).post('/api/settlement-rails/instructions').set(actor).send({settlementId:settlement.body.settlementId,adapterId:adapter.body.adapterId,amount:100000,receivingInstitutionReference:'RECBANK17',receivingAccountReference:'BENACCT17'}).expect(201);
  return {instruction};
}

test('treasury connector approves, submits, receives bank status, and reconciles',async()=>{
  const {app}=await createApp({serveStatic:false,seedMarketplace:false});
  const {instruction}=await setup(app);
  const connection=await request(app).post('/api/treasury/connections').send({institutionId:'BANK17',bankCustomerReference:'CUSTOMER17',apiProfile:'HOST_TO_HOST',authenticationProfileReference:'AUTH17',submissionEndpointReference:'SUB17',statusEndpointReference:'STATUS17',statementEndpointReference:'STMT17',authorizedOriginatingAccounts:['ORIG17'],approvedBeneficiaries:['BEN17'],singlePaymentLimit:200000,dailyPaymentLimit:500000,approvalThreshold:50000,requiredApprovals:1}).expect(201);
  const order=await request(app).post('/api/treasury/payments').send({connectionId:connection.body.connectionId,railInstructionId:instruction.body.instructionId,originatingAccountReference:'ORIG17',beneficiaryReference:'BEN17'}).expect(201);
  assert.equal(order.body.state,'PENDING_APPROVAL');
  await request(app).post(`/api/treasury/payments/${order.body.paymentOrderId}/approve`).send({approverId:'APPROVER17',approvalReference:'APPROVAL17'}).expect(200);
  await request(app).post(`/api/treasury/payments/${order.body.paymentOrderId}/submit`).send({bankSubmissionReference:'SUBMISSION17'}).expect(200);
  await request(app).post(`/api/treasury/payments/${order.body.paymentOrderId}/status`).send({state:'ACCEPTED',bankTransactionReference:'BANKTX17'}).expect(200);
  await request(app).post(`/api/treasury/payments/${order.body.paymentOrderId}/status`).send({state:'EXECUTED',bankTransactionReference:'BANKTX17',networkReference:'NET17'}).expect(200);
  const reconciled=await request(app).post(`/api/treasury/payments/${order.body.paymentOrderId}/status`).send({state:'RECONCILED',bankTransactionReference:'BANKTX17',networkReference:'NET17',receivingConfirmationReference:'RCV17',confirmedAmount:100000}).expect(200);
  assert.equal(reconciled.body.state,'RECONCILED');
  const statement=await request(app).post('/api/treasury/statements').send({connectionId:connection.body.connectionId,accountReference:'ORIG17',statementDate:'2026-08-03',openingBalance:200000,closingBalance:100000,sourceReference:'BANK-STMT17',entries:[{reference:'BANKTX17',amount:-100000}]}).expect(201);
  assert.equal(typeof statement.body.statementHash,'string');
});

test('treasury connector blocks unauthorized origin account',async()=>{
  const {app}=await createApp({serveStatic:false,seedMarketplace:false});
  const {instruction}=await setup(app);
  const connection=await request(app).post('/api/treasury/connections').send({institutionId:'BANK17',bankCustomerReference:'CUSTOMER17',apiProfile:'API',authenticationProfileReference:'AUTH',submissionEndpointReference:'SUB',statusEndpointReference:'STATUS',authorizedOriginatingAccounts:['RIGHT'],approvedBeneficiaries:['BEN'],requiredApprovals:1}).expect(201);
  const blocked=await request(app).post('/api/treasury/payments').send({connectionId:connection.body.connectionId,railInstructionId:instruction.body.instructionId,originatingAccountReference:'WRONG',beneficiaryReference:'BEN'}).expect(400);
  assert.match(blocked.body.error,/not authorized/i);
});
