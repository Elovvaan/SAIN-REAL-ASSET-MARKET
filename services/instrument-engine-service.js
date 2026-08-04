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

export class InstrumentEngineService {
  constructor(persistentDomain) {
    this.persistentDomain = persistentDomain;
  }

  list(filters = {}) {
    return this.persistentDomain.list(RECORD_TYPES.SRA_INSTRUMENT)
      .filter((instrument) => !filters.state || instrument.state === filters.state)
      .filter((instrument) => !filters.instrumentType || instrument.instrumentType === filters.instrumentType)
      .filter((instrument) => !filters.coinPositionId || instrument.coinPositionId === filters.coinPositionId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  get(instrumentId) {
    return this.persistentDomain.get(RECORD_TYPES.SRA_INSTRUMENT, instrumentId);
  }

  async createFromCoinPosition(coinPositionId, input = {}, actorId = 'SAIN_AGENT') {
    const position = this.persistentDomain.get(RECORD_TYPES.COIN_POSITION, coinPositionId);
    if (!position) throw new Error('Coin position not found.');
    if (!['REPRESENTED', 'ACTIVE', 'RESTRICTED'].includes(position.state)) throw new Error('Only an open coin position can support an instrument.');

    const existing = this.list({ coinPositionId }).find((instrument) => !['CANCELLED', 'MATURED', 'CLOSED'].includes(instrument.state));
    if (existing) return { instrument: existing, created: false };

    const principalQuantity = finitePositive(input.principalQuantity ?? position.quantity, 'principalQuantity');
    if (principalQuantity > Number(position.quantity)) throw new Error('principalQuantity cannot exceed the coin position quantity.');

    const instrumentType = requireText(input.instrumentType || 'SRA_VALUE_INSTRUMENT', 'instrumentType').toUpperCase();
    const issueDate = input.issueDate || new Date().toISOString();
    const maturityDate = input.maturityDate || null;
    if (maturityDate && new Date(maturityDate).getTime() <= new Date(issueDate).getTime()) throw new Error('maturityDate must be after issueDate.');

    const instrumentId = `SRI-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    const now = new Date().toISOString();
    const instrument = {
      instrumentId,
      instrumentType,
      name: requireText(input.name || `${position.symbol} Instrument ${instrumentId}`, 'name'),
      coinPositionId,
      coinAccountId: position.coinAccountId,
      financialRecordId: position.financialRecordId,
      financialAccountId: position.financialAccountId,
      recognitionId: position.recognitionId,
      observationId: position.observationId,
      issuer: input.issuer || { type: 'SRA_PLATFORM', id: 'SAIN_REAL_ASSET_MARKET' },
      holder: input.holder || null,
      denomination: { symbol: position.symbol, principalQuantity, sourceQuantity: position.quantity },
      terms: {
        purpose: requireText(input.purpose || 'RECORDED_VALUE_OPERATION', 'purpose').toUpperCase(),
        issueDate,
        maturityDate,
        duration: input.duration || null,
        returnMethod: input.returnMethod || null,
        returnRate: input.returnRate == null ? null : Number(input.returnRate),
        paymentSchedule: input.paymentSchedule || null,
        settlementUnit: input.settlementUnit || position.symbol,
        transferability: requireText(input.transferability || 'RESTRICTED', 'transferability').toUpperCase(),
        governingReference: input.governingReference || null
      },
      rights: [...asList(position.rights), ...asList(input.rights)],
      obligations: [...asList(position.obligations), ...asList(input.obligations)],
      restrictions: [...asList(position.restrictions), ...asList(input.restrictions)],
      conditions: asList(input.conditions),
      events: { activation: asList(input.activationEvents), default: asList(input.defaultEvents), maturity: asList(input.maturityEvents) },
      sourceLineage: {
        coinPositionId,
        financialRecordId: position.financialRecordId,
        recognitionId: position.recognitionId,
        observationId: position.observationId,
        source: position.sourceLineage?.source || null,
        evidence: position.sourceLineage?.evidence || null,
        conversionRule: position.conversionRule
      },
      state: 'DRAFT',
      statusHistory: [{ state: 'DRAFT', actorId, occurredAt: now, reason: input.reason || 'Instrument created from an SRA Coin Position.' }],
      phase: 5,
      version: 3,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now
    };

    await this.persistentDomain.put(RECORD_TYPES.SRA_INSTRUMENT, instrumentId, instrument, { actorId, eventType: 'SRA_INSTRUMENT_CREATED' });
    await this.persistentDomain.lifecycle({
      objectType: RECORD_TYPES.SRA_INSTRUMENT,
      objectId: instrumentId,
      eventType: 'COIN_POSITION_INSTRUMENT_CREATED',
      actorId,
      payload: { coinPositionId, instrumentType, principalQuantity, symbol: position.symbol, maturityDate }
    });
    return { instrument, created: true };
  }

  async changeState(instrumentId, input = {}, actorId = 'SRA_PLATFORM') {
    const instrument = this.get(instrumentId);
    if (!instrument) throw new Error('Instrument not found.');
    const state = requireText(input.state, 'state').toUpperCase();
    if (!['DRAFT', 'RECORDED', 'ACTIVE', 'RESTRICTED', 'MATURED', 'CANCELLED', 'CLOSED'].includes(state)) throw new Error('Unsupported instrument state.');
    const now = new Date().toISOString();
    const updated = {
      ...instrument,
      state,
      statusHistory: [...(instrument.statusHistory || []), { state, actorId, occurredAt: now, reason: input.reason || null }],
      activatedAt: state === 'ACTIVE' && !instrument.activatedAt ? now : instrument.activatedAt || null,
      maturedAt: state === 'MATURED' ? now : instrument.maturedAt || null,
      closedAt: state === 'CLOSED' ? now : instrument.closedAt || null,
      updatedAt: now
    };
    await this.persistentDomain.put(RECORD_TYPES.SRA_INSTRUMENT, instrumentId, updated, { actorId, eventType: 'SRA_INSTRUMENT_STATE_CHANGED' });
    await this.persistentDomain.lifecycle({ objectType: RECORD_TYPES.SRA_INSTRUMENT, objectId: instrumentId, eventType: 'SRA_INSTRUMENT_STATE_CHANGED', actorId, payload: { state, reason: input.reason || null } });
    return updated;
  }

  summary() {
    const instruments = this.list();
    const byState = {};
    const byType = {};
    const quantityBySymbol = {};
    for (const instrument of instruments) {
      byState[instrument.state] = (byState[instrument.state] || 0) + 1;
      byType[instrument.instrumentType] = (byType[instrument.instrumentType] || 0) + 1;
      const symbol = instrument.denomination?.symbol || 'UNSPECIFIED';
      quantityBySymbol[symbol] = Number(((quantityBySymbol[symbol] || 0) + Number(instrument.denomination?.principalQuantity || 0)).toFixed(8));
    }
    return { version: 3, phase: 5, layer: 'INSTRUMENT_ENGINE', instrumentCount: instruments.length, byState, byType, quantityBySymbol, latestCreatedAt: instruments[0]?.createdAt || null };
  }
}
