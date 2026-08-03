import express from 'express';
function actorId(req){return req.headers['x-sra-actor-id']||req.body?.actorId||null;}
function fail(res,error){const message=error?.message||'Unexpected capital formation error.';return res.status(/not found/i.test(message)?404:400).json({error:message});}
export function createCapitalFormationRouter(service){const router=express.Router();
router.get('/offerings',(req,res)=>res.json({offerings:service.listOfferings({state:req.query.state||null})}));
router.post('/offerings',async(req,res)=>{try{return res.status(201).json(await service.createOffering(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/offerings/:offeringId',(req,res)=>{const item=service.getOffering(req.params.offeringId);return item?res.json(item):res.status(404).json({error:'Capital Formation Offering not found.'});});
router.post('/offerings/:offeringId/transition',async(req,res)=>{try{return res.json(await service.transitionOffering(req.params.offeringId,req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/offerings/:offeringId/summary',(req,res)=>{try{return res.json(service.summary(req.params.offeringId));}catch(e){return fail(res,e);}});
router.get('/subscriptions',(req,res)=>res.json({subscriptions:service.listSubscriptions({offeringId:req.query.offeringId||null,investorId:req.query.investorId||null,state:req.query.state||null})}));
router.post('/subscriptions',async(req,res)=>{try{return res.status(201).json(await service.createSubscription(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/subscriptions/:subscriptionId',(req,res)=>{const item=service.getSubscription(req.params.subscriptionId);return item?res.json(item):res.status(404).json({error:'Capital Formation Subscription not found.'});});
router.post('/subscriptions/:subscriptionId/transition',async(req,res)=>{try{return res.json(await service.transitionSubscription(req.params.subscriptionId,req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
return router;}
