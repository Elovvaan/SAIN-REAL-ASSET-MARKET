import crypto from 'node:crypto';

const TYPES=Object.freeze({
  AGENT:'SRA_AGENT_WORKER',
  WORK:'SRA_AGENT_WORK_ORDER',
  COMPENSATION:'SRA_AGENT_COMPENSATION_RECORD',
});
const WORK_STATES=new Set(['ASSIGNED','IN_PROGRESS','COMPLETED','ACCEPTED','REJECTED','CANCELLED']);
const PAYMENT_STATES=new Set(['EARNED','AUTHORIZED','PAID','VOID']);
const PROTECTED_EXECUTION_CLASSES=new Set(['FINANCIAL_AUTHORIZATION','EXTERNAL_SETTLEMENT','ON_CHAIN_EXECUTION','INSTRUMENT_ISSUANCE']);
const now=()=>new Date().toISOString();
const id=(prefix)=>`${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const required=(value,field)=>{const v=String(value||'').trim();if(!v)throw new Error(`${field} is required.`);return v;};
const money=(value,field='amount')=>{const n=Number(value);if(!Number.isFinite(n)||n<0)throw new Error(`${field} must be zero or greater.`);return Number(n.toFixed(2));};

export class AgentWorkforceService {
  constructor({domain,database=null}){this.domain=domain;this.database=database;}
  async initialize(){await this.domain.hydrate(Object.values(TYPES));return this.status();}
  status(){return{service:'SRA_AGENT_WORKFORCE',agents:this.domain.list(TYPES.AGENT).length,workOrders:this.domain.list(TYPES.WORK).length,compensationRecords:this.domain.list(TYPES.COMPENSATION).length,authority:'GOVERNED_DELEGATION',economicModel:'WORK_PERFORMED_AND_ACCEPTED_BEFORE_COMPENSATION'};}
  listAgents(filters={}){return this.domain.list(TYPES.AGENT).filter(a=>(!filters.state||a.state===filters.state)&&(!filters.role||a.role===filters.role));}
  getAgent(agentId){return this.domain.get(TYPES.AGENT,agentId);}
  async registerAgent(input={},actor={}){
    const agentId=input.agentId||id('AGENT');
    const record={agentId,name:required(input.name,'name'),role:required(input.role,'role').toUpperCase(),description:String(input.description||'').trim()||null,capabilities:[...new Set((input.capabilities||[]).map(v=>String(v).trim().toUpperCase()).filter(Boolean))],executionClasses:[...new Set((input.executionClasses||['READ_ONLY','SAFE_PREPARATION']).map(v=>String(v).trim().toUpperCase()).filter(Boolean))],walletReference:input.walletReference||null,paymentAccountReference:input.paymentAccountReference||null,state:'ACTIVE',createdBy:actor.id||null,createdAt:now(),updatedAt:now()};
    await this.domain.put(TYPES.AGENT,agentId,record,{actorId:actor.id||null,eventType:'SRA_AGENT_WORKER_REGISTERED'});return record;
  }
  listWork(filters={}){return this.domain.list(TYPES.WORK).filter(w=>(!filters.agentId||w.agentId===filters.agentId)&&(!filters.state||w.state===filters.state)&&(!filters.opportunityId||w.opportunityId===filters.opportunityId));}
  getWork(workOrderId){return this.domain.get(TYPES.WORK,workOrderId);}
  async assignWork(input={},actor={}){
    const agent=this.getAgent(required(input.agentId,'agentId'));if(!agent||agent.state!=='ACTIVE')throw new Error('Active SRA agent worker not found.');
    const executionClass=required(input.executionClass||'SAFE_PREPARATION','executionClass').toUpperCase();
    if(!agent.executionClasses.includes(executionClass))throw new Error('Agent is not delegated for this execution class.');
    const workOrderId=input.workOrderId||id('WORK');
    const record={workOrderId,agentId:agent.agentId,role:agent.role,title:required(input.title,'title'),objective:required(input.objective,'objective'),executionClass,requiresAdministratorAuthorization:PROTECTED_EXECUTION_CLASSES.has(executionClass),opportunityId:input.opportunityId||null,instrumentId:input.instrumentId||null,settlementInstructionId:input.settlementInstructionId||null,onChainInstructionId:input.onChainInstructionId||null,authorizedCompensation:money(input.authorizedCompensation||0,'authorizedCompensation'),currency:String(input.currency||'USD').toUpperCase(),state:'ASSIGNED',assignedBy:actor.id||null,assignedAt:now(),history:[{state:'ASSIGNED',at:now(),actorId:actor.id||null}]};
    await this.domain.put(TYPES.WORK,workOrderId,record,{actorId:actor.id||null,eventType:'SRA_AGENT_WORK_ASSIGNED'});return record;
  }
  async startWork(workOrderId,actor={}){const w=this.getWork(workOrderId);if(!w)throw new Error('Agent work order not found.');if(w.state!=='ASSIGNED')throw new Error(`Work cannot start from ${w.state}.`);const u={...w,state:'IN_PROGRESS',startedAt:now(),updatedAt:now(),history:[...(w.history||[]),{state:'IN_PROGRESS',at:now(),actorId:actor.id||w.agentId}]};await this.domain.put(TYPES.WORK,workOrderId,u,{actorId:actor.id||w.agentId,eventType:'SRA_AGENT_WORK_STARTED'});return u;}
  async completeWork(workOrderId,input={},actor={}){const w=this.getWork(workOrderId);if(!w)throw new Error('Agent work order not found.');if(!['ASSIGNED','IN_PROGRESS'].includes(w.state))throw new Error(`Work cannot complete from ${w.state}.`);const resultReference=required(input.resultReference,'resultReference');const u={...w,state:'COMPLETED',resultReference,resultSummary:String(input.resultSummary||'').trim()||null,transactionReference:input.transactionReference||null,completedAt:now(),updatedAt:now(),history:[...(w.history||[]),{state:'COMPLETED',at:now(),actorId:actor.id||w.agentId}]};await this.domain.put(TYPES.WORK,workOrderId,u,{actorId:actor.id||w.agentId,eventType:'SRA_AGENT_WORK_COMPLETED'});return u;}
  async acceptWork(workOrderId,input={},actor={}){
    const w=this.getWork(workOrderId);if(!w)throw new Error('Agent work order not found.');if(w.state!=='COMPLETED')throw new Error('Only completed agent work can be accepted.');if(String(input.approval||'').toUpperCase()!=='ACCEPT')throw new Error('Explicit administrator acceptance is required.');
    const acceptedAt=now(),u={...w,state:'ACCEPTED',acceptedBy:actor.id||null,acceptedAt,updatedAt:acceptedAt,history:[...(w.history||[]),{state:'ACCEPTED',at:acceptedAt,actorId:actor.id||null}]};
    const compensationId=id('COMP'),comp={compensationId,workOrderId:w.workOrderId,agentId:w.agentId,amount:w.authorizedCompensation,currency:w.currency,basis:'ACCEPTED_AGENT_WORK',state:'EARNED',earnedAt:acceptedAt,authorizedBy:null,paidAt:null,paymentReference:null};
    if(typeof this.domain.atomicPut==='function')await this.domain.atomicPut([{type:TYPES.WORK,id:w.workOrderId,payload:u,actorId:actor.id||null,eventType:'SRA_AGENT_WORK_ACCEPTED'},{type:TYPES.COMPENSATION,id:compensationId,payload:comp,actorId:actor.id||null,eventType:'SRA_AGENT_COMPENSATION_EARNED'}]);else{await this.domain.put(TYPES.WORK,w.workOrderId,u,{actorId:actor.id||null,eventType:'SRA_AGENT_WORK_ACCEPTED'});await this.domain.put(TYPES.COMPENSATION,compensationId,comp,{actorId:actor.id||null,eventType:'SRA_AGENT_COMPENSATION_EARNED'});}return{work:u,compensation:comp};
  }
  listCompensation(filters={}){return this.domain.list(TYPES.COMPENSATION).filter(c=>(!filters.agentId||c.agentId===filters.agentId)&&(!filters.state||c.state===filters.state));}
  async transitionCompensation(compensationId,targetState,input={},actor={}){const c=this.domain.get(TYPES.COMPENSATION,compensationId);if(!c)throw new Error('Agent compensation record not found.');const state=required(targetState,'state').toUpperCase();if(!PAYMENT_STATES.has(state))throw new Error(`Unsupported compensation state: ${state}.`);const allowed={EARNED:['AUTHORIZED','VOID'],AUTHORIZED:['PAID','VOID'],PAID:[],VOID:[]};if(!allowed[c.state]?.includes(state))throw new Error(`Invalid compensation transition: ${c.state} -> ${state}.`);if(state==='AUTHORIZED'&&String(input.approval||'').toUpperCase()!=='AUTHORIZE')throw new Error('Explicit administrator authorization is required.');if(state==='PAID'&&!input.paymentReference)throw new Error('paymentReference is required when compensation is paid.');const u={...c,state,authorizedBy:state==='AUTHORIZED'?(actor.id||null):c.authorizedBy,authorizedAt:state==='AUTHORIZED'?now():c.authorizedAt||null,paidAt:state==='PAID'?now():c.paidAt||null,paymentReference:state==='PAID'?input.paymentReference:c.paymentReference||null,updatedAt:now()};await this.domain.put(TYPES.COMPENSATION,compensationId,u,{actorId:actor.id||null,eventType:`SRA_AGENT_COMPENSATION_${state}`});return u;}
}

export const SRA_AGENT_WORKFORCE_TYPES=TYPES;
