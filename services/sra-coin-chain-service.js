const TYPE='SRA_COIN_CHAIN_PROJECTION';
function active(p){return String(p?.state||'').toUpperCase()!=='RETIRED'&&String(p?.symbol||'').toUpperCase()==='SRA';}
function n(value){const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;}
export class SraCoinChainService{
  constructor(domain,solana){this.domain=domain;this.solana=solana;this.hydrated=false;}
  async ensure(){if(!this.hydrated){await this.domain.hydrate([TYPE]);this.hydrated=true;}}
  supply(){return Number(this.domain.list('COIN_POSITION').filter(active).reduce((sum,p)=>sum+Number(p.quantity||0),0).toFixed(8));}
  executionReadiness(){return this.solana?.status?.()||{network:'SOLANA',rpcConfigured:false,signerConfigured:false,configured:false,ready:false};}
  async executionHealth(){return this.solana?.health?this.solana.health():this.executionReadiness();}
  async status(){await this.ensure();const platformSupply=this.supply(),onChain=this.domain.get(TYPE,'SRA-SOLANA')||null;return{symbol:'SRA',network:'SOLANA',platformSupply,onChain,execution:this.executionReadiness(),synchronization:{platformSupply,issuedOnChainSupply:Number(onChain?.issuedOnChainSupply||0),pendingQuantity:Number(Math.max(0,platformSupply-Number(onChain?.issuedOnChainSupply||0)).toFixed(8)),state:!onChain?'NOT_ON_CHAIN':platformSupply>Number(onChain.issuedOnChainSupply||0)?'SYNC_AVAILABLE':platformSupply===Number(onChain.issuedOnChainSupply||0)?'SYNCHRONIZED':'RECONCILIATION_REQUIRED'}};}
  async putOnChain(input={},actorId=null){
    await this.ensure();
    const currentSupply=this.supply();
    const targetSupply=input.targetSupply===undefined?currentSupply:Number(Number(input.targetSupply).toFixed(8));
    if(targetSupply<=0)throw new Error('No active SRA coin supply is available to put on chain.');
    if(targetSupply>currentSupply)throw new Error('Approved on-chain target exceeds current authoritative SRA supply.');
    const existing=this.domain.get(TYPE,'SRA-SOLANA');
    const issued=Number(existing?.issuedOnChainSupply||0);
    if(existing&&issued>currentSupply)throw new Error('On-chain issued SRA exceeds current platform supply; reconciliation is required before another mint.');
    if(input.expectedIssuedOnChainSupply!==undefined&&Number(input.expectedIssuedOnChainSupply)!==issued){const error=new Error('The on-chain issued supply changed after approval. Refresh and review the current Chain Operations job.');error.code='SRA_CHAIN_APPROVAL_SNAPSHOT_STALE';throw error;}
    if(targetSupply<issued)throw new Error('Approved on-chain target cannot be below already issued SRA supply.');
    const result=await this.solana.createSraMint({issuanceId:`SRA-SOLANA-${targetSupply.toFixed(8)}`,authorizedSupply:String(targetSupply),decimals:8,mintAddress:existing?.mintAddress||null,platformTokenAccount:existing?.platformTokenAccount||null,issuedSupply:String(issued)});
    const now=new Date().toISOString();
    const projection={...(existing||{}),projectionId:'SRA-SOLANA',symbol:'SRA',network:'SOLANA',mintAddress:result.mintAddress,platformTokenAccount:result.platformTokenAccount,platformSupply:currentSupply,authorizedOnChainSupply:targetSupply,issuedOnChainSupply:result.issuedSupply,transactionSignature:result.transactionSignature||existing?.transactionSignature||null,lastMintedQuantity:Number(result.mintedQuantity||0),status:'ACTIVE',authoritativeRecordType:'COIN_POSITION_AGGREGATE',createdBy:existing?.createdBy||actorId,createdAt:existing?.createdAt||now,updatedBy:actorId,updatedAt:now,lastSynchronizedAt:now};
    await this.domain.put(TYPE,projection.projectionId,projection,{actorId,eventType:existing?'SRA_COIN_ON_CHAIN_SUPPLY_SYNCHRONIZED':'SRA_COIN_PUT_ON_CHAIN'});
    await this.domain.lifecycle({objectType:TYPE,objectId:projection.projectionId,eventType:existing?'SRA_COIN_ON_CHAIN_SUPPLY_SYNCHRONIZED':'SRA_COIN_PUT_ON_CHAIN',actorId,payload:{platformSupply:currentSupply,approvedTargetSupply:targetSupply,issuedOnChainSupply:result.issuedSupply,mintedQuantity:Number(result.mintedQuantity||0),mintAddress:result.mintAddress,transactionSignature:result.transactionSignature||null,snapshotVersion:input.snapshotVersion||null}});
    return projection;
  }
  async send(input={},actorId=null){await this.ensure();const projection=this.domain.get(TYPE,'SRA-SOLANA');if(!projection)throw new Error('SRA has not been put on chain yet.');const result=await this.solana.sendSra({...input,mintAddress:projection.mintAddress,sourceTokenAccount:projection.platformTokenAccount});await this.domain.lifecycle({objectType:TYPE,objectId:projection.projectionId,eventType:'SRA_COIN_ON_CHAIN_TRANSFER',actorId,payload:{destinationAddress:result.destinationAddress,amount:result.amount,transactionSignature:result.transactionSignature}});return result;}
}