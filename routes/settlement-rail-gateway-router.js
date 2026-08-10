import express from 'express';

function actorId(req){return req.headers['x-sra-actor-id']||req.body?.actorId||null;}
function handleError(res,error){const message=error?.message||'Unexpected settlement rail error.';const status=/not found/i.test(message)?404:400;return res.status(status).json({error:message,code:error?.code||null});}

export function createSettlementRailGatewayRouter(service){
  const router=express.Router();

  router.get('/rails',(_req,res)=>res.json({rails:service.supportedRails()}));
  router.get('/adapters',(req,res)=>res.json({adapters:service.listAdapters({institutionId:req.query.institutionId||null,rail:req.query.rail||null,state:req.query.state||null})}));
  router.post('/adapters',async(req,res)=>{try{return res.status(201).json(await service.registerAdapter(req.body||{},actorId(req)));}catch(error){return handleError(res,error);}});
  router.get('/adapters/:adapterId',(req,res)=>{const record=service.getAdapter(req.params.adapterId);return record?res.json(record):res.status(404).json({error:'Settlement Rail Adapter not found.'});});

  router.get('/instructions',(req,res)=>res.json({instructions:service.listInstructions({settlementId:req.query.settlementId||null,exportPackageId:req.query.exportPackageId||null,institutionId:req.query.institutionId||null,rail:req.query.rail||null,state:req.query.state||null})}));
  router.post('/instructions',async(req,res)=>{try{return res.status(201).json(await service.createInstruction(req.body||{},actorId(req)));}catch(error){return handleError(res,error);}});
  router.get('/instructions/:instructionId',(req,res)=>{const record=service.getInstruction(req.params.instructionId);return record?res.json(record):res.status(404).json({error:'Settlement Rail Instruction not found.'});});
  router.post('/instructions/:instructionId/transition',async(req,res)=>{try{return res.json(await service.transitionInstruction(req.params.instructionId,req.body?.state,req.body||{},actorId(req)));}catch(error){return handleError(res,error);}});

  router.get('/settlements/:settlementId/status',(req,res)=>{try{return res.json(service.settlementRailStatus(req.params.settlementId));}catch(error){return handleError(res,error);}});

  return router;
}
