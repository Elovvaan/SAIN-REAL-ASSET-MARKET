import test from 'node:test';
import assert from 'node:assert/strict';
import { SraNeuralCoreService, SraTinyNeuralNetwork, extractSraNeuralFeatures } from '../services/sra-neural-core-service.js';

class Domain {
  constructor(){this.records=new Map();this.events=[];}
  key(type,id){return `${type}:${id}`;}
  async hydrate(){return {};}
  get(type,id){return this.records.get(this.key(type,id))||null;}
  list(type){const prefix=`${type}:`;return [...this.records.entries()].filter(([key])=>key.startsWith(prefix)).map(([,value])=>value);}
  async put(type,id,payload){this.records.set(this.key(type,id),payload);return payload;}
  async atomicPut(changes){for(const change of changes)this.records.set(this.key(change.type,change.id),change.payload);return changes.map(change=>change.payload);}
  async lifecycle(event){this.events.push(event);return event;}
}

function opportunity(id,status='INTAKE_IN_PROGRESS',stage='APPLICATION',type='STARTUP_BUSINESS',amount=50000){return{opportunityId:id,title:id,status,financingStage:stage,opportunityType:type,requestedAmount:amount,currency:'USD',supportingDocumentIds:['DOC-1','DOC-2'],evidenceRecordIds:['E-1'],relatedAgreementIds:['A-1'],preferredFundingDate:'2026-09-01'};}

test('neural core exposes all three levels without financial write authority',async()=>{
  const domain=new Domain(),service=new SraNeuralCoreService({domain});await service.initialize();
  const status=service.status();
  assert.equal(status.levels.copilot.level,1);
  assert.equal(status.levels.orchestrator.level,2);
  assert.equal(status.levels.adaptiveInstitutionalIntelligence.level,3);
  assert.equal(status.financialWriteAuthority,'NONE_WITHOUT_GOVERNED_ADMIN_AUTHORIZATION');
  assert.ok(service.capabilities().invariants.includes('NEURAL_OUTPUT_CANNOT_SELF_AUTHORIZE_FUNDING'));
});

test('orchestrator prepares financing plan but does not execute governed financial actions',async()=>{
  const domain=new Domain();domain.records.set(domain.key('FUNDING_OPPORTUNITY','FOR-1'),opportunity('FOR-1','READY_TO_FUND','READY_TO_FUND','BUSINESS_ACQUISITION',500000));
  const service=new SraNeuralCoreService({domain});await service.initialize();
  const plan=await service.createPlan({objective:'fund this acquisition',opportunityId:'FOR-1'},{id:'ADMIN'});
  assert.equal(plan.status,'PROPOSED');
  assert.ok(plan.steps.some(step=>step.action==='AUTHORIZE_FUNDING'&&step.requiresApproval));
  await assert.rejects(()=>service.dispatchPlan(plan.planId,{id:'ADMIN'}),/approved before dispatch/);
  await service.approvePlan(plan.planId,{approval:'APPROVE'},{id:'ADMIN'});
  const dispatched=await service.dispatchPlan(plan.planId,{id:'ADMIN'});
  assert.deepEqual(dispatched.executedFinancialActions,[]);
  assert.ok(dispatched.handoffs.some(step=>step.action==='AUTHORIZE_FUNDING'&&step.state==='GOVERNED_HANDOFF_REQUIRED'));
  assert.ok(dispatched.handoffs.some(step=>step.action==='EXECUTE_SETTLEMENT'&&step.state==='GOVERNED_HANDOFF_REQUIRED'));
});

test('adaptive feature schema excludes protected personal characteristics',async()=>{
  const features=extractSraNeuralFeatures({...opportunity('FOR-2'),race:'ignored',sex:'ignored',religion:'ignored',age:72});
  assert.equal(features.length,8);
  assert.ok(features.every(Number.isFinite));
  const domain=new Domain();const service=new SraNeuralCoreService({domain});await service.initialize();
  const schema=service.capabilities().invariants;
  assert.ok(schema.includes('PROTECTED_PERSONAL_CHARACTERISTICS_ARE_NOT_MODEL_FEATURES'));
});

test('tiny neural network trains and returns bounded advisory inference',()=>{
  const samples=[];
  for(let i=0;i<16;i++){const high=i>=8;const features=[high?.8:.2,.5,.5,.3,high?0:1,high?1:0,0,1];samples.push({features,target:high?1:0});}
  const network=new SraTinyNeuralNetwork(null,'TEST');
  const before=network.forward(samples[0].features).output;
  const result=network.train(samples,{epochs:300,learningRate:.04});
  const after=network.forward(samples[0].features).output;
  assert.ok(result.loss>=0&&Number.isFinite(result.loss));
  assert.ok(after>=0&&after<=1);
  assert.notEqual(before,after);
});

test('adaptive model requires administrator approval and sufficient institutional history',async()=>{
  const domain=new Domain();
  for(let i=0;i<10;i++){const funded=i>=4;const record=opportunity(`FOR-${i}`,funded?'FUNDED':'REJECTED',funded?'FUNDED':'CLOSED',i%2?'STARTUP_BUSINESS':'BUSINESS_ACQUISITION',25000+i*5000);domain.records.set(domain.key('FUNDING_OPPORTUNITY',record.opportunityId),record);}
  const service=new SraNeuralCoreService({domain});await service.initialize();
  await assert.rejects(()=>service.trainAdaptiveModel({}, {id:'ADMIN'}),/Explicit administrator approval/);
  const trained=await service.trainAdaptiveModel({approval:'APPROVE',minimumSamples:8,epochs:80},{id:'ADMIN'});
  assert.equal(trained.model.status,'ACTIVE');
  assert.equal(trained.model.decisionAuthority,'ADVISORY_ONLY');
  assert.ok(trained.model.prohibitedUses.includes('AUTOMATIC_CREDIT_APPROVAL'));
  const forecast=service.forecastOpportunity('FOR-9');
  assert.equal(forecast.available,true);
  assert.equal(forecast.notCreditDecision,true);
  assert.ok(forecast.score>=0&&forecast.score<=1);
});