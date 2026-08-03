import express from 'express';
function actorId(req){return req.headers['x-sra-actor-id']||req.body?.actorId||null;}
function fail(res,error){const message=error?.message||'Unexpected asset servicing error.';return res.status(/not found/i.test(message)?404:400).json({error:message});}
export function createAssetServicingRouter(service){const router=express.Router();
router.get('/accounts',(req,res)=>res.json({accounts:service.listAccounts({assetAccountId:req.query.assetAccountId||null,ownerId:req.query.ownerId||null,state:req.query.state||null})}));
router.post('/accounts',async(req,res)=>{try{return res.status(201).json(await service.createAccount(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/accounts/:servicingAccountId',(req,res)=>{const item=service.getAccount(req.params.servicingAccountId);return item?res.json(item):res.status(404).json({error:'Asset Servicing Account not found.'});});
router.post('/accounts/:servicingAccountId/transition',async(req,res)=>{try{return res.json(await service.transitionAccount(req.params.servicingAccountId,req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/accounts/:servicingAccountId/summary',(req,res)=>{try{return res.json(service.summary(req.params.servicingAccountId));}catch(e){return fail(res,e);}});
router.get('/obligations',(req,res)=>res.json({obligations:service.listObligations({servicingAccountId:req.query.servicingAccountId||null,type:req.query.type||null,state:req.query.state||null})}));
router.post('/obligations',async(req,res)=>{try{return res.status(201).json(await service.createObligation(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/obligations/:obligationId',(req,res)=>{const item=service.getObligation(req.params.obligationId);return item?res.json(item):res.status(404).json({error:'Asset Servicing Obligation not found.'});});
router.post('/obligations/:obligationId/transition',async(req,res)=>{try{return res.json(await service.transitionObligation(req.params.obligationId,req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/events',(req,res)=>res.json({events:service.listEvents({servicingAccountId:req.query.servicingAccountId||null,type:req.query.type||null})}));
router.post('/events',async(req,res)=>{try{return res.status(201).json(await service.recordEvent(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
return router;}
