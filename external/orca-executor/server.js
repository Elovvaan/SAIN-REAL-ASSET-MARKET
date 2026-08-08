import crypto from 'node:crypto';
import express from 'express';
import { OrcaExecutorWorker } from './orca-worker.js';
import { SraTokenWorker } from './sra-token-worker.js';

const port=Number(process.env.PORT||3000),app=express(),worker=new OrcaExecutorWorker(process.env),chain=new SraTokenWorker(process.env);let startupState='STARTING',startupError=null;
app.set('trust proxy',1);app.use(express.json({limit:'256kb'}));
function text(v){return String(v??'').trim();}
function tokenMatches(provided,expected){const a=Buffer.from(`Bearer ${text(expected)}`),b=Buffer.from(text(provided));return Boolean(expected)&&a.length===b.length&&crypto.timingSafeEqual(a,b);}
function solanaAuthorized(req){return tokenMatches(req.get('authorization'),process.env.SOLANA_EXECUTOR_TOKEN||process.env.DEX_ORCA_EXECUTOR_TOKEN||process.env.EXECUTOR_API_TOKEN);}
function dexAuthorized(req){return tokenMatches(req.get('authorization'),process.env.DEX_ORCA_EXECUTOR_TOKEN||process.env.EXECUTOR_API_TOKEN||process.env.SOLANA_EXECUTOR_TOKEN);}
function ready(res){if(startupState==='READY')return true;res.status(503).json({error:'Executor is not ready.',startupState});return false;}
function key(req,res){const value=text(req.get('idempotency-key'));if(!value)res.status(400).json({error:'Idempotency-Key is required.'});return value;}
function fail(res,error,code){const message=String(error?.message||error);const status=/required|invalid|must|address|amount|idempotency|supply|decimal|quantity/i.test(message)?400:502;return res.status(status).json({error:message,code,transactionSignature:error?.transactionSignature||null});}

app.get('/health',async(_req,res)=>{const status=worker.status(),ok=startupState==='READY'&&status.ready;res.status(ok?200:503).json({status:ok?'ok':'degraded',startupState,startupError,executor:status,sraToken:ok?await chain.state().catch(()=>null):null,timestamp:new Date().toISOString()});});
app.get('/wallet',(req,res)=>{if(!ready(res))return;if(!solanaAuthorized(req))return res.status(401).json({error:'Unauthorized.'});return res.json(chain.platformWallet());});
app.post('/transfer',async(req,res)=>{if(!ready(res))return;if(!solanaAuthorized(req))return res.status(401).json({error:'Unauthorized.'});const id=key(req,res);if(!id)return;try{return res.json(await chain.transferSol(req.body||{},id));}catch(error){return fail(res,error,'SOLANA_TRANSFER_FAILED');}});
app.post('/tokens/sra/mint',async(req,res)=>{if(!ready(res))return;if(!solanaAuthorized(req))return res.status(401).json({error:'Unauthorized.'});const id=key(req,res);if(!id)return;try{return res.json(await chain.createSraMint(req.body||{},id));}catch(error){return fail(res,error,'SRA_TOKEN_MINT_FAILED');}});
app.post('/tokens/sra/transfer',async(req,res)=>{if(!ready(res))return;if(!solanaAuthorized(req))return res.status(401).json({error:'Unauthorized.'});const id=key(req,res);if(!id)return;try{return res.json(await chain.transferSra(req.body||{},id));}catch(error){return fail(res,error,'SRA_TOKEN_TRANSFER_FAILED');}});
app.post('/execute',async(req,res)=>{if(!ready(res))return;if(!dexAuthorized(req))return res.status(401).json({error:'Unauthorized.'});const id=key(req,res);if(!id)return;try{return res.json(await worker.execute(req.body||{},id));}catch(error){return fail(res,error,'ORCA_EXECUTION_FAILED');}});

const server=app.listen(port,'0.0.0.0',()=>console.log(JSON.stringify({level:'info',event:'SOLANA_EXECUTOR_LISTENING',port})));server.requestTimeout=Number(process.env.EXECUTOR_REQUEST_TIMEOUT_MS||120000);server.headersTimeout=server.requestTimeout+5000;
try{await worker.initialize();await chain.initialize();startupState='READY';console.log(JSON.stringify({level:'info',event:'SOLANA_EXECUTOR_READY',cluster:worker.status().cluster,platformAddress:chain.platformWallet().address,at:new Date().toISOString()}));}catch(error){startupState='FAILED';startupError={name:error?.name||'Error',message:String(error?.message||error)};console.error(JSON.stringify({level:'error',event:'SOLANA_EXECUTOR_STARTUP_FAILED',...startupError,at:new Date().toISOString()}));}
async function shutdown(signal){startupState='STOPPING';server.close(async()=>{try{await worker.close();await chain.close();}catch{}process.exit(0);});setTimeout(()=>process.exit(1),15000).unref();console.log(JSON.stringify({level:'info',event:'SOLANA_EXECUTOR_STOPPING',signal,at:new Date().toISOString()}));}
process.once('SIGTERM',()=>void shutdown('SIGTERM'));process.once('SIGINT',()=>void shutdown('SIGINT'));
