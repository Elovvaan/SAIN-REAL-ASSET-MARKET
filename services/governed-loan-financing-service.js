import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';
import { TreasuryLedgerService, SRA_TREASURY_PROFILE_ID } from './treasury-ledger-service.js';
import { normalizeFinancingStage } from './financing-lifecycle-service.js';

const LOAN_RECEIVABLE = 'TRSY-1200-LOANS-RECEIVABLE';
const BORROWER_FUNDING = 'TRSY-2100-BORROWER-FUNDING';
const FINANCING_TYPE = 'LOAN_FINANCING_AUTHORIZATION';
const OPPORTUNITY_TYPE = 'FUNDING_OPPORTUNITY';
const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const now = () => new Date().toISOString();
const amount = (value) => { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new Error('Loan amount must be greater than zero.'); return Number(n.toFixed(8)); };

export class GovernedLoanFinancingService {
  constructor(domain) { this.domain = domain; this.treasury = new TreasuryLedgerService(domain); }

  async initialize(actorId = 'SRA_FINANCING_SYSTEM') {
    await this.treasury.initialize(actorId);
    const timestamp = now();
    const definitions = [
      { accountId: LOAN_RECEIVABLE, code: '1200', name: 'Loans Receivable', category: 'ASSET', normalSide: 'DEBIT' },
      { accountId: BORROWER_FUNDING, code: '2100', name: 'Borrower Funding Liabilities', category: 'LIABILITY', normalSide: 'CREDIT' }
    ];
    const changes = definitions.filter((d) => !this.domain.get(RECORD_TYPES.LEDGER_ACCOUNT, d.accountId)).map((d) => ({ type: RECORD_TYPES.LEDGER_ACCOUNT, id: d.accountId, actorId, eventType: 'FINANCING_LEDGER_ACCOUNT_OPENED', payload: { ...d, treasuryProfileId: SRA_TREASURY_PROFILE_ID, currency: 'USD', state: 'ACTIVE', balance: 0, totalDebits: 0, totalCredits: 0, createdAt: timestamp, updatedAt: timestamp } }));
    if (changes.length) await this.domain.atomicPut(changes);
    return this.status();
  }

  getIssuanceTransaction(transactionId) {
    const tx = this.domain.get(RECORD_TYPES.SRA_TRANSACTION, transactionId);
    if (!tx || tx.transactionType !== 'INSTRUMENT_ISSUANCE') throw new Error('Issued financing instrument transaction was not found.');
    return tx;
  }

  existingForIssuance(transactionId) {
    return this.domain.list(RECORD_TYPES.SRA_TRANSACTION).find((r) => r.transactionType === FINANCING_TYPE && r.issuanceTransactionId === transactionId && r.state === 'POSTED') || null;
  }

  existingForOpportunity(opportunityId) {
    return this.domain.list(RECORD_TYPES.SRA_TRANSACTION).find((r) => r.transactionType === FINANCING_TYPE && r.opportunityId === opportunityId && r.state === 'POSTED') || null;
  }

  preview(input = {}) {
    const issuance = this.getIssuanceTransaction(input.issuanceTransactionId);
    const instrument = this.domain.get(RECORD_TYPES.SRA_INSTRUMENT, issuance.instrumentId);
    if (!instrument || instrument.issuanceStatus !== 'ISSUED') throw new Error('The financing instrument must be issued before funding can be recorded.');
    if (String(issuance.currency || '').toUpperCase() !== 'USD') throw new Error('The initial governed loan-financing workflow supports USD instruments only.');
    const principal = amount(input.amount ?? issuance.amount);
    if (principal > Number(issuance.amount || 0)) throw new Error('Financing amount cannot exceed the issued face value.');
    const borrowerParticipantId = String(input.borrowerParticipantId || instrument.borrowerParticipantId || instrument.issuerParticipantId || '').trim();
    if (!borrowerParticipantId) throw new Error('borrowerParticipantId is required.');
    const existing = this.existingForIssuance(issuance.transactionId);
    if (existing) return { action: 'RECORD_LOAN_FINANCING', alreadyPosted: true, financing: existing, approvalRequired: false };
    return {
      action: 'RECORD_LOAN_FINANCING', approvalRequired: true, issuanceTransactionId: issuance.transactionId, instrumentId: issuance.instrumentId, opportunityId: issuance.opportunityId || null, borrowerParticipantId, amount: principal, currency: 'USD',
      journal: { debit: { accountId: LOAN_RECEIVABLE, amount: principal }, credit: { accountId: BORROWER_FUNDING, amount: principal } },
      effect: 'Records the issued loan as a Loans Receivable asset and credits an equal Borrower Funding liability.',
      doesNot: ['MOVE_EXTERNAL_FUNDS', 'DISBURSE_CASH', 'CREATE_SRA_COIN', 'SELF_APPROVE', 'CHANGE_OWNERSHIP']
    };
  }

  previewOpportunity(opportunityId, input = {}) {
    const opportunity = this.domain.get(OPPORTUNITY_TYPE, opportunityId);
    if (!opportunity) throw new Error('Funding opportunity was not found.');
    const stage = normalizeFinancingStage(opportunity);
    if (!['CLOSING', 'READY_TO_FUND'].includes(stage)) throw new Error(`Financing authorization is not available from ${stage}.`);
    if (String(opportunity.creditDecision?.decision || '').toUpperCase() !== 'APPROVE') throw new Error('An approved credit decision is required before financing can be recorded.');
    const approvedAmount = amount(opportunity.creditDecision?.approvedAmount ?? opportunity.requestedAmount);
    const principal = amount(input.amount ?? approvedAmount);
    if (principal > approvedAmount) throw new Error('Financing amount cannot exceed the approved amount.');
    const currency = String(opportunity.currency || 'USD').toUpperCase();
    if (currency !== 'USD') throw new Error('The current governed loan-financing workflow supports USD financing only.');
    const borrowerParticipantId = String(input.borrowerParticipantId || opportunity.applicantParticipantId || '').trim();
    if (!borrowerParticipantId) throw new Error('borrowerParticipantId is required.');
    const existing = this.existingForOpportunity(opportunityId);
    if (existing) return { action: 'RECORD_LOAN_FINANCING', alreadyPosted: true, financing: existing, approvalRequired: false };
    return {
      action: 'RECORD_LOAN_FINANCING',
      approvalRequired: true,
      opportunityId,
      issuanceTransactionId: null,
      instrumentId: opportunity.instrumentId || null,
      borrowerParticipantId,
      amount: principal,
      currency,
      journal: { debit: { accountId: LOAN_RECEIVABLE, amount: principal }, credit: { accountId: BORROWER_FUNDING, amount: principal } },
      effect: 'Records the approved financing as a Loans Receivable asset and credits an equal Borrower Funding liability before closing and disbursement.',
      doesNot: ['MOVE_EXTERNAL_FUNDS', 'DISBURSE_CASH', 'CREATE_SRA_COIN', 'SELF_APPROVE', 'CHANGE_OWNERSHIP']
    };
  }

  async post(preview, actorId, reference, memo, authorizationSource) {
    if (preview.alreadyPosted) return { financing: preview.financing, created: false, treasury: this.treasury.summary() };
    const timestamp = now();
    const financingId = id('LFA');
    const journal = await this.treasury.approve({ approval: 'APPROVE', journalType: 'LOAN_ORIGINATION', idempotencyKey: `loan-financing:${reference}`, memo, reference, lines: [
      { accountId: LOAN_RECEIVABLE, side: 'DEBIT', amount: preview.amount },
      { accountId: BORROWER_FUNDING, side: 'CREDIT', amount: preview.amount }
    ] }, actorId);
    const financing = {
      transactionId: financingId,
      transactionType: FINANCING_TYPE,
      authorizationSource,
      issuanceTransactionId: preview.issuanceTransactionId || null,
      instrumentId: preview.instrumentId || null,
      opportunityId: preview.opportunityId || null,
      borrowerParticipantId: preview.borrowerParticipantId,
      amount: preview.amount,
      currency: preview.currency || 'USD',
      treasuryJournalId: journal.journal.entryId,
      state: 'POSTED',
      status: 'FUNDING_CREDITED_PENDING_DISBURSEMENT',
      externalDisbursementAuthorized: false,
      approvedBy: actorId,
      approvedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.domain.put(RECORD_TYPES.SRA_TRANSACTION, financingId, financing, { actorId, eventType: 'LOAN_FINANCING_RECORDED' });
    return { financing, created: true, treasury: journal.summary };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator financing approval is required.');
    const preview = this.preview(input);
    return this.post(preview, actorId, preview.issuanceTransactionId, `Record financing for issued instrument ${preview.instrumentId}`, 'ISSUED_INSTRUMENT');
  }

  async approveOpportunity(opportunityId, input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator financing approval is required.');
    const preview = this.previewOpportunity(opportunityId, input);
    return this.post(preview, actorId, opportunityId, `Record approved financing for opportunity ${opportunityId}`, 'APPROVED_FINANCING_OPPORTUNITY');
  }

  status() {
    const records = this.domain.list(RECORD_TYPES.SRA_TRANSACTION).filter((r) => r.transactionType === FINANCING_TYPE);
    return { service: 'GOVERNED_LOAN_FINANCING', financingCount: records.length, totalFinancedUsd: Number(records.reduce((s, r) => s + Number(r.amount || 0), 0).toFixed(8)), pendingDisbursement: records.filter((r) => r.status === 'FUNDING_CREDITED_PENDING_DISBURSEMENT').length, accounts: { loansReceivable: LOAN_RECEIVABLE, borrowerFundingLiabilities: BORROWER_FUNDING } };
  }
}

export { LOAN_RECEIVABLE as LOANS_RECEIVABLE_ACCOUNT_ID, BORROWER_FUNDING as BORROWER_FUNDING_ACCOUNT_ID, FINANCING_TYPE as LOAN_FINANCING_TRANSACTION_TYPE };
