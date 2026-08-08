import express from 'express';
import { OrcaExecutorWorker } from './orca-worker.js';
import { SraTokenWorker } from './sra-token-worker.js';

const port=Number(process.env.PORT||3000);const app=express();const worker=new OrcaExecutorWorker(process.env);const sraToken=new SraTokenWorker(process.env);let startupState='STARTING';let startupError=null;
app.set('trust proxy',1);app.use(express.json({limit:'256kb'}));
function authorized(req){return worker.authenticate(req.get('authorization'));}
function guard(req,res){if(startupState!=='READY'){res.status(503).json({error:'Executor is not ready.',startupState});return false;}if(!authorized(req)){res.status(401).json({error:'Unauthorized.'});return false;}return true;}
function key(req,res){const value=String(req.get('idempotency-key')||'').trim();if(!value)res.status(400).json({error:'Idempotency-Key is required.'});return value;}
function failure(res,error,code){const message=String(error?.message||error);const status=/required|invalid|must|address|amount|idempotency|supports|decimals|supply/i.test(message)?400:502;return res.status(status).json({error:message,code});}

app.get('/health',async(_req,res)=>{const status=worker.status();const ok=startupState==='READY'&&status.ready;res.status(ok?200:503).json({status:ok?'ok':'degraded',startupState,startupError,executor:status,sraToken:ok?await sraToken.state().catch(()=>null):null,timestamp:new Date().toISOString()});});
app.get('/wallet',(req,res)=>{if(!guard(req,res))return;return res.json(worker.platformWallet());});
app.post('/transfer',async(req,res)=>{if(!guard(req,res))return;const id=key(req,res);if(!id)return;try{return res.json(await worker.transferSol(req.body||{},id));}catch(error){return failure(res,error,'SOLANA_TRANSFER_FAILED');}});
app.post('/tokens/sra/mint',async(req,res)=>{if(!guard(req,res))return;const id=key(req,res);if(!id)return;try{return res.json(await sraToken.createSraMint(req.body||{},id));}catch(error){return failure(res,error,'SRA_TOKEN_MINT_FAILED');}});
app.post('/tokens/sra/transfer',async(req,res)=>{if(!guard(req,res))return;const id=key(req,res);if(!id)return;try{return res.json(await sraToken.transferSra(req.body||{},id));}catch(error){return failure(res,error,'SRA_TOKEN_TRANSFER_FAILED');}});
app.post('/execute',async(req,res)=>{if(!guard(req,res))return;const id=key(req,res);if(!id)return;try{return res.json(await worker.execute(req.body||{},id));}catch(error){const message=String(error?.message||error);const status=/required|unsupported|invalid|must|precision|idempotency/i.test(message)?400:/already exists/i.test(message)?409:502;return res.status(status).json({error:message,code:'ORCA_EXECUTION_FAILED'});}});

const server=app.listen(port,'0.0.0.0',()=>console.log(JSON.stringify({level:'info',event:'SOLANA_EXECUTOR_LISTENING',port})));server.requestTimeout=Number(process.env.EXECUTOR_REQUEST_TIMEOUT_MS||120000);server.headersTimeout=server.requestTimeout+5000;
try{await worker.initialize();await sraToken.initialize();startupState='READY';console.log(JSON.stringify({level:'info',event:'SOLANA_EXECUTOR_READY',cluster:worker.status().cluster,platformAddress:worker.status().platformAddress,at:new Date().toISOString()}));}catch(error){startupState='FAILED';startupError={name:error?.name||'Error',message:String(error?.message||error)};console.error(JSON.stringify({level:'error',event:'SOLANA_EXECUTOR_STARTUP_FAILED',...startupError,at:new Date().toISOString()}));}
async function shutdown(signal){startupState='STOPPING';server.close(async()=>{try{await worker.close();await sraToken.close();}catch{}process.exit(0);});setTimeout(()=>process.exit(1),15000).unref();console.log(JSON.stringify({level:'info',event:'SOLANA_EXECUTOR_STOPPING',signal,at:new Date().toISOString()}));}
process.once('SIGTERM',()=>void shutdown('SIGTERM'));process.once('SIGINT',()=>void shutdown('SIGINT'));
