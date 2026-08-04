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

test('observation layer preserves raw source records without recognition', async () => {
  const domain = new MemoryDomain();
  const service = new ObservationLayerService(domain);
  const rawPayload = { id: 'listing-1', price: 120, nested: { state: 'ACTIVE' } };

  const result = await service.observe({
    sourceMarket: 'ebay',
    sourceRecordId: 'listing-1',
    sourceRecordType: 'listing',
    sourceTimestamp: '2026-08-04T00:00:00Z',
    category: 'equipment',
    rawValues: { price: 120, currency: 'USD' },
    rawPayload
  });

  assert.equal(result.created, true);
  assert.equal(result.observation.sourceMarket, 'EBAY');
  assert.equal(result.observation.state, 'OBSERVED');
  assert.equal(result.observation.recognitionState, 'UNPROCESSED');
  assert.deepEqual(result.observation.rawPayload, rawPayload);
  assert.equal(typeof result.observation.payloadDigest, 'string');
  assert.equal(domain.list(RECORD_TYPES.MARKET_OBSERVATION).length, 1);
});

test('same source payload is idempotent', async () => {
  const domain = new MemoryDomain();
  const service = new ObservationLayerService(domain);
  const input = {
    sourceMarket: 'coinbase',
    sourceRecordId: 'trade-1',
    sourceRecordType: 'trade',
    rawPayload: { tradeId: 'trade-1', price: '64000.00' }
  };

  const first = await service.observe(input);
  const second = await service.observe(input);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.observation.observationId, second.observation.observationId);
  assert.equal(service.summary().observationCount, 1);
});

test('changed source payload creates a new observation', async () => {
  const domain = new MemoryDomain();
  const service = new ObservationLayerService(domain);
  const base = {
    sourceMarket: 'opensea',
    sourceRecordId: 'sale-1',
    sourceRecordType: 'sale'
  };

  await service.observe({ ...base, rawPayload: { price: 10 } });
  await service.observe({ ...base, rawPayload: { price: 12 } });

  assert.equal(service.summary().observationCount, 2);
  assert.equal(service.summary().byMarket.OPENSEA, 2);
});
