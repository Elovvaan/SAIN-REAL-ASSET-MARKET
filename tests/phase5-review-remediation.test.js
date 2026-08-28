import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { CounterpartyOperationsService } from '../services/counterparty-operations-service.js';
import { TransactionParticipationGatewayService } from '../services/transaction-participation-gateway-service.js';

class Domain {
  constructor(){this.m=new Map();}
  key(t,i){return `${t}:${i}`;}
  list(t){return [...this.m.entries()].filter(([k])=>k.startsWith(`${t}:`)).map(([,v])=>structuredClone(v));}
  async put(t,i,p){this.m.set(this.key(t,i),structuredClone(p));return p;}
}
const reasoning={reasonForExportPackage(){return{unresolvedFields:[],unresolvedServicingFields:[]};}};
async function seed(d,event){
  await d.put('EXPORT_PACKAGE','EXP-REVIEW',{id:'EXP-REVIEW',exportPackageId:'EXP-REVIEW',financingTransactionId:'FTX-REVIEW',exportKind:'FINANCING_DISBURSEMENT',state:'READY_FOR_SETTLEMENT_INSTRUCTION',amount:250000,currency:'USD',settlementMethod:'ACH'});
  await d.put('TRANSACTION_PARTICIPATION_EVENT',event.eventId,{id:event.eventId,windowId:'TPW-REVIEW',exportPackageId:'EXP-REVIEW',financingTransactionId:'FTX-REVIEW',...event,createdAt:new Date().toISOString()});
}

test('recognizes protected authority intent even when topic is GENERAL_PROCESSING',async()=>{
  const requests=['authorize settlement','execute the transfer','issue the instrument','transfer ownership','authorize payment'];
  for(const [index,summary] of requests.entries()){
    const d=new Domain();
    const eventId=`TPE-P-${index}`;
    await seed(d,{eventId,eventType:'PROCESSING_CLARIFICATION_REQUESTED',summary,details:{topic:'GENERAL_PROCESSING'}});
    const outcomes={summary(){return{status:'EXTERNAL_ACTIVITY_RECORDED'};}};
    const result=await new CounterpartyOperationsService(d,{reasoning,outcomes}).resolveParticipationEvent(eventId);
    assert.equal(result.status,'AWAITING_PRINCIPAL_AUTHORITY',summary);
    assert.equal(result.nextAction,'PRINCIPAL_REVIEW_REQUIRED',summary);
    assert.equal(result.authorityRequired,true,summary);
  }
});

test('failed Phase 4 outcome blocks continuation',async()=>{
  const d=new Domain();
  await seed(d,{eventId:'TPE-FAILED',eventType:'PROCESSING_CLARIFICATION_REQUESTED',summary:'Please confirm the next processing step.',details:{topic:'GENERAL_PROCESSING'}});
  const outcomes={async reconcile(){},summary(){return{status:'FAILED_EXTERNAL_OUTCOME'};}};
  const result=await new CounterpartyOperationsService(d,{reasoning,outcomes}).resolveParticipationEvent('TPE-FAILED');
  assert.equal(result.status,'BLOCKED_FAILED_EXTERNAL_OUTCOME');
  assert.equal(result.nextAction,'RECONCILE_FAILED_EXTERNAL_OUTCOME');
  assert.notEqual(result.nextAction,'CONTINUE_CURRENT_RECORDED_PROCESS');
});

test('reconciles Phase 4 immediately before grounding the counterparty response',async()=>{
  const d=new Domain();
  await seed(d,{eventId:'TPE-FRESH',eventType:'PROCESSING_CLARIFICATION_REQUESTED',summary:'What happens next?',details:{topic:'GENERAL_PROCESSING'}});
  let reconciled=false;
  const outcomes={async reconcile(id){assert.equal(id,'EXP-REVIEW');reconciled=true;},summary(){assert.equal(reconciled,true);return{status:'FAILED_EXTERNAL_OUTCOME'};}};
  const result=await new CounterpartyOperationsService(d,{reasoning,outcomes}).resolveParticipationEvent('TPE-FRESH');
  assert.equal(result.groundedIn.outcomeStatus,'FAILED_EXTERNAL_OUTCOME');
  assert.equal(result.nextAction,'RECONCILE_FAILED_EXTERNAL_OUTCOME');
});

test('participation events reuse a stable idempotency key instead of creating duplicate events',async()=>{
  const d=new Domain();
  const gateway=new TransactionParticipationGatewayService(d);
  const window={windowId:'TPW-IDEMP',exportPackageId:'EXP-IDEMP',financingTransactionId:'FTX-IDEMP'};
  const first=await gateway.recordEvent(window,'PROCESSING_CLARIFICATION_REQUESTED',{summary:'Question',idempotencyKey:'REQ-123'});
  const second=await gateway.recordEvent(window,'PROCESSING_CLARIFICATION_REQUESTED',{summary:'Question',idempotencyKey:'REQ-123'});
  assert.equal(first.eventId,second.eventId);
  assert.equal(d.list('TRANSACTION_PARTICIPATION_EVENT').length,1);
  assert.equal(d.list('OPERATIONAL_EVENT').length,1);
});

test('HTTP routes accept stable idempotency keys and private admin exposes Phase 5 status',()=>{
  const participation=fs.readFileSync(new URL('../routes/transaction-participation-gateway-router.js',import.meta.url),'utf8');
  assert.match(participation,/idempotency-key/);
  assert.match(participation,/x-idempotency-key/);
  const admin=fs.readFileSync(new URL('../routes/agent-workforce-admin-routes.js',import.meta.url),'utf8');
  assert.match(admin,/\/api\/admin\/counterparty-operations/);
  assert.match(admin,/requireAdmin/);
  assert.match(admin,/CounterpartyOperationsStatusService/);
});
