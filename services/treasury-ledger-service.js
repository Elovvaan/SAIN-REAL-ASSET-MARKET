import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const PROFILE_ID = 'SRA_PLATFORM_TREASURY';
const DEFAULT_ACCOUNTS = Object.freeze([
  { accountId: 'TRSY-1000-CASH-USD', code: '1000', name: 'Treasury Cash — USD', category: 'ASSET', normalSide: 'DEBIT', currency: 'USD' },
  { accountId: 'TRSY-1020-USDC-STELLAR', code: '1020', name: 'Treasury USDC — Stellar (USD equivalent)', category: 'ASSET', normalSide: 'DEBIT', currency: 'USD' },
  { accountId: 'TRSY-1100-RECOGNIZED-VALUE', code: '1100', name: 'Recognized Recorded Value', category: 'ASSET', normalSide: 'DEBIT', currency: 'USD' },
  { accountId: 'TRSY-2000-SRA-REPRESENTED', code: '2000', name: 'SRA Coin Represented at Par', category: 'LIABILITY', normalSide: 'CREDIT', currency: 'USD' },
  { accountId: 'TRSY-3000-PLATFORM-CAPITAL', code: '3000', name: 'Platform Contributed Capital', category: 'EQUITY', normalSide: 'CREDIT', currency: 'USD' }
]);

function now() { return new Date().toISOString(); }
function money(value, field = 'amount') {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`${field} must be greater than zero.`);
  return Number(amount.toFixed(8));
}
function text(value, field) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${field} is required.`);
  return result;
}
function side(value) {
  const result = String(value || '').toUpperCase();
  if (!['DEBIT', 'CREDIT'].includes(result)) throw new Error('Each journal line requires DEBIT or CREDIT.');
  return result;
}
function balanceEffect(account, line) {
  const increase = line.side === account.normalSide;
  return increase ? line.amount : -line.amount;
}
function journalId(input) {
  if (input.idempotencyKey) {
    const digest = crypto.createHash('sha256').update(String(input.idempotencyKey)).digest('hex').slice(0, 16).toUpperCase();
    return `TJE-${digest}`;
  }
  return `TJE-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

export class TreasuryLedgerService {
  constructor(domain) { this.domain = domain; }

  async initialize(actorId = 'SRA_TREASURY_SYSTEM') {
    const timestamp = now();
    const changes = [];
    if (!this.domain.get(RECORD_TYPES.PLATFORM_TREASURY_PROFILE, PROFILE_ID)) {
      changes.push({ type: RECORD_TYPES.PLATFORM_TREASURY_PROFILE, id: PROFILE_ID, actorId, eventType: 'PLATFORM_TREASURY_OPENED', payload: {
        profileId: PROFILE_ID, name: 'SRA Platform Treasury', state: 'ACTIVE', accountingBasis: 'DOUBLE_ENTRY', functionalCurrency: 'USD', parReference: { asset: 'SRA Coin', market: 'SRA/USD', rate: 1, unit: 'USD_PER_SRA' }, createdAt: timestamp, updatedAt: timestamp
      } });
    }
    for (const definition of DEFAULT_ACCOUNTS) {
      if (this.domain.get(RECORD_TYPES.LEDGER_ACCOUNT, definition.accountId)) continue;
      changes.push({ type: RECORD_TYPES.LEDGER_ACCOUNT, id: definition.accountId, actorId, eventType: 'TREASURY_LEDGER_ACCOUNT_OPENED', payload: {
        ...definition, treasuryProfileId: PROFILE_ID, state: 'ACTIVE', balance: 0, totalDebits: 0, totalCredits: 0, createdAt: timestamp, updatedAt: timestamp
      } });
    }
    if (changes.length) await this.domain.atomicPut(changes);
    return this.summary();
  }

  accounts() {
    return this.domain.list(RECORD_TYPES.LEDGER_ACCOUNT)
      .filter((item) => item.treasuryProfileId === PROFILE_ID)
      .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }

  journals() {
    return this.domain.list(RECORD_TYPES.LEDGER_ENTRY)
      .filter((item) => item.treasuryProfileId === PROFILE_ID)
      .sort((a, b) => String(b.postedAt || b.createdAt).localeCompare(String(a.postedAt || a.createdAt)));
  }

  preview(input = {}) {
    const memo = text(input.memo, 'memo');
    const rawLines = Array.isArray(input.lines) ? input.lines : [];
    if (rawLines.length < 2) throw new Error('A journal entry requires at least two lines.');
    const accounts = new Map(this.accounts().map((item) => [item.accountId, item]));
    const lines = rawLines.map((item, index) => {
      const accountId = text(item.accountId, `lines[${index}].accountId`);
      const account = accounts.get(accountId);
      if (!account || account.state !== 'ACTIVE') throw new Error(`Treasury account ${accountId} is unavailable.`);
      const line = { accountId, accountName: account.name, side: side(item.side), amount: money(item.amount, `lines[${index}].amount`), currency: String(item.currency || account.currency || 'USD').toUpperCase() };
      if (line.currency !== account.currency) throw new Error(`Treasury account ${accountId} requires ${account.currency}.`);
      return line;
    });
    const currencies = [...new Set(lines.map((item) => item.currency))];
    if (currencies.length !== 1) throw new Error('All journal lines must use one currency.');
    const totalDebits = Number(lines.filter((item) => item.side === 'DEBIT').reduce((sum, item) => sum + item.amount, 0).toFixed(8));
    const totalCredits = Number(lines.filter((item) => item.side === 'CREDIT').reduce((sum, item) => sum + item.amount, 0).toFixed(8));
    if (totalDebits !== totalCredits) throw new Error('Treasury journal is not balanced: total debits must equal total credits.');
    const projectedAccounts = lines.map((line) => {
      const account = accounts.get(line.accountId);
      return { accountId: account.accountId, currentBalance: Number(account.balance || 0), projectedBalance: Number((Number(account.balance || 0) + balanceEffect(account, line)).toFixed(8)) };
    });
    return { action: 'POST_TREASURY_JOURNAL', readOnly: true, memo, reference: input.reference || null, currency: currencies[0], totalDebits, totalCredits, balanced: true, lines, projectedAccounts, approvalRequired: true, effect: 'Posts equal debits and credits to the SRA Platform Treasury.', doesNot: ['CREATE_UNVERIFIED_VALUE', 'SELF_APPROVE', 'MOVE_EXTERNAL_FUNDS', 'CREATE_SRA_COIN_WITHOUT_RECOGNIZED_RECORDED_VALUE'] };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator treasury approval is required.');
    const preview = this.preview(input);
    const entryId = journalId(input);
    const existing = this.domain.get(RECORD_TYPES.LEDGER_ENTRY, entryId);
    if (existing) return { journal: existing, created: false, summary: this.summary() };
    const timestamp = now();
    const accountMap = new Map(this.accounts().map((item) => [item.accountId, item]));
    const updatedAccounts = new Map();
    for (const line of preview.lines) {
      const base = updatedAccounts.get(line.accountId) || accountMap.get(line.accountId);
      const next = {
        ...base,
        balance: Number((Number(base.balance || 0) + balanceEffect(base, line)).toFixed(8)),
        totalDebits: Number((Number(base.totalDebits || 0) + (line.side === 'DEBIT' ? line.amount : 0)).toFixed(8)),
        totalCredits: Number((Number(base.totalCredits || 0) + (line.side === 'CREDIT' ? line.amount : 0)).toFixed(8)),
        latestEntryId: entryId,
        updatedAt: timestamp
      };
      updatedAccounts.set(line.accountId, next);
    }
    const journal = {
      entryId, treasuryProfileId: PROFILE_ID, journalType: String(input.journalType || 'GENERAL').toUpperCase(), memo: preview.memo, reference: preview.reference, currency: preview.currency, totalDebits: preview.totalDebits, totalCredits: preview.totalCredits, lines: preview.lines, state: 'POSTED', approval: { approvedBy: actorId, approvedAt: timestamp }, postedAt: timestamp, createdAt: timestamp, updatedAt: timestamp
    };
    const changes = [...updatedAccounts.values()].map((account) => ({ type: RECORD_TYPES.LEDGER_ACCOUNT, id: account.accountId, payload: account, actorId, eventType: 'TREASURY_LEDGER_ACCOUNT_BALANCE_UPDATED' }));
    changes.push({ type: RECORD_TYPES.LEDGER_ENTRY, id: entryId, payload: journal, actorId, eventType: 'TREASURY_BALANCED_JOURNAL_POSTED' });
    await this.domain.atomicPut(changes);
    return { journal, created: true, summary: this.summary() };
  }

  summary() {
    const accounts = this.accounts();
    const journals = this.journals();
    const totalDebits = Number(journals.reduce((sum, item) => sum + Number(item.totalDebits || 0), 0).toFixed(8));
    const totalCredits = Number(journals.reduce((sum, item) => sum + Number(item.totalCredits || 0), 0).toFixed(8));
    const byAccount = Object.fromEntries(accounts.map((item) => [item.accountId, Number(item.balance || 0)]));
    return {
      treasuryProfileId: PROFILE_ID, state: 'ACTIVE', accountingBasis: 'DOUBLE_ENTRY', functionalCurrency: 'USD', accountCount: accounts.length, journalCount: journals.length, totalDebits, totalCredits, balanced: totalDebits === totalCredits, cashBalanceUsd: Number(byAccount['TRSY-1000-CASH-USD'] || 0), stellarUsdcUsdEquivalent: Number(byAccount['TRSY-1020-USDC-STELLAR'] || 0), recognizedValueBalanceUsd: Number(byAccount['TRSY-1100-RECOGNIZED-VALUE'] || 0), sraRepresentedAtParUsd: Number(byAccount['TRSY-2000-SRA-REPRESENTED'] || 0), capitalBalanceUsd: Number(byAccount['TRSY-3000-PLATFORM-CAPITAL'] || 0), accounts, recentJournals: journals.slice(0, 20), parReference: { asset: 'SRA Coin', market: 'SRA/USD', rate: 1, unit: 'USD_PER_SRA' }
    };
  }
}

export { PROFILE_ID as SRA_TREASURY_PROFILE_ID, DEFAULT_ACCOUNTS as SRA_TREASURY_DEFAULT_ACCOUNTS };
