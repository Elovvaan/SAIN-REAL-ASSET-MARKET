import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ListingReadinessBatchService } from '../services/listing-readiness-batch-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type,id) { return `${type}:${id}`; }
  get(type,id) { return structuredClone(this.records.get(this.key(type,id)) || null); }
  list(type) { const prefix=`${type}:`; return [...this.records].filter(([key])=>key.startsWith(prefix)).map(([,value])=>structuredClone(value)); }
  async put(type,id,payload) { this.records.set(this.key(type,id),structuredClone(payload)); return payload; }
  async atomicPut(changes) { for (const change of changes) await this.put(change.type,change.id,change.payload); return changes.map(change=>change.payload); }
  async lifecycle(input) { const id=`LE-${this.records.size+1}`; return this.put(RECORD_TYPES.LIFECYCLE_EVENT,id,{id,...input,occurredAt:new Date().toISOString()}); }
}

test('direct instrument approval moves DRAFT to APPROVED and clears only the instrument-review blocker', async () => {
  const domain = new MemoryDomain();
  await domain.put(RECORD_TYPES.SRA_INSTRUMENT,'SRI-1',{instrumentId:'SRI-1',state:'DRAFT',statusHistory:[]});
  await domain.put(RECORD_TYPES.MARKETPLACE_LISTING,'ML-1',{listingId:'ML-1',instrumentId:'SRI-1',state:'PREPARED',readiness:{instrumentReviewed:false},blockers:['ADMINISTRATIVE_INSTRUMENT_REVIEW_REQUIRED','MARKET_ACCESS_RULES_REQUIRED']});
  const service = new ListingReadinessBatchService(domain);
  const result = await service.approve({approval:'APPROVE',instrumentId:'SRI-1'},'ADMIN-1');
  assert.equal(result.instrument.state,'APPROVED');
  assert.equal(domain.get(RECORD_TYPES.SRA_INSTRUMENT,'SRI-1').approvedBy,'ADMIN-1');
  const listing=domain.get(RECORD_TYPES.MARKETPLACE_LISTING,'ML-1');
  assert.equal(listing.readiness.instrumentReviewed,true);
  assert.deepEqual(listing.blockers,['MARKET_ACCESS_RULES_REQUIRED']);
});

test('admin bootstrap includes the instrument approval control after the suite shell', () => {
  const bootstrap=fs.readFileSync(new URL('../public/admin/admin-bootstrap.js',import.meta.url),'utf8');
  const shell=bootstrap.indexOf('/admin/admin-suite-shell.js');
  const approval=bootstrap.indexOf('/admin/admin-instrument-approvals.js');
  assert.ok(shell>=0 && approval>shell);
  const ui=fs.readFileSync(new URL('../public/admin/admin-instrument-approvals.js',import.meta.url),'utf8');
  assert.match(ui,/data-instrument-approve/);
  assert.match(ui,/instrumentId/);
  assert.match(ui,/approval:\s*'APPROVE'/);
  assert.match(ui,/SRAAdminDataClient/);
});
