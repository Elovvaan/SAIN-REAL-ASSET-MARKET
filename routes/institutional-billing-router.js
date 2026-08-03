import express from 'express';
function actorId(req){return req.headers['x-sra-actor-id']||req.body?.actorId||null;}
function fail(res,error){const message=error?.message||'Unexpected institutional billing error.';return res.status(/not found/i.test(message)?404:400).json({error:message});}
export function createInstitutionalBillingRouter(service){const router=express.Router();
router.get('/profiles',(req,res)=>res.json({profiles:service.listProfiles({institutionId:req.query.institutionId||null,state:req.query.state||null})}));
router.post('/profiles',async(req,res)=>{try{return res.status(201).json(await service.createProfile(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/profiles/:profileId',(req,res)=>{const item=service.getProfile(req.params.profileId);return item?res.json(item):res.status(404).json({error:'Institution Billing Profile not found.'});});
router.get('/usage',(req,res)=>res.json({usage:service.listUsage({institutionId:req.query.institutionId||null,metric:req.query.metric||null,from:req.query.from||null,to:req.query.to||null})}));
router.post('/usage',async(req,res)=>{try{return res.status(201).json(await service.recordUsage(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/runs',(req,res)=>res.json({runs:service.listBillingRuns({institutionId:req.query.institutionId||null,state:req.query.state||null})}));
router.post('/runs',async(req,res)=>{try{return res.status(201).json(await service.generateBillingRun(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/runs/:billingRunId',(req,res)=>{const item=service.getBillingRun(req.params.billingRunId);return item?res.json(item):res.status(404).json({error:'Institution Billing Run not found.'});});
router.get('/institutions/:institutionId/summary',(req,res)=>res.json(service.summary(req.params.institutionId)));
return router;}
