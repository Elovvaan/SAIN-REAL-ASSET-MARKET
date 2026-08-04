import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

function requireText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function finitePositive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be greater than zero.`);
  return number;
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

const OPEN_STATES = new Set(['INITIATED', 'AUTHORIZED', 'EXECUTED', 'PENDING_SETTLEMENT']);
const FINAL_STATES = new Set(['COMPLETED', 'CANCELLED', 'FAILED']);

export class TransactionEngineService {
  constructor(persistentDomain) {
    this.persistentDomain = persistentDomain;
  }

  list(filters = {}) {
    return this.persistentDomain.list(RECORD_TYPES.SRA_TRANSACTION)
      .filter((transaction) => !filters.state || transaction.state === filters.state)
      .filter((transaction) => !filters.instrumentId || transaction.instrumentId === filters.instrumentId)
      .filter((transaction) => !filters.transactionType || transaction.transactionType === filters.transactionType)
      .filter((transaction) => !filters.partyId || [transaction.fromParty?.id, transaction.toParty?.id].includes(filters.partyId))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  get(transactionId) {
    return this.persistentDomain.get(RECORD_TYPES.SRA_TRANSACTION, transactionId);
  }

  reservedQuantity(instrumentId, excludingTransactionId = null) {
    return this.list({ instrumentId })
      .filter((transaction) => transaction.transactionId !== excludingTransactionId)
      .filter((transaction) => OPEN_STATES.has(transaction.state) || transaction.state === 'COMPLETED')
      .reduce((total, transaction) => total + Number(transaction.quantity || 0), 0);
  }

  async createFromInstrument(instrumentId, input = {}, actorId = 'SAIN_AGENT') {
    const instrument = this.persistentDomain.get(RECORD_TYPES.SRA_INSTRUMENT, instrumentId);
    if (!instrument) throw new Error('Instrument not found.');
    if (!['RECORDED', 'ACTIVE', 'RESTRICTED'].includes(instrument.state)) throw new Error('Only a recorded or active instrument can support a transaction.');

    const idempotencyKey = input.idempotencyKey ? requireText(input.idempotencyKey, 'idempotencyKey') : null;
    if (idempotencyKey) {
      const existing = this.list({ instrumentId }).find((transaction) => transaction.idempotencyKey === idempotencyKey);
      if (existing) return { transaction: existing, created: false };
    }

    const principalQuantity = finitePositive(instrument.denomination?.principalQuantity, 'instrument principal quantity');
    const quantity = finitePositive(input.quantity ?? principalQuantity, 'quantity');
    const reserved = this.reservedQuantity(instrumentId);
    if (Number((reserved + quantity).toFixed(8)) > principalQuantity) throw new Error('Transaction quantity exceeds the instrument quantity available for transaction.');

    const fromParty = input.fromParty || instrument.holder || instrument.issuer;
    const toParty = input.toParty;
    if (!fromParty?.id) throw new Error('fromParty.id is required.');
    if (!toParty?.id) throw new Error('toParty.id is required.');
    if (String(fromParty.id) === String(toParty.id)) throw new Error('fromParty and toParty must be different.');

    const transactionId = `SRT-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    const now = new Date().toISOString();
    const transactionType = requireText(input.transactionType || 'INSTRUMENT_TRANSFER', 'transactionType').toUpperCase();
    const settlementUnit = requireText(input.settlementUnit || instrument.terms?.settlementUnit || instrument.denomination?.symbol, 'settlementUnit').toUpperCase();
    const transaction = {
      transactionId,
      idempotencyKey,
      transactionType,
      instrumentId,
      coinPositionId: instrument.coinPositionId,
      coinAccountId: instrument.coinAccountId,
      financialRecordId: instrument.financialRecordId,
      recognitionId: instrument.recognitionId,
      observationId: instrument.observationId,
      fromParty,
      toParty,
      quantity,
      denomination: instrument.denomination?.symbol,
      consideration: input.consideration || null,
      purpose: requireText(input.purpose || instrument.terms?.purpose || 'INSTRUMENT_TRANSACTION', 'purpose').toUpperCase(),
      authority: input.authority || null,
      conditions: asList(input.conditions),
      restrictions: [...asList(instrument.restrictions), ...asList(input.restrictions)],
      settlement: {
        unit: settlementUnit,
        method: input.settlementMethod || null,
        rail: input.settlementRail || null,
        destination: input.settlementDestination || null,
        instructionReference: input.settlementInstructionReference || null,
        externalReference: null,
        dueAt: input.settlementDueAt || null,
        state: 'NOT_STARTED'
      },
      execution: {
        authorizedBy: null,
        authorizedAt: null,
        executedBy: null,
        executedAt: null,
        executionReference: null,
        evidence: []
      },
      sourceLineage: {
        instrumentId,
        coinPositionId: instrument.coinPositionId,
        financialRecordId: instrument.financialRecordId,
        recognitionId: instrument.recognitionId,
        observationId: instrument.observationId,
        source: instrument.sourceLineage?.source || null,
        evidence: instrument.sourceLineage?.evidence || null,
        conversionRule: instrument.sourceLineage?.conversionRule || null,
        governingReference: instrument.terms?.governingReference || null
      },
      state: 'INITIATED',
      statusHistory: [{ state: 'INITIATED', actorId, occurredAt: now, reason: input.reason || 'Transaction initiated from an SRA Instrument.' }],
      phase: 6,
      version: 3,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now
    };

    await this.persistentDomain.put(RECORD_TYPES.SRA_TRANSACTION, transactionId, transaction, { actorId, eventType: 'SRA_TRANSACTION_INITIATED' });
    await this.persistentDomain.lifecycle({
      objectType: RECORD_TYPES.SRA_TRANSACTION,
      objectId: transactionId,
      eventType: 'INSTRUMENT_TRANSACTION_INITIATED',
      actorId,
      payload: { instrumentId, transactionType, quantity, denomination: transaction.denomination, fromParty: fromParty.id, toParty: toParty.id }
    });
    return { transaction, created: true };
  }

  async changeState(transactionId, input = {}, actorId = 'SRA_PLATFORM') {
    const transaction = this.get(transactionId);
    if (!transaction) throw new Error('Transaction not found.');
    if (FINAL_STATES.has(transaction.state)) throw new Error('A final transaction cannot change state.');

    const state = requireText(input.state, 'state').toUpperCase();
    const allowed = ['INITIATED', 'AUTHORIZED', 'EXECUTED', 'PENDING_SETTLEMENT', 'COMPLETED', 'CANCELLED', 'FAILED'];
    if (!allowed.includes(state)) throw new Error('Unsupported transaction state.');

    const transitions = {
      INITIATED: ['AUTHORIZED', 'CANCELLED', 'FAILED'],
      AUTHORIZED: ['EXECUTED', 'CANCELLED', 'FAILED'],
      EXECUTED: ['PENDING_SETTLEMENT', 'COMPLETED', 'FAILED'],
      PENDING_SETTLEMENT: ['COMPLETED', 'FAILED']
    };
    if (state !== transaction.state && !(transitions[transaction.state] || []).includes(state)) throw new Error(`Transaction cannot move from ${transaction.state} to ${state}.`);

    const now = new Date().toISOString();
    const execution = { ...(transaction.execution || {}) };
    const settlement = { ...(transaction.settlement || {}) };
    if (state === 'AUTHORIZED') {
      execution.authorizedBy = input.authorizedBy || actorId;
      execution.authorizedAt = now;
    }
    if (state === 'EXECUTED') {
      execution.executedBy = input.executedBy || actorId;
      execution.executedAt = now;
      execution.executionReference = requireText(input.executionReference, 'executionReference');
      execution.evidence = [...asList(execution.evidence), ...asList(input.evidence)];
    }
    if (state === 'PENDING_SETTLEMENT') settlement.state = 'PENDING';
    if (state === 'COMPLETED') {
      settlement.state = 'RECORDED';
      settlement.externalReference = input.externalReference || settlement.externalReference || null;
      settlement.completedAt = now;
    }
    if (state === 'FAILED') settlement.state = 'FAILED';
    if (state === 'CANCELLED') settlement.state = 'CANCELLED';

    const updated = {
      ...transaction,
      state,
      execution,
      settlement,
      statusHistory: [...(transaction.statusHistory || []), { state, actorId, occurredAt: now, reason: input.reason || null }],
      authorizedAt: state === 'AUTHORIZED' ? now : transaction.authorizedAt || null,
      executedAt: state === 'EXECUTED' ? now : transaction.executedAt || null,
      completedAt: state === 'COMPLETED' ? now : transaction.completedAt || null,
      cancelledAt: state === 'CANCELLED' ? now : transaction.cancelledAt || null,
      failedAt: state === 'FAILED' ? now : transaction.failedAt || null,
      updatedAt: now
    };

    await this.persistentDomain.put(RECORD_TYPES.SRA_TRANSACTION, transactionId, updated, { actorId, eventType: 'SRA_TRANSACTION_STATE_CHANGED' });
    await this.persistentDomain.lifecycle({
      objectType: RECORD_TYPES.SRA_TRANSACTION,
      objectId: transactionId,
      eventType: 'SRA_TRANSACTION_STATE_CHANGED',
      actorId,
      payload: { state, instrumentId: transaction.instrumentId, quantity: transaction.quantity, reason: input.reason || null }
    });
    return updated;
  }

  summary() {
    const transactions = this.list();
    const byState = {};
    const byType = {};
    const quantityBySymbol = {};
    for (const transaction of transactions) {
      byState[transaction.state] = (byState[transaction.state] || 0) + 1;
      byType[transaction.transactionType] = (byType[transaction.transactionType] || 0) + 1;
      const symbol = transaction.denomination || 'UNSPECIFIED';
      quantityBySymbol[symbol] = Number(((quantityBySymbol[symbol] || 0) + Number(transaction.quantity || 0)).toFixed(8));
    }
    return {
      version: 3,
      phase: 6,
      layer: 'TRANSACTION_ENGINE',
      transactionCount: transactions.length,
      byState,
      byType,
      quantityBySymbol,
      latestCreatedAt: transactions[0]?.createdAt || null
    };
  }
}
