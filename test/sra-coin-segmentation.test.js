import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SraCoinPositionSegmentationService } from '../services/sra-coin-position-segmentation-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }
  put(type, id, payload) { this.records.set(this.key(type, id), payload); }
  async atomicPut(entries) { for (const entry of entries) this.put(entry.type, entry.id, entry.payload); }
}

test('SRA Coin stays the asset name while SRA/USD is the native market pair', () => {
  const source = fs.readFileSync(new URL('../services/sra-coin-passport-memory-service.js', import.meta.url), 'utf8');
  assert.match(source, /assetName: 'SRA Coin'/);
  assert.match(source, /nativeMarketPair: 'SRA\/USD'/);
  assert.match(source, /rate: 1/);
});

test('segmentation atomically creates a child without creating new value', async () => {
  const domain = new Domain();
  domain.put('COIN_POSITION', 'CP-100', {
    coinPositionId: 'CP-100',
    positionId: 'CP-100',
    participantId: 'P-1',
    instrumentId: 'INS-1',
    denomination: { symbol: 'SRA' },
    quantity: 1000,
    availableQuantity: 1000,
    generation: 1,
    state: 'AVAILABLE',
  });
  const service = new SraCoinPositionSegmentationService(domain);
  const preview = service.preview({ positionId: 'CP-100', quantity: 125 });
  assert.equal(preview.assetName, 'SRA Coin');
  assert.equal(preview.nativeMarketPair, 'SRA/USD');
  assert.equal(preview.parentAvailableAfter, 875);
  const result = await service.approve({ positionId: 'CP-100', quantity: 125, approval: 'APPROVE' }, 'ADMIN-1');
  assert.equal(result.parent.availableQuantity, 875);
  assert.equal(result.child.quantity, 125);
  assert.equal(result.child.parentPositionId, 'CP-100');
  assert.equal(result.parent.quantity, 1000);
  assert.equal(result.parent.availableQuantity + result.child.quantity, 1000);
});

test('segmentation rejects held, restricted, or full-quantity splits', () => {
  const domain = new Domain();
  domain.put('COIN_POSITION', 'CP-200', { coinPositionId: 'CP-200', participantId: 'P-2', instrumentId: 'INS-2', quantity: 100, availableQuantity: 100 });
  domain.put('SRA_TRANSACTION', 'RSV-1', { transactionType: 'PRE_ALLOCATION_RESERVATION', positionReservation: { positionId: 'CP-200', quantity: 40, state: 'HELD' } });
  const service = new SraCoinPositionSegmentationService(domain);
  assert.throws(() => service.preview({ positionId: 'CP-200', quantity: 60 }), /less than the unencumbered/);
  domain.put('COIN_POSITION', 'CP-200', { ...domain.get('COIN_POSITION', 'CP-200'), frozen: true });
  assert.throws(() => service.preview({ positionId: 'CP-200', quantity: 10 }), /Restricted/);
});

test('production SANE router exposes segmentation preview and approval', () => {
  const router = fs.readFileSync(new URL('../routes/sane-router.js', import.meta.url), 'utf8');
  assert.match(router, /SraCoinPositionSegmentationService/);
  assert.match(router, /\/coin-agents\/:coinPositionId\/segment\/preview/);
  assert.match(router, /\/coin-agents\/:coinPositionId\/segment\/approve/);
  assert.match(router, /authenticated administrator identity/);
});
