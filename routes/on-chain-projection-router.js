import express from 'express';
import { ExternalDexAdapterService } from '../services/external-dex-adapter-service.js';
import { SolanaTransferService } from '../services/solana-transfer-service.js';
import { SraCoinChainService } from '../services/sra-coin-chain-service.js';

function actorId(req){return req.get('x-sra-actor-id')||req.body?.actorId||null;}
function handle(res,error){const status=['PROJECTION_INELIGIBLE','DEX_EXPORT_INELIGIBLE'].includes(error.code)?422:error.code==='SOLANA_EXECUTOR_NOT_READY'?503:error.code==='SOLANA_EXECUTOR_REJECTED'?502:/not found/i.test(error.message)?404:400;return res.status(status).json({error:error.message,code:error.code||'ON_CHAIN_PROJECTION_ERROR',assessment:error.assessment||null});}
function normalizeDirectMount(req,_res,next){const prefix='/api/on-chain';if(req.url===prefix)req.url='/';else if(req.url.startsWith(`${prefix}/`))req.url=req.url.slice(prefix.length);next();}

export function createOnChainProjectionRouter(service){
  const router=express.Router();
  router.use(normalizeDirectMount);
  const dex=new ExternalDexAdapterService(service.domain,service);
  const solana=new SolanaTransferService();
  const sraCoin=new SraCoinChainService(service.domain,solana);

  router.get('/status',(_q,r)=>r.json(service.status()));
  router.get('/eligibility/:instrumentId',(q,r)=>r.json(service.evaluateInstrument(q.params.instrumentId)));
  router.get('/projections',(q,r)=>r.json({records:service.listProjections({status:q.query.status,instrumentId:q.query.instrumentId,network:q.query.network})}));
  router.get('/projections/:projectionId',(q,r)=>{const x=service.getProjection(q.params.projectionId);return x?r.json(x):r.status(404).json({error:'Projection not found.'});});
  router.post('/projections',async(q,r)=>{try{return r.status(201).json(await service.createProjection(q.body,actorId(q)));}catch(e){return handle(r,e);}});
  router.post('/projections/:projectionId/approve',async(q,r)=>{try{return r.json(await service.approveProjection(q.params.projectionId,actorId(q)));}catch(e){return handle(r,e);}});
  router.post('/projections/:projectionId/mint',async(q,r)=>{try{return r.status(201).json(await service.createMint(q.params.projectionId,q.body,actorId(q)));}catch(e){return handle(r,e);}});
  router.post('/projections/:projectionId/allocate',async(q,r)=>{try{return r.status(201).json(await service.allocate(q.params.projectionId,q.body,actorId(q)));}catch(e){return handle(r,e);}});
  router.get('/wallets',(q,r)=>r.json({records:service.listWallets({participantId:q.query.participantId,status:q.query.status})}));
  router.post('/wallets',async(q,r)=>{try{return r.status(201).json(await service.registerWallet(q.body,actorId(q)));}catch(e){return handle(r,e);}});
  router.post('/wallets/:walletId/approve',async(q,r)=>{try{return r.json(await service.approveWallet(q.params.walletId,q.body,actorId(q)));}catch(e){return handle(r,e);}});
  router.get('/events',(q,r)=>r.json({records:service.listChainEvents(q.query.projectionId||null)}));
  router.post('/events',async(q,r)=>{try{return r.status(201).json(await service.recordChainEvent(q.body,actorId(q)));}catch(e){return handle(r,e);}});
  router.post('/events/:eventId/reconcile',async(q,r)=>{try{return r.json(await service.reconcileEvent(q.params.eventId,actorId(q)));}catch(e){return handle(r,e);}});
  router.get('/reconciliations',(q,r)=>r.json({records:service.listReconciliations(q.query.projectionId||null)}));

  router.get('/solana/status',(_q,r)=>r.json(solana.status()));
  router.get('/solana/wallet',async(_q,r)=>{try{return r.json(await solana.wallet());}catch(e){return handle(r,e);}});
  router.post('/solana/transfers',async(q,r)=>{try{return r.status(201).json(await solana.send(q.body||{}));}catch(e){return handle(r,e);}});
  router.get('/solana/sra',async(_q,r)=>{try{return r.json(await sraCoin.status());}catch(e){return handle(r,e);}});
  router.post('/solana/sra/mint',async(q,r)=>{try{return r.status(201).json(await sraCoin.putOnChain(q.body||{},actorId(q)));}catch(e){return handle(r,e);}});
  router.post('/solana/sra/transfers',async(q,r)=>{try{return r.status(201).json(await sraCoin.send(q.body||{},actorId(q)));}catch(e){return handle(r,e);}});

  router.get('/dex/status',async(_q,r)=>{try{return r.json(await dex.status());}catch(e){return handle(r,e);}});
  router.get('/dex/venues',(_q,r)=>r.json({records:dex.venues()}));
  router.get('/dex/exports',async(q,r)=>{try{return r.json({records:await dex.listExports({state:q.query.state,venue:q.query.venue,exportPackageId:q.query.exportPackageId})});}catch(e){return handle(r,e);}});
  router.get('/dex/exports/:dexExportId',async(q,r)=>{try{const x=await dex.getExport(q.params.dexExportId);return x?r.json(x):r.status(404).json({error:'DEX export was not found.'});}catch(e){return handle(r,e);}});
  router.post('/dex/exports/preview',(q,r)=>{try{return r.json(dex.preview(q.body||{}));}catch(e){return handle(r,e);}});
  router.post('/dex/exports',async(q,r)=>{try{return r.status(201).json(await dex.prepare(q.body||{},actorId(q)));}catch(e){return handle(r,e);}});
  router.post('/dex/exports/:dexExportId/submitted',async(q,r)=>{try{return r.json(await dex.markSubmitted(q.params.dexExportId,q.body||{},actorId(q)));}catch(e){return handle(r,e);}});
  router.post('/dex/exports/:dexExportId/confirm',async(q,r)=>{try{return r.status(201).json(await dex.confirm(q.params.dexExportId,q.body||{},actorId(q)));}catch(e){return handle(r,e);}});
  return router;
}
