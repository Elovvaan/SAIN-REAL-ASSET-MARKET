import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const INSTRUCTION_STATES = new Set(['DRAFT','READY','DISPATCHED','ACCEPTED','EXECUTED','REJECTED','RETURNED','EXCEPTION','RECONCILED','CANCELLED']);
const SUPPORTED_RAILS = new Set(['WIRE','FEDWIRE','ACH','INTERNAL_TRANSFER','OTHER_APPROVED_RAIL']);

function now(){return new Date().toISOString();}
function id(prefix){return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;}
function requiredString(value,field){if(typeof value!=='string'||!value.trim())throw new Error(`${field} is required.`);return value.trim();}
function positiveMoney(value,field){const number=Number(value);if(!Number.isFinite(number)||number<=0)throw new Error(`${field} must be greater than zero.`);return Number(number.toFixed(2));}
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}

export class SettlementRailGatewayService{
  constructor(domain,settlementService,participationService){
    this.domain=domain;
    this.settlementService=settlementService;
    this.participationService=participationService;
  }

  listAdapters(filters={}){
    return this.domain.list(RECORD_TYPES.SETTLEMENT_RAIL_ADAPTER).filter((record)=>{
      if(filters.institutionId&&record.institutionId!==filters.institutionId)return false;
      if(filters.rail&&record.rail!==filters.rail)return false;
      if(filters.state&&record.state!==filters.state)return false;
      return true;
    });
  }

  getAdapter(adapterId){return this.domain.get(RECORD_TYPES.SETTLEMENT_RAIL_ADAPTER,adapterId);}

  async registerAdapter(input,actorId=null){
    const institutionId=requiredString(input.institutionId,'institutionId');
    const rail=requiredString(input.rail,'rail').toUpperCase();
    if(!SUPPORTED_RAILS.has(rail))throw new Error(`Unsupported settlement rail: ${rail}.`);
    const adapterId=input.adapterId||id('RAIL-ADAPTER');
    const timestamp=now();
    const record={
      adapterId,
      institutionId,
      institutionName:input.institutionName||institutionId,
      rail,
      endpointReference:requiredString(input.endpointReference,'endpointReference'),
      messageStandard:input.messageStandard||'INSTITUTION_DEFINED',
      currency:input.currency||'USD',
      senderAccountReference:input.senderAccountReference||null,
      permittedReceivingAccountReferences:Array.isArray(input.permittedReceivingAccountReferences)?[...new Set(input.permittedReceivingAccountReferences)]:[],
      state:'ACTIVE',
      createdBy:actorId,
      createdAt:timestamp,
      updatedAt:timestamp
    };
    await this.domain.put(RECORD_TYPES.SETTLEMENT_RAIL_ADAPTER,adapterId,record,{actorId,eventType:'SETTLEMENT_RAIL_ADAPTER_REGISTERED'});
    await this.domain.lifecycle({objectType:RECORD_TYPES.SETTLEMENT_RAIL_ADAPTER,objectId:adapterId,eventType:'SETTLEMENT_RAIL_ADAPTER_REGISTERED',actorId,payload:{institutionId,rail}});
    return record;
  }

  listInstructions(filters={}){
    return this.domain.list(RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION).filter((record)=>{
      if(filters.settlementId&&record.settlementId!==filters.settlementId)return false;
      if(filters.institutionId&&record.institutionId!==filters.institutionId)return false;
      if(filters.state&&record.state!==filters.state)return false;
      return true;
    }).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  }

  getInstruction(instructionId){return this.domain.get(RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION,instructionId);}

  settlementRailStatus(settlementId){
    const settlement=this.settlementService.getSettlement(settlementId);
    if(!settlement)throw new Error('SRA Settlement not found.');
    const instructions=this.listInstructions({settlementId});
    const requiredAmount=Number((settlement.settlementPackage?.sources||[]).reduce((sum,source)=>sum+Number(source.amount||0),0).toFixed(2));
    const executedAmount=Number(instructions.filter((item)=>['EXECUTED','RECONCILED'].includes(item.state)).reduce((sum,item)=>sum+item.amount,0).toFixed(2));
    const reconciledAmount=Number(instructions.filter((item)=>item.state==='RECONCILED').reduce((sum,item)=>sum+item.amount,0).toFixed(2));
    return {
      settlementId,
      instructions,
      requiredAmount,
      executedAmount,
      reconciledAmount,
      remainingToExecute:Math.max(0,Number((requiredAmount-executedAmount).toFixed(2))),
      remainingToReconcile:Math.max(0,Number((requiredAmount-reconciledAmount).toFixed(2))),
      allExecuted:requiredAmount>0&&executedAmount===requiredAmount,
      allReconciled:requiredAmount>0&&reconciledAmount===requiredAmount,
      hasExceptions:instructions.some((item)=>['REJECTED','RETURNED','EXCEPTION'].includes(item.state))
    };
  }

  async createInstruction(input,actorId=null){
    const settlement=this.settlementService.getSettlement(requiredString(input.settlementId,'settlementId'));
    if(!settlement)throw new Error('SRA Settlement not found.');
    if(!['READY','LOCKED'].includes(settlement.state))throw new Error('Settlement must be ready or locked before rail instructions are created.');
    const adapter=this.getAdapter(requiredString(input.adapterId,'adapterId'));
    if(!adapter||adapter.state!=='ACTIVE')throw new Error('Active settlement rail adapter not found.');
    const commitmentId=input.commitmentId||null;
    const commitment=commitmentId?this.participationService.getCommitment(commitmentId):null;
    if(commitmentId&&!commitment)throw new Error('Participation Commitment not found.');
    if(commitment&&commitment.state!=='COMMITTED')throw new Error('Participation Commitment must be committed before rail instruction creation.');
    if(commitment&&commitment.institutionId!==adapter.institutionId)throw new Error('Commitment institution does not match rail adapter institution.');
    const instructionAmount=positiveMoney(input.amount??commitment?.amount,'amount');
    const status=this.settlementRailStatus(settlement.settlementId);
    const alreadyAllocated=Number(status.instructions.filter((item)=>!['CANCELLED','REJECTED','RETURNED'].includes(item.state)).reduce((sum,item)=>sum+item.amount,0).toFixed(2));
    if(alreadyAllocated+instructionAmount>status.requiredAmount)throw new Error('Rail instruction exceeds the remaining settlement amount.');
    const receivingAccountReference=requiredString(input.receivingAccountReference,'receivingAccountReference');
    if(adapter.permittedReceivingAccountReferences.length&&!adapter.permittedReceivingAccountReferences.includes(receivingAccountReference))throw new Error('Receiving account is not permitted for this adapter.');
    const instructionId=input.instructionId||id('SRA-RAIL');
    const timestamp=now();
    const message={
      instructionId,
      settlementId:settlement.settlementId,
      settlementPackageId:settlement.settlementPackage?.settlementPackageId||null,
      settlementInstrumentReference:input.settlementInstrumentReference||settlement.executionReference,
      homeProjectId:settlement.homeProjectId,
      commitmentId,
      institutionId:adapter.institutionId,
      adapterId:adapter.adapterId,
      rail:adapter.rail,
      amount:instructionAmount,
      currency:input.currency||adapter.currency||'USD',
      senderAccountReference:input.senderAccountReference||adapter.senderAccountReference,
      receivingInstitutionReference:requiredString(input.receivingInstitutionReference,'receivingInstitutionReference'),
      receivingAccountReference,
      purpose:input.purpose||'SRA_HOME_PROJECT_SETTLEMENT',
      requestedExecutionDate:input.requestedExecutionDate||null,
      remittanceReference:input.remittanceReference||settlement.homeProjectId,
      packageHash:settlement.settlementPackage?.packageHash||null,
      messageStandard:adapter.messageStandard
    };
    const record={...message,messageHash:hash(message),state:'READY',createdBy:actorId,createdAt:timestamp,updatedAt:timestamp,history:[{state:'READY',at:timestamp,actorId}]};
    await this.domain.put(RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION,instructionId,record,{actorId,eventType:'SETTLEMENT_RAIL_INSTRUCTION_CREATED'});
    await this.domain.lifecycle({objectType:RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION,objectId:instructionId,eventType:'SETTLEMENT_RAIL_INSTRUCTION_CREATED',actorId,payload:{settlementId:settlement.settlementId,institutionId:adapter.institutionId,amount:instructionAmount,rail:adapter.rail}});
    return record;
  }

  async transitionInstruction(instructionId,targetState,input={},actorId=null){
    const current=this.getInstruction(instructionId);
    if(!current)throw new Error('Settlement Rail Instruction not found.');
    const state=requiredString(targetState,'state').toUpperCase();
    if(!INSTRUCTION_STATES.has(state))throw new Error(`Unsupported rail instruction state: ${state}.`);
    const allowed={
      READY:['DISPATCHED','CANCELLED'],
      DISPATCHED:['ACCEPTED','REJECTED','EXCEPTION'],
      ACCEPTED:['EXECUTED','REJECTED','RETURNED','EXCEPTION'],
      EXECUTED:['RECONCILED','RETURNED','EXCEPTION'],
      REJECTED:[],RETURNED:[],EXCEPTION:['DISPATCHED','CANCELLED'],RECONCILED:[],CANCELLED:[],DRAFT:['READY','CANCELLED']
    };
    if(!allowed[current.state].includes(state))throw new Error(`Invalid rail instruction transition: ${current.state} -> ${state}.`);
    if(['ACCEPTED','EXECUTED','RECONCILED','REJECTED','RETURNED','EXCEPTION'].includes(state)&&!input.institutionTransactionReference)throw new Error('institutionTransactionReference is required.');
    if(['EXECUTED','RECONCILED'].includes(state)&&!input.networkReference)throw new Error('networkReference is required.');
    if(state==='RECONCILED'){
      const confirmedAmount=positiveMoney(input.confirmedAmount??current.amount,'confirmedAmount');
      if(confirmedAmount!==current.amount)throw new Error('Confirmed amount does not match the rail instruction amount.');
      if(!input.receivingConfirmationReference)throw new Error('receivingConfirmationReference is required.');
    }
    if(['REJECTED','RETURNED','EXCEPTION'].includes(state)&&!input.exceptionCode)throw new Error('exceptionCode is required.');
    const timestamp=now();
    const updated={
      ...current,
      state,
      institutionTransactionReference:input.institutionTransactionReference||current.institutionTransactionReference||null,
      networkReference:input.networkReference||current.networkReference||null,
      receivingConfirmationReference:input.receivingConfirmationReference||current.receivingConfirmationReference||null,
      confirmedAmount:state==='RECONCILED'?Number(input.confirmedAmount??current.amount):current.confirmedAmount||null,
      exceptionCode:input.exceptionCode||null,
      exceptionDetail:input.exceptionDetail||null,
      dispatchedAt:state==='DISPATCHED'?timestamp:current.dispatchedAt||null,
      acceptedAt:state==='ACCEPTED'?timestamp:current.acceptedAt||null,
      executedAt:state==='EXECUTED'?timestamp:current.executedAt||null,
      reconciledAt:state==='RECONCILED'?timestamp:current.reconciledAt||null,
      updatedAt:timestamp,
      history:[...(current.history||[]),{state,at:timestamp,actorId,note:input.note||null}]
    };
    await this.domain.put(RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION,instructionId,updated,{actorId,eventType:`SETTLEMENT_RAIL_${state}`});
    await this.domain.lifecycle({objectType:RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION,objectId:instructionId,eventType:`SETTLEMENT_RAIL_${state}`,actorId,payload:{settlementId:current.settlementId,institutionId:current.institutionId,amount:current.amount,networkReference:updated.networkReference,exceptionCode:updated.exceptionCode}});
    if(state==='RECONCILED'&&current.commitmentId){
      const commitment=this.participationService.getCommitment(current.commitmentId);
      if(commitment&&commitment.state==='COMMITTED'){
        const settlement=this.settlementService.getSettlement(current.settlementId);
        if(settlement?.state==='COMPLETED')await this.participationService.transitionCommitment(current.commitmentId,'SETTLED',{note:'Rail instruction reconciled after SRA settlement completion.'},actorId);
      }
    }
    return updated;
  }
}

export const SETTLEMENT_RAIL_INSTRUCTION_STATES=Object.freeze([...INSTRUCTION_STATES]);
export const SETTLEMENT_RAIL_TYPES=Object.freeze([...SUPPORTED_RAILS]);
