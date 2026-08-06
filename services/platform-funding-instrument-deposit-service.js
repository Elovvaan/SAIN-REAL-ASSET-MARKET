import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const DEPOSIT_TYPE = 'PLATFORM_FUNDING_INSTRUMENT_DEPOSIT';
const DEBIT_ACCOUNT = 'TRSY-1050-INSTRUMENT-USD';
const CREDIT_ACCOUNT = 'TRSY-2200-PLATFORM-INSTRUMENT-FUNDING';

function now() { return new Date().toISOString(); }
function text(value, field) { const result = String(value || '').trim(); if (!result) throw new Error(`${field} is required.`); return result; }
function amount(value) { const result = Number(value); if (!Number.isFinite(result) || result <= 0) throw new Error('faceValueUsd must be greater than zero.'); return Number(result.toFixed(8)); }
function digestId(prefix, value) { return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16).toUpperCase()}`; }
function updateAccount(account, side, value, entryId, timestamp) {
  const increase = side === account.normalSide;
  return {
    ...account,
    balance: Number((Number(account.balance || 0) + (increase ? value : -value)).toFixed(8)),
    totalDebits: Number((Number(account.totalDebits || 0) + (side === 'DEBIT' ? value : 0)).toFixed(8)),
    totalCredits: Number((Number(account.totalCredits || 0) + (side === 'CREDIT' ? value : 0)).toFixed(8)),
    latestEntryId: entryId,
    updatedAt: timestamp
  };
}

export class PlatformFundingInstrumentDepositService {
  constructor(domain, treasury) { this.domain = domain; this.treasury = treasury; }

  deposits() {
    return this.domain.list(RECORD_TYPES.SRA_TRANSACTION)
      .filter((item) => item.transactionType === DEPOSIT_TYPE)
      .sort((a, b) => String(b.depositedAt).localeCompare(String(a.depositedAt)));
  }

  get(depositId) { return this.domain.get(RECORD_TYPES.SRA_TRANSACTION, depositId); }

  preview(input = {}) {
    const instrumentId = text(input.instrumentId, 'instrumentId');
    const instrument = this.domain.get(RECORD_TYPES.SRA_INSTRUMENT, instrumentId);
    if (!instrument) throw new Error('Platform commercial instrument was not found.');
    if (['CANCELLED', 'MATURED', 'CLOSED'].includes(instrument.state)) throw new Error('The platform commercial instrument is not open for deposit.');
    const faceValueUsd = amount(input.faceValueUsd ?? instrument.faceValueUsd ?? instrument.principalQuantity);
    const depositReference = text(input.depositReference, 'depositReference');
    const depositId = digestId('PFID', depositReference);
    const existing = this.get(depositId);
    if (existing && existing.instrumentId !== instrumentId) throw new Error('The deposit reference is already assigned to another instrument.');
    const alreadyDeposited = this.deposits().find((item) => item.instrumentId === instrumentId && item.state === 'DEPOSITED_RECOGNIZED_USD');
    if (alreadyDeposited && alreadyDeposited.transactionId !== depositId) throw new Error('This platform commercial instrument is already deposited in Treasury.');
    const termMonths = Number(input.termMonths ?? instrument.termMonths ?? 36);
    if (!Number.isInteger(termMonths) || termMonths <= 0) throw new Error('termMonths must be a positive integer.');
    const debitAccount = this.domain.get(RECORD_TYPES.LEDGER_ACCOUNT, DEBIT_ACCOUNT);
    const creditAccount = this.domain.get(RECORD_TYPES.LEDGER_ACCOUNT, CREDIT_ACCOUNT);
    if (!debitAccount || !creditAccount) throw new Error('Platform commercial instrument Treasury accounts are unavailable.');
    return {
      action: 'DEPOSIT_PLATFORM_COMMERCIAL_INSTRUMENT',
      readOnly: true,
      depositId,
      instrumentId,
      instrumentName: instrument.name || instrument.instrumentName || instrumentId,
      faceValueUsd,
      termMonths,
      depositReference,
      treasuryEffect: {
        debit: { accountId: DEBIT_ACCOUNT, amount: faceValueUsd, meaning: 'Instrument-backed Treasury USD position' },
        credit: { accountId: CREDIT_ACCOUNT, amount: faceValueUsd, meaning: 'Platform commercial instrument funding obligation' }
      },
      sraReference: { asset: 'SRA Coin', market: 'SRA/USD', rate: 1, representedQuantity: faceValueUsd },
      financingCapacityUsd: faceValueUsd,
      approvalRequired: true,
      effect: 'Deposits the platform commercial instrument into SRA and establishes its represented USD value as governed financing capacity.',
      doesNot: ['RECORD_OWNER_CONTRIBUTED_CAPITAL', 'EXECUTE_EXTERNAL_SETTLEMENT', 'CHANGE_INSTRUMENT_OWNERSHIP', 'SELF_APPROVE']
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator instrument-deposit approval is required.');
    const preview = this.preview(input);
    const existing = this.get(preview.depositId);
    if (existing) return { deposit: existing, created: false, treasury: this.treasury.summary() };
    const instrument = this.domain.get(RECORD_TYPES.SRA_INSTRUMENT, preview.instrumentId);
    const debitAccount = this.domain.get(RECORD_TYPES.LEDGER_ACCOUNT, DEBIT_ACCOUNT);
    const creditAccount = this.domain.get(RECORD_TYPES.LEDGER_ACCOUNT, CREDIT_ACCOUNT);
    const timestamp = now();
    const entryId = digestId('TJE', `PLATFORM_INSTRUMENT_DEPOSIT:${preview.depositReference}`);
    const updatedDebitAccount = updateAccount(debitAccount, 'DEBIT', preview.faceValueUsd, entryId, timestamp);
    const updatedCreditAccount = updateAccount(creditAccount, 'CREDIT', preview.faceValueUsd, entryId, timestamp);
    const journal = {
      entryId,
      treasuryProfileId: 'SRA_PLATFORM_TREASURY',
      journalType: DEPOSIT_TYPE,
      memo: `Deposit platform commercial instrument ${preview.instrumentId} into SRA Treasury`,
      reference: preview.depositReference,
      currency: 'USD',
      totalDebits: preview.faceValueUsd,
      totalCredits: preview.faceValueUsd,
      lines: [
        { accountId: DEBIT_ACCOUNT, accountName: debitAccount.name, side: 'DEBIT', amount: preview.faceValueUsd, currency: 'USD' },
        { accountId: CREDIT_ACCOUNT, accountName: creditAccount.name, side: 'CREDIT', amount: preview.faceValueUsd, currency: 'USD' }
      ],
      state: 'POSTED',
      approval: { approvedBy: actorId, approvedAt: timestamp },
      postedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const deposit = {
      transactionId: preview.depositId,
      transactionType: DEPOSIT_TYPE,
      instrumentId: preview.instrumentId,
      ledgerEntryId: entryId,
      faceValueUsd: preview.faceValueUsd,
      representedSraQuantity: preview.faceValueUsd,
      nativeMarketPair: 'SRA/USD',
      parReference: '1 SRA = 1 USD',
      termMonths: preview.termMonths,
      depositReference: preview.depositReference,
      state: 'DEPOSITED_RECOGNIZED_USD',
      financingState: 'AVAILABLE_FOR_GOVERNED_FINANCING',
      depositedBy: actorId,
      depositedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const updatedInstrument = {
      ...instrument,
      platformTreasuryDepositId: preview.depositId,
      depositedFaceValueUsd: preview.faceValueUsd,
      treasuryRepresentation: 'USD',
      treasuryState: 'DEPOSITED_RECOGNIZED_USD',
      depositedAt: timestamp,
      updatedAt: timestamp
    };
    await this.domain.atomicPut([
      { type: RECORD_TYPES.LEDGER_ACCOUNT, id: DEBIT_ACCOUNT, payload: updatedDebitAccount, actorId, eventType: 'TREASURY_LEDGER_ACCOUNT_BALANCE_UPDATED' },
      { type: RECORD_TYPES.LEDGER_ACCOUNT, id: CREDIT_ACCOUNT, payload: updatedCreditAccount, actorId, eventType: 'TREASURY_LEDGER_ACCOUNT_BALANCE_UPDATED' },
      { type: RECORD_TYPES.LEDGER_ENTRY, id: entryId, payload: journal, actorId, eventType: 'PLATFORM_FUNDING_INSTRUMENT_JOURNAL_POSTED' },
      { type: RECORD_TYPES.SRA_TRANSACTION, id: preview.depositId, payload: deposit, actorId, eventType: 'PLATFORM_FUNDING_INSTRUMENT_DEPOSITED' },
      { type: RECORD_TYPES.SRA_INSTRUMENT, id: preview.instrumentId, payload: updatedInstrument, actorId, eventType: 'PLATFORM_FUNDING_INSTRUMENT_TREASURY_RECOGNIZED' }
    ]);
    return { deposit, instrument: updatedInstrument, journal, created: true, treasury: this.treasury.summary() };
  }

  summary() {
    const deposits = this.deposits();
    const total = Number(deposits.reduce((sum, item) => sum + Number(item.faceValueUsd || 0), 0).toFixed(8));
    return { depositCount: deposits.length, depositedInstrumentValueUsd: total, availableFinancingCapacityUsd: total, deposits: deposits.slice(0, 20), model: 'PLATFORM_COMMERCIAL_INSTRUMENT_DEPOSIT', parReference: '1 SRA = 1 USD' };
  }
}

export { DEPOSIT_TYPE as PLATFORM_FUNDING_INSTRUMENT_DEPOSIT_TYPE };
