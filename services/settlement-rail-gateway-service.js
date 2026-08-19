import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const INSTRUCTION_STATES = new Set(['DRAFT','READY','DISPATCHED','ACCEPTED','EXECUTED','REJECTED','RETURNED','EXCEPTION','RECONCILED','CANCELLED']);
const SUPPORTED_RAILS = new Set(['ACH','FEDWIRE','WIRE','INTERNAL_TRANSFER','OTHER_APPROVED_RAIL']);
const EXECUTION_MODES = new Set(['BANK_PARTNER','SERVICE_PROVIDER','DIRECT_PARTICIPANT','INTERNAL']);
const EXPORT_PACKAGE_TYPE = 'EXPORT_PACKAGE';

function now(){return new Date().toISOString();}
function id(prefix){return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;}
function requiredString(value,field){if(typeof value!=='string'||!value.trim())throw new Error(`${field} is required.`);return value.trim();}
function positiveMoney(value,field){const number=Number(value);if(!Number.isFinite(number)||number<=0)throw new Error(`${field} must be greater than zero.`);return Number(number.toFixed(2));}
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function defaultStandard(rail){if(rail==='ACH')return 'NACHA';if(rail==='FEDWIRE')return 'ISO_20022';return 'INSTITUTION_DEFINED';}
function defaultExecutionMode(rail){if(rail==='INTERNAL_TRANSFER')return 'INTERNAL';return 'BANK_PARTNER';}
function normalizedRoutingNumber(value){
  const routing=String(value||'').replace(/\D/g,'');
  if(!/^\d{9}$/.test(routing))throw new Error('ABA routing number must contain exactly 9 digits.');
  return routing;
}
function achStandardDetails({routingNumber,accountNumber,beneficiaryName,amount,requestedExecutionDate,remittanceReference,adapter,input}){
  const routing=normalizedRoutingNumber(routingNumber);
  const standardEntryClassCode=String(input.standardEntryClassCode||adapter.standardEntryClassCode||'').trim().toUpperCase()||null;
  return {
    network:'ACH_NETWORK',
    rules:'NACHA_OPERATING_RULES',
    standardEntryClassCode,
    companyEntryDescription:String(input.companyEntryDescription||adapter.companyEntryDescription||'SRA FUNDING').trim().slice(0,10),
    effectiveEntryDate:requestedExecutionDate||now().slice(0,10),
    receivingDfiIdentification:routing.slice(0,8),
    checkDigit:routing.slice(8),
    dfiAccountNumber:accountNumber,
    amount,
    receivingIndividualOrCompanyName:beneficiaryName||null,
    addendaRecordIndicator:remittanceReference?1:0,
    traceNumber:null,
    originatingDfiIdentification:adapter.originatingDfiIdentification||null,
  };
}
function fedwireStandardDetails({accountNumber,beneficiaryName,amount,routingNumber,remittanceReference,sourceType,adapter,input}){
  const creditorAgentRoutingNumber=normalizedRoutingNumber(routingNumber);
  return {
    service:'FEDWIRE_FUNDS_SERVICE',
    messageStandard:'ISO_20022',
    businessApplicationHeader:'head.001',
    messageType:String(input.iso20022MessageType||adapter.iso20022MessageType||(sourceType==='FINANCING_DISBURSEMENT'?'pacs.008':'')).trim()||null,
    messageTypeDescription:sourceType==='FINANCING_DISBURSEMENT'?'Customer Credit Transfer':null,
    debtor:input.debtorName||adapter.senderName||null,
    debtorAccount:input.senderAccountReference||adapter.senderAccountReference||null,
    creditor:beneficiaryName||null,
    creditorAccount:accountNumber,
    creditorAgentRoutingNumber,
    amount,
    remittanceInformation:remittanceReference||null,
    imad:null,
  };
}
function railStandardDetails({rail,routingNumber,accountNumber,beneficiaryName,amount,requestedExecutionDate,remittanceReference,sourceType,adapter,input}){
  if(rail==='ACH')return achStandardDetails({routingNumber,accountNumber,beneficiaryName,amount,requestedExecutionDate,remittanceReference,adapter,input});
  if(rail==='FEDWIRE')return fedwireStandardDetails({accountNumber,beneficiaryName,amount,routingNumber,remittanceReference,sourceType,adapter,input});
  return null;
}

export class SettlementRailGatewayService{
  constructor(domain,settlementService,participationService){this.domain=domain;this.settlementService=settlementService;this.participationService=participationService;}

  supportedRails(){
    return [...SUPPORTED_RAILS].map((rail)=>({
      rail,
      displayName:rail==='ACH'?'ACH Network':rail==='FEDWIRE'?'Fedwire Funds Service':rail==='WIRE'?'Bank Wire':rail,
      messageStandard:defaultStandard(rail),
      executionMode:defaultExecutionMode(rail),
    }));
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
    const executionMode=String(input.executionMode||defaultExecutionMode(rail)).toUpperCase();
    if(!EXECUTION_MODES.has(executionMode))throw new Error(`Unsupported execution mode: ${executionMode}.`);
    if(rail==='FEDWIRE'&&executionMode==='DIRECT_PARTICIPANT'&&!input.federalReserveAccountReference)throw new Error('federalReserveAccountReference is required for direct Fedwire participation.');
    const adapterId=input.adapterId||id('RAIL-ADAPTER');
    const timestamp=now();
    const record={
      adapterId,institutionId,institutionName:input.institutionName||institutionId,rail,executionMode,
      endpointReference:requiredString(input.endpointReference,'endpointReference'),
      messageStandard:input.messageStandard||defaultStandard(rail),currency:input.currency||'USD',
      senderAccountReference:input.senderAccountReference||null,federalReserveAccountReference:input.federalReserveAccountReference||null,
      providerReference:input.providerReference||null,
      originatingDfiIdentification:input.originatingDfiIdentification||null,
      standardEntryClassCode:input.standardEntryClassCode||null,
      companyEntryDescription:input.companyEntryDescription||null,
      iso20022MessageType:input.iso20022MessageType||null,
      senderName:input.senderName||null,
      permittedReceivingAccountReferences:Array.isArray(input.permittedReceivingAccountReferences)?[...new Set(input.permittedReceivingAccountReferences)]:[],
      state:'ACTIVE',createdBy:actorId,createdAt:timestamp,updatedAt:timestamp,
    };
    await this.domain.put(RECORD_TYPES.SETTLEMENT_RAIL_ADAPTER,adapterId,record,{actorId,eventType:'SETTLEMENT_RAIL_ADAPTER_REGISTERED'});
    await this.domain.lifecycle({objectType:RECORD_TYPES.SETTLEMENT_RAIL_ADAPTER,objectId:adapterId,eventType:'SETTLEMENT_RAIL_ADAPTER_REGISTERED',actorId,payload:{institutionId,rail,executionMode,messageStandard:record.messageStandard}});
    return record;
  }

  listInstructions(filters={}){
    return this.domain.list(RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION).filter((record)=>{
      if(filters.settlementId&&record.settlementId!==filters.settlementId)return false;
      if(filters.exportPackageId&&record.exportPackageId!==filters.exportPackageId)return false;
      if(filters.institutionId&&record.institutionId!==filters.institutionId)return false;
      if(filters.rail&&record.rail!==filters.rail)return false;
      if(filters.state&&record.state!==filters.state)return false;
      return true;
    }).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  }

  getInstruction(instructionId){return this.domain.get(RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION,instructionId);}

  settlementRailStatus(settlementId){
    const settlement=this.settlementService?.getSettlement?.(settlementId);
    if(!settlement)throw new Error('SRA Settlement not found.');
    const instructions=this.listInstructions({settlementId});
    const requiredAmount=Number((settlement.settlementPackage?.sources||[]).reduce((sum,source)=>sum+Number(source.amount||0),0).toFixed(2));
    const executedAmount=Number(instructions.filter((item)=>['EXECUTED','RECONCILED'].includes(item.state)).reduce((sum,item)=>sum+item.amount,0).toFixed(2));
    const reconciledAmount=Number(instructions.filter((item)=>item.state==='RECONCILED').reduce((sum,item)=>sum+item.amount,0).toFixed(2));
    return {settlementId,instructions,requiredAmount,executedAmount,reconciledAmount,remainingToExecute:Math.max(0,Number((requiredAmount-executedAmount).toFixed(2))),remainingToReconcile:Math.max(0,Number((requiredAmount-reconciledAmount).toFixed(2))),allExecuted:requiredAmount>0&&executedAmount===requiredAmount,allReconciled:requiredAmount>0&&reconciledAmount===requiredAmount,hasExceptions:instructions.some((item)=>['REJECTED','RETURNED','EXCEPTION'].includes(item.state))};
  }

  financingExportPackage(exportPackageId){
    const pkg=this.domain.get(EXPORT_PACKAGE_TYPE,exportPackageId);
    if(!pkg)throw new Error('Financing export package not found.');
    if(pkg.exportKind!=='FINANCING_DISBURSEMENT')throw new Error('Export package is not a financing disbursement package.');
    if(!['READY_FOR_SETTLEMENT_INSTRUCTION','SETTLEMENT_INSTRUCTION_READY'].includes(pkg.state))throw new Error(`Financing export package is not available for settlement instruction from ${pkg.state}.`);
    return pkg;
  }

  resolveSource(input={}){
    const exportPackageId=String(input.exportPackageId||'').trim();
    if(exportPackageId){
      const pkg=this.financingExportPackage(exportPackageId);
      return {sourceType:'FINANCING_DISBURSEMENT',exportPackage:pkg,requiredAmount:positiveMoney(pkg.amount,'export package amount'),currency:pkg.currency||'USD'};
    }
    const settlementId=requiredString(input.settlementId,'settlementId');
    const settlement=this.settlementService?.getSettlement?.(settlementId);
    if(!settlement)throw new Error('SRA Settlement not found.');
    if(!['READY','LOCKED'].includes(settlement.state))throw new Error('Settlement must be ready or locked before rail instructions are created.');
    const requiredAmount=Number((settlement.settlementPackage?.sources||[]).reduce((sum,source)=>sum+Number(source.amount||0),0).toFixed(2));
    return {sourceType:'SRA_SETTLEMENT',settlement,requiredAmount,currency:settlement.currency||'USD'};
  }

  async createInstruction(input,actorId=null){
    const source=this.resolveSource(input);
    const adapter=this.getAdapter(requiredString(input.adapterId,'adapterId'));
    if(!adapter||adapter.state!=='ACTIVE')throw new Error('Active settlement rail adapter not found.');
    const requestedRail=String(input.rail||adapter.rail).toUpperCase();
    if(requestedRail!==adapter.rail)throw new Error('Requested rail does not match the selected adapter.');

    let commitmentId=null;
    let commitment=null;
    if(source.sourceType==='SRA_SETTLEMENT'){
      commitmentId=input.commitmentId||null;
      commitment=commitmentId?this.participationService?.getCommitment?.(commitmentId):null;
      if(commitmentId&&!commitment)throw new Error('Participation Commitment not found.');
      if(commitment&&commitment.state!=='COMMITTED')throw new Error('Participation Commitment must be committed before rail instruction creation.');
      if(commitment&&commitment.institutionId!==adapter.institutionId)throw new Error('Commitment institution does not match rail adapter institution.');
    }

    const instructionAmount=positiveMoney(input.amount??commitment?.amount??source.requiredAmount,'amount');
    if(source.sourceType==='FINANCING_DISBURSEMENT'&&instructionAmount!==source.requiredAmount)throw new Error('Financing settlement instruction amount must match the authorized export package amount.');
    if(source.sourceType==='SRA_SETTLEMENT'){
      const status=this.settlementRailStatus(source.settlement.settlementId);
      const alreadyAllocated=Number(status.instructions.filter((item)=>!['CANCELLED','REJECTED','RETURNED'].includes(item.state)).reduce((sum,item)=>sum+item.amount,0).toFixed(2));
      if(alreadyAllocated+instructionAmount>status.requiredAmount)throw new Error('Rail instruction exceeds the remaining settlement amount.');
    }
    if(source.sourceType==='FINANCING_DISBURSEMENT'){
      const existing=this.listInstructions({exportPackageId:source.exportPackage.exportPackageId}).find((item)=>!['CANCELLED','REJECTED','RETURNED'].includes(item.state));
      if(existing)return existing;
    }

    const receivingAccountReference=requiredString(input.receivingAccountReference,'receivingAccountReference');
    if(adapter.permittedReceivingAccountReferences.length&&!adapter.permittedReceivingAccountReferences.includes(receivingAccountReference))throw new Error('Receiving account is not permitted for this adapter.');
    const instructionId=input.instructionId||id('SRA-RAIL');
    const timestamp=now();
    const settlement=source.settlement||null;
    const pkg=source.exportPackage||null;
    const beneficiaryName=pkg?.beneficiaryName||input.beneficiaryName||null;
    const requestedExecutionDate=input.requestedExecutionDate||null;
    const remittanceReference=input.remittanceReference||pkg?.exportPackageId||settlement?.homeProjectId||null;
    const routingNumber=['ACH','FEDWIRE'].includes(adapter.rail)?normalizedRoutingNumber(input.routingNumber):input.routingNumber||null;
    const standardDetails=railStandardDetails({
      rail:adapter.rail,
      routingNumber,
      accountNumber:receivingAccountReference,
      beneficiaryName,
      amount:instructionAmount,
      requestedExecutionDate,
      remittanceReference,
      sourceType:source.sourceType,
      adapter,
      input,
    });
    const message={
      instructionId,
      sourceType:source.sourceType,
      settlementId:settlement?.settlementId||null,
      settlementPackageId:settlement?.settlementPackage?.settlementPackageId||null,
      exportPackageId:pkg?.exportPackageId||null,
      financingTransactionId:pkg?.financingTransactionId||null,
      closingId:pkg?.closingId||null,
      disbursementId:pkg?.disbursementId||null,
      opportunityId:pkg?.opportunityId||null,
      instrumentId:pkg?.instrumentId||null,
      beneficiaryName,
      settlementInstrumentReference:input.settlementInstrumentReference||settlement?.executionReference||pkg?.financingTransactionId||null,
      homeProjectId:settlement?.homeProjectId||null,
      commitmentId,
      institutionId:adapter.institutionId,
      adapterId:adapter.adapterId,
      rail:adapter.rail,
      railDisplayName:adapter.rail==='ACH'?'ACH Network':adapter.rail==='FEDWIRE'?'Fedwire Funds Service':adapter.rail,
      executionMode:adapter.executionMode||defaultExecutionMode(adapter.rail),
      amount:instructionAmount,
      currency:input.currency||source.currency||adapter.currency||'USD',
      senderAccountReference:input.senderAccountReference||adapter.senderAccountReference,
      receivingInstitutionReference:requiredString(input.receivingInstitutionReference,'receivingInstitutionReference'),
      receivingAccountReference,
      routingNumber,
      accountType:input.accountType||null,
      purpose:input.purpose||(pkg?'SRA_FINANCING_DISBURSEMENT':'SRA_SETTLEMENT'),
      requestedExecutionDate,
      remittanceReference,
      packageHash:settlement?.settlementPackage?.packageHash||null,
      messageStandard:adapter.messageStandard||defaultStandard(adapter.rail),
      standardDetails,
    };
    const record={...message,messageHash:hash(message),state:'READY',createdBy:actorId,createdAt:timestamp,updatedAt:timestamp,history:[{state:'READY',at:timestamp,actorId}]};
    const changes=[{type:RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION,id:instructionId,payload:record,actorId,eventType:'SETTLEMENT_RAIL_INSTRUCTION_CREATED'}];
    if(pkg){
      changes.push({
        type:EXPORT_PACKAGE_TYPE,
        id:pkg.exportPackageId,
        payload:{...pkg,selectedRail:record.rail,settlementInstructionId:instructionId,state:'SETTLEMENT_INSTRUCTION_READY',updatedAt:timestamp,statusHistory:[...(pkg.statusHistory||[]),{state:'SETTLEMENT_INSTRUCTION_READY',actorId,occurredAt:timestamp}]},
        actorId,
        eventType:'FINANCING_EXPORT_PACKAGE_SETTLEMENT_INSTRUCTION_READY',
      });
    }
    if(typeof this.domain.atomicPut==='function')await this.domain.atomicPut(changes);
    else {
      for(const change of changes)await this.domain.put(change.type,change.id,change.payload,{actorId,eventType:change.eventType});
    }
    await this.domain.lifecycle({objectType:RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION,objectId:instructionId,eventType:'SETTLEMENT_RAIL_INSTRUCTION_CREATED',actorId,payload:{settlementId:record.settlementId,exportPackageId:record.exportPackageId,institutionId:adapter.institutionId,amount:instructionAmount,rail:adapter.rail,executionMode:record.executionMode,messageStandard:record.messageStandard}});
    return record;
  }

  async transitionInstruction(instructionId,targetState,input={},actorId=null){
    const current=this.getInstruction(instructionId);
    if(!current)throw new Error('Settlement Rail Instruction not found.');
    const state=requiredString(targetState,'state').toUpperCase();
    if(!INSTRUCTION_STATES.has(state))throw new Error(`Unsupported rail instruction state: ${state}.`);
    const allowed={READY:['DISPATCHED','CANCELLED'],DISPATCHED:['ACCEPTED','REJECTED','EXCEPTION'],ACCEPTED:['EXECUTED','REJECTED','RETURNED','EXCEPTION'],EXECUTED:['RECONCILED','RETURNED','EXCEPTION'],REJECTED:[],RETURNED:[],EXCEPTION:['DISPATCHED','CANCELLED'],RECONCILED:[],CANCELLED:[],DRAFT:['READY','CANCELLED']};
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
    let standardDetails=current.standardDetails||null;
    if(standardDetails&&input.networkReference){
      if(current.rail==='ACH')standardDetails={...standardDetails,traceNumber:input.networkReference};
      if(current.rail==='FEDWIRE')standardDetails={...standardDetails,imad:input.networkReference};
    }
    const updated={...current,state,institutionTransactionReference:input.institutionTransactionReference||current.institutionTransactionReference||null,networkReference:input.networkReference||current.networkReference||null,receivingConfirmationReference:input.receivingConfirmationReference||current.receivingConfirmationReference||null,confirmedAmount:state==='RECONCILED'?Number(input.confirmedAmount??current.amount):current.confirmedAmount||null,exceptionCode:input.exceptionCode||null,exceptionDetail:input.exceptionDetail||null,standardDetails,dispatchedAt:state==='DISPATCHED'?timestamp:current.dispatchedAt||null,acceptedAt:state==='ACCEPTED'?timestamp:current.acceptedAt||null,executedAt:state==='EXECUTED'?timestamp:current.executedAt||null,reconciledAt:state==='RECONCILED'?timestamp:current.reconciledAt||null,updatedAt:timestamp,history:[...(current.history||[]),{state,at:timestamp,actorId,note:input.note||null}]};
    await this.domain.put(RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION,instructionId,updated,{actorId,eventType:`SETTLEMENT_RAIL_${state}`});
    await this.domain.lifecycle({objectType:RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION,objectId:instructionId,eventType:`SETTLEMENT_RAIL_${state}`,actorId,payload:{settlementId:current.settlementId,exportPackageId:current.exportPackageId,institutionId:current.institutionId,amount:current.amount,rail:current.rail,networkReference:updated.networkReference,exceptionCode:updated.exceptionCode}});
    if(state==='RECONCILED'&&current.commitmentId){
      const commitment=this.participationService?.getCommitment?.(current.commitmentId);
      if(commitment&&commitment.state==='COMMITTED'){
        const settlement=this.settlementService?.getSettlement?.(current.settlementId);
        if(settlement?.state==='COMPLETED')await this.participationService.transitionCommitment(current.commitmentId,'SETTLED',{note:'Rail instruction reconciled after SRA settlement completion.'},actorId);
      }
    }
    return updated;
  }
}

export const SETTLEMENT_RAIL_INSTRUCTION_STATES=Object.freeze([...INSTRUCTION_STATES]);
export const SETTLEMENT_RAIL_TYPES=Object.freeze([...SUPPORTED_RAILS]);
