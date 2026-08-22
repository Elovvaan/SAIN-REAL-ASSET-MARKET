import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { InstrumentApprovalService } from '../services/instrument-approval-service.js';
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
  const service = new InstrumentApprovalService(domain);
  const result = await service.approve('SRI-1','ADMIN-1');
  assert.equal(result.instrument.state,'APPROVED');
  assert.equal(domain.get(RECORD_TYPES.SRA_INSTRUMENT,'SRI-1').approvedBy,'ADMIN-1');
  const listing=domain.get(RECORD_TYPES.MARKETPLACE_LISTING,'ML-1');
  assert.equal(listing.readiness.instrumentReviewed,true);
  assert.deepEqual(listing.blockers,['MARKET_ACCESS_RULES_REQUIRED']);
});

test('admin bootstrap loads workstation controls and instrument UI calls dedicated approval routes', () => {
  const bootstrap=fs.readFileSync(new URL('../public/admin/admin-bootstrap.js',import.meta.url),'utf8');
  const shell=bootstrap.indexOf('/admin/admin-suite-shell.js');
  const workstation=bootstrap.indexOf('/admin/admin-workstation-controls.js');
  assert.ok(shell>=0 && workstation>shell);

  const ui=fs.readFileSync(new URL('../public/admin/admin-workstation-controls.js',import.meta.url),'utf8');
  assert.match(ui,/\/api\/admin\/instruments\/approval-status/);
  assert.match(ui,/\/api\/admin\/instruments\/\$\{encodeURIComponent\(id\)\}\/approve/);
  assert.match(ui,/\/representation\/approve/);
  assert.match(ui,/approval:'APPROVE'/);
  assert.match(ui,/SRAAdminDataClient/);
  assert.doesNotMatch(ui,/listing-readiness-batch\/approve[^\n]+instrumentId/);
});

test('on-chain admin UI preserves the ordered instrument lifecycle before asset execution', () => {
  const ui=fs.readFileSync(new URL('../public/admin/admin-on-chain-issuance-controls.js',import.meta.url),'utf8');
  assert.match(ui,/Instrument approval → representation approval → network readiness → asset identity → issue supply → transfer/);
  assert.match(ui,/STEP 3 · NETWORK READINESS/);
  assert.match(ui,/STEP 4 · ASSET IDENTITY/);
  assert.match(ui,/Complete Representation Approval/);
  assert.match(ui,/Each stage must complete before the next stage becomes actionable/);

  const routes=fs.readFileSync(new URL('../routes/instrument-admin-routes.js',import.meta.url),'utf8');
  assert.match(routes,/currentStage/);
  assert.match(routes,/REPRESENTATION_APPROVAL/);
  assert.match(routes,/ON_CHAIN_PREPARATION/);
  assert.match(routes,/representationApproval/);
});
