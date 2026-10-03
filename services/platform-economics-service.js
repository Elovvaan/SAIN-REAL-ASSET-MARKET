import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const FEE_METHODS=new Set(['FIXED','PERCENTAGE','TIERED','USAGE']);
const CHARGE_STATES=new Set(['CALCULATED','ASSESSED','WAIVED','INVOICED','PAID','CANCELLED']);
function now(){return new Date().toISOString();}
function id(prefix){return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;}
function required(value,field){if(typeof value!=='string'||!value.trim())throw new Error(`${field} is required.`);return value.trim();}
function number(value,field,{allowZero=false}={}){const n=Number(value);if(!Number.isFinite(n)||(allowZero?n<0:n<=0))throw new Error(`${field} must be ${allowZero?'zero or greater':'greater than zero'}.`);return n;}
function money(value){return Number(Number(value).toFixed(2));}

export class PlatformEconomicsService{
  constructor(domain,ledgerService=null){this.domain=domain;this.ledgerService=ledgerService;}
  async hydrate(){await this.domain.hydrate([RECORD_TYPES.FEE_CATALOG_ITEM,RECORD_TYPES.FEE_SCHEDULE,RECORD_TYPES.FEE_CHARGE,RECORD_TYPES.FEE_INVOICE]);}
  listInvoices(filters={}){return this.domain.list(RECORD_TYPES.FEE_INVOICE).filter(r=>(!filters.payerId||r.payerId===filters.payerId)&&(!filters.state||r.state===filters.state));}
  getInvoice(invoiceId){return this.domain.get(RECORD_TYPES.FEE_INVOICE,invoiceId);}
  listCatalog(filters={}){return this.domain.list(RECORD_TYPES.FEE_CATALOG_ITEM).filter(r=>(!filters.category||r.category===filters.category)&&(!filters.state||r.state===filters.state));}
  getCatalogItem(feeCode){return this.domain.get(RECORD_TYPES.FEE_CATALOG_ITEM,feeCode);}
  async createCatalogItem(input,actorId=null){const feeCode=required(input.feeCode,'feeCode').toUpperCase();if(this.getCatalogItem(feeCode))throw new Error('Fee Catalog Item already exists.');const record={feeCode,name:required(input.name,'name'),description:input.description||'',category:required(input.category,'category').toUpperCase(),defaultPayerType:required(input.defaultPayerType,'defaultPayerType').toUpperCase(),currency:input.currency||'USD',state:'ACTIVE',createdBy:actorId,createdAt:now(),updatedAt:now()};await this.domain.put(RECORD_TYPES.FEE_CATALOG_ITEM,feeCode,record,{actorId,eventType:'FEE_CATALOG_ITEM_CREATED'});return record;}
  listSchedules(filters={}){return this.domain.list(RECORD_TYPES.FEE_SCHEDULE).filter(r=>(!filters.state||r.state===filters.state));}
  getSchedule(scheduleId){return this.domain.get(RECORD_TYPES.FEE_SCHEDULE,scheduleId);}
  async createSchedule(input,actorId=null){const scheduleId=input.scheduleId||id('FEE-SCHEDULE');if(this.getSchedule(scheduleId))throw new Error('Fee Schedule already exists.');const version=required(input.version,'version');if(!Number.isFinite(Date.parse(input.effectiveFrom)))throw new Error('A valid effectiveFrom date is required.');if(input.effectiveTo&&(!Number.isFinite(Date.parse(input.effectiveTo))||input.effectiveTo<input.effectiveFrom))throw new Error('Invalid effectiveTo date.');const rules=(input.rules||[]).map((rule,index)=>{const feeCode=required(rule.feeCode,`rules[${index}].feeCode`).toUpperCase();if(!this.getCatalogItem(feeCode))throw new Error(`Unknown fee code: ${feeCode}.`);const method=required(rule.method,`rules[${index}].method`).toUpperCase();if(!FEE_METHODS.has(method))throw new Error(`Unsupported fee method: ${method}.`);if(method==='FIXED'&&rule.amount==null)throw new Error('FIXED rules require amount.');if(method==='PERCENTAGE'&&rule.rate==null)throw new Error('PERCENTAGE rules require rate.');if(method==='USAGE'&&rule.unitPrice==null)throw new Error('USAGE rules require unitPrice.');if(method==='TIERED'){if(!Array.isArray(rule.tiers)||!rule.tiers.length)throw new Error('TIERED rules require tiers.');for(const tier of rule.tiers){const from=number(tier.from??0,'tier.from',{allowZero:true});if(tier.to!=null&&number(tier.to,'tier.to',{allowZero:true})<from)throw new Error('Invalid tier range.');if(tier.amount==null&&tier.rate==null)throw new Error('Tier amount or rate is required.');if(tier.amount!=null)number(tier.amount,'tier.amount',{allowZero:true});if(tier.rate!=null)number(tier.rate,'tier.rate',{allowZero:true});}}if(rule.minimum!=null&&rule.maximum!=null&&Number(rule.minimum)>Number(rule.maximum))throw new Error('minimum must not exceed maximum.');return{ruleId:rule.ruleId||id('FEE-RULE'),feeCode,method,amount:rule.amount==null?null:number(rule.amount,'amount',{allowZero:true}),rate:rule.rate==null?null:number(rule.rate,'rate',{allowZero:true}),minimum:rule.minimum==null?null:number(rule.minimum,'minimum',{allowZero:true}),maximum:rule.maximum==null?null:number(rule.maximum,'maximum',{allowZero:true}),unitPrice:rule.unitPrice==null?null:number(rule.unitPrice,'unitPrice',{allowZero:true}),tiers:Array.isArray(rule.tiers)?rule.tiers:[],payerType:(rule.payerType||this.getCatalogItem(feeCode).defaultPayerType).toUpperCase(),trigger:required(rule.trigger,`rules[${index}].trigger`).toUpperCase(),conditions:rule.conditions||{},state:'ACTIVE'};});const record={scheduleId,name:required(input.name,'name'),version,effectiveFrom:required(input.effectiveFrom,'effectiveFrom'),effectiveTo:input.effectiveTo||null,state:input.state||'DRAFT',rules,createdBy:actorId,createdAt:now(),updatedAt:now()};await this.domain.put(RECORD_TYPES.FEE_SCHEDULE,scheduleId,record,{actorId,eventType:'FEE_SCHEDULE_CREATED'});return record;}
  async activateSchedule(scheduleId,actorId=null){const current=this.getSchedule(scheduleId);if(!current)throw new Error('Fee Schedule not found.');for(const schedule of this.listSchedules({state:'ACTIVE'})){await this.domain.put(RECORD_TYPES.FEE_SCHEDULE,schedule.scheduleId,{...schedule,state:'RETIRED',retiredAt:now(),updatedAt:now()},{actorId,eventType:'FEE_SCHEDULE_RETIRED'});}const updated={...current,state:'ACTIVE',activatedAt:now(),updatedAt:now()};await this.domain.put(RECORD_TYPES.FEE_SCHEDULE,scheduleId,updated,{actorId,eventType:'FEE_SCHEDULE_ACTIVATED'});return updated;}
  activeSchedule(at=new Date().toISOString()){return this.listSchedules({state:'ACTIVE'}).find(s=>s.effectiveFrom<=at&&(!s.effectiveTo||s.effectiveTo>=at))||null;}
  matches(rule,context){return Object.entries(rule.conditions||{}).every(([key,value])=>context[key]===value);}
  calculateRule(rule,context){let calculated=0;if(rule.method==='FIXED')calculated=rule.amount||0;if(rule.method==='PERCENTAGE')calculated=number(context.baseAmount,'baseAmount',{allowZero:true})*(rule.rate||0);if(rule.method==='USAGE')calculated=number(context.units,'units',{allowZero:true})*(rule.unitPrice||0);if(rule.method==='TIERED'){const base=number(context.baseAmount,'baseAmount',{allowZero:true});for(const tier of rule.tiers){const from=Number(tier.from||0),to=tier.to==null?Infinity:Number(tier.to);if(base>=from&&base<=to){calculated=tier.amount!=null?Number(tier.amount):base*Number(tier.rate||0);break;}}}if(rule.minimum!=null)calculated=Math.max(calculated,rule.minimum);if(rule.maximum!=null)calculated=Math.min(calculated,rule.maximum);return money(calculated);}
  calculate(input){const at=input.occurredAt||now();const schedule=input.scheduleId?this.getSchedule(input.scheduleId):this.activeSchedule(at);if(!schedule)throw new Error('Active Fee Schedule not found.');if(!['ACTIVE','ACTIVE_FOR_EXPLICIT_USE'].includes(schedule.state)||schedule.effectiveFrom>at||(schedule.effectiveTo&&schedule.effectiveTo<at))throw new Error('Fee Schedule is not effective for this calculation.');const trigger=required(input.trigger,'trigger').toUpperCase();const context=input.context||{};const lines=schedule.rules.filter(r=>r.state==='ACTIVE'&&r.trigger===trigger&&this.matches(r,context)).map(rule=>{const item=this.getCatalogItem(rule.feeCode);return{feeCode:rule.feeCode,name:item?.name||rule.feeCode,category:item?.category||null,payerType:rule.payerType,amount:this.calculateRule(rule,context),currency:item?.currency||'USD',ruleId:rule.ruleId};});return{scheduleId:schedule.scheduleId,scheduleVersion:schedule.version,trigger,context,total:money(lines.reduce((s,l)=>s+l.amount,0)),lines,calculatedAt:now()};}
  async assess(input,actorId=null){const calculation=this.calculate(input);const chargeId=input.chargeId||id('FEE-CHARGE');if(this.getCharge(chargeId))throw new Error('Fee Charge already exists.');if(!calculation.lines.length)throw new Error('No fee rules match this charge.');const currency=input.currency||calculation.lines[0].currency;if(calculation.lines.some(line=>line.currency!==currency))throw new Error('Fee charge currency must match every fee line.');const record={chargeId,subjectType:required(input.subjectType,'subjectType'),subjectId:required(input.subjectId,'subjectId'),payerId:required(input.payerId,'payerId'),payerType:required(input.payerType,'payerType').toUpperCase(),scheduleId:calculation.scheduleId,scheduleVersion:calculation.scheduleVersion,trigger:calculation.trigger,lines:calculation.lines,total:calculation.total,currency,state:'ASSESSED',assessedBy:actorId,assessedAt:now(),createdAt:now(),updatedAt:now()};await this.domain.put(RECORD_TYPES.FEE_CHARGE,chargeId,record,{actorId,eventType:'FEE_CHARGE_ASSESSED'});return record;}
  getCharge(chargeId){return this.domain.get(RECORD_TYPES.FEE_CHARGE,chargeId);}
  listCharges(filters={}){return this.domain.list(RECORD_TYPES.FEE_CHARGE).filter(r=>(!filters.payerId||r.payerId===filters.payerId)&&(!filters.subjectId||r.subjectId===filters.subjectId)&&(!filters.state||r.state===filters.state));}
  async waive(chargeId,input={},actorId=null){
    const operationKey=`WAIVE-${crypto.randomUUID()}`;
    const database=this.domain.database;
    const claim=await database.claimIdempotency({key:operationKey,fingerprint:operationKey,actorId,resourceKey:'SRA:PLATFORM_BILLING_WRITE',ttlMs:180000});
    if(claim.state!=='CLAIMED')throw new Error('Another billing operation is in progress.');
    try {
      const current=await database.getRecord(RECORD_TYPES.FEE_CHARGE,chargeId);
      if(!current)throw new Error('Fee Charge not found.');
      if(!['ASSESSED','INVOICED'].includes(current.state))throw new Error('Only assessed or invoiced fees can be waived.');
      const invoice=current.invoiceId?await database.getRecord(RECORD_TYPES.FEE_INVOICE,current.invoiceId):null;
      if(invoice&&invoice.state!=='OPEN')throw new Error('A charge on a paid or partially paid invoice cannot be waived.');
      const updated={...current,state:'WAIVED',waiverReason:required(input.reason,'reason'),waivedBy:actorId,waivedAt:now(),updatedAt:now()};
      const changes=[{type:RECORD_TYPES.FEE_CHARGE,id:chargeId,payload:updated,actorId,eventType:'FEE_CHARGE_WAIVED'}];
      if(current.state==='INVOICED'&&this.ledgerService&&current.total>0){
        await this.domain.hydrate([RECORD_TYPES.LEDGER_ACCOUNT]);
        const ar=this.ledgerService.listAccounts().find(account=>account.code==='1100-AR'&&account.currency===current.currency);
        const contra=this.ledgerService.listAccounts().find(account=>account.code==='4190-FEE-WAIVERS'&&account.currency===current.currency);
        if(!ar||!contra)throw new Error('Required fee waiver ledger accounts are not configured.');
        const entryId=`JE-WAIVER-${chargeId}`;
        changes.push({type:RECORD_TYPES.LEDGER_ENTRY,id:entryId,actorId,eventType:'LEDGER_ENTRY_POSTED',payload:{entryId,referenceType:'FEE_CHARGE',referenceId:chargeId,eventType:'FEE_CHARGE_WAIVED',description:`Fee waiver ${chargeId}`,currency:current.currency,lines:[{accountId:contra.accountId,debit:current.total,credit:0},{accountId:ar.accountId,debit:0,credit:current.total}],totalDebits:current.total,totalCredits:current.total,state:'POSTED',postedBy:actorId,postedAt:now(),createdAt:now()}});
      }
      await this.domain.atomicPut(changes);
      return updated;
    } finally {await database.releaseIdempotency(operationKey);}
  }

  async createInvoice(input,actorId=null){
    const chargeIds=input.chargeIds||[];
    if(!Array.isArray(chargeIds)||!chargeIds.length||new Set(chargeIds).size!==chargeIds.length)throw new Error('Invoice charge IDs must be non-empty and unique.');
    const operationKey=`INVOICE-${crypto.randomUUID()}`;
    const database=this.domain.database;
    const claim=await database.claimIdempotency({key:operationKey,fingerprint:operationKey,actorId,resourceKey:'SRA:PLATFORM_BILLING_WRITE',ttlMs:180000});
    if(claim.state!=='CLAIMED')throw new Error('Another billing operation is in progress. Retry after it completes.');
    try {
      const charges=await Promise.all(chargeIds.map(chargeId=>database.getRecord(RECORD_TYPES.FEE_CHARGE,chargeId)));
      if(charges.some(charge=>!charge))throw new Error('One or more Fee Charges were not found.');
      if(charges.some(charge=>charge.state!=='ASSESSED'))throw new Error('Only assessed Fee Charges can be invoiced.');
      const payerId=required(input.payerId,'payerId');
      if(charges.some(charge=>charge.payerId!==payerId))throw new Error('All charges must belong to the invoice payer.');
      const invoiceId=input.invoiceId||id('FEE-INVOICE');
      if(await database.getRecord(RECORD_TYPES.FEE_INVOICE,invoiceId))throw new Error('Fee Invoice already exists.');
      const currency=input.currency||charges[0].currency;
      if(charges.some(charge=>charge.currency!==currency))throw new Error('Invoice currencies must match.');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate||'')||!Number.isFinite(Date.parse(input.dueDate))||new Date(input.dueDate).toISOString().slice(0,10)!==input.dueDate)throw new Error('A valid invoice dueDate is required.');
      const total=money(charges.reduce((sum,charge)=>sum+charge.total,0));
      if(total<=0)throw new Error('Zero-value charges do not require a cash invoice.');
      const timestamp=now();
      const record={invoiceId,payerId,payerType:required(input.payerType,'payerType').toUpperCase(),chargeIds,total,currency,dueDate:input.dueDate,state:'OPEN',createdBy:actorId,createdAt:timestamp,updatedAt:timestamp};
      const changes=[{type:RECORD_TYPES.FEE_INVOICE,id:invoiceId,payload:record,actorId,eventType:'FEE_INVOICE_CREATED'},...charges.map(charge=>({type:RECORD_TYPES.FEE_CHARGE,id:charge.chargeId,payload:{...charge,state:'INVOICED',invoiceId,updatedAt:timestamp},actorId,eventType:'FEE_CHARGE_INVOICED'}))];
      if(this.ledgerService){
        await this.domain.hydrate([RECORD_TYPES.LEDGER_ACCOUNT]);
        const ar=this.ledgerService.listAccounts().find(account=>account.code==='1100-AR'&&account.currency===currency);
        const revenue=this.ledgerService.listAccounts().find(account=>account.code==='4100-FEE-REVENUE'&&account.currency===currency);
        if(!ar||!revenue)throw new Error('Required fee ledger accounts are not configured for this currency.');
        const entryId=`JE-${invoiceId}`;
        changes.push({type:RECORD_TYPES.LEDGER_ENTRY,id:entryId,actorId,eventType:'LEDGER_ENTRY_POSTED',payload:{entryId,referenceType:'FEE_INVOICE',referenceId:invoiceId,eventType:'FEE_INVOICE_CREATED',description:`Fee invoice ${invoiceId}`,currency,lines:[{accountId:ar.accountId,debit:total,credit:0},{accountId:revenue.accountId,debit:0,credit:total}],totalDebits:total,totalCredits:total,state:'POSTED',postedBy:actorId,postedAt:timestamp,createdAt:timestamp}});
      }
      await this.domain.atomicPut(changes);
      return record;
    } finally {await database.releaseIdempotency(operationKey);}
  }

}

export const PLATFORM_FEE_METHODS=Object.freeze([...FEE_METHODS]);
export const PLATFORM_FEE_CHARGE_STATES=Object.freeze([...CHARGE_STATES]);
