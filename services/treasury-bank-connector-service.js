import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const CONNECTION_STATES=new Set(['DRAFT','ACTIVE','SUSPENDED','CLOSED']);
const PAYMENT_STATES=new Set(['DRAFT','PENDING_APPROVAL','APPROVED','SUBMITTED','ACCEPTED','PROCESSING','EXECUTED','REJECTED','RETURNED','EXCEPTION','RECONCILED','CANCELLED']);
function now(){return new Date().toISOString();}
function id(prefix){return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;}
function required(value,field){if(typeof value!=='string'||!value.trim())throw new Error(`${field} is required.`);return value.trim();}
function money(value,field){const number=Number(value);if(!Number.isFinite(number)||number<=0)throw new Error(`${field} must be greater than zero.`);return Number(number.toFixed(2));}
function digest(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}

export class TreasuryBankConnectorService{
  constructor(domain,railGateway){this.domain=domain;this.railGateway=railGateway;}
  listConnections(filters={}){return this.domain.list(RECORD_TYPES.TREASURY_BANK_CONNECTION).filter(r=>(!filters.institutionId||r.institutionId===filters.institutionId)&&(!filters.state||r.state===filters.state));}
  getConnection(connectionId){return this.domain.get(RECORD_TYPES.TREASURY_BANK_CONNECTION,connectionId);}
  async createConnection(input,actorId=null){
    const timestamp=now();const connectionId=input.connectionId||id('TBC');
    const record={connectionId,institutionId:required(input.institutionId,'institutionId'),institutionName:input.institutionName||input.institutionId,bankCustomerReference:required(input.bankCustomerReference,'bankCustomerReference'),apiProfile:required(input.apiProfile,'apiProfile'),authenticationProfileReference:required(input.authenticationProfileReference,'authenticationProfileReference'),submissionEndpointReference:required(input.submissionEndpointReference,'submissionEndpointReference'),statusEndpointReference:required(input.statusEndpointReference,'statusEndpointReference'),statementEndpointReference:input.statementEndpointReference||null,authorizedOriginatingAccounts:[...new Set(input.authorizedOriginatingAccounts||[])],approvedBeneficiaries:[...new Set(input.approvedBeneficiaries||[])],currency:input.currency||'USD',singlePaymentLimit:Number(input.singlePaymentLimit||0),dailyPaymentLimit:Number(input.dailyPaymentLimit||0),approvalThreshold:Number(input.approvalThreshold||0),requiredApprovals:Number(input.requiredApprovals||1),state:'ACTIVE',createdBy:actorId,createdAt:timestamp,updatedAt:timestamp};
    if(!record.authorizedOriginatingAccounts.length)throw new Error('At least one authorized originating account is required.');
    await this.domain.put(RECORD_TYPES.TREASURY_BANK_CONNECTION,connectionId,record,{actorId,eventType:'TREASURY_BANK_CONNECTION_CREATED'});return record;
  }
  listPayments(filters={}){return this.domain.list(RECORD_TYPES.TREASURY_PAYMENT_ORDER).filter(r=>(!filters.connectionId||r.connectionId===filters.connectionId)&&(!filters.settlementId||r.settlementId===filters.settlementId)&&(!filters.state||r.state===filters.state)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));}
  getPayment(paymentOrderId){return this.domain.get(RECORD_TYPES.TREASURY_PAYMENT_ORDER,paymentOrderId);}
  dailySubmitted(connectionId,date=new Date().toISOString().slice(0,10)){return this.listPayments({connectionId}).filter(r=>r.createdAt?.slice(0,10)===date&&!['CANCELLED','REJECTED','RETURNED'].includes(r.state)).reduce((s,r)=>s+r.amount,0);}
  async createPayment(input,actorId=null){
    const connection=this.getConnection(required(input.connectionId,'connectionId'));if(!connection||connection.state!=='ACTIVE')throw new Error('Active Treasury Bank Connection not found.');
    const railInstruction=this.railGateway.getInstruction(required(input.railInstructionId,'railInstructionId'));if(!railInstruction)throw new Error('Settlement Rail Instruction not found.');
    const amount=money(input.amount??railInstruction.amount,'amount');if(amount!==railInstruction.amount)throw new Error('Treasury payment amount must match the rail instruction amount.');
    const originatingAccountReference=required(input.originatingAccountReference,'originatingAccountReference');if(!connection.authorizedOriginatingAccounts.includes(originatingAccountReference))throw new Error('Originating account is not authorized for this connection.');
    const beneficiaryReference=required(input.beneficiaryReference,'beneficiaryReference');if(connection.approvedBeneficiaries.length&&!connection.approvedBeneficiaries.includes(beneficiaryReference))throw new Error('Beneficiary is not approved for this connection.');
    if(connection.singlePaymentLimit&&amount>connection.singlePaymentLimit)throw new Error('Payment exceeds the single-payment limit.');
    if(connection.dailyPaymentLimit&&this.dailySubmitted(connection.connectionId)+amount>connection.dailyPaymentLimit)throw new Error('Payment exceeds the daily-payment limit.');
    const timestamp=now(),paymentOrderId=input.paymentOrderId||id('TPO');
    const payload={paymentOrderId,connectionId:connection.connectionId,settlementId:railInstruction.settlementId,railInstructionId:railInstruction.instructionId,institutionId:connection.institutionId,amount,currency:railInstruction.currency,originatingAccountReference,beneficiaryReference,beneficiaryAccountReference:railInstruction.receivingAccountReference,receivingInstitutionReference:railInstruction.receivingInstitutionReference,executionDate:input.executionDate||railInstruction.requestedExecutionDate||null,purpose:railInstruction.purpose,remittanceReference:railInstruction.remittanceReference,settlementInstrumentReference:railInstruction.settlementInstrumentReference};
    const requiresApproval=amount>=connection.approvalThreshold||connection.requiredApprovals>0;
    const record={...payload,orderHash:digest(payload),state:requiresApproval?'PENDING_APPROVAL':'APPROVED',approvals:[],requiredApprovals:connection.requiredApprovals,createdBy:actorId,createdAt:timestamp,updatedAt:timestamp};
    await this.domain.put(RECORD_TYPES.TREASURY_PAYMENT_ORDER,paymentOrderId,record,{actorId,eventType:'TREASURY_PAYMENT_ORDER_CREATED'});return record;
  }
  async approvePayment(paymentOrderId,input={},actorId=null){
    const current=this.getPayment(paymentOrderId);if(!current)throw new Error('Treasury Payment Order not found.');if(current.state!=='PENDING_APPROVAL')throw new Error('Payment Order is not pending approval.');
    const approverId=required(input.approverId||actorId,'approverId');if(current.approvals.some(a=>a.approverId===approverId))throw new Error('Approver has already approved this Payment Order.');
    const approvals=[...current.approvals,{approverId,approvalReference:required(input.approvalReference,'approvalReference'),at:now()}];const state=approvals.length>=current.requiredApprovals?'APPROVED':'PENDING_APPROVAL';
    const updated={...current,approvals,state,approvedAt:state==='APPROVED'?now():null,updatedAt:now()};await this.domain.put(RECORD_TYPES.TREASURY_PAYMENT_ORDER,paymentOrderId,updated,{actorId,eventType:state==='APPROVED'?'TREASURY_PAYMENT_ORDER_APPROVED':'TREASURY_PAYMENT_APPROVAL_ADDED'});return updated;
  }
  async submitPayment(paymentOrderId,input={},actorId=null){
    const current=this.getPayment(paymentOrderId);if(!current)throw new Error('Treasury Payment Order not found.');if(current.state!=='APPROVED')throw new Error('Payment Order must be approved before submission.');
    const timestamp=now();const updated={...current,state:'SUBMITTED',bankSubmissionReference:input.bankSubmissionReference||id('BANK-SUB'),submittedAt:timestamp,submittedBy:actorId,updatedAt:timestamp};await this.domain.put(RECORD_TYPES.TREASURY_PAYMENT_ORDER,paymentOrderId,updated,{actorId,eventType:'TREASURY_PAYMENT_SUBMITTED'});
    const instruction=this.railGateway.getInstruction(current.railInstructionId);if(instruction?.state==='READY')await this.railGateway.transitionInstruction(instruction.instructionId,'DISPATCHED',{},actorId);return updated;
  }
  async applyBankStatus(paymentOrderId,input={},actorId=null){
    const current=this.getPayment(paymentOrderId);if(!current)throw new Error('Treasury Payment Order not found.');const state=required(input.state,'state').toUpperCase();if(!PAYMENT_STATES.has(state))throw new Error(`Unsupported payment state: ${state}.`);
    const allowed={SUBMITTED:['ACCEPTED','REJECTED','EXCEPTION'],ACCEPTED:['PROCESSING','EXECUTED','REJECTED','RETURNED','EXCEPTION'],PROCESSING:['EXECUTED','RETURNED','EXCEPTION'],EXECUTED:['RECONCILED','RETURNED','EXCEPTION'],REJECTED:[],RETURNED:[],EXCEPTION:['SUBMITTED','CANCELLED'],RECONCILED:[],CANCELLED:[],DRAFT:[],PENDING_APPROVAL:[],APPROVED:['SUBMITTED']};
    if(!allowed[current.state]?.includes(state))throw new Error(`Invalid bank status transition: ${current.state} -> ${state}.`);
    if(['ACCEPTED','PROCESSING','EXECUTED','RECONCILED','REJECTED','RETURNED','EXCEPTION'].includes(state)&&!input.bankTransactionReference)throw new Error('bankTransactionReference is required.');
    if(['REJECTED','RETURNED','EXCEPTION'].includes(state)&&!input.reasonCode)throw new Error('reasonCode is required.');
    if(['EXECUTED','RECONCILED'].includes(state)&&!input.networkReference)throw new Error('networkReference is required.');
    const timestamp=now();const updated={...current,state,bankTransactionReference:input.bankTransactionReference||current.bankTransactionReference||null,networkReference:input.networkReference||current.networkReference||null,reasonCode:input.reasonCode||null,reasonDetail:input.reasonDetail||null,bankStatusPayloadHash:digest(input),updatedAt:timestamp};await this.domain.put(RECORD_TYPES.TREASURY_PAYMENT_ORDER,paymentOrderId,updated,{actorId,eventType:`TREASURY_PAYMENT_${state}`});
    const rail=this.railGateway.getInstruction(current.railInstructionId);if(rail){const map={ACCEPTED:'ACCEPTED',EXECUTED:'EXECUTED',RECONCILED:'RECONCILED',REJECTED:'REJECTED',RETURNED:'RETURNED',EXCEPTION:'EXCEPTION'};const railState=map[state];if(railState&&rail.state!==railState){await this.railGateway.transitionInstruction(rail.instructionId,railState,{institutionTransactionReference:updated.bankTransactionReference,networkReference:updated.networkReference,receivingConfirmationReference:input.receivingConfirmationReference,confirmedAmount:input.confirmedAmount||current.amount,exceptionCode:input.reasonCode,exceptionDetail:input.reasonDetail},actorId);}}
    return updated;
  }
  async ingestStatement(input,actorId=null){
    const connection=this.getConnection(required(input.connectionId,'connectionId'));if(!connection)throw new Error('Treasury Bank Connection not found.');const statementId=input.statementId||id('TST');const timestamp=now();const record={statementId,connectionId:connection.connectionId,accountReference:required(input.accountReference,'accountReference'),statementDate:required(input.statementDate,'statementDate'),openingBalance:Number(input.openingBalance||0),closingBalance:Number(input.closingBalance||0),entries:Array.isArray(input.entries)?input.entries:[],sourceReference:required(input.sourceReference,'sourceReference'),statementHash:digest(input),createdBy:actorId,createdAt:timestamp};await this.domain.put(RECORD_TYPES.TREASURY_STATEMENT,statementId,record,{actorId,eventType:'TREASURY_STATEMENT_INGESTED'});return record;
  }
  exceptionQueue(connectionId){return this.listPayments({connectionId}).filter(r=>['REJECTED','RETURNED','EXCEPTION'].includes(r.state));}
}

export const TREASURY_CONNECTION_STATES=Object.freeze([...CONNECTION_STATES]);
export const TREASURY_PAYMENT_STATES=Object.freeze([...PAYMENT_STATES]);
