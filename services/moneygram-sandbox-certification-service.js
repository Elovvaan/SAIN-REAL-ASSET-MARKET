import crypto from 'node:crypto';

const TYPE = 'MONEYGRAM_SANDBOX_CERTIFICATION_TEST';
const TESTS = Object.freeze({ CASH_OUT:'withdraw', CASH_OUT_REFUND:'withdraw', CASH_IN:'deposit' });
const text = (value) => String(value ?? '').trim();
const now = () => new Date().toISOString();
function safeUrl(value) { const raw=text(value); if(!raw)return null; try { const url=new URL(raw); return url.protocol==='https:'?url.toString():null; } catch { return null; } }

function publicTransaction(value = {}) {
  const source = value.transaction || value;
  return {
    id:text(source.id) || null,
    kind:text(source.kind) || null,
    status:text(source.status) || null,
    statusEta:Number.isFinite(Number(source.status_eta)) ? Number(source.status_eta) : null,
    amountIn:text(source.amount_in) || null,
    amountOut:text(source.amount_out) || null,
    amountFee:text(source.amount_fee) || null,
    startedAt:text(source.started_at) || null,
    completedAt:text(source.completed_at) || null,
    updatedAt:text(source.updated_at) || null,
    message:text(source.message) || null,
    moreInfoUrl:safeUrl(source.more_info_url),
    stellarTransactionId:text(source.stellar_transaction_id) || null,
    externalTransactionId:text(source.external_transaction_id) || null,
    withdrawAnchorAccount:text(source.withdraw_anchor_account) || null,
    withdrawMemo:text(source.withdraw_memo) || null,
    withdrawMemoType:text(source.withdraw_memo_type) || null,
    refunded:Boolean(source.refunds || text(source.status).toLowerCase() === 'refunded'),
  };
}

export class MoneyGramSandboxCertificationService {
  constructor({ domain, sep24 }) { this.domain=domain; this.sep24=sep24; }
  status(){
    const sep24=this.sep24.status();
    const tests=this.list();
    return { ...sep24, sandboxOnly:true, tests, completedTests:[...new Set(tests.filter((item)=>['completed','refunded'].includes(String(item.anchorStatus).toLowerCase())).map((item)=>item.testType))] };
  }
  list(){ return this.domain.list(TYPE).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))); }
  get(id){ return this.domain.get(TYPE,id); }
  async start(input={},actorId=null){
    const sep24=this.sep24.status();
    if(sep24.mode!=='SANDBOX'||sep24.network!=='TESTNET') throw new Error('MoneyGram certification tests are locked to SEP-24 SANDBOX on Stellar TESTNET.');
    if(!sep24.ready) throw new Error('MoneyGram sandbox credentials are not ready.');
    const testType=text(input.testType).toUpperCase();
    const kind=TESTS[testType];
    if(!kind) throw new Error('Test type must be CASH_OUT, CASH_OUT_REFUND, or CASH_IN.');
    const amount=Number(input.amount);
    if(!Number.isFinite(amount)||amount<=0) throw new Error('A positive sandbox amount is required.');
    const started=await this.sep24.startInteractive({ kind, amount:String(amount), userId:input.userId });
    if(!started.transactionId) throw new Error('MoneyGram did not return a sandbox transaction ID.');
    const timestamp=now();
    const record={ certificationTestId:`MGTEST-${crypto.randomUUID()}`, provider:'MONEYGRAM_RAMPS', environment:'SANDBOX', network:'TESTNET', asset:'USDC', testType, kind, amount:String(amount), anchorDomain:started.anchorDomain, transactionId:started.transactionId, interactiveUrl:started.interactiveUrl, account:started.account, authAccount:started.authAccount, userId:started.userId, anchorStatus:'interactive_started', evidence:{ transactionId:started.transactionId, stellarTransactionId:null, externalTransactionId:null }, statusHistory:[{ status:'interactive_started', at:timestamp }], createdAt:timestamp, updatedAt:timestamp };
    await this.domain.put(TYPE,record.certificationTestId,record,{actorId,eventType:'MONEYGRAM_SANDBOX_CERTIFICATION_TEST_STARTED'});
    return record;
  }
  async refresh(id,actorId=null){
    const current=this.get(id);
    if(!current) throw new Error('MoneyGram sandbox certification test not found.');
    const result=await this.sep24.getTransaction({ transactionId:current.transactionId, userId:current.userId });
    const transaction=publicTransaction(result);
    const anchorStatus=transaction.status || current.anchorStatus;
    const timestamp=now();
    const changed=anchorStatus!==current.anchorStatus;
    const record={ ...current, anchorStatus, transaction, interactiveUrl:transaction.moreInfoUrl || current.interactiveUrl, evidence:{ transactionId:current.transactionId, stellarTransactionId:transaction.stellarTransactionId, externalTransactionId:transaction.externalTransactionId }, statusHistory:changed?[...(current.statusHistory||[]),{status:anchorStatus,at:timestamp}]:current.statusHistory, updatedAt:timestamp };
    await this.domain.put(TYPE,id,record,{actorId,eventType:'MONEYGRAM_SANDBOX_CERTIFICATION_TEST_REFRESHED'});
    return record;
  }
  evidence(){
    return { provider:'MoneyGram Ramps', environment:'SANDBOX', network:'Stellar Testnet', generatedAt:now(), warning:'Sandbox evidence only. Testnet assets have no monetary value.', tests:this.list().map(({certificationTestId,testType,kind,amount,transactionId,anchorStatus,evidence,statusHistory,createdAt,updatedAt})=>({certificationTestId,testType,kind,amount,transactionId,anchorStatus,evidence,statusHistory,createdAt,updatedAt})) };
  }
}
