import crypto from 'node:crypto';
import { RECORD_TYPES as T } from './persistent-domain-service.js';

const required = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
};
const cents = value => {
  if (value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) <= 0
    || Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) > 0.00001) throw new Error('Payment amount must be positive with at most two decimal places.');
  return Math.round(Number(value) * 100);
};

export class FeePaymentService {
  constructor(domain, economics, ledger) { this.domain = domain; this.economics = economics; this.ledger = ledger; }
  async record(invoiceId, input, actorId) {
    required(invoiceId, 'invoiceId');
    const reference = required(input.externalReference, 'externalReference');
    const evidenceReference = required(input.evidenceReference, 'evidenceReference');
    const amountCents = cents(input.amount);
    const currency = required(input.currency, 'currency').toUpperCase();
    const receiptId = `FEE-RCPT-${crypto.createHash('sha256').update(`${currency}:${reference}`).digest('hex').slice(0, 32)}`;
    const operationKey = `FEE-PAYMENT-${crypto.randomUUID()}`;
    const database = this.domain.database;
    const claim = await database.claimIdempotency({ key: operationKey, fingerprint: operationKey, actorId, resourceKey: 'SRA:PLATFORM_BILLING_WRITE', ttlMs: 180000 });
    if (claim.state !== 'CLAIMED') throw new Error('Another fee payment is being recorded. Retry after it completes.');
    try {
      await this.economics.hydrate();
      await this.domain.hydrate([T.LEDGER_ACCOUNT, T.LEDGER_ENTRY, T.PAYMENT_RECEIPT]);
      const previous = await database.getRecord(T.PAYMENT_RECEIPT, receiptId);
      if (previous) {
        if (previous.invoiceId !== invoiceId || cents(previous.amount) !== amountCents || previous.evidenceReference !== evidenceReference) throw new Error('This payment reference is already recorded with different details.');
        return { receipt: previous, reused: true };
      }
      // Refresh under the durable lock so a different process cannot rely on a stale invoice balance.
      const invoice = await database.getRecord(T.FEE_INVOICE, invoiceId);
      if (!invoice) throw new Error('Fee Invoice not found.');
      if (!['OPEN', 'PARTIALLY_PAID'].includes(invoice.state)) throw new Error('Only open or partially paid invoices can receive payment.');
      if (invoice.currency !== currency) throw new Error('Payment currency does not match the invoice.');
      const charges = await Promise.all(invoice.chargeIds.map(id => database.getRecord(T.FEE_CHARGE, id)));
      if (charges.some(charge => !charge)) throw new Error('Invoice charges are incomplete.');
      const waivedCents = charges.filter(charge => charge.state === 'WAIVED').reduce((total, charge) => total + Math.round(charge.total * 100), 0);
      const journals = await database.listRecords(T.LEDGER_ENTRY);
      const arIds = new Set(this.ledger.listAccounts().filter(account => account.code === '1100-AR').map(account => account.accountId));
      const paidCents = journals.filter(entry => entry.state === 'POSTED' && entry.eventType === 'FEE_INVOICE_PAYMENT_RECEIVED' && entry.referenceType === 'FEE_INVOICE' && entry.referenceId === invoiceId).reduce((total, entry) => total + entry.lines.filter(line => arIds.has(line.accountId)).reduce((subtotal, line) => subtotal + Math.round((Number(line.credit || 0) - Number(line.debit || 0)) * 100), 0), 0);
      const outstanding = Math.round(invoice.total * 100) - waivedCents - paidCents;
      if (amountCents > outstanding) throw new Error('Payment exceeds the outstanding invoice amount.');
      const cash = this.ledger.getAccount(required(input.cashAccountId, 'cashAccountId'));
      const ar = this.ledger.listAccounts().find(account => account.code === '1100-AR' && account.currency === currency);
      if (!cash || cash.code !== '1000-CASH' || cash.currency !== currency || cash.state !== 'ACTIVE' || !ar) throw new Error('Matching operating cash and receivable accounts are required.');
      const timestamp = new Date().toISOString();
      const entryId = `JE-${receiptId}`;
      const amount = amountCents / 100;
      const receipt = { paymentReceiptId: receiptId, invoiceId, fundingInstructionId:input.fundingInstructionId||null,participantId:invoice.payerId,accountId:input.accountId||null,purpose: 'PLATFORM_FEE_PAYMENT', amount, currency,
        externalReference: reference, evidenceReference, ledgerEntryId: entryId, state: 'RECORDED', recordedBy: actorId, recordedAt: timestamp, createdAt: timestamp };
      const entry = { entryId, referenceType: 'FEE_INVOICE', referenceId: invoiceId, eventType: 'FEE_INVOICE_PAYMENT_RECEIVED',
        description: `Recorded fee payment for ${invoiceId}`, currency, lines: [{ accountId: cash.accountId, debit: amount, credit: 0 }, { accountId: ar.accountId, debit: 0, credit: amount }],
        totalDebits: amount, totalCredits: amount, state: 'POSTED', postedBy: actorId, postedAt: timestamp, createdAt: timestamp, evidenceReference };
      const paid = amountCents === outstanding;
      const updated = { ...invoice, paidAmount: (paidCents + amountCents) / 100, state: paid ? 'PAID' : 'PARTIALLY_PAID',
        paymentReference: reference, updatedAt: timestamp, ...(paid ? { paidAt: timestamp } : {}) };
      const changes = [
        { type: T.FEE_INVOICE, id: invoiceId, payload: updated, actorId, eventType: 'FEE_INVOICE_PAYMENT_RECORDED' },
        { type: T.PAYMENT_RECEIPT, id: receiptId, payload: receipt, actorId, eventType: 'PAYMENT_RECEIPT_RECORDED' },
        { type: T.LEDGER_ENTRY, id: entryId, payload: entry, actorId, eventType: 'LEDGER_ENTRY_POSTED' },
      ];
      if (paid) for (const charge of charges.filter(charge => charge.state === 'INVOICED')) changes.push({ type: T.FEE_CHARGE, id: charge.chargeId, payload: { ...charge, state: 'PAID', paidAt: timestamp, updatedAt: timestamp }, actorId, eventType: 'FEE_CHARGE_PAID' });
      await this.domain.atomicPut(changes);
      return { invoice: updated, receipt, ledgerEntry: entry, reused: false };
    } finally { await database.releaseIdempotency(operationKey); }
  }
}
