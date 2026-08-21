import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { BankAchOriginationService } from '../services/bank-ach-origination-service.js';
import { createSettlementRailGatewayRouter } from '../routes/settlement-rail-gateway-router.js';

test('Increase ACH submission maps the prepared SRA instruction to the bank API and returns its transfer id', async () => {
  let captured=null;
  const fetchImpl=async(url,options)=>{
    captured={url,options};
    return {ok:true,status:200,json:async()=>({id:'ach_transfer_real_123',status:'pending_submission',created_at:'2026-08-21T00:00:00Z'})};
  };
  const service=new BankAchOriginationService({fetchImpl,provider:'INCREASE',apiKey:'test-key',accountId:'account_sender_1',baseUrl:'https://sandbox.increase.com',companyName:'SRA'});
  const result=await service.submit({
    instructionId:'SRA-RAIL-1',rail:'ACH',state:'READY',amount:79456.17,
    receivingAccountReference:'1234567890',routingNumber:'071000013',accountType:'CHECKING',
    beneficiaryName:'House Morris Trust',remittanceReference:'EXP-1',
  });
  assert.equal(captured.url,'https://sandbox.increase.com/ach_transfers');
  assert.equal(captured.options.headers.Authorization,'Bearer test-key');
  assert.equal(captured.options.headers['Idempotency-Key'],'sra-SRA-RAIL-1');
  const body=JSON.parse(captured.options.body);
  assert.equal(body.account_id,'account_sender_1');
  assert.equal(body.account_number,'1234567890');
  assert.equal(body.routing_number,'071000013');
  assert.equal(body.amount,7945617);
  assert.equal(body.require_approval,false);
  assert.equal(result.institutionTransactionReference,'ach_transfer_real_123');
});

class GatewayStub{
  constructor(){this.instruction={instructionId:'SRA-RAIL-1',rail:'ACH',state:'READY',amount:10,receivingAccountReference:'1234',routingNumber:'071000013',accountType:'CHECKING'};this.transitions=[];}
  supportedRails(){return[];}
  listAdapters(){return[];}
  listInstructions(){return[this.instruction];}
  getInstruction(){return this.instruction;}
  async transitionInstruction(_id,state,input){this.transitions.push({state,input});this.instruction={...this.instruction,state,institutionTransactionReference:input.institutionTransactionReference||this.instruction.institutionTransactionReference,networkReference:input.networkReference||this.instruction.networkReference};return this.instruction;}
  settlementRailStatus(){return{};}
}

function appFor(gateway,originator){const app=express();app.use(express.json());app.use('/api/settlement-rails',createSettlementRailGatewayRouter(gateway,originator));return app;}

test('manual DISPATCHED request cannot advance ACH until the bank API returns success', async () => {
  const gateway=new GatewayStub();
  const originator={status:()=>({configured:true}),submit:async()=>{throw new Error('bank unavailable');}};
  const response=await request(appFor(gateway,originator)).post('/api/settlement-rails/instructions/SRA-RAIL-1/transition').send({state:'DISPATCHED'});
  assert.equal(response.status,400);
  assert.equal(gateway.instruction.state,'READY');
  assert.equal(gateway.transitions.length,0);
});

test('successful ACH bank API response automatically stores the bank reference and advances through institution acceptance', async () => {
  const gateway=new GatewayStub();
  const originator={status:()=>({configured:true}),submit:async()=>({provider:'INCREASE',providerStatus:'pending_submission',institutionTransactionReference:'ach_transfer_real_456',networkReference:null,submittedAt:'2026-08-21T00:00:00Z'})};
  const response=await request(appFor(gateway,originator)).post('/api/settlement-rails/instructions/SRA-RAIL-1/transition').send({state:'DISPATCHED'});
  assert.equal(response.status,200);
  assert.equal(gateway.instruction.state,'ACCEPTED');
  assert.equal(gateway.instruction.institutionTransactionReference,'ach_transfer_real_456');
  assert.deepEqual(gateway.transitions.map((item)=>item.state),['DISPATCHED','ACCEPTED']);
  assert.equal(response.body.bankApi.institutionTransactionReference,'ach_transfer_real_456');
});
