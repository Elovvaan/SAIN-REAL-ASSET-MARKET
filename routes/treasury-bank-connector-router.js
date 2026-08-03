import express from 'express';
function actorId(req){return req.headers['x-sra-actor-id']||req.body?.actorId||null;}
function fail(res,error){const message=error?.message||'Unexpected treasury connector error.';return res.status(/not found/i.test(message)?404:400).json({error:message});}
export function createTreasuryBankConnectorRouter(service){const router=express.Router();
router.get('/connections',(req,res)=>res.json({connections:service.listConnections({institutionId:req.query.institutionId||null,state:req.query.state||null})}));
router.post('/connections',async(req,res)=>{try{return res.status(201).json(await service.createConnection(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/connections/:connectionId',(req,res)=>{const record=service.getConnection(req.params.connectionId);return record?res.json(record):res.status(404).json({error:'Treasury Bank Connection not found.'});});
router.get('/connections/:connectionId/exceptions',(req,res)=>res.json({exceptions:service.exceptionQueue(req.params.connectionId)}));
router.get('/payments',(req,res)=>res.json({payments:service.listPayments({connectionId:req.query.connectionId||null,settlementId:req.query.settlementId||null,state:req.query.state||null})}));
router.post('/payments',async(req,res)=>{try{return res.status(201).json(await service.createPayment(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/payments/:paymentOrderId',(req,res)=>{const record=service.getPayment(req.params.paymentOrderId);return record?res.json(record):res.status(404).json({error:'Treasury Payment Order not found.'});});
router.post('/payments/:paymentOrderId/approve',async(req,res)=>{try{return res.json(await service.approvePayment(req.params.paymentOrderId,req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.post('/payments/:paymentOrderId/submit',async(req,res)=>{try{return res.json(await service.submitPayment(req.params.paymentOrderId,req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.post('/payments/:paymentOrderId/status',async(req,res)=>{try{return res.json(await service.applyBankStatus(req.params.paymentOrderId,req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.post('/statements',async(req,res)=>{try{return res.status(201).json(await service.ingestStatement(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
return router;}
