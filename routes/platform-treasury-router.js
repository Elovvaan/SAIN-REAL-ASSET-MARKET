import express from 'express';
function actorId(req){return req.headers['x-sra-actor-id']||req.body?.actorId||null;}
function fail(res,error){const message=error?.message||'Unexpected platform treasury error.';return res.status(/not found/i.test(message)?404:400).json({error:message});}
export function createPlatformTreasuryRouter(service){const router=express.Router();
router.get('/profiles',(req,res)=>res.json({profiles:service.listProfiles({state:req.query.state||null})}));
router.post('/profiles',async(req,res)=>{try{return res.status(201).json(await service.createProfile(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/profiles/:profileId',(req,res)=>{const item=service.getProfile(req.params.profileId);return item?res.json(item):res.status(404).json({error:'Platform Treasury Profile not found.'});});
router.get('/profiles/:profileId/position',(req,res)=>{try{return res.json(service.position(req.params.profileId));}catch(e){return fail(res,e);}});
router.get('/forecasts',(req,res)=>res.json({forecasts:service.listForecasts({profileId:req.query.profileId||null})}));
router.post('/forecasts',async(req,res)=>{try{return res.status(201).json(await service.createForecast(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/exceptions',(req,res)=>res.json({exceptions:service.listExceptions({profileId:req.query.profileId||null,state:req.query.state||null,severity:req.query.severity||null})}));
router.post('/exceptions',async(req,res)=>{try{return res.status(201).json(await service.createException(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.post('/exceptions/:exceptionId/resolve',async(req,res)=>{try{return res.json(await service.resolveException(req.params.exceptionId,req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
return router;}
