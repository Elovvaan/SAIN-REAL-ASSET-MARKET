import express from 'express';
import { randomUUID } from 'node:crypto';
function actorId(req){return req.headers['x-sra-actor-id']||req.body?.actorId||null;}
function fail(res,error){const message=error?.message||'Unexpected treasury connector error.';return res.status(/not found/i.test(message)?404:400).json({error:message});}
function treasuryPrimeConfig(){
  const keyId=String(process.env.TREASURY_PRIME_ID||'').trim();
  const secretKey=String(process.env.TREASURY_PRIME_SECRET_KEY||'').trim();
  const baseUrl=String(process.env.TREASURY_PRIME_URL||'https://api.sandbox.treasuryprime.com').replace(/\/$/,'');
  if(!keyId||!secretKey)throw Object.assign(new Error('Treasury Prime credentials are not configured.'),{status:503});
  return {keyId,secretKey,baseUrl};
}
async function treasuryPrimeRequest(path,{method='GET',body=null,idempotencyKey=null}={}){
  const {keyId,secretKey,baseUrl}=treasuryPrimeConfig();
  const authorization=Buffer.from(`${keyId}:${secretKey}`,'utf8').toString('base64');
  const headers={Authorization:`Basic ${authorization}`,Accept:'application/json'};
  if(body!==null)headers['Content-Type']='application/json';
  if(idempotencyKey)headers['X-Idempotency-Key']=idempotencyKey;
  const response=await fetch(`${baseUrl}${path}`,{method,headers,body:body===null?undefined:JSON.stringify(body)});
  const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{}
  if(!response.ok){const error=new Error(payload?.error||`Treasury Prime request failed (HTTP ${response.status}).`);error.status=response.status;throw error;}
  return {payload,baseUrl};
}
async function treasuryPrimePing(_req,res){
  try{
    const {payload,baseUrl}=await treasuryPrimeRequest('/ping');
    return res.json({ok:true,environment:baseUrl.includes('sandbox')?'SANDBOX':'PRODUCTION',apiVersion:payload.api_version??null,version:payload.version??null,providerTime:payload.time??null,checkedAt:new Date().toISOString()});
  }catch(error){return res.status(error.status===503?503:502).json({ok:false,error:`Treasury Prime connection failed: ${error?.message||error}`});}
}
async function treasuryPrimeAccounts(_req,res){
  try{
    const {payload,baseUrl}=await treasuryPrimeRequest('/account');
    const accounts=(payload?.data||[]).map((account)=>({id:account.id,name:account.name||account.account_type||account.id,accountType:account.account_type||null,availableBalance:account.available_balance??null,currentBalance:account.current_balance??null,status:account.status||null,last4:String(account.account_number||'').slice(-4)||null}));
    return res.json({ok:true,environment:baseUrl.includes('sandbox')?'SANDBOX':'PRODUCTION',accounts});
  }catch(error){return res.status(error.status===503?503:502).json({ok:false,error:`Treasury Prime account lookup failed: ${error?.message||error}`});}
}
async function treasuryPrimeCounterparties(_req,res){
  try{
    const {payload,baseUrl}=await treasuryPrimeRequest('/counterparty');
    const counterparties=(payload?.data||[]).map((counterparty)=>({id:counterparty.id,name:counterparty.name||counterparty.id,accountType:counterparty.ach?.account_type||null,last4:String(counterparty.ach?.account_number||'').slice(-4)||null,routingLast4:String(counterparty.ach?.routing_number||'').slice(-4)||null,achAvailable:Boolean(counterparty.ach?.account_number&&counterparty.ach?.routing_number)})).filter((item)=>item.achAvailable);
    return res.json({ok:true,environment:baseUrl.includes('sandbox')?'SANDBOX':'PRODUCTION',counterparties});
  }catch(error){return res.status(error.status===503?503:502).json({ok:false,error:`Treasury Prime counterparty lookup failed: ${error?.message||error}`});}
}
async function treasuryPrimeAchTest(req,res){
  try{
    const {baseUrl}=treasuryPrimeConfig();
    if(!baseUrl.includes('sandbox'))return res.status(400).json({ok:false,error:'Treasury Prime ACH test is restricted to the sandbox environment.'});
    const accountId=String(req.body?.accountId||'').trim();
    const counterpartyId=String(req.body?.counterpartyId||'').trim();
    if(!accountId||!counterpartyId)return res.status(400).json({ok:false,error:'Select a sandbox account and ACH counterparty before testing.'});
    const body={account_id:accountId,amount:'1.00',counterparty_id:counterpartyId,direction:'credit',sec_code:'ccd'};
    const {payload}=await treasuryPrimeRequest('/ach',{method:'POST',body,idempotencyKey:`sra-sandbox-${randomUUID()}`});
    return res.status(201).json({ok:true,achId:payload.id??null,status:payload.status??null,amount:payload.amount??'1.00',direction:payload.direction??'credit',effectiveDate:payload.effective_date??null,createdAt:payload.created_at??null});
  }catch(error){return res.status(error.status===503?503:502).json({ok:false,error:`Treasury Prime ACH test failed: ${error?.message||error}`});}
}
export function createTreasuryBankConnectorRouter(service){const router=express.Router();
router.post('/treasury-prime/ping',treasuryPrimePing);
router.get('/treasury-prime/accounts',treasuryPrimeAccounts);
router.get('/treasury-prime/counterparties',treasuryPrimeCounterparties);
router.post('/treasury-prime/ach-test',treasuryPrimeAchTest);
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
