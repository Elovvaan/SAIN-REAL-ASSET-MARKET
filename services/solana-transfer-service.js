import crypto from 'node:crypto';

function text(value){return String(value??'').trim();}
function exactAmount(value,decimals,name='amount'){const source=text(value);if(!/^\d+(?:\.\d+)?$/.test(source))throw new Error(`${name} must be a positive decimal amount.`);const [whole,fraction='']=source.split('.');if(fraction.length>decimals)throw new Error(`${name} cannot exceed ${decimals} decimal places.`);if(BigInt(`${whole}${fraction.padEnd(decimals,'0')}`)<=0n)throw new Error(`${name} must be greater than zero.`);return source;}

export class SolanaTransferService{
  constructor(options={}){this.environment=options.environment||process.env;this.fetchImpl=options.fetchImpl||globalThis.fetch;this.timeoutMs=Math.max(1000,Number(this.environment.SOLANA_EXECUTOR_TIMEOUT_MS||120000));}
  endpoint(){return text(this.environment.SOLANA_EXECUTOR_ENDPOINT).replace(/\/$/,'');}
  token(){return text(this.environment.SOLANA_EXECUTOR_TOKEN);}
  status(){const endpointConfigured=Boolean(this.endpoint()),credentialConfigured=Boolean(this.token());return{service:'SRA Solana Transfer',network:'SOLANA',endpointConfigured,credentialConfigured,configured:endpointConfigured&&credentialConfigured,ready:endpointConfigured&&credentialConfigured};}
  async health(){
    const configuration=this.status();
    if(!configuration.endpointConfigured)return{...configuration,reachable:false,executorReady:false,startupState:'NOT_CONFIGURED',worker:null,wallet:null,sraToken:null,error:'SOLANA_EXECUTOR_ENDPOINT is not configured.'};
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.min(this.timeoutMs,10000));
    try{
      const response=await this.fetchImpl(`${this.endpoint()}/health`,{method:'GET',headers:{Accept:'application/json'},signal:controller.signal});
      const payload=await response.json().catch(()=>({}));
      const executorReady=Boolean(response.ok&&payload.status==='ok'&&payload.startupState==='READY');
      return{...configuration,reachable:true,executorReady,ready:configuration.configured&&executorReady,startupState:payload.startupState||null,startupError:payload.startupError||null,worker:payload.executor||null,wallet:payload.wallet||null,sraToken:payload.sraToken||null,error:response.ok?null:(payload.error||`Solana executor health returned HTTP ${response.status}.`)};
    }catch(error){return{...configuration,reachable:false,executorReady:false,ready:false,startupState:'UNREACHABLE',worker:null,wallet:null,sraToken:null,error:error?.name==='AbortError'?'Solana executor health check timed out.':String(error?.message||error)};}
    finally{clearTimeout(timer);}
  }
  async request(path,options={}){if(!this.status().configured){const error=new Error('Solana executor is not configured.');error.code='SOLANA_EXECUTOR_NOT_READY';throw error;}const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);try{const response=await this.fetchImpl(`${this.endpoint()}${path}`,{...options,signal:controller.signal,headers:{Accept:'application/json',Authorization:`Bearer ${this.token()}`,...(options.headers||{})}});const payload=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(payload.error||`Solana executor returned HTTP ${response.status}.`);error.code=payload.code||'SOLANA_EXECUTOR_REJECTED';throw error;}return payload;}finally{clearTimeout(timer);}}
  async wallet(){return this.request('/wallet');}
  async send(input={}){const destinationAddress=text(input.destinationAddress),amount=exactAmount(input.amount,9),transferId=text(input.transferId)||`SOL-${crypto.randomUUID().split('-')[0].toUpperCase()}`;if(!destinationAddress)throw new Error('destinationAddress is required.');return this.request('/transfer',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':transferId},body:JSON.stringify({transferId,destinationAddress,amount,asset:'SOL'})});}
  async createSraMint(input={}){const issuanceId=text(input.issuanceId)||`SRA-MINT-${crypto.randomUUID().split('-')[0].toUpperCase()}`,authorizedSupply=exactAmount(input.authorizedSupply,8,'authorizedSupply');return this.request('/tokens/sra/mint',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':issuanceId},body:JSON.stringify({issuanceId,authorizedSupply,decimals:Number.isInteger(input.decimals)?input.decimals:8})});}
  async sendSra(input={}){const destinationAddress=text(input.destinationAddress),amount=exactAmount(input.amount,8),transferId=text(input.transferId)||`SRA-${crypto.randomUUID().split('-')[0].toUpperCase()}`;if(!destinationAddress)throw new Error('destinationAddress is required.');return this.request('/tokens/sra/transfer',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':transferId},body:JSON.stringify({transferId,destinationAddress,amount})});}
}