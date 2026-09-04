import test from 'node:test';
import assert from 'node:assert/strict';
import { MoneyGramSandboxCertificationService } from '../services/moneygram-sandbox-certification-service.js';

function domain(){
  const values=new Map();
  return { list(type){return [...values.values()].filter((item)=>item.type===type).map((item)=>item.value);},get(type,id){return values.get(`${type}:${id}`)?.value||null;},async put(type,id,value){values.set(`${type}:${id}`,{type,value});} };
}

test('MoneyGram certification workflow persists sandbox IDs and refreshed evidence',async()=>{
  const store=domain();
  const sep24={
    status(){return {ready:true,mode:'SANDBOX',network:'TESTNET',anchorDomain:'anchor.example',authAccount:'GAUTH',fundsAccount:'GFUNDS'};},
    async startInteractive(input){assert.equal(input.kind,'withdraw');return {anchorDomain:'anchor.example',kind:'withdraw',account:'GFUNDS',authAccount:'GAUTH',userId:'42',transactionId:'mg-1',interactiveUrl:'https://anchor.example/transaction/mg-1'};},
    async getTransaction(){return {transaction:{id:'mg-1',status:'completed',stellar_transaction_id:'stellar-1',external_transaction_id:'external-1'}};},
  };
  const service=new MoneyGramSandboxCertificationService({domain:store,sep24});
  const started=await service.start({testType:'CASH_OUT',amount:'25',userId:'42'},'ADMIN');
  assert.equal(started.transactionId,'mg-1');
  const refreshed=await service.refresh(started.certificationTestId,'ADMIN');
  assert.equal(refreshed.anchorStatus,'completed');
  assert.equal(refreshed.evidence.stellarTransactionId,'stellar-1');
  assert.deepEqual(service.status().completedTests,['CASH_OUT']);
  assert.equal(service.evidence().tests[0].externalTransactionId,undefined);
});

test('MoneyGram certification workflow refuses production mode',async()=>{
  const service=new MoneyGramSandboxCertificationService({domain:domain(),sep24:{status(){return {ready:true,mode:'PRODUCTION',network:'PUBLIC'};}}});
  await assert.rejects(()=>service.start({testType:'CASH_IN',amount:'1'},'ADMIN'),/locked to SEP-24 SANDBOX/);
});
