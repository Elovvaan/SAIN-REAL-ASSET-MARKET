import test from 'node:test';
import assert from 'node:assert/strict';
import { ObservationLayerService } from '../services/observation-layer-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  get(type, id) { const value = this.records.get(this.key(type, id)); return value ? structuredClone(value) : null; }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return payload; }
  async lifecycle(event) { this.events.push(structuredClone(event)); return event; }
}

async function observed(service) {
  return (await service.observe({
    sourceMarket: 'ebay',
    sourceRecordId: 'sale-100',
    sourceRecordType: 'completed_sale',
    sourceTimestamp: '2026-08-04T00:00:00Z',
    category: 'equipment',
    rawValues: { price: 9200, currency: 'USD', quantity: 1 },
    rawPayload: { id: 'sale-100', price: 9200, status: 'COMPLETED' }
  })).observation;
}

test('SAIN records the full recognition chain over an observation', async () => {
  const domain = new MemoryDomain();
  const service = new ObservationLayerService(domain);
  const observation = await observed(service);

  const result = await service.recognize(observation.observationId, {
    identity: { subjectType: 'market_item', subjectId: 'equipment-class-4', displayName: 'Commercial Equipment' },
    authority: { basis: 'platform_rules', scope: 'Recognize public market activity under SRA Version 3' },
    evidence: { items: [{ type: 'SOURCE_API_RECORD', reference: 'sale-100' }] },
    classification: { type: 'MARKET_SALE_EVENT', category: 'equipment' },
    relationships: [{ type: 'COMPARABLE_TO', targetId: 'equipment-class-4' }],
    measurement: { method: 'OBSERVED_TRANSACTION_VALUE', unit: 'USD', value: 9200, inputs: { price: 9200 } },
    decision: 'RECOGNIZED',
    rationale: 'Completed source transaction measured under the platform recognition rules.'
  });

  assert.equal(result.recognition.engine, 'SAIN_RECOGNITION_ENGINE');
  assert.equal(result.recognition.phase, 2);
  assert.equal(result.recognition.identity.subjectId, 'equipment-class-4');
  assert.equal(result.recognition.source.payloadDigest, observation.payloadDigest);
  assert.equal(result.recognition.measurement.value, 9200);
  assert.equal(result.observation.recognitionState, 'RECOGNIZED');
  assert.equal(domain.list(RECORD_TYPES.RECOGNITION_ASSESSMENT).length, 1);
});

test('recognition assessment does not create financial, coin, instrument, or ledger records', async () => {
  const domain = new MemoryDomain();
  const service = new ObservationLayerService(domain);
  const observation = await observed(service);

  await service.recognize(observation.observationId, {
    identity: { subjectType: 'MARKET_CATEGORY', subjectId: 'equipment' },
    authority: { basis: 'SRA_RULES', scope: 'Classification and measurement' },
    classification: { type: 'MARKET_ACTIVITY' },
    measurement: { method: 'SOURCE_VALUE', unit: 'USD', value: 9200 },
    decision: 'IN_REVIEW'
  });

  assert.equal(domain.list(RECORD_TYPES.VERIFIED_VALUE_RECORD).length, 0);
  assert.equal(domain.list(RECORD_TYPES.LEDGER_ENTRY).length, 0);
  assert.equal(domain.list(RECORD_TYPES.PROTECTION_INSTRUMENT).length, 0);
  assert.equal(service.summary().phase, 2);
  assert.equal(service.summary().byRecognitionState.IN_REVIEW, 1);
});

test('recognition requires identity, authority, classification, and finite measurement', async () => {
  const service = new ObservationLayerService(new MemoryDomain());
  const observation = await observed(service);

  await assert.rejects(
    service.recognize(observation.observationId, {
      identity: { subjectType: 'MARKET_ITEM', subjectId: 'item-1' },
      authority: { basis: 'SRA_RULES', scope: 'Recognition' },
      classification: { type: 'MARKET_EVENT' },
      measurement: { method: 'SOURCE_VALUE', unit: 'USD', value: 'not-a-number' }
    }),
    /finite number/
  );
});
