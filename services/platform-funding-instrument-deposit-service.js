import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const DEPOSIT_TYPE = 'PLATFORM_FUNDING_INSTRUMENT_DEPOSIT';
const CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID = 'INS-SRA-PLATFORM-FUNDING-18000000';
const CANONICAL_PLATFORM_FUNDING_FACE_VALUE_USD = 18_000_000;
const CASH_ACCOUNT = 'TRSY-1000-CASH-USD';
const INSTRUMENT_ACCOUNT = 'TRSY-1050-INSTRUMENT-USD';
const SRA_REPRESENTED_ACCOUNT = 'TRSY-2000-SRA-REPRESENTED';
const LEGACY_FUNDING_ACCOUNT = 'TRSY-2200-PLATFORM-INSTRUMENT-FUNDING';

function now() { return new Date().toISOString(); }
function text(value, field) { const result = String(value || '').trim(); if (!result) throw new Error(`${field} is required.`); return result; }
function amount(value) { const result = Number(value); if (!Number.isFinite(result) || result <= 0) throw new Error('faceValueUsd must be greater than zero.'); return Number(result.toFixed(8)); }
function digestId(prefix, value) { return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16).toUpperCase()}`; }
function round(value) { return Number(Number(value || 0).toFixed(8)); }
function updateAccount(account, side, value, entryId, timestamp) {
  const increase = side === account.normalSide;
  return {
    ...account,
    balance: round(Number(account.balance || 0) + (increase ? value : -value)),
    totalDebits: round(Number(account.totalDebits || 0) + (side === 'DEBIT' ? value : 0)),
    totalCredits: round(Number(account.totalCredits || 0) + (side === 'CREDIT' ? value : 0)),
    latestEntryId: entryId,
    updatedAt: timestamp
  };
}
function applyLines(accounts, lines, entryId, timestamp) {
  const updated = new Map(accounts);
  for (const line of lines) {
    const current = updated.get(line.accountId);
    if (!current) throw new Error(`Treasury account ${line.accountId} is unavailable.`);
    updated.set(line.accountId, updateAccount(current, line.side, line.amount, entryId, timestamp));
  }
  return updated;
}

export class PlatformFundingInstrumentDepositService {
  constructor(domain, treasury) { this.domain = domain; this.treasury = treasury; }

  allDeposits() {
    return this.domain.list(RECORD_TYPES.SRA_TRANSACTION)
      .filter((item) => item.transactionType === DEPOSIT_TYPE)
      .sort((a, b) => String(b.depositedAt || b.updatedAt).localeCompare(String(a.depositedAt || a.updatedAt)));
  }

  deposits() {
    return this.allDeposits().filter((item) => item.state === 'DEPOSITED_RECOGNIZED_USD');
  }

  get(depositId) { return this.domain.get(RECORD_TYPES.SRA_TRANSACTION, depositId); }

  preview(input = {}) {
    const instrumentId = text(input.instrumentId, 'instrumentId');
    const instrument = this.domain.get(RECORD_TYPES.SRA_INSTRUMENT, instrumentId);
    if (!instrument) throw new Error('Platform commercial instrument was not found.');
    if (instrumentId !== CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID || instrument.instrumentPurpose !== 'PLATFORM_SELF_FINANCING') {
      throw new Error('Select the canonical $18,000,000 SRA platform commercial instrument. Marketplace transaction instruments cannot establish the platform Treasury position.');
    }
    if (['CANCELLED', 'MATURED', 'CLOSED'].includes(String(instrument.state || '').toUpperCase())) throw new Error('The platform commercial instrument is not open for deposit.');
    const faceValueUsd = amount(input.faceValueUsd ?? instrument.faceValueUsd ?? instrument.principalQuantity);
    if (faceValueUsd !== CANONICAL_PLATFORM_FUNDING_FACE_VALUE_USD) throw new Error('The canonical platform commercial instrument has a fixed USD face value of $18,000,000.');
    const depositReference = text(input.depositReference, 'depositReference');
    const depositId = digestId('PFID', `CANONICAL:${CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID}`);
    const existing = this.get(depositId);
    const alreadyDeposited = this.deposits().find((item) => item.instrumentId === instrumentId);
    if (alreadyDeposited && alreadyDeposited.transactionId !== depositId) throw new Error('The canonical platform commercial instrument is already deposited in Treasury.');
    const termMonths = Number(input.termMonths ?? instrument.termMonths ?? 36);
    if (!Number.isInteger(termMonths) || termMonths <= 0) throw new Error('termMonths must be a positive integer.');
    const requiredAccounts = [CASH_ACCOUNT, INSTRUMENT_ACCOUNT, SRA_REPRESENTED_ACCOUNT, LEGACY_FUNDING_ACCOUNT];
    if (requiredAccounts.some((accountId) => !this.domain.get(RECORD_TYPES.LEDGER_ACCOUNT, accountId))) throw new Error('Platform commercial instrument Treasury accounts are unavailable.');
    const legacyDeposits = this.deposits().filter((item) => item.instrumentId !== instrumentId);
    const legacyDepositedValueUsd = round(legacyDeposits.reduce((sum, item) => sum + Number(item.faceValueUsd || 0), 0));
    const existingCashFundingJournal = this.treasury.journals().find((journal) => {
      const lines = Array.isArray(journal.lines) ? journal.lines : [];
      return lines.some((line) => line.accountId === CASH_ACCOUNT && line.side === 'DEBIT' && round(line.amount) === faceValueUsd)
        && lines.some((line) => line.accountId === LEGACY_FUNDING_ACCOUNT && line.side === 'CREDIT' && round(line.amount) === faceValueUsd);
    }) || null;
    return {
      action: 'DEPOSIT_CANONICAL_PLATFORM_COMMERCIAL_INSTRUMENT',
      readOnly: true,
      depositId,
      instrumentId,
      instrumentName: instrument.name || instrument.instrumentName || instrumentId,
      faceValueUsd,
      termMonths,
      depositReference,
      existingDeposit: existing || null,
      reconciliation: {
        legacyDepositCount: legacyDeposits.length,
        legacyDepositedValueUsd,
        existingCashFundingJournalId: existingCashFundingJournal?.entryId || null,
        reclassifiesExistingCashJournal: Boolean(existingCashFundingJournal)
      },
      treasuryEffect: {
        debit: { accountId: INSTRUMENT_ACCOUNT, amount: faceValueUsd, meaning: 'Canonical platform commercial instrument represented in USD' },
        credit: { accountId: SRA_REPRESENTED_ACCOUNT, amount: faceValueUsd, meaning: 'SRA represented at the fixed 1 SRA = 1 USD par reference' }
      },
      sraReference: { asset: 'SRA Coin', market: 'SRA/USD', rate: 1, representedQuantity: faceValueUsd },
      financingCapacityUsd: faceValueUsd,
      approvalRequired: true,
      effect: 'Establishes one canonical $18,000,000 platform commercial instrument as the Treasury financing foundation and reconciles earlier test deposits and the existing manual funding journal without duplicating value.',
      doesNot: ['ADD_A_SECOND_18M_POSITION', 'COUNT_MARKETPLACE_TRADE_INSTRUMENTS_AS_PLATFORM_FUNDING', 'RECORD_OWNER_CONTRIBUTED_CAPITAL', 'EXECUTE_EXTERNAL_SETTLEMENT', 'SELF_APPROVE']
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator instrument-deposit approval is required.');
    const preview = this.preview(input);
    const existing = this.get(preview.depositId);
    if (existing?.state === 'DEPOSITED_RECOGNIZED_USD') return { deposit: existing, created: false, treasury: this.treasury.summary() };

    const instrument = this.domain.get(RECORD_TYPES.SRA_INSTRUMENT, preview.instrumentId);
    const timestamp = now();
    const entryId = digestId('TJE', `CANONICAL_PLATFORM_INSTRUMENT:${preview.instrumentId}`);
    const accounts = new Map(this.treasury.accounts().map((item) => [item.accountId, item]));
    const lines = [];

    if (preview.reconciliation.legacyDepositedValueUsd > 0) {
      lines.push(
        { accountId: LEGACY_FUNDING_ACCOUNT, accountName: accounts.get(LEGACY_FUNDING_ACCOUNT).name, side: 'DEBIT', amount: preview.reconciliation.legacyDepositedValueUsd, currency: 'USD' },
        { accountId: INSTRUMENT_ACCOUNT, accountName: accounts.get(INSTRUMENT_ACCOUNT).name, side: 'CREDIT', amount: preview.reconciliation.legacyDepositedValueUsd, currency: 'USD' }
      );
    }
    if (preview.reconciliation.reclassifiesExistingCashJournal) {
      lines.push(
        { accountId: LEGACY_FUNDING_ACCOUNT, accountName: accounts.get(LEGACY_FUNDING_ACCOUNT).name, side: 'DEBIT', amount: preview.faceValueUsd, currency: 'USD' },
        { accountId: CASH_ACCOUNT, accountName: accounts.get(CASH_ACCOUNT).name, side: 'CREDIT', amount: preview.faceValueUsd, currency: 'USD' }
      );
    }
    lines.push(
      { accountId: INSTRUMENT_ACCOUNT, accountName: accounts.get(INSTRUMENT_ACCOUNT).name, side: 'DEBIT', amount: preview.faceValueUsd, currency: 'USD' },
      { accountId: SRA_REPRESENTED_ACCOUNT, accountName: accounts.get(SRA_REPRESENTED_ACCOUNT).name, side: 'CREDIT', amount: preview.faceValueUsd, currency: 'USD' }
    );

    const totalDebits = round(lines.filter((line) => line.side === 'DEBIT').reduce((sum, line) => sum + line.amount, 0));
    const totalCredits = round(lines.filter((line) => line.side === 'CREDIT').reduce((sum, line) => sum + line.amount, 0));
    if (totalDebits !== totalCredits) throw new Error('Canonical platform instrument reconciliation is not balanced.');
    const updatedAccounts = applyLines(accounts, lines, entryId, timestamp);
    const journal = {
      entryId,
      treasuryProfileId: 'SRA_PLATFORM_TREASURY',
      journalType: 'CANONICAL_PLATFORM_FUNDING_INSTRUMENT_RECONCILIATION',
      memo: 'Reconcile the canonical $18,000,000 SRA platform commercial instrument into Treasury',
      reference: preview.depositReference,
      sourceLedgerEntryId: preview.reconciliation.existingCashFundingJournalId,
      currency: 'USD', totalDebits, totalCredits, lines, state: 'POSTED',
      approval: { approvedBy: actorId, approvedAt: timestamp },
      postedAt: timestamp, createdAt: timestamp, updatedAt: timestamp
    };
    const deposit = {
      transactionId: preview.depositId,
      transactionType: DEPOSIT_TYPE,
      instrumentId: preview.instrumentId,
      ledgerEntryId: entryId,
      sourceLedgerEntryId: preview.reconciliation.existingCashFundingJournalId,
      faceValueUsd: preview.faceValueUsd,
      representedSraQuantity: preview.faceValueUsd,
      nativeMarketPair: 'SRA/USD',
      parReference: '1 SRA = 1 USD',
      termMonths: preview.termMonths,
      depositReference: preview.depositReference,
      state: 'DEPOSITED_RECOGNIZED_USD',
      financingState: 'AVAILABLE_FOR_GOVERNED_FINANCING',
      isCanonicalPlatformFundingInstrument: true,
      supersededLegacyDepositCount: preview.reconciliation.legacyDepositCount,
      supersededLegacyDepositValueUsd: preview.reconciliation.legacyDepositedValueUsd,
      depositedBy: actorId, depositedAt: timestamp, createdAt: timestamp, updatedAt: timestamp
    };
    const updatedInstrument = {
      ...instrument,
      platformTreasuryDepositId: preview.depositId,
      depositedFaceValueUsd: preview.faceValueUsd,
      representedSraQuantity: preview.faceValueUsd,
      treasuryRepresentation: 'USD',
      treasuryState: 'DEPOSITED_RECOGNIZED_USD',
      financingState: 'AVAILABLE_FOR_GOVERNED_FINANCING',
      depositedAt: timestamp,
      updatedAt: timestamp
    };

    const changes = [...updatedAccounts.values()].map((account) => ({ type: RECORD_TYPES.LEDGER_ACCOUNT, id: account.accountId, payload: account, actorId, eventType: 'TREASURY_LEDGER_ACCOUNT_BALANCE_UPDATED' }));
    changes.push(
      { type: RECORD_TYPES.LEDGER_ENTRY, id: entryId, payload: journal, actorId, eventType: 'CANONICAL_PLATFORM_FUNDING_INSTRUMENT_RECONCILED' },
      { type: RECORD_TYPES.SRA_TRANSACTION, id: preview.depositId, payload: deposit, actorId, eventType: 'PLATFORM_FUNDING_INSTRUMENT_DEPOSITED' },
      { type: RECORD_TYPES.SRA_INSTRUMENT, id: preview.instrumentId, payload: updatedInstrument, actorId, eventType: 'PLATFORM_FUNDING_INSTRUMENT_TREASURY_RECOGNIZED' }
    );
    for (const legacy of this.deposits().filter((item) => item.instrumentId !== preview.instrumentId)) {
      changes.push({
        type: RECORD_TYPES.SRA_TRANSACTION,
        id: legacy.transactionId,
        actorId,
        eventType: 'NON_PLATFORM_INSTRUMENT_TREASURY_DEPOSIT_SUPERSEDED',
        payload: { ...legacy, state: 'SUPERSEDED_NON_PLATFORM_INSTRUMENT', financingState: 'NOT_PLATFORM_FINANCING_CAPACITY', supersededByDepositId: preview.depositId, supersededAt: timestamp, updatedAt: timestamp }
      });
      const legacyInstrument = this.domain.get(RECORD_TYPES.SRA_INSTRUMENT, legacy.instrumentId);
      if (legacyInstrument) changes.push({
        type: RECORD_TYPES.SRA_INSTRUMENT,
        id: legacy.instrumentId,
        actorId,
        eventType: 'NON_PLATFORM_INSTRUMENT_TREASURY_STATUS_REMOVED',
        payload: { ...legacyInstrument, treasuryState: 'NOT_PLATFORM_FUNDING_INSTRUMENT', financingState: 'NOT_PLATFORM_FINANCING_CAPACITY', supersededTreasuryDepositId: legacy.transactionId, platformTreasuryDepositId: null, updatedAt: timestamp }
      });
    }
    await this.domain.atomicPut(changes);
    return { deposit, instrument: updatedInstrument, journal, created: true, treasury: this.treasury.summary() };
  }

  summary() {
    const deposits = this.deposits();
    const canonical = deposits.find((item) => item.instrumentId === CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID) || null;
    const total = canonical ? Number(canonical.faceValueUsd || 0) : 0;
    return {
      depositCount: canonical ? 1 : 0,
      depositedInstrumentValueUsd: total,
      availableFinancingCapacityUsd: total,
      representedSraQuantity: canonical ? Number(canonical.representedSraQuantity || total) : 0,
      canonicalInstrumentId: CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,
      canonicalDeposit: canonical,
      deposits: canonical ? [canonical] : [],
      ignoredLegacyDepositCount: this.allDeposits().filter((item) => item.state === 'SUPERSEDED_NON_PLATFORM_INSTRUMENT').length,
      model: 'CANONICAL_PLATFORM_COMMERCIAL_INSTRUMENT_DEPOSIT',
      parReference: '1 SRA = 1 USD'
    };
  }
}

export {
  DEPOSIT_TYPE as PLATFORM_FUNDING_INSTRUMENT_DEPOSIT_TYPE,
  CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,
  CANONICAL_PLATFORM_FUNDING_FACE_VALUE_USD
};
