import express from 'express';
function actorId(req){return req.headers['x-sra-actor-id']||req.body?.actorId||null;}
function fail(res,error){const message=error?.message||'Unexpected platform ledger error.';return res.status(/not found/i.test(message)?404:400).json({error:message});}
export function createPlatformLedgerRouter(service){const router=express.Router();
router.get('/accounts',(req,res)=>res.json({accounts:service.listAccounts({type:req.query.type||null,state:req.query.state||null})}));
router.post('/accounts',async(req,res)=>{try{return res.status(201).json(await service.createAccount(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/accounts/:accountId',(req,res)=>{const item=service.getAccount(req.params.accountId);return item?res.json(item):res.status(404).json({error:'Ledger Account not found.'});});
router.get('/accounts/:accountId/balance',(req,res)=>{try{return res.json(service.balance(req.params.accountId));}catch(e){return fail(res,e);}});
router.get('/entries',(req,res)=>res.json({entries:service.listEntries({referenceId:req.query.referenceId||null,accountId:req.query.accountId||null,state:req.query.state||null})}));
router.post('/entries',async(req,res)=>{try{return res.status(201).json(await service.post(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/entries/:entryId',(req,res)=>{const item=service.getEntry(req.params.entryId);return item?res.json(item):res.status(404).json({error:'Ledger Entry not found.'});});
router.get('/trial-balance',(req,res)=>{try{return res.json(service.trialBalance());}catch(e){return fail(res,e);}});
router.post('/invoice-payments',async(req,res)=>{try{return res.status(201).json(await service.recordInvoicePayment(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
return router;}
