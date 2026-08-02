import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const ACTIVATABLE_STATES = new Set(['VERIFIED', 'CLASSIFIED', 'MEASURED']);

export class MarketCirculationService {
  constructor(domain) {
    this.domain = domain;
  }

  listEvents() {
    return this.domain.list(RECORD_TYPES.MARKET_CIRCULATION_EVENT);
  }

  listInstruments() {
    return this.domain.list(RECORD_TYPES.PROTECTION_INSTRUMENT);
  }

  async recordEvent(input, actorId = null) {
    const eventId = input.eventId || `MCE-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    const event = {
      id: eventId,
      eventId,
      eventType: input.eventType,
      state: input.state || 'DETECTED',
      assetIds: input.assetIds || [],
      projectIds: input.projectIds || [],
      trueBillIds: input.trueBillIds || [],
      participationPositionIds: input.participationPositionIds || [],
      transferablePositionIds: input.transferablePositionIds || [],
      currencies: input.currencies || [],
      jurisdictions: input.jurisdictions || [],
      components: input.components || {},
      verifiedTransitionRequirement: input.verifiedTransitionRequirement || null,
      replacementCapacity: input.replacementCapacity || null,
      evidenceIds: input.evidenceIds || [],
      detectedAt: new Date().toISOString()
    };
    await this.domain.put(RECORD_TYPES.MARKET_CIRCULATION_EVENT, eventId, event, { actorId, eventType: 'MARKET_CIRCULATION_EVENT_RECORDED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.MARKET_CIRCULATION_EVENT, objectId: eventId, eventType: 'MARKET_CIRCULATION_EVENT_RECORDED', actorId, payload: { state: event.state, eventType: event.eventType } });
    return event;
  }

  async activateProtection(eventId, input, actorId = null) {
    const event = this.domain.get(RECORD_TYPES.MARKET_CIRCULATION_EVENT, eventId);
    if (!event) throw new Error('Market circulation event not found.');
    if (!ACTIVATABLE_STATES.has(event.state)) throw new Error(`Event must be verified, classified, or measured before activation: ${event.state}`);
    if (!event.verifiedTransitionRequirement) throw new Error('Verified transition requirement is required before activation.');

    const existing = this.listInstruments().find((item) => item.eventId === eventId && item.state !== 'CLOSED');
    if (existing) return existing;

    const instrumentId = input.instrumentId || `PI-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    const instrument = {
      id: instrumentId,
      instrumentId,
      eventId,
      type: input.type || 'MARKET_DISCHARGE_INSTRUMENT',
      state: 'ACTIVE',
      purpose: input.purpose,
      scope: input.scope,
      authorizedCapacity: event.verifiedTransitionRequirement,
      assetIds: [...event.assetIds],
      projectIds: [...event.projectIds],
      trueBillIds: [...event.trueBillIds],
      participationPositionIds: [...event.participationPositionIds],
      transferablePositionIds: [...event.transferablePositionIds],
      currencies: [...event.currencies],
      jurisdictions: [...event.jurisdictions],
      completionConditions: input.completionConditions || [],
      activatedAt: new Date().toISOString()
    };
    await this.domain.put(RECORD_TYPES.PROTECTION_INSTRUMENT, instrumentId, instrument, { actorId, eventType: 'PROTECTION_INSTRUMENT_ACTIVATED' });
    await this.domain.put(RECORD_TYPES.MARKET_CIRCULATION_EVENT, eventId, { ...event, state: 'INSTRUMENT_ACTIVE', protectionInstrumentId: instrumentId }, { actorId, eventType: 'MARKET_CIRCULATION_PROTECTION_ACTIVATED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.PROTECTION_INSTRUMENT, objectId: instrumentId, eventType: 'PROTECTION_INSTRUMENT_ACTIVATED', actorId, payload: { eventId, authorizedCapacity: instrument.authorizedCapacity } });
    return instrument;
  }
}
