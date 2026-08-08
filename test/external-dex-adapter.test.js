import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ExternalDexAdapterService } from '../services/external-dex-adapter-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  async hydrate() {}
  key(type,id) { return `${type}:${id}`; }
  get(type,id) { return this.records.get(this.key(type,id)) || null; }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([,value]) => value); }
  async put(type,id,payload) { this.records.set(this.key(type,id), payload); return payload; }
  async atomicPut(changes) { for (const change of changes) await this.put(change.type,change.id,change.payload); }
  async lifecycle() { return { id:'EVT-1' }; }
}

function fixture({ realMint = true } = {}) {
  const domain = new Domain();
  domain.records.set('EXPORT_PACKAGE:EXP-1', {
    exportPackageId:'EXP-1', state:'READY_FOR_EXPORT', instrumentId:'INS-1', participantId:'P-1', quantity:25, unit:'SRA',
    snapshots:{ instrument:{ financialRecordId:'FR-1' } }
  });
  const projection = { projectionId:'OCP-1', instrumentId:'INS-1', network:'SOLANA', status:'ACTIVE', mintAddress:realMint?'RealSolanaMint111':'SIM-DEVNET-123', denomination:{symbol:'SRAA'} };
  const onChain = {
    listProjections:() => [projection],
    recordChainEvent: async (input) => ({ eventId:'OCE-1', ...input })
  };
  return { domain, service:new ExternalDexAdapterService(domain,onChain) };
}

test('external DEX export requires a real active Solana mint', async () => {
  const { service } = fixture({ realMint:false });
  const preview = service.preview({ exportPackageId:'EXP-1', venue:'ORCA_WHIRLPOOLS', quoteSymbol:'USDC', quoteMintAddress:'QuoteMint111' });
  assert.equal(preview.eligibilityState,'BLOCKED');
  assert.ok(preview.blockers.includes('REAL_SOLANA_MINT_REQUIRED'));
});

test('external DEX export preserves SRA recorded-value authority and prepares connector handoff', async () => {
  const { service } = fixture();
  const prepared = await service.prepare({ exportPackageId:'EXP-1', venue:'ORCA_WHIRLPOOLS', quoteSymbol:'USDC', quoteMintAddress:'QuoteMint111', approval:'APPROVE' }, 'ADMIN-1');
  assert.equal(prepared.state,'READY_FOR_EXTERNAL_DEX');
  assert.equal(prepared.externalExecutionState,'NOT_SUBMITTED');
  assert.equal(prepared.pair,'SRAA/USDC');
  assert.equal(prepared.marketPrice,null);
  assert.equal(prepared.recordedValueReference,'FR-1');
  assert.equal(prepared.handoff.baseMintAddress,'RealSolanaMint111');
});

test('external confirmation records market price only as observational reference', async () => {
  const { service } = fixture();
  const prepared = await service.prepare({ exportPackageId:'EXP-1', quoteSymbol:'USDC', quoteMintAddress:'QuoteMint111', approval:'APPROVE' }, 'ADMIN-1');
  const confirmed = await service.confirm(prepared.dexExportId, { transactionSignature:'SIG-1', externalMarketAddress:'POOL-1', executedQuantity:25, observedMarketPrice:1.08 }, 'CONNECTOR-1');
  assert.equal(confirmed.export.state,'EXTERNALLY_CONFIRMED');
  assert.equal(confirmed.confirmation.observedMarketPrice,1.08);
  assert.equal(confirmed.confirmation.priceReferenceOnly,true);
  assert.equal(confirmed.export.recordedValueReference,'FR-1');
});

test('admin UI mounts a DEX connection view and DEX export preparation at the existing boundary', () => {
  const ui = fs.readFileSync(new URL('../public/admin/admin-external-dex-adapter.js', import.meta.url),'utf8');
  const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url),'utf8');
  assert.match(ui,/data-admin-tab = 'DEX'|dataset\.adminTab = 'DEX'/);
  assert.match(ui,/Export Packages/);
  assert.match(ui,/Prepare DEX Export/);
  assert.match(ui,/\/api\/on-chain\/dex\/exports/);
  assert.match(bootstrap,/admin-external-dex-adapter\.js/);
  assert.match(bootstrap,/mountAdminExternalDexAdapter/);
});
