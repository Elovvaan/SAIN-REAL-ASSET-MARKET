import crypto from 'node:crypto';
import { RECORD_TYPES as T } from './persistent-domain-service.js';
import { SRA_AGENT_SERVICE_FEE_SCHEDULE } from '../config/agent-service-fee-schedule.js';
import { CAPACITY_DEFINITIONS } from './access-service.js';

const round = value => Number(Number(value).toFixed(2));
const sum = records => round(records.reduce((total, record) => total + Number(record.total ?? record.amount ?? 0), 0));

export class PlatformBillingReportService {
  constructor(domain, economics) { this.domain = domain; this.economics = economics; }
  async saveModel(input,actorId){
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period||''))throw new Error('A valid model month is required.');
    if(typeof input.name!=='string'||!input.name.trim())throw new Error('A model name is required.');
    const services=Object.values(SRA_AGENT_SERVICE_FEE_SCHEDULE.services);
    const counts=input.workCounts||{};
    if(Object.keys(counts).some(key=>!services.some(service=>service.agentId===key)))throw new Error('Unknown service in revenue model.');
    const lines=services.map(service=>{
      const raw=counts[service.agentId];
      const units=raw==null||raw===''?null:Number(raw);
      if(units!=null&&(!Number.isSafeInteger(units)||units<0))throw new Error('Work counts must be non-negative whole numbers.');
      return{agentId:service.agentId,serviceName:service.serviceName,unitPrice:service.amount,units,grossCharges:units==null?null:round(units*service.amount),currency:service.currency};
    });
    if(lines.every(line=>line.units==null))throw new Error('Enter at least one projected work count.');
    const modelId=`SRA-REVENUE-${crypto.randomUUID()}`;
    const record={modelId,name:input.name.trim(),period:input.period,state:'SCENARIO',fundingTarget:5000000,repaymentSource:'FUTURE_SRA_BUSINESS_REVENUE',scheduleId:SRA_AGENT_SERVICE_FEE_SCHEDULE.scheduleId,scheduleVersion:SRA_AGENT_SERVICE_FEE_SCHEDULE.version,lines,grossCharges:sum(lines.filter(line=>line.grossCharges!=null).map(line=>({amount:line.grossCharges}))),coverage:lines.every(line=>line.units!=null)?'ALL_SERVICE_COUNTS':'PARTIAL_SERVICE_COUNTS',currency:'USD',collectionsForecast:null,repaymentCapacity:null,createdBy:actorId,createdAt:new Date().toISOString()};
    await this.domain.put(T.SRA_REVENUE_MODEL,modelId,record,{actorId,eventType:'SRA_REVENUE_SCENARIO_SAVED'});
    return record;
  }
  async snapshot() {
    await this.economics.hydrate();
    await this.domain.loadTypes([T.FEE_CATALOG_ITEM,T.FEE_SCHEDULE,T.FEE_CHARGE,T.FEE_INVOICE,T.LEDGER_ACCOUNT,T.LEDGER_ENTRY,T.PAYMENT_RECEIPT,T.FUNDING_INSTRUCTION,T.SRA_AGENT_WORK_ORDER,T.SRA_AGENT_COMPENSATION_RECORD,T.SRA_REVENUE_MODEL]);
    const charges = this.economics.listCharges();
    const invoices = this.economics.listInvoices();
    const invoiceIds = new Set(invoices.map(invoice => invoice.invoiceId));
    const arIds = new Set(this.domain.list(T.LEDGER_ACCOUNT).filter(account => account.code === '1100-AR').map(account => account.accountId));
    // Count posted fee-payment journals once. Invoice state or platform balances alone are not cash collections.
    const payments = this.domain.list(T.LEDGER_ENTRY).filter(entry => entry.state === 'POSTED'
      && entry.eventType === 'FEE_INVOICE_PAYMENT_RECEIVED' && entry.referenceType === 'FEE_INVOICE'
      && invoiceIds.has(entry.referenceId)).map(entry => ({
        entryId: entry.entryId, invoiceId: entry.referenceId, currency: entry.currency,
        amount: round(entry.lines.filter(line => arIds.has(line.accountId)).reduce((total, line) => total + Number(line.credit || 0) - Number(line.debit || 0), 0)),
        occurredAt: entry.postedAt || entry.createdAt,
      }));
    const receipts=this.domain.list(T.PAYMENT_RECEIPT).filter(receipt=>receipt.state==='RECORDED'&&receipt.purpose==='PLATFORM_FEE_PAYMENT'&&receipt.externalReference);
    const instructions=this.domain.list(T.FUNDING_INSTRUCTION);
    const receiptBacked=payment=>receipts.some(receipt=>receipt.ledgerEntryId===payment.entryId&&receipt.currency===payment.currency&&round(receipt.amount)===payment.amount&&(receipt.invoiceId||instructions.find(instruction=>instruction.fundingInstructionId===receipt.fundingInstructionId)?.invoiceId)===payment.invoiceId);
    for(const payment of payments)payment.receiptBacked=receiptBacked(payment);
    const compensation = this.domain.list(T.SRA_AGENT_COMPENSATION_RECORD);
    const work = this.domain.list(T.SRA_AGENT_WORK_ORDER);
    const currencies = [...new Set([...charges, ...invoices, ...payments, ...compensation].map(record => record.currency || 'USD'))].sort();
    const totals = currencies.map(currency => {
      const c = charges.filter(record => (record.currency || 'USD') === currency);
      const i = invoices.filter(record => (record.currency || 'USD') === currency);
      const p = payments.filter(record => record.currency === currency);
      const expenses = compensation.filter(record => (record.currency || 'USD') === currency);
      const waivedInvoiced = sum(c.filter(record => record.state === 'WAIVED' && record.invoiceId));
      const invoiced = sum(i);
      const collected = sum(p.filter(payment=>payment.receiptBacked));
      const unmatchedPaymentJournals=sum(p.filter(payment=>!payment.receiptBacked));
      return { currency, assessedGross: sum(c), waived: sum(c.filter(record => record.state === 'WAIVED')),
        cancelled: sum(c.filter(record => record.state === 'CANCELLED')),
        uninvoiced: sum(c.filter(record => record.state === 'ASSESSED')), invoicedGross: invoiced,
        invoicedWaivers: waivedInvoiced, collected, unmatchedPaymentJournals, outstanding: round(invoiced - waivedInvoiced - collected),
        compensationAccrued: sum(expenses.filter(record => ['EARNED', 'AUTHORIZED', 'PAID'].includes(record.state))),
        compensationPaid: sum(expenses.filter(record => record.state === 'PAID')),
        paidInvoicesWithoutPaymentJournal: i.filter(invoice => invoice.state === 'PAID' && !p.some(payment => payment.invoiceId === invoice.invoiceId && payment.receiptBacked)).length };
    });
    const months = new Map();
    const month = (date, currency) => {
      const period = /^\d{4}-\d{2}/.test(date || '') ? date.slice(0, 7) : 'UNDATED';
      const key = `${period}:${currency}`;
      if (!months.has(key)) months.set(key, { period, currency, assessedGross: 0, invoicedGross: 0, collected: 0, compensationPaid: 0 });
      return months.get(key);
    };
    for (const charge of charges) month(charge.assessedAt || charge.createdAt, charge.currency).assessedGross += Number(charge.total || 0);
    for (const invoice of invoices) month(invoice.createdAt, invoice.currency).invoicedGross += Number(invoice.total || 0);
    for (const payment of payments.filter(payment=>payment.receiptBacked)) month(payment.occurredAt, payment.currency).collected += payment.amount;
    for (const expense of compensation.filter(record => record.state === 'PAID')) month(expense.paidAt || expense.updatedAt, expense.currency || 'USD').compensationPaid += Number(expense.amount || 0);
    return {
      generatedAt: new Date().toISOString(), fundingTarget: 5000000, repaymentSource: 'FUTURE_SRA_BUSINESS_REVENUE',
      totals, monthly: [...months.values()].map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value]))).sort((a, b) => a.period.localeCompare(b.period)),
      serviceRates: Object.values(SRA_AGENT_SERVICE_FEE_SCHEDULE.services).map(service => ({ ...service,
        acceptedWorkCount: work.filter(record => record.agentId === service.agentId && record.state === 'ACCEPTED').length,
        chargedWorkCount: new Set(charges.filter(record => record.scheduleId === SRA_AGENT_SERVICE_FEE_SCHEDULE.scheduleId && record.lines?.some(line => line.feeCode === service.feeCode)).map(record => record.subjectId)).size })),
      tiers: Object.entries(CAPACITY_DEFINITIONS).map(([id, tier]) => ({ id, label: tier.label || id, tier: tier.tier, feeBasis: tier.feeBasis || null })),
      models:this.domain.list(T.SRA_REVENUE_MODEL),
      catalog: this.economics.listCatalog(), schedules: this.economics.listSchedules(), charges, invoices, payments,
      limitations: ['Collections are recorded fee-payment journals; reconcile them to external payment evidence and bank statements.',
        'Compensation is a separate cost. Other expenses, taxes, refunds, and working-capital needs must be added to the financing forecast.',
        'Activity counts are historical records, not assumed future sales. Unpriced tiers have no numeric forecast contribution.'],
    };
  }
}
