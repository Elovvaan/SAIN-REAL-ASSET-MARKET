import test from 'node:test';
import assert from 'node:assert/strict';
import { StableSettlementAssetService } from '../services/stable-settlement-asset-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  async hydrate() {}
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }
  async put(type, id, payload) { this.records.set(this.key(type, id), payload); return payload; }
  async lifecycle() {}
}

async function fixture() {
  const domain = new MemoryDomain();
  const service = new StableSettlementAssetService(domain);
  await service.ensure();
  return { domain, service };
}

test('defines SRA_USD as a stable settlement asset without replacing financing instruments', async () => {
  const { service } = await fixture();
  const definition = await service.define({}, 'ADMIN');
  assert.equal(definition.assetCode, 'SRA_USD');
  assert.equal(definition.currency, 'USD');
  assert.equal(definition.unitValue, 1);
  assert.equal(definition.reservePolicy, 'FULL_RESERVE');
  assert.equal(definition.settlementPurpose, 'STABLE_VALUE_SETTLEMENT');
});

test('full-reserve issuance cannot exceed recorded reserves', async () => {
  const { service } = await fixture();
  await service.define({}, 'ADMIN');
  await service.recordReserve('SRA_USD', { amount: 100000, externalReference: 'RESERVE-1' }, 'ADMIN');
  const issued = await service.issue('SRA_USD', { amount: 75000, settlementReference: 'EXP-1' }, 'ADMIN');
  assert.equal(issued.status.reserveBalance, 100000);
  assert.equal(issued.status.circulatingSupply, 75000);
  assert.equal(issued.status.availableToIssue, 25000);
  await assert.rejects(() => service.issue('SRA_USD', { amount: 25000.01 }, 'ADMIN'), /exceeds recorded reserves/);
});

test('network representation is explicit and network-neutral', async () => {
  const { service } = await fixture();
  await service.define({}, 'ADMIN');
  const representation = await service.registerRepresentation('SRA_USD', {
    network: 'STELLAR',
    onChainAssetId: 'OCA-1',
    networkAssetCode: 'SRAUSD',
  }, 'ADMIN');
  assert.equal(representation.network, 'STELLAR');
  assert.equal(representation.onChainAssetId, 'OCA-1');
  assert.equal(service.status('SRA_USD').representations.length, 1);
});

test('redemption reduces circulating supply and protects reserve coverage', async () => {
  const { service } = await fixture();
  await service.define({}, 'ADMIN');
  await service.recordReserve('SRA_USD', { amount: 50000 }, 'ADMIN');
  await service.issue('SRA_USD', { amount: 40000 }, 'ADMIN');
  const redeemed = await service.redeem('SRA_USD', { amount: 15000 }, 'ADMIN');
  assert.equal(redeemed.status.circulatingSupply, 25000);
  assert.equal(redeemed.status.fullyReserved, true);
  await assert.rejects(() => service.recordReserve('SRA_USD', { direction: 'DEBIT', amount: 30000 }, 'ADMIN'), /below circulating supply/);
});
