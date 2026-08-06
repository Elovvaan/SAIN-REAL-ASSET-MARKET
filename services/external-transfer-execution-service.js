const TX = 'SRA_TRANSACTION';
const locks = new Map();
function now(){return new Date().toISOString();}
function authId(id){return `XAU-${String(id).replace(/^XFR-/,'')}`;}
function resultId(id){return `XRS-${String(id).replace(/^XFR-/,'')}`;}
function blocked(r){return Boolean(r?.frozen||r?.status==='FROZEN'||r?.state==='FROZEN'||r?.complianceHold||r?.transferRestricted||r?.externalTransferRestricted||r?.disputeState==='OPEN');}

export class ExternalTransferExecutionService {
  constructor(domain){this.domain=domain;}
  instruction(id){
    const x=this.domain.get(TX,id);
    if(!x||x.transactionType!=='EXTERNAL_TRANSFER_INSTRUCTION') throw new Error('External transfer instruction was not found.');
    return x;
  }
  package(x){const p=this.domain.get('EXPORT_PACKAGE',x.exportPackageId); if(!p) throw new Error('Linked export package was not found.'); return p;}
  position(x){const p=this.domain.get('COIN_POSITION',x.positionId); if(!p) throw new Error('Linked internal position was not found.'); return p;}
  ownership(x){const p=this.package(x); const o=this.domain.get('OWNERSHIP_RECOGNITION',p.ownershipRecognitionId); if(!o) throw new Error('Linked ownership record was not found.'); return o;}

  preview(input={}){
    const action=String(input.action||'').toUpperCase();
    const id=String(input.transferInstructionId||'').trim(); if(!id) throw new Error('transferInstructionId is required.');
    const x=this.instruction(id), p=this.package(x), pos=this.position(x), own=this.ownership(x);
    if(blocked(x)||blocked(p)||blocked(pos)||blocked(own)) throw new Error('Transfer lifecycle is restricted or unavailable.');
    if(pos.participantId!==x.participantId||own.participantId!==x.participantId) throw new Error('Instruction, position, and ownership participant records do not agree.');
    if(pos.instrumentId!==x.instrumentId||own.instrumentId!==x.instrumentId) throw new Error('Instruction, position, and ownership instrument records do not agree.');
    if(Number(pos.availableQuantity)<Number(x.quantity)) throw new Error('Internal position no longer contains the instructed quantity.');
    if(action==='AUTHORIZE_EXECUTION'){
      if(x.state!=='TRANSFER_INSTRUCTION_VERIFIED'||x.executionState!=='NOT_AUTHORIZED') throw new Error('Transfer instruction is not awaiting execution authorization.');
      return {action:'EXTERNAL_EXECUTION_AUTHORIZATION_PREVIEW',readOnly:true,transferInstructionId:id,exportPackageId:x.exportPackageId,participantId:x.participantId,positionId:x.positionId,instrumentId:x.instrumentId,quantity:Number(x.quantity),unit:x.unit,route:x.route,destinationReference:x.destinationReference,state:'ELIGIBLE_FOR_EXECUTION_AUTHORIZATION',effect:'Authorize an external operator to execute the verified instruction without changing internal position or ownership yet.',doesNot:['EXECUTE_TRANSFER','REDUCE_INTERNAL_POSITION','CHANGE_OWNERSHIP'],approvalRequired:true};
    }
    if(action==='RECONCILE_RESULT'){
      if(x.executionState!=='AUTHORIZED'||x.state!=='EXECUTION_AUTHORIZED') throw new Error('Transfer instruction is not awaiting an external result.');
      const result=String(input.result||'').toUpperCase(); if(!['COMPLETED','FAILED'].includes(result)) throw new Error('result must be COMPLETED or FAILED.');
      const externalReference=String(input.externalReference||'').trim(); if(!externalReference) throw new Error('externalReference is required.');
      return {action:'EXTERNAL_TRANSFER_RESULT_PREVIEW',readOnly:true,transferInstructionId:id,result,externalReference,completedAt:input.completedAt||now(),quantity:Number(x.quantity),effect:result==='COMPLETED'?'Reconcile verified external completion, reduce the internal position, and mark ownership as externally held.':'Record the external failure while preserving internal position and ownership.',approvalRequired:true};
    }
    throw new Error('Unsupported external transfer action.');
  }

  async approve(input={},actorId='SRA_PLATFORM_ADMIN'){
    if(String(input.approval||'').toUpperCase()!=='APPROVE') throw new Error('Explicit administrator approval is required.');
    const id=String(input.transferInstructionId||'').trim();
    const prior=locks.get(id)||Promise.resolve(); let release; const current=new Promise(r=>{release=r;}); locks.set(id,prior.then(()=>current)); await prior;
    try{
      const preview=this.preview(input), x=this.instruction(id), p=this.package(x), at=now();
      if(preview.action==='EXTERNAL_EXECUTION_AUTHORIZATION_PREVIEW'){
        const aid=authId(id); if(this.domain.get(TX,aid)) throw new Error('Execution authorization already exists.');
        const auth={transactionId:aid,executionAuthorizationId:aid,transactionType:'EXTERNAL_TRANSFER_EXECUTION_AUTHORIZATION',transferInstructionId:id,exportPackageId:x.exportPackageId,participantId:x.participantId,positionId:x.positionId,instrumentId:x.instrumentId,quantity:Number(x.quantity),unit:x.unit,state:'EXECUTION_AUTHORIZED',executionState:'AUTHORIZED',externalWithdrawalState:'AUTHORIZED_FOR_OPERATOR',authorizedBy:actorId,authorizedAt:at,createdAt:at,updatedAt:at,statusHistory:[{state:'EXECUTION_AUTHORIZED',actorId,occurredAt:at}]};
        await this.domain.atomicPut([
          {type:TX,id:aid,payload:auth,actorId,eventType:'EXTERNAL_TRANSFER_EXECUTION_AUTHORIZED'},
          {type:TX,id,payload:{...x,executionAuthorizationId:aid,state:'EXECUTION_AUTHORIZED',executionState:'AUTHORIZED',externalWithdrawalState:'AUTHORIZED_FOR_OPERATOR',updatedAt:at},actorId,eventType:'TRANSFER_INSTRUCTION_EXECUTION_AUTHORIZED'},
          {type:'EXPORT_PACKAGE',id:x.exportPackageId,payload:{...p,executionAuthorizationId:aid,state:'EXECUTION_AUTHORIZED',exportExecutionState:'AUTHORIZED',updatedAt:at},actorId,eventType:'EXPORT_EXECUTION_AUTHORIZED'}
        ]); return auth;
      }
      const rid=resultId(id); if(this.domain.get(TX,rid)) throw new Error('Transfer result has already been reconciled.');
      const pos=this.position(x), own=this.ownership(x), completed=preview.result==='COMPLETED';
      const result={transactionId:rid,transferResultId:rid,transactionType:'EXTERNAL_TRANSFER_RESULT',transferInstructionId:id,exportPackageId:x.exportPackageId,result:preview.result,externalReference:preview.externalReference,quantity:Number(x.quantity),unit:x.unit,state:completed?'EXTERNAL_TRANSFER_COMPLETED':'EXTERNAL_TRANSFER_FAILED',reconciledBy:actorId,reconciledAt:at,externalCompletedAt:preview.completedAt,createdAt:at,updatedAt:at};
      const changes=[
        {type:TX,id:rid,payload:result,actorId,eventType:completed?'EXTERNAL_TRANSFER_COMPLETED':'EXTERNAL_TRANSFER_FAILED'},
        {type:TX,id,payload:{...x,transferResultId:rid,state:result.state,executionState:completed?'COMPLETED':'FAILED',externalWithdrawalState:completed?'COMPLETED':'FAILED',updatedAt:at},actorId,eventType:'TRANSFER_INSTRUCTION_RECONCILED'},
        {type:'EXPORT_PACKAGE',id:x.exportPackageId,payload:{...p,transferResultId:rid,state:result.state,exportExecutionState:completed?'COMPLETED':'FAILED',updatedAt:at},actorId,eventType:'EXPORT_RESULT_RECONCILED'}
      ];
      if(completed){
        changes.push({type:'COIN_POSITION',id:x.positionId,payload:{...pos,availableQuantity:Number(pos.availableQuantity)-Number(x.quantity),externalizedQuantity:Number(pos.externalizedQuantity||0)+Number(x.quantity),state:Number(pos.availableQuantity)-Number(x.quantity)>0?'ACTIVE':'EXTERNALLY_TRANSFERRED',externalTransferState:'COMPLETED',updatedAt:at},actorId,eventType:'INTERNAL_POSITION_EXTERNALIZED'});
        changes.push({type:'OWNERSHIP_RECOGNITION',id:p.ownershipRecognitionId,payload:{...own,state:'EXTERNALLY_HELD',externalTransferState:'COMPLETED',externalReference:preview.externalReference,updatedAt:at},actorId,eventType:'OWNERSHIP_MARKED_EXTERNALLY_HELD'});
      }
      await this.domain.atomicPut(changes); return result;
    } finally {release(); locks.delete(id);}
  }

  status(){const items=this.domain.list(TX).filter(i=>i.transactionType==='EXTERNAL_TRANSFER_RESULT'); return {reconciledCount:items.length,completed:items.filter(i=>i.result==='COMPLETED').length,failed:items.filter(i=>i.result==='FAILED').length,latestResult:items.sort((a,b)=>String(b.reconciledAt).localeCompare(String(a.reconciledAt)))[0]||null};}
}
