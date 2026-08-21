import express from 'express';
import { BankAchOriginationService } from '../services/bank-ach-origination-service.js';

function actorId(req){return req.headers['x-sra-actor-id']||req.body?.actorId||null;}
function handleError(res,error){const message=error?.message||'Unexpected settlement rail error.';const status=/not found/i.test(message)?404:error?.httpStatus||400;return res.status(status).json({error:message,code:error?.code||null});}

export function createSettlementRailGatewayRouter(service,bankAchOriginationService=new BankAchOriginationService()){
  const router=express.Router();

  async function submitAchInstruction(instructionId,actor){
    const current=service.getInstruction(instructionId);
    if(!current)throw new Error('Settlement Rail Instruction not found.');
    if(String(current.rail||'').toUpperCase()!=='ACH')throw new Error('Real bank API submission is currently available for ACH instructions only.');

    const submission=await bankAchOriginationService.submit(current);
    let updated=current;
    const institutionTransactionReference=submission.institutionTransactionReference;
    const note=`Submitted through ${submission.provider} ACH bank API; provider status ${submission.providerStatus||'created'}.`;

    if(['READY','EXCEPTION'].includes(String(updated.state||'').toUpperCase())){
      updated=await service.transitionInstruction(instructionId,'DISPATCHED',{institutionTransactionReference,note},actor);
    }
    if(String(updated.state||'').toUpperCase()==='DISPATCHED'){
      updated=await service.transitionInstruction(instructionId,'ACCEPTED',{institutionTransactionReference,note},actor);
    }
    if(submission.networkReference&&String(updated.state||'').toUpperCase()==='ACCEPTED'){
      updated=await service.transitionInstruction(instructionId,'EXECUTED',{institutionTransactionReference,networkReference:submission.networkReference,note:`${note} FedACH trace returned by provider.`},actor);
    }

    return {...updated,bankApi:{provider:submission.provider,status:submission.providerStatus,institutionTransactionReference,networkReference:submission.networkReference||null,submittedAt:submission.submittedAt}};
  }

  router.get('/rails',(_req,res)=>res.json({rails:service.supportedRails()}));
  router.get('/origination/status',(_req,res)=>res.json(bankAchOriginationService.status()));
  router.get('/adapters',(req,res)=>res.json({adapters:service.listAdapters({institutionId:req.query.institutionId||null,rail:req.query.rail||null,state:req.query.state||null})}));
  router.post('/adapters',async(req,res)=>{try{return res.status(201).json(await service.registerAdapter(req.body||{},actorId(req)));}catch(error){return handleError(res,error);}});
  router.get('/adapters/:adapterId',(req,res)=>{const record=service.getAdapter(req.params.adapterId);return record?res.json(record):res.status(404).json({error:'Settlement Rail Adapter not found.'});});

  router.get('/instructions',(req,res)=>res.json({instructions:service.listInstructions({settlementId:req.query.settlementId||null,exportPackageId:req.query.exportPackageId||null,institutionId:req.query.institutionId||null,rail:req.query.rail||null,state:req.query.state||null})}));
  router.post('/instructions',async(req,res)=>{try{return res.status(201).json(await service.createInstruction(req.body||{},actorId(req)));}catch(error){return handleError(res,error);}});
  router.get('/instructions/:instructionId',(req,res)=>{const record=service.getInstruction(req.params.instructionId);return record?res.json(record):res.status(404).json({error:'Settlement Rail Instruction not found.'});});
  router.post('/instructions/:instructionId/submit',async(req,res)=>{try{return res.json(await submitAchInstruction(req.params.instructionId,actorId(req)));}catch(error){return handleError(res,error);}});
  router.post('/instructions/:instructionId/transition',async(req,res)=>{
    try{
      const current=service.getInstruction(req.params.instructionId);
      const targetState=String(req.body?.state||'').toUpperCase();
      if(current&&String(current.rail||'').toUpperCase()==='ACH'&&targetState==='DISPATCHED')return res.json(await submitAchInstruction(req.params.instructionId,actorId(req)));
      return res.json(await service.transitionInstruction(req.params.instructionId,req.body?.state,req.body||{},actorId(req)));
    }catch(error){return handleError(res,error);}
  });

  router.get('/settlements/:settlementId/status',(req,res)=>{try{return res.json(service.settlementRailStatus(req.params.settlementId));}catch(error){return handleError(res,error);}});

  return router;
}
