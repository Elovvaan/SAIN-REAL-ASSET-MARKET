import test from 'node:test';
import assert from 'node:assert/strict';
import { FinancingClosingService } from '../services/financing-closing-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type,id){return `${type}:${id}`;}
  async hydrate(){return {};}
  get(type,id){return this.records.get(this.key(type,id)) || null;}
  list(type){const prefix=`${type}:`;return [...this.records.entries()].filter(([k])=>k.startsWith(prefix)).map(([,v])=>v);}
  async put(type,id,payload){this.records.set(this.key(type,id),payload);return payload;}
  async atomicPut(changes){for(const c of changes)this.records.set(this.key(c.type,c.id),c.payload);return changes.map(c=>c.payload);}
  async lifecycle(event){this.events.push(event);return event;}
}

function seedFinancing(domain){
  const record={transactionId:'LFA-1',transactionType:'LOAN_FINANCING_AUTHORIZATION',issuanceTransactionId:'TX-ISSUE-1',instrumentId:'INS-1',opportunityId:'FOR-1',borrowerParticipantId:'P-1',amount:500000,currency:'USD',state:'POSTED',status:'FUNDING_CREDITED_PENDING_DISBURSEMENT',externalDisbursementAuthorized:false};
  domain.records.set(domain.key(RECORD_TYPES.SRA_TRANSACTION,record.transactionId),record);
}

test('approved financing moves through closing, authorization and verified settlement before FUNDED', async()=>{
  const domain=new Domain(); seedFinancing(domain);
  const service=new FinancingClosingService(domain); await service.initialize();
  const opened=await service.open({financingTransactionId:'LFA-1'},'ADMIN');
  assert.equal(opened.closing.status,'IN_PROGRESS');
  const condition=await service.addCondition(opened.closing.closingId,{type:'PURCHASE_AGREEMENT',title:'Executed purchase agreement'},'ADMIN');
  await assert.rejects(()=>service.markReady(opened.closing.closingId,{beneficiaryName:'Closing Escrow',settlementMethod:'FEDWIRE'}),'Required closing conditions remain open');
  await service.satisfyCondition(opened.closing.closingId,condition.conditionId,{status:'SATISFIED',evidenceReference:'DOC-1'},'ADMIN');
  const ready=await service.markReady(opened.closing.closingId,{beneficiaryName:'Closing Escrow',settlementMethod:'FEDWIRE'},'ADMIN');
  assert.equal(ready.status,'READY_TO_FUND');
  const auth=await service.authorize(opened.closing.closingId,{approval:'APPROVE'},'ADMIN');
  assert.equal(auth.disbursement.status,'AUTHORIZED');
  assert.equal(domain.get(RECORD_TYPES.SRA_TRANSACTION,'LFA-1').status,'FUNDING_CREDITED_PENDING_DISBURSEMENT');
  await service.submitDisbursement(opened.closing.closingId,auth.disbursement.disbursementId,{},'ADMIN');
  await assert.rejects(()=>service.recordSettlement(opened.closing.closingId,auth.disbursement.disbursementId,{},'ADMIN'),'externalReference is required');
  const settled=await service.recordSettlement(opened.closing.closingId,auth.disbursement.disbursementId,{externalReference:'FEDWIRE-REF-001'},'ADMIN');
  assert.equal(settled.closing.status,'FUNDED');
  assert.equal(settled.disbursement.status,'SETTLED');
  assert.equal(settled.financing.status,'FUNDED');
  assert.equal(settled.financing.externalSettlementReference,'FEDWIRE-REF-001');
});

test('servicing boarding is unavailable until settlement has funded the closing', async()=>{
  const domain=new Domain(); seedFinancing(domain);
  const service=new FinancingClosingService(domain,{createAccount:async()=>({servicingAccountId:'ASA-1'}),getAccount:()=>null}); await service.initialize();
  const {closing}=await service.open({financingTransactionId:'LFA-1'},'ADMIN');
  await assert.rejects(()=>service.boardToServicing(closing.closingId,{assetAccountId:'A-1'},'ADMIN'),'Only funded financing can be boarded to servicing');
});