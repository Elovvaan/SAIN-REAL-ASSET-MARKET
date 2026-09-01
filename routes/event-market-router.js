import { Router } from 'express';

function cookie(req,name){const found=String(req.headers.cookie||'').split(';').map((x)=>x.trim()).find((x)=>x.startsWith(`${name}=`));return found?decodeURIComponent(found.slice(name.length+1)):'';}
function fail(res,error){const message=error?.message||'Event market operation failed.';const status=/not found/i.test(message)?404:/not available|authorization/i.test(message)?403:/already|insufficient|state|open|resolved/i.test(message)?409:400;return res.status(status).json({error:message});}

export function createEventMarketRouter(service,directAccounts,accessService){
  const router=Router();
  async function required(req,res){const current=await accessService.getSession(cookie(req,'sra_session'));if(!current)res.status(401).json({error:'Authentication required.'});return current;}
  const actor=(current)=>({participantId:current.id,capacity:current.activeCapacity});
  router.get('/',(req,res)=>res.json({markets:service.list(req.query)}));
  router.get('/me/positions',async(req,res)=>{const current=await required(req,res);if(!current)return;return res.json({positions:service.participantPositions(current.id)});});
  router.get('/:eventMarketId',(req,res)=>{const detail=service.detail(req.params.eventMarketId);return detail?res.json(detail):res.status(404).json({error:'Event market not found.'});});
  router.post('/',async(req,res)=>{try{const current=await required(req,res);if(!current)return;return res.status(201).json(await service.create(req.body,actor(current)));}catch(error){return fail(res,error);}});
  router.post('/:eventMarketId/review',async(req,res)=>{try{const current=await required(req,res);if(!current)return;return res.json(await service.review(req.params.eventMarketId,req.body,actor(current)));}catch(error){return fail(res,error);}});
  router.post('/:eventMarketId/list',async(req,res)=>{try{const current=await required(req,res);if(!current)return;return res.json(await service.listOnVenue(req.params.eventMarketId,req.body,actor(current)));}catch(error){return fail(res,error);}});
  router.post('/:eventMarketId/orders',async(req,res)=>{try{const current=await required(req,res);if(!current)return;const account=await directAccounts.ensureAccount({participantId:current.id,universalAccountId:current.universalAccountId,displayName:current.displayName},current.id);return res.status(201).json(await service.buy(req.params.eventMarketId,{...req.body,directValueAccountId:req.body?.directValueAccountId||account.directValueAccountId},actor(current)));}catch(error){return fail(res,error);}});
  router.post('/:eventMarketId/signals',async(req,res)=>{try{const current=await required(req,res);if(!current)return;return res.status(201).json(await service.recordSignal(req.params.eventMarketId,req.body,actor(current)));}catch(error){return fail(res,error);}});
  router.post('/:eventMarketId/control',async(req,res)=>{try{const current=await required(req,res);if(!current)return;return res.json(await service.control(req.params.eventMarketId,req.body,actor(current)));}catch(error){return fail(res,error);}});
  router.post('/:eventMarketId/resolution',async(req,res)=>{try{const current=await required(req,res);if(!current)return;return res.status(201).json(await service.resolve(req.params.eventMarketId,req.body,actor(current)));}catch(error){return fail(res,error);}});
  router.post('/:eventMarketId/settlement',async(req,res)=>{try{const current=await required(req,res);if(!current)return;return res.status(201).json(await service.settle(req.params.eventMarketId,req.body,actor(current)));}catch(error){return fail(res,error);}});
  return router;
}
