import express from 'express';
import { SettlementAdapterExecutionService } from '../services/settlement-adapter-execution-service.js';

function actorId(req){return req.headers['x-sra-actor-id']||req.body?.actorId||null;}
function handleError(res,error){
  const message=error?.message||'Unexpected settlement rail error.';
  const status=/not found/i.test(message)?404:(error?.code==='LIVE_EXECUTION_CONFIRMATION_REQUIRED'?409:400);
  return res.status(status).json({error:message,code:error?.code||null,executionEvidence:error?.executionEvidence||null});
}
function providerState(status){
  const value=String(status||'').toUpperCase();
  if(['COMPLETED','EXECUTED','SETTLED','CONFIRMED','SUCCESS','SUCCEEDED'].includes(value))return 'EXECUTED';
  if(['ACCEPTED','PENDING','PROCESSING','SUBMITTED','QUEUED'].includes(value))return 'ACCEPTED';
  return 'ACCEPTED';
}

export function createSettlementRailGatewayRouter(service){
  const router=express.Router();
  const executor=new SettlementAdapterExecutionService();

  router.get('/adapters',(req,res)=>res.json({adapters:service.listAdapters({institutionId:req.query.institutionId||null,rail:req.query.rail||null,state:req.query.state||null})}));
  router.post('/adapters',async(req,res)=>{try{return res.status(201).json(await service.registerAdapter(req.body||{},actorId(req)));}catch(error){return handleError(res,error);}});
  router.get('/adapters/:adapterId',(req,res)=>{const record=service.getAdapter(req.params.adapterId);return record?res.json(record):res.status(404).json({error:'Settlement Rail Adapter not found.'});});
  router.get('/execution/status',(_req,res)=>res.json(executor.status()));

  router.get('/instructions',(req,res)=>res.json({instructions:service.listInstructions({settlementId:req.query.settlementId||null,institutionId:req.query.institutionId||null,state:req.query.state||null})}));
  router.post('/instructions',async(req,res)=>{try{return res.status(201).json(await service.createInstruction(req.body||{},actorId(req)));}catch(error){return handleError(res,error);}});
  router.get('/instructions/:instructionId',(req,res)=>{const record=service.getInstruction(req.params.instructionId);return record?res.json(record):res.status(404).json({error:'Settlement Rail Instruction not found.'});});
  router.post('/instructions/:instructionId/transition',async(req,res)=>{try{return res.json(await service.transitionInstruction(req.params.instructionId,req.body?.state,req.body||{},actorId(req)));}catch(error){return handleError(res,error);}});

  router.post('/instructions/:instructionId/execute',async(req,res)=>{
    const instructionId=req.params.instructionId;
    const actor=actorId(req);
    const instruction=service.getInstruction(instructionId);
    try{
      if(!instruction)return res.status(404).json({error:'Settlement Rail Instruction not found.'});
      const confirmation=req.headers['x-sra-live-confirmation']||req.body?.confirmation||null;
      executor.assertCanExecute(instruction,confirmation);
      const dispatchReference=`SRA-DISPATCH-${instructionId}`;
      const dispatched=await service.transitionInstruction(instructionId,'DISPATCHED',{institutionTransactionReference:dispatchReference,note:'Dispatched to configured live settlement provider.'},actor);
      try{
        const evidence=await executor.execute(instruction,{confirmation,actorId:actor});
        const accepted=await service.transitionInstruction(instructionId,'ACCEPTED',{
          institutionTransactionReference:evidence.providerReference,
          note:`Provider status: ${evidence.providerStatus}. Evidence hash: ${evidence.responseHash}`
        },actor);
        if(providerState(evidence.providerStatus)==='EXECUTED'){
          const executed=await service.transitionInstruction(instructionId,'EXECUTED',{
            institutionTransactionReference:evidence.providerReference,
            networkReference:evidence.providerReference,
            note:`Provider reported execution. Evidence hash: ${evidence.responseHash}`
          },actor);
          return res.status(202).json({instruction:executed,executionEvidence:evidence,reconciliationRequired:true});
        }
        return res.status(202).json({instruction:accepted,executionEvidence:evidence,reconciliationRequired:true});
      }catch(error){
        const reference=error?.executionEvidence?.requestId||dispatchReference;
        await service.transitionInstruction(instructionId,'EXCEPTION',{
          institutionTransactionReference:reference,
          exceptionCode:error?.code||'SETTLEMENT_PROVIDER_ERROR',
          exceptionDetail:error?.message||String(error),
          note:'Live provider execution did not complete.'
        },actor);
        throw error;
      }
    }catch(error){return handleError(res,error);}
  });

  router.post('/instructions/:instructionId/execute-one-dollar-canary',async(req,res)=>{
    const instruction=service.getInstruction(req.params.instructionId);
    if(!instruction)return res.status(404).json({error:'Settlement Rail Instruction not found.'});
    if(Number(instruction.amount)!==1||String(instruction.currency||'').toUpperCase()!=='USD')return res.status(409).json({error:'The canary endpoint only executes an existing 1.00 USD settlement instruction.'});
    req.body={...(req.body||{}),confirmation:`EXECUTE 1.00 USD VIA ${String(instruction.rail).toUpperCase()}`};
    const confirmation=req.headers['x-sra-live-confirmation']||req.body.confirmation;
    if(req.headers['x-sra-live-confirmation']!==confirmation)return res.status(409).json({error:`Set x-sra-live-confirmation exactly to: ${confirmation}`});
    try{
      executor.assertCanExecute(instruction,confirmation);
      const actor=actorId(req);
      const dispatchReference=`SRA-CANARY-${instruction.instructionId}`;
      await service.transitionInstruction(instruction.instructionId,'DISPATCHED',{institutionTransactionReference:dispatchReference,note:'One-dollar live canary dispatched.'},actor);
      const evidence=await executor.execute(instruction,{confirmation,actorId:actor});
      const accepted=await service.transitionInstruction(instruction.instructionId,'ACCEPTED',{institutionTransactionReference:evidence.providerReference,note:`One-dollar provider status: ${evidence.providerStatus}.`},actor);
      if(providerState(evidence.providerStatus)==='EXECUTED'){
        const executed=await service.transitionInstruction(instruction.instructionId,'EXECUTED',{institutionTransactionReference:evidence.providerReference,networkReference:evidence.providerReference,note:'One-dollar provider execution reported.'},actor);
        return res.status(202).json({canary:true,instruction:executed,executionEvidence:evidence,reconciliationRequired:true});
      }
      return res.status(202).json({canary:true,instruction:accepted,executionEvidence:evidence,reconciliationRequired:true});
    }catch(error){
      const current=service.getInstruction(instruction.instructionId);
      if(current?.state==='DISPATCHED')await service.transitionInstruction(instruction.instructionId,'EXCEPTION',{institutionTransactionReference:error?.executionEvidence?.requestId||`SRA-CANARY-${instruction.instructionId}`,exceptionCode:error?.code||'CANARY_PROVIDER_ERROR',exceptionDetail:error?.message||String(error)},actorId(req));
      return handleError(res,error);
    }
  });

  router.get('/settlements/:settlementId/status',(req,res)=>{try{return res.json(service.settlementRailStatus(req.params.settlementId));}catch(error){return handleError(res,error);}});

  return router;
}
