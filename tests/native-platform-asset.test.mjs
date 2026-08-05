import test from 'node:test';
import assert from 'node:assert/strict';
import { NativePlatformAssetService } from '../services/native-platform-asset-service.js';
import { InternalLifecycleService } from '../services/internal-lifecycle-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.events = []; }
  bucket(type) { if (!this.records.has(type)) this.records.set(type, new Map()); return this.records.get(type); }
  list(type) { return [...this.bucket(type).values()].map((record) => structuredClone(record)); }
  get(type, id) { const record = this.bucket(type).get(id); return record ? structuredClone(record) : null; }
  async put(type, id, record) { this.bucket(type).set(id, structuredClone(record)); return record; }
  async lifecycle(event) { this.events.push(structuredClone(event)); return event; }
}

test('native platform asset starts absent and completes the full internal lifecycle', async () => {
  const domain = new MemoryDomain();
  const internalLifecycle = new InternalLifecycleService(domain);
  const service = new NativePlatformAssetService(domain, internalLifecycle);

  assert.equal(service.status().state, 'NOT_CREATED');

  const result = await service.bootstrap({ issuedAmount: 1000000, unitPrice: 1 }, 'ADMIN-1');
  assert.equal(result.created, true);
  assert.equal(result.status.state, 'READY_FOR_EXPORT');
  assert.equal(result.status.readyForExport, true);
  assert.ok(result.status.references.instrumentId);
  assert.ok(result.status.references.listingId);
  assert.ok(result.status.references.settlementRecordId);
  assert.ok(result.status.references.ownershipRecognitionId);
  assert.ok(result.status.references.exportPackageId);
  assert.equal(result.exportPackage.state, 'READY_FOR_EXPORT');
  assert.equal(result.exportPackage.immutable, true);
  assert.equal(result.exportPackage.manifest.destinationClass, 'MULTI_RAIL_ADAPTER_READY');
  assert.deepEqual(result.exportPackage.manifest.adapterInstructions.supportedTargets, ['SOLANA', 'ACH', 'FEDWIRE', 'BANK', 'INSTITUTION', 'PARTNER']);
  assert.equal(internalLifecycle.verifyExportPackage(result.exportPackage.exportPackageId).valid, true);
});

test('native platform asset bootstrap is idempotent after export readiness', async () => {
  const domain = new MemoryDomain();
  const service = new NativePlatformAssetService(domain, new InternalLifecycleService(domain));
  const first = await service.bootstrap({}, 'ADMIN-1');
  const second = await service.bootstrap({}, 'ADMIN-1');

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.status.references.exportPackageId, first.status.references.exportPackageId);
  assert.equal(domain.list('SRA_INSTRUMENT').length, 1);
  assert.equal(domain.list('EXPORT_PACKAGE').length, 1);
});

test('native platform asset remains inside SRA until an adapter executes', async () => {
  const domain = new MemoryDomain();
  const service = new NativePlatformAssetService(domain, new InternalLifecycleService(domain));
  const result = await service.bootstrap({}, 'ADMIN-1');

  assert.equal(result.exportPackage.manifest.sourceSystem, 'SRA');
  assert.equal(result.exportPackage.manifest.boundary, 'EXPORT_BOUNDARY');
  assert.equal(result.exportPackage.manifest.adapterInstructions.executionRequired, false);
  assert.equal(domain.list('TREASURY_CRYPTO_ACTIVITY').length, 0);
});
