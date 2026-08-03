import express from 'express';
function actorId(req){return req.headers['x-sra-actor-id']||req.body?.actorId||null;}
function fail(res,error){const message=error?.message||'Unexpected platform economics error.';return res.status(/not found/i.test(message)?404:400).json({error:message});}
export function createPlatformEconomicsRouter(service){const router=express.Router();
router.get('/catalog',(req,res)=>res.json({items:service.listCatalog({category:req.query.category||null,state:req.query.state||null})}));
router.post('/catalog',async(req,res)=>{try{return res.status(201).json(await service.createCatalogItem(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/catalog/:feeCode',(req,res)=>{const item=service.getCatalogItem(req.params.feeCode.toUpperCase());return item?res.json(item):res.status(404).json({error:'Fee Catalog Item not found.'});});
router.get('/schedules',(req,res)=>res.json({schedules:service.listSchedules({state:req.query.state||null})}));
router.post('/schedules',async(req,res)=>{try{return res.status(201).json(await service.createSchedule(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/schedules/:scheduleId',(req,res)=>{const item=service.getSchedule(req.params.scheduleId);return item?res.json(item):res.status(404).json({error:'Fee Schedule not found.'});});
router.post('/schedules/:scheduleId/activate',async(req,res)=>{try{return res.json(await service.activateSchedule(req.params.scheduleId,actorId(req)));}catch(e){return fail(res,e);}});
router.post('/calculate',(req,res)=>{try{return res.json(service.calculate(req.body||{}));}catch(e){return fail(res,e);}});
router.get('/charges',(req,res)=>res.json({charges:service.listCharges({payerId:req.query.payerId||null,subjectId:req.query.subjectId||null,state:req.query.state||null})}));
router.post('/charges',async(req,res)=>{try{return res.status(201).json(await service.assess(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/charges/:chargeId',(req,res)=>{const item=service.getCharge(req.params.chargeId);return item?res.json(item):res.status(404).json({error:'Fee Charge not found.'});});
router.post('/charges/:chargeId/waive',async(req,res)=>{try{return res.json(await service.waive(req.params.chargeId,req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.post('/invoices',async(req,res)=>{try{return res.status(201).json(await service.createInvoice(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
return router;}
