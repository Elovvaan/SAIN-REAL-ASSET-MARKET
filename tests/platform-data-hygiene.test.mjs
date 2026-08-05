import test from 'node:test';
import assert from 'node:assert/strict';
import { PlatformDataHygieneService, MOCK_ASSET_IDS, MOCK_PROJECT_IDS } from '../services/platform-data-hygiene-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor(records = {}) {
    this.cache = new Map();
    this.audit = [];
    this.database = {
      memory: { records: this.cache },
      audit: async (event) => { this.audit.push(event); }
    };
    for (const [type, values] of Object.entries(records)) {
      for (const record of values) {
        const id = record.assetId || record.projectId || record.coinPositionId || record.instrumentId || record.listingId;
        this.cache.set(`${type}:${id}`, structuredClone(record));
      }
    }
  }
  get(type, id) { return structuredClone(this.cache.get(`${type}:${id}`) || null); }
  list(type) {
    return [...this.cache.entries()]
      .filter(([key]) => key.startsWith(`${type}:`))
      .map(([, value]) => structuredClone(value));
  }
  async put(type, id, payload) { this.cache.set(`${type}:${id}`, structuredClone(payload)); }
}

test('removes only the six exact legacy mock asset and project records', async () => {
  const domain = new Domain({
    [RECORD_TYPES.ASSET_ACCOUNT]: [
      ...MOCK_ASSET_IDS.map((assetId) => ({ assetId })),
      { assetId: 'A-REAL', name: 'Real customer asset' }
    ],
    [RECORD_TYPES.PROJECT_ACCOUNT]: [
      ...MOCK_PROJECT_IDS.map((projectId) => ({ projectId })),
      { projectId: 'P-REAL', title: 'Real project' }
    ]
  });
  const result = await new PlatformDataHygieneService(domain).removeLegacyMockMarketplaceRecords();
  assert.equal(result.removedCount, 6);
  assert.equal(domain.get(RECORD_TYPES.ASSET_ACCOUNT, 'A-REAL').name, 'Real customer asset');
  assert.equal(domain.get(RECORD_TYPES.PROJECT_ACCOUNT, 'P-REAL').title, 'Real project');
  for (const id of MOCK_ASSET_IDS) assert.equal(domain.get(RECORD_TYPES.ASSET_ACCOUNT, id), null);
  for (const id of MOCK_PROJECT_IDS) assert.equal(domain.get(RECORD_TYPES.PROJECT_ACCOUNT, id), null);
});

test('enforces one SRA equals one USD on the native coin, instrument, and listing', async () => {
  const domain = new Domain({
    [RECORD_TYPES.COIN_POSITION]: [{ coinPositionId: 'CP-1', assetCode: 'SRA_PLATFORM_ASSET', unitPrice: 3, currency: 'EUR' }],
    [RECORD_TYPES.SRA_INSTRUMENT]: [{ instrumentId: 'INS-1', platformAssetCode: 'SRA_PLATFORM_ASSET', unitPrice: 4 }],
    [RECORD_TYPES.MARKETPLACE_LISTING]: [{ listingId: 'LIST-1', instrumentId: 'INS-1', unitPrice: 5, pricing: { askingPrice: 5 } }]
  });
  const result = await new PlatformDataHygieneService(domain).enforceNativeSraPar();
  assert.equal(result.updatedCount, 3);
  for (const [type, id] of [[RECORD_TYPES.COIN_POSITION, 'CP-1'], [RECORD_TYPES.SRA_INSTRUMENT, 'INS-1'], [RECORD_TYPES.MARKETPLACE_LISTING, 'LIST-1']]) {
    const record = domain.get(type, id);
    assert.equal(record.unitPrice, 1);
    assert.equal(record.currency, 'USD');
    assert.equal(record.pricePolicy, 'FIXED_PAR');
  }
  assert.equal(domain.get(RECORD_TYPES.MARKETPLACE_LISTING, 'LIST-1').pricing.askingPrice, 1);
});
