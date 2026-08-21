const DEFAULT_INCREASE_URL='https://api.increase.com';

function required(value,name){
  const text=String(value||'').trim();
  if(!text)throw new Error(`${name} is required for ACH bank API submission.`);
  return text;
}

function safeText(value,max){return String(value||'').trim().slice(0,max);}

export class BankAchOriginationService{
  constructor(options={}){
    this.fetchImpl=options.fetchImpl||globalThis.fetch;
    this.provider=String(options.provider??process.env.SRA_ACH_BANK_API_PROVIDER??'INCREASE').trim().toUpperCase();
    this.apiKey=options.apiKey??process.env.INCREASE_API_KEY??null;
    this.accountId=options.accountId??process.env.INCREASE_ACCOUNT_ID??null;
    this.baseUrl=String(options.baseUrl??process.env.INCREASE_URL??DEFAULT_INCREASE_URL).replace(/\/$/,'');
    this.companyName=options.companyName??process.env.SRA_ACH_COMPANY_NAME??'SRA';
    this.requireApproval=options.requireApproval??String(process.env.INCREASE_ACH_REQUIRE_APPROVAL||'false').toLowerCase()==='true';
  }

  status(){
    const configured=this.provider==='INCREASE'&&Boolean(this.apiKey)&&Boolean(this.accountId)&&typeof this.fetchImpl==='function';
    return {provider:this.provider,configured,baseUrl:this.baseUrl,accountId:configured?this.accountId:null};
  }

  assertConfigured(){
    if(this.provider!=='INCREASE')throw new Error(`Unsupported ACH bank API provider: ${this.provider||'none'}.`);
    required(this.apiKey,'INCREASE_API_KEY');
    required(this.accountId,'INCREASE_ACCOUNT_ID');
    if(typeof this.fetchImpl!=='function')throw new Error('Server fetch is unavailable for ACH bank API submission.');
  }

  async increaseRequest(path,{method='GET',body=null,idempotencyKey=null}={}){
    this.assertConfigured();
    const headers={Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'};
    if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
    const response=await this.fetchImpl(`${this.baseUrl}${path}`,{method,headers,body:body===null?undefined:JSON.stringify(body)});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){
      const message=payload?.detail||payload?.title||payload?.error||`ACH bank API request failed with HTTP ${response.status}.`;
      const error=new Error(message);
      error.code=payload?.type||'ACH_BANK_API_ERROR';
      error.httpStatus=response.status;
      throw error;
    }
    return payload;
  }

  async submit(instruction){
    if(!instruction)throw new Error('Settlement instruction is required.');
    if(String(instruction.rail||'').toUpperCase()!=='ACH')throw new Error('Bank ACH origination only accepts ACH instructions.');
    if(!['READY','EXCEPTION'].includes(String(instruction.state||'').toUpperCase()))throw new Error(`ACH instruction cannot be submitted from ${instruction.state}.`);
    const accountNumber=required(instruction.receivingAccountReference,'receivingAccountReference');
    const routingNumber=required(instruction.routingNumber,'routingNumber');
    const amount=Math.round(Number(instruction.amount)*100);
    if(!Number.isSafeInteger(amount)||amount<=0)throw new Error('ACH instruction amount must convert to a positive whole-cent amount.');

    const payload={
      account_id:required(this.accountId,'INCREASE_ACCOUNT_ID'),
      account_number:accountNumber,
      amount,
      routing_number:routingNumber,
      funding:String(instruction.accountType||'CHECKING').toUpperCase()==='SAVINGS'?'savings':'checking',
      statement_descriptor:safeText(instruction.remittanceReference||instruction.exportPackageId||instruction.instructionId,200)||'SRA ACH',
      company_name:safeText(this.companyName,16)||'SRA',
      individual_name:safeText(instruction.beneficiaryName,22)||undefined,
      standard_entry_class_code:'corporate_credit_or_debit',
      require_approval:Boolean(this.requireApproval),
    };
    if(payload.individual_name===undefined)delete payload.individual_name;

    const transfer=await this.increaseRequest('/ach_transfers',{method:'POST',body:payload,idempotencyKey:`sra-${instruction.instructionId}`});
    if(!transfer?.id)throw new Error('ACH bank API did not return a transfer identifier.');
    return {
      provider:'INCREASE',
      institutionTransactionReference:transfer.id,
      providerStatus:transfer.status||null,
      networkReference:transfer.submission?.trace_number||null,
      submittedAt:transfer.submission?.submitted_at||transfer.created_at||new Date().toISOString(),
      transfer,
    };
  }

  async retrieve(institutionTransactionReference){
    const reference=required(institutionTransactionReference,'institutionTransactionReference');
    return this.increaseRequest(`/ach_transfers/${encodeURIComponent(reference)}`);
  }
}
