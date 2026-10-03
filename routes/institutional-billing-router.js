import express from 'express';
import { billingAuthorization } from '../middleware/billing-authorization.js';
import { RECORD_TYPES as T } from '../services/persistent-domain-service.js';
function actorId(req){return req.billingActorId;}
function fail(res,error){const message=error?.message||'Unexpected institutional billing error.';return res.status(/not found/i.test(message)?404:400).json({error:message});}
export function createInstitutionalBillingRouter(service,accessService){const router=express.Router();
router.use(billingAuthorization(accessService));
router.use(async(_req,_res,next)=>{try{await service.economicsService.hydrate();await service.domain.hydrate([T.INSTITUTION_BILLING_PROFILE,T.INSTITUTION_USAGE_EVENT,T.INSTITUTION_BILLING_RUN]);return next();}catch(error){return next(error);}});
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
