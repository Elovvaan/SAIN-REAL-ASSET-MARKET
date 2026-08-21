const DEFAULT_INCREASE_URL='https://api.increase.com';
const DEFAULT_TREASURY_PRIME_URL='https://api.sandbox.treasuryprime.com';

function required(value,name){
  const text=String(value||'').trim();
  if(!text)throw new Error(`${name} is required for ACH bank API submission.`);
  return text;
}
function safeText(value,max){return String(value||'').trim().slice(0,max);}

export class BankAchOriginationService{
  constructor(options={}){
    this.fetchImpl=options.fetchImpl||globalThis.fetch;
    const treasuryPrimeConfigured=Boolean(options.treasuryPrimeId??process.env.TREASURY_PRIME_ID)&&Boolean(options.treasuryPrimeSecretKey??process.env.TREASURY_PRIME_SECRET_KEY);
    this.provider=String(options.provider??process.env.SRA_ACH_BANK_API_PROVIDER??(treasuryPrimeConfigured?'TREASURY_PRIME':'INCREASE')).trim().toUpperCase();
    this.apiKey=options.apiKey??process.env.INCREASE_API_KEY??null;
    this.accountId=options.accountId??process.env.INCREASE_ACCOUNT_ID??null;
    this.baseUrl=String(options.baseUrl??process.env.INCREASE_URL??DEFAULT_INCREASE_URL).replace(/\/$/,'');
    this.companyName=options.companyName??process.env.SRA_ACH_COMPANY_NAME??'SRA';
    this.requireApproval=options.requireApproval??String(process.env.INCREASE_ACH_REQUIRE_APPROVAL||'false').toLowerCase()==='true';
    this.treasuryPrimeId=options.treasuryPrimeId??process.env.TREASURY_PRIME_ID??null;
    this.treasuryPrimeSecretKey=options.treasuryPrimeSecretKey??process.env.TREASURY_PRIME_SECRET_KEY??null;
    this.treasuryPrimeUrl=String(options.treasuryPrimeUrl??process.env.TREASURY_PRIME_URL??DEFAULT_TREASURY_PRIME_URL).replace(/\/$/,'');
    this.treasuryPrimeAccountId=options.treasuryPrimeAccountId??process.env.TREASURY_PRIME_ACCOUNT_ID??null;
  }

  status(){
    const configured=this.provider==='TREASURY_PRIME'
      ? Boolean(this.treasuryPrimeId)&&Boolean(this.treasuryPrimeSecretKey)&&Boolean(this.treasuryPrimeAccountId)&&typeof this.fetchImpl==='function'
      : this.provider==='INCREASE'&&Boolean(this.apiKey)&&Boolean(this.accountId)&&typeof this.fetchImpl==='function';
    return {provider:this.provider,configured,baseUrl:this.provider==='TREASURY_PRIME'?this.treasuryPrimeUrl:this.baseUrl,accountId:configured?(this.provider==='TREASURY_PRIME'?this.treasuryPrimeAccountId:this.accountId):null};
  }

  assertConfigured(){
    if(this.provider==='TREASURY_PRIME'){
      required(this.treasuryPrimeId,'TREASURY_PRIME_ID');
      required(this.treasuryPrimeSecretKey,'TREASURY_PRIME_SECRET_KEY');
      required(this.treasuryPrimeAccountId,'TREASURY_PRIME_ACCOUNT_ID');
    }else if(this.provider==='INCREASE'){
      required(this.apiKey,'INCREASE_API_KEY');
      required(this.accountId,'INCREASE_ACCOUNT_ID');
    }else throw new Error(`Unsupported ACH bank API provider: ${this.provider||'none'}.`);
    if(typeof this.fetchImpl!=='function')throw new Error('Server fetch is unavailable for ACH bank API submission.');
  }

  async increaseRequest(path,{method='GET',body=null,idempotencyKey=null}={}){
    this.assertConfigured();
    const headers={Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'};
    if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
    const response=await this.fetchImpl(`${this.baseUrl}${path}`,{method,headers,body:body===null?undefined:JSON.stringify(body)});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(payload?.detail||payload?.title||payload?.error||`ACH bank API request failed with HTTP ${response.status}.`);error.code=payload?.type||'ACH_BANK_API_ERROR';error.httpStatus=response.status;throw error;}
    return payload;
  }

  async treasuryPrimeRequest(path,{method='GET',body=null}={}){
    this.assertConfigured();
    const authorization=Buffer.from(`${this.treasuryPrimeId}:${this.treasuryPrimeSecretKey}`,'utf8').toString('base64');
    const headers={Authorization:`Basic ${authorization}`,Accept:'application/json'};
    if(body!==null)headers['Content-Type']='application/json';
    const response=await this.fetchImpl(`${this.treasuryPrimeUrl}${path}`,{method,headers,body:body===null?undefined:JSON.stringify(body)});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(payload?.error||payload?.message||`Treasury Prime ACH request failed with HTTP ${response.status}.`);error.code='ACH_BANK_API_ERROR';error.httpStatus=response.status;throw error;}
    return payload;
  }

  async treasuryPrimeCounterparty(instruction){
    const body={name_on_account:required(instruction.beneficiaryName,'beneficiaryName'),ach:{account_number:required(instruction.receivingAccountReference,'receivingAccountReference'),account_type:String(instruction.accountType||'checking').toLowerCase()==='savings'?'savings':'checking',routing_number:required(instruction.routingNumber,'routingNumber')},userdata:{sra_instruction_id:instruction.instructionId,sra_export_package_id:instruction.exportPackageId||null}};
    const counterparty=await this.treasuryPrimeRequest('/counterparty',{method:'POST',body});
    if(!counterparty?.id)throw new Error('Treasury Prime did not return a counterparty identifier.');
    return counterparty;
  }

  async submit(instruction){
    if(!instruction)throw new Error('Settlement instruction is required.');
    if(String(instruction.rail||'').toUpperCase()!=='ACH')throw new Error('Bank ACH origination only accepts ACH instructions.');
    if(!['READY','EXCEPTION','DISPATCHED'].includes(String(instruction.state||'').toUpperCase()))throw new Error(`ACH instruction cannot be submitted from ${instruction.state}.`);

    if(this.provider==='TREASURY_PRIME'){
      const counterparty=await this.treasuryPrimeCounterparty(instruction);
      const body={account_id:required(this.treasuryPrimeAccountId,'TREASURY_PRIME_ACCOUNT_ID'),amount:Number(instruction.amount).toFixed(2),counterparty_id:counterparty.id,direction:'credit',sec_code:'ccd',service:'standard',userdata:{sra_instruction_id:instruction.instructionId,sra_export_package_id:instruction.exportPackageId||null}};
      if(!Number.isFinite(Number(instruction.amount))||Number(instruction.amount)<=0)throw new Error('ACH instruction amount must be a positive numeric value.');
      const transfer=await this.treasuryPrimeRequest('/ach',{method:'POST',body});
      if(!transfer?.id)throw new Error('Treasury Prime did not return an ACH transfer identifier.');
      return {provider:'TREASURY_PRIME',institutionTransactionReference:transfer.id,providerStatus:transfer.status||null,networkReference:transfer.trace_number||transfer.bankdata?.trace_number||null,submittedAt:transfer.created_at||new Date().toISOString(),transfer};
    }

    const accountNumber=required(instruction.receivingAccountReference,'receivingAccountReference');
    const routingNumber=required(instruction.routingNumber,'routingNumber');
    const amount=Math.round(Number(instruction.amount)*100);
    if(!Number.isSafeInteger(amount)||amount<=0)throw new Error('ACH instruction amount must convert to a positive whole-cent amount.');
    const payload={account_id:required(this.accountId,'INCREASE_ACCOUNT_ID'),account_number:accountNumber,amount,routing_number:routingNumber,funding:String(instruction.accountType||'CHECKING').toUpperCase()==='SAVINGS'?'savings':'checking',statement_descriptor:safeText(instruction.remittanceReference||instruction.exportPackageId||instruction.instructionId,200)||'SRA ACH',company_name:safeText(this.companyName,16)||'SRA',individual_name:safeText(instruction.beneficiaryName,22)||undefined,standard_entry_class_code:'corporate_credit_or_debit',require_approval:Boolean(this.requireApproval)};
    if(payload.individual_name===undefined)delete payload.individual_name;
    const transfer=await this.increaseRequest('/ach_transfers',{method:'POST',body:payload,idempotencyKey:`sra-${instruction.instructionId}`});
    if(!transfer?.id)throw new Error('ACH bank API did not return a transfer identifier.');
    return {provider:'INCREASE',institutionTransactionReference:transfer.id,providerStatus:transfer.status||null,networkReference:transfer.submission?.trace_number||null,submittedAt:transfer.submission?.submitted_at||transfer.created_at||new Date().toISOString(),transfer};
  }

  async retrieve(institutionTransactionReference){
    const reference=required(institutionTransactionReference,'institutionTransactionReference');
    return this.provider==='TREASURY_PRIME'?this.treasuryPrimeRequest(`/ach/${encodeURIComponent(reference)}`):this.increaseRequest(`/ach_transfers/${encodeURIComponent(reference)}`);
  }
}
