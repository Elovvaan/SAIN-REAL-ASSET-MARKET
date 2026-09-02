import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const DEPOSIT_TYPE = 'PLATFORM_FUNDING_INSTRUMENT_DEPOSIT';
const CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID = 'INS-SRA-PLATFORM-FUNDING-18000000';
const CANONICAL_PLATFORM_FUNDING_FACE_VALUE_USD = 18_000_000;
const INSTRUMENT_ACCOUNT = 'TRSY-1050-INSTRUMENT-USD';
const SRA_REPRESENTED_ACCOUNT = 'TRSY-2000-SRA-REPRESENTED';
const PLATFORM_COIN_ACCOUNT_ID = 'CA-SRA-PLATFORM-TREASURY';
const PLATFORM_COIN_POSITION_ID = 'CP-SRA-PLATFORM-FUNDING-18000000';
const PLATFORM_COIN_POSITION_EVENT_ID = 'LE-SRA-PLATFORM-FUNDING-COIN-POSITION';

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

export class PlatformFundingInstrumentDepositService {
  constructor(domain, treasury) { this.domain = domain; this.treasury = treasury; }

  allDeposits() {
    return this.domain.list(RECORD_TYPES.SRA_TRANSACTION)
      .filter((item) => item.transactionType === DEPOSIT_TYPE)
      .sort((a, b) => String(b.depositedAt || b.updatedAt).localeCompare(String(a.depositedAt || a.updatedAt)));
  }

  deposits() { return this.allDeposits().filter((item) => item.state === 'DEPOSITED_RECOGNIZED_USD'); }
  get(depositId) { return this.domain.get(RECORD_TYPES.SRA_TRANSACTION, depositId); }

  representationRecords(deposit, instrument, actorId, timestamp = now()) {
    const existingAccount = this.domain.get(RECORD_TYPES.COIN_ACCOUNT, PLATFORM_COIN_ACCOUNT_ID);
    const existingPosition = this.domain.get(RECORD_TYPES.COIN_POSITION, PLATFORM_COIN_POSITION_ID);
    const quantity = Number(deposit.representedSraQuantity || deposit.faceValueUsd || CANONICAL_PLATFORM_FUNDING_FACE_VALUE_USD);
    const coinAccount = existingAccount ? {
      ...existingAccount,
      positionCount: Number(existingAccount.positionCount || 0) + (existingPosition ? 0 : 1),
      representedQuantity: Number(existingAccount.representedQuantity || 0) + (existingPosition ? 0 : quantity),
      latestCoinPositionId: PLATFORM_COIN_POSITION_ID,
      updatedAt: timestamp,
    } : {
      coinAccountId: PLATFORM_COIN_ACCOUNT_ID,
      subjectType: 'PLATFORM_TREASURY',
      subjectId: 'SRA_PLATFORM',
      ownerId: 'SRA_PLATFORM',
      symbol: 'SRA',
      state: 'ACTIVE',
      positionCount: 1,
      representedQuantity: quantity,
      latestCoinPositionId: PLATFORM_COIN_POSITION_ID,
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const coinPosition = existingPosition || {
      coinPositionId: PLATFORM_COIN_POSITION_ID,
      coinAccountId: PLATFORM_COIN_ACCOUNT_ID,
      sourceInstrumentId: instrument.instrumentId,
      sourceDepositId: deposit.transactionId,
      sourceLedgerEntryId: deposit.ledgerEntryId,
      ownerId: 'SRA_PLATFORM',
      ownerType: 'PLATFORM',
      symbol: 'SRA',
      representationType: 'PLATFORM_FUNDING_INSTRUMENT_POSITION',
      sourcePosition: { amount: quantity, unit: 'USD', asOf: deposit.depositedAt || timestamp, basis: 'PLATFORM_FUNDING_INSTRUMENT_TREASURY_DEPOSIT' },
      recordedValue: { amount: quantity, currency: 'USD' },
      conversionRule: { method: 'RECORDED_USD_VALUE_AT_PAR', rate: 1, sourceUnit: 'USD', coinUnit: 'SRA', methodologyReference: 'ONE_SRA_PER_RECOGNIZED_RECORDED_USD' },
      quantity,
      availableQuantity: quantity,
      reservedQuantity: 0,
      externalizedQuantity: 0,
      rights: instrument.rights || [],
      obligations: instrument.obligations || [],
      restrictions: [],
      sourceLineage: { instrumentId: instrument.instrumentId, depositId: deposit.transactionId, ledgerEntryId: deposit.ledgerEntryId },
      state: 'ACTIVE',
      statusHistory: [{ state: 'ACTIVE', actorId, occurredAt: timestamp, reason: 'Canonical platform funding instrument represented as an SRA Coin Position.' }],
      representedBy: actorId,
      representedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const event = {
      id: PLATFORM_COIN_POSITION_EVENT_ID,
      eventId: PLATFORM_COIN_POSITION_EVENT_ID,
      objectType: RECORD_TYPES.COIN_POSITION,
      objectId: PLATFORM_COIN_POSITION_ID,
      eventType: 'PLATFORM_FUNDING_INSTRUMENT_COIN_POSITION_CREATED',
      actorId,
      occurredAt: timestamp,
      payload: { instrumentId: instrument.instrumentId, depositId: deposit.transactionId, coinAccountId: PLATFORM_COIN_ACCOUNT_ID, coinPositionId: PLATFORM_COIN_POSITION_ID, quantity, symbol: 'SRA' },
    };
    return { coinAccount, coinPosition, event, existingAccount, existingPosition };
  }

  async ensureCoinPosition(actorId = 'SRA_TREASURY_SYSTEM') {
    const deposit = this.deposits().find((item) => item.instrumentId === CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID) || null;
    const instrument = this.domain.get(RECORD_TYPES.SRA_INSTRUMENT, CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID);
    if (!deposit || !instrument) return { created: false, reason: 'CANONICAL_DEPOSIT_NOT_AVAILABLE' };
    const records = this.representationRecords(deposit, instrument, actorId);
    if (records.existingPosition) return { created: false, coinAccount: records.coinAccount, coinPosition: records.coinPosition };
    const timestamp = records.coinPosition.createdAt;
    await this.domain.atomicPut([
      { type: RECORD_TYPES.COIN_ACCOUNT, id: PLATFORM_COIN_ACCOUNT_ID, payload: records.coinAccount, actorId, eventType: 'PLATFORM_TREASURY_COIN_ACCOUNT_OPENED' },
      { type: RECORD_TYPES.COIN_POSITION, id: PLATFORM_COIN_POSITION_ID, payload: records.coinPosition, actorId, eventType: 'PLATFORM_FUNDING_INSTRUMENT_COIN_POSITION_CREATED' },
      { type: RECORD_TYPES.SRA_INSTRUMENT, id: instrument.instrumentId, payload: { ...instrument, preparedCoinPositionId: PLATFORM_COIN_POSITION_ID, updatedAt: timestamp }, actorId, eventType: 'PLATFORM_FUNDING_INSTRUMENT_COIN_POSITION_PREPARED' },
      { type: RECORD_TYPES.LIFECYCLE_EVENT, id: records.event.id, payload: records.event, actorId, eventType: records.event.eventType },
    ]);
    return { created: true, coinAccount: records.coinAccount, coinPosition: records.coinPosition, event: records.event };
  }

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
    const termMonths = Number(input.termMonths ?? instrument.termMonths ?? 36);
    if (!Number.isInteger(termMonths) || termMonths <= 0) throw new Error('termMonths must be a positive integer.');
    const depositReference = text(input.depositReference, 'depositReference');
    const depositId = digestId('PFID', `CANONICAL:${instrumentId}`);
    if (!this.domain.get(RECORD_TYPES.LEDGER_ACCOUNT, INSTRUMENT_ACCOUNT) || !this.domain.get(RECORD_TYPES.LEDGER_ACCOUNT, SRA_REPRESENTED_ACCOUNT)) {
      throw new Error('Platform commercial instrument Treasury accounts are unavailable.');
    }
    const legacyDeposits = this.deposits().filter((item) => item.instrumentId !== instrumentId);
    return {
      action: 'DEPOSIT_CANONICAL_PLATFORM_COMMERCIAL_INSTRUMENT', readOnly: true, depositId, instrumentId,
      instrumentName: instrument.name || instrument.instrumentName || instrumentId,
      faceValueUsd, termMonths, depositReference,
      existingDeposit: this.get(depositId),
      reconciliation: {
        legacyDepositCount: legacyDeposits.length,
        legacyDepositedValueUsd: round(legacyDeposits.reduce((sum, item) => sum + Number(item.faceValueUsd || 0), 0)),
        cleanupMode: 'EXCLUDED_FROM_CANONICAL_SUMMARY'
      },
      treasuryEffect: {
        debit: { accountId: INSTRUMENT_ACCOUNT, amount: faceValueUsd },
        credit: { accountId: SRA_REPRESENTED_ACCOUNT, amount: faceValueUsd }
      },
      sraReference: { asset: 'SRA Coin', market: 'SRA/USD', rate: 1, representedQuantity: faceValueUsd },
      financingCapacityUsd: faceValueUsd,
      approvalRequired: true,
      effect: 'Establishes the canonical $18,000,000 platform commercial instrument as Treasury financing capacity in one bounded atomic posting.',
      doesNot: ['ADD_A_SECOND_18M_POSITION', 'COUNT_MARKETPLACE_TRADE_INSTRUMENTS_AS_PLATFORM_FUNDING', 'EXECUTE_EXTERNAL_SETTLEMENT', 'SELF_APPROVE']
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator instrument-deposit approval is required.');
    const preview = this.preview(input);
    const existing = this.get(preview.depositId);
    if (existing?.state === 'DEPOSITED_RECOGNIZED_USD') {
      const representation = await this.ensureCoinPosition(actorId);
      return { deposit: existing, created: false, representation, treasury: this.treasury.summary() };
    }

    const timestamp = now();
    const entryId = digestId('TJE', `CANONICAL_PLATFORM_INSTRUMENT:${preview.instrumentId}`);
    const instrumentAccount = this.domain.get(RECORD_TYPES.LEDGER_ACCOUNT, INSTRUMENT_ACCOUNT);
    const representedAccount = this.domain.get(RECORD_TYPES.LEDGER_ACCOUNT, SRA_REPRESENTED_ACCOUNT);
    const updatedInstrumentAccount = updateAccount(instrumentAccount, 'DEBIT', preview.faceValueUsd, entryId, timestamp);
    const updatedRepresentedAccount = updateAccount(representedAccount, 'CREDIT', preview.faceValueUsd, entryId, timestamp);
    const lines = [
      { accountId: INSTRUMENT_ACCOUNT, accountName: instrumentAccount.name, side: 'DEBIT', amount: preview.faceValueUsd, currency: 'USD' },
      { accountId: SRA_REPRESENTED_ACCOUNT, accountName: representedAccount.name, side: 'CREDIT', amount: preview.faceValueUsd, currency: 'USD' }
    ];
    const journal = {
      entryId, treasuryProfileId: 'SRA_PLATFORM_TREASURY', journalType: 'CANONICAL_PLATFORM_FUNDING_INSTRUMENT_DEPOSIT',
      memo: 'Deposit the canonical $18,000,000 SRA platform commercial instrument into Treasury',
      reference: preview.depositReference, currency: 'USD', totalDebits: preview.faceValueUsd, totalCredits: preview.faceValueUsd,
      lines, state: 'POSTED', approval: { approvedBy: actorId, approvedAt: timestamp }, postedAt: timestamp, createdAt: timestamp, updatedAt: timestamp
    };
    const deposit = {
      transactionId: preview.depositId, transactionType: DEPOSIT_TYPE, instrumentId: preview.instrumentId, ledgerEntryId: entryId,
      faceValueUsd: preview.faceValueUsd, representedSraQuantity: preview.faceValueUsd, nativeMarketPair: 'SRA/USD', parReference: '1 SRA = 1 USD',
      termMonths: preview.termMonths, depositReference: preview.depositReference, state: 'DEPOSITED_RECOGNIZED_USD',
      financingState: 'AVAILABLE_FOR_GOVERNED_FINANCING', isCanonicalPlatformFundingInstrument: true,
      ignoredLegacyDepositCount: preview.reconciliation.legacyDepositCount,
      depositedBy: actorId, depositedAt: timestamp, createdAt: timestamp, updatedAt: timestamp
    };
    const instrument = this.domain.get(RECORD_TYPES.SRA_INSTRUMENT, preview.instrumentId);
    const updatedInstrument = {
      ...instrument, platformTreasuryDepositId: preview.depositId, depositedFaceValueUsd: preview.faceValueUsd,
      representedSraQuantity: preview.faceValueUsd, treasuryRepresentation: 'USD', treasuryState: 'DEPOSITED_RECOGNIZED_USD',
      financingState: 'AVAILABLE_FOR_GOVERNED_FINANCING', preparedCoinPositionId: PLATFORM_COIN_POSITION_ID, depositedAt: timestamp, updatedAt: timestamp
    };
    const representation = this.representationRecords(deposit, updatedInstrument, actorId, timestamp);

    await this.domain.atomicPut([
      { type: RECORD_TYPES.LEDGER_ACCOUNT, id: INSTRUMENT_ACCOUNT, payload: updatedInstrumentAccount, actorId, eventType: 'TREASURY_LEDGER_ACCOUNT_BALANCE_UPDATED' },
      { type: RECORD_TYPES.LEDGER_ACCOUNT, id: SRA_REPRESENTED_ACCOUNT, payload: updatedRepresentedAccount, actorId, eventType: 'TREASURY_LEDGER_ACCOUNT_BALANCE_UPDATED' },
      { type: RECORD_TYPES.LEDGER_ENTRY, id: entryId, payload: journal, actorId, eventType: 'CANONICAL_PLATFORM_FUNDING_INSTRUMENT_DEPOSIT_POSTED' },
      { type: RECORD_TYPES.SRA_TRANSACTION, id: preview.depositId, payload: deposit, actorId, eventType: 'PLATFORM_FUNDING_INSTRUMENT_DEPOSITED' },
      { type: RECORD_TYPES.SRA_INSTRUMENT, id: preview.instrumentId, payload: updatedInstrument, actorId, eventType: 'PLATFORM_FUNDING_INSTRUMENT_TREASURY_RECOGNIZED' },
      { type: RECORD_TYPES.COIN_ACCOUNT, id: PLATFORM_COIN_ACCOUNT_ID, payload: representation.coinAccount, actorId, eventType: 'PLATFORM_TREASURY_COIN_ACCOUNT_OPENED' },
      { type: RECORD_TYPES.COIN_POSITION, id: PLATFORM_COIN_POSITION_ID, payload: representation.coinPosition, actorId, eventType: 'PLATFORM_FUNDING_INSTRUMENT_COIN_POSITION_CREATED' },
      { type: RECORD_TYPES.LIFECYCLE_EVENT, id: representation.event.id, payload: representation.event, actorId, eventType: representation.event.eventType }
    ]);
    return { deposit, instrument: updatedInstrument, journal, coinAccount: representation.coinAccount, coinPosition: representation.coinPosition, created: true, treasury: this.treasury.summary() };
  }

  summary() {
    const canonical = this.deposits().find((item) => item.instrumentId === CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID) || null;
    const total = canonical ? Number(canonical.faceValueUsd || 0) : 0;
    return {
      depositCount: canonical ? 1 : 0,
      depositedInstrumentValueUsd: total,
      availableFinancingCapacityUsd: total,
      representedSraQuantity: canonical ? Number(canonical.representedSraQuantity || total) : 0,
      canonicalInstrumentId: CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,
      canonicalDeposit: canonical,
      deposits: canonical ? [canonical] : [],
      ignoredLegacyDepositCount: this.allDeposits().filter((item) => item.instrumentId !== CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID).length,
      model: 'CANONICAL_PLATFORM_COMMERCIAL_INSTRUMENT_DEPOSIT',
      parReference: '1 SRA = 1 USD'
    };
  }
}

export {
  DEPOSIT_TYPE as PLATFORM_FUNDING_INSTRUMENT_DEPOSIT_TYPE,
  CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,
  CANONICAL_PLATFORM_FUNDING_FACE_VALUE_USD,
  PLATFORM_COIN_ACCOUNT_ID,
  PLATFORM_COIN_POSITION_ID
};
