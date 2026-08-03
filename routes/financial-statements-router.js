import express from 'express';
function actorId(req){return req.headers['x-sra-actor-id']||req.body?.actorId||null;}
function fail(res,error){const message=error?.message||'Unexpected financial statements error.';return res.status(/not found/i.test(message)?404:400).json({error:message});}
export function createFinancialStatementsRouter(service){const router=express.Router();
router.get('/periods',(req,res)=>res.json({periods:service.listPeriods({state:req.query.state||null})}));
router.post('/periods',async(req,res)=>{try{return res.status(201).json(await service.createPeriod(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/periods/:periodId',(req,res)=>{const item=service.getPeriod(req.params.periodId);return item?res.json(item):res.status(404).json({error:'Accounting Period not found.'});});
router.get('/periods/:periodId/statements',(req,res)=>{try{return res.json(service.generate(req.params.periodId));}catch(e){return fail(res,e);}});
router.post('/periods/:periodId/snapshots',async(req,res)=>{try{return res.status(201).json(await service.snapshot(req.params.periodId,actorId(req)));}catch(e){return fail(res,e);}});
router.post('/periods/:periodId/close',async(req,res)=>{try{return res.json(await service.closePeriod(req.params.periodId,req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/snapshots',(req,res)=>res.json({snapshots:service.listSnapshots({periodId:req.query.periodId||null})}));
return router;}
