import express from 'express';
function actorId(req){return req.headers['x-sra-actor-id']||req.body?.actorId||null;}
function fail(res,error){const message=error?.message||'Unexpected treasury connector error.';return res.status(/not found/i.test(message)?404:400).json({error:message});}
async function treasuryPrimePing(_req,res){
  const keyId=String(process.env.TREASURY_PRIME_ID||'').trim();
  const secretKey=String(process.env.TREASURY_PRIME_SECRET_KEY||'').trim();
  const baseUrl=String(process.env.TREASURY_PRIME_URL||'https://api.sandbox.treasuryprime.com').replace(/\/$/,'');
  if(!keyId||!secretKey)return res.status(503).json({ok:false,error:'Treasury Prime credentials are not configured.'});
  try{
    const authorization=Buffer.from(`${keyId}:${secretKey}`,'utf8').toString('base64');
    const response=await fetch(`${baseUrl}/ping`,{method:'GET',headers:{Authorization:`Basic ${authorization}`,Accept:'application/json'}});
    const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{}
    if(!response.ok)return res.status(502).json({ok:false,status:response.status,error:`Treasury Prime authentication failed (HTTP ${response.status}).`});
    return res.json({ok:true,environment:baseUrl.includes('sandbox')?'SANDBOX':'PRODUCTION',apiVersion:payload.api_version??null,version:payload.version??null,providerTime:payload.time??null,checkedAt:new Date().toISOString()});
  }catch(error){return res.status(502).json({ok:false,error:`Treasury Prime connection failed: ${error?.message||error}`});}
}
export function createTreasuryBankConnectorRouter(service){const router=express.Router();
router.post('/treasury-prime/ping',treasuryPrimePing);
router.get('/connections',(req,res)=>res.json({connections:service.listConnections({institutionId:req.query.institutionId||null,state:req.query.state||null})}));
router.post('/connections',async(req,res)=>{try{return res.status(201).json(await service.createConnection(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/connections/:connectionId',(req,res)=>{const record=service.getConnection(req.params.connectionId);return record?res.json(record):res.status(404).json({error:'Treasury Bank Connection not found.'});});
router.get('/connections/:connectionId/exceptions',(req,res)=>res.json({exceptions:service.exceptionQueue(req.params.connectionId)}));
router.get('/payments',(req,res)=>res.json({payments:service.listPayments({connectionId:req.query.connectionId||null,settlementId:req.query.settlementId||null,state:req.query.state||null})}));
router.post('/payments',async(req,res)=>{try{return res.status(201).json(await service.createPayment(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.get('/payments/:paymentOrderId',(req,res)=>{const record=service.getPayment(req.params.paymentOrderId);return record?res.json(record):res.status(404).json({error:'Treasury Payment Order not found.'});});
router.post('/payments/:paymentOrderId/approve',async(req,res)=>{try{return res.json(await service.approvePayment(req.params.paymentOrderId,req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.post('/payments/:paymentOrderId/submit',async(req,res)=>{try{return res.json(await service.submitPayment(req.params.paymentOrderId,req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.post('/payments/:paymentOrderId/status',async(req,res)=>{try{return res.json(await service.applyBankStatus(req.params.paymentOrderId,req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
router.post('/statements',async(req,res)=>{try{return res.status(201).json(await service.ingestStatement(req.body||{},actorId(req)));}catch(e){return fail(res,e);}});
return router;}
