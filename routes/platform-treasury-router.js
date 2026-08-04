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
router.get('/crypto-wallets',(req,res)=>res.json({wallets:service.listCryptoWallets({state:req.query.state||null,network:req.query.network||null})}));
router.post('/crypto-wallets',async(req,res)=>{try{return res.status(201).json(await service.registerHardwareWallet(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/crypto-wallets/dashboard',(_req,res)=>{try{return res.json(service.hardwareWalletDashboard());}catch(e){return fail(res,e);}});
router.get('/crypto-wallets/:walletId',(req,res)=>{const item=service.getCryptoWallet(req.params.walletId);return item?res.json(item):res.status(404).json({error:'Treasury crypto wallet not found.'});});
router.get('/crypto-wallets/:walletId/position',(req,res)=>{try{return res.json(service.cryptoWalletPosition(req.params.walletId));}catch(e){return fail(res,e);}});
router.post('/crypto-wallets/:walletId/state',async(req,res)=>{try{return res.json(await service.updateHardwareWalletState(req.params.walletId,req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/crypto-activity',(req,res)=>res.json({activity:service.listCryptoActivity({walletId:req.query.walletId||null,state:req.query.state||null})}));
router.post('/crypto-activity',async(req,res)=>{try{return res.status(201).json(await service.recordCryptoActivity(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
return router;}
