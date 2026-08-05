import { RECORD_TYPES } from './persistent-domain-service.js';

const MOCK_ASSET_IDS = Object.freeze(['A-1042', 'A-2088', 'A-3104']);
const MOCK_PROJECT_IDS = Object.freeze(['SRA-RE-0014', 'SRA-RE-0021', 'SRA-RE-0033']);
const PLATFORM_ASSET_CODE = 'SRA_PLATFORM_ASSET';

function domainKey(type, id) { return `${type}:${id}`; }

async function deletePersistedRecord(domain, type, id) {
  const key = domainKey(type, id);
  const existed = Boolean(domain.cache?.has(key) || domain.get(type, id));
  if (domain.database?.pool) {
    await domain.database.pool.query(
      'DELETE FROM sra_domain_records WHERE record_type = $1 AND record_id = $2',
      [type, id]
    );
  } else if (domain.database?.memory?.records) {
    domain.database.memory.records.delete(key);
  }
  domain.cache?.delete(key);
  return existed;
}

function isNativeCoinPosition(record) {
  return record?.assetCode === PLATFORM_ASSET_CODE;
}
function isNativeInstrument(record) {
  return record?.platformAssetCode === PLATFORM_ASSET_CODE;
}

export class PlatformDataHygieneService {
  constructor(domain, logger = console) {
    this.domain = domain;
    this.logger = logger;
  }

  async removeLegacyMockMarketplaceRecords(actorId = 'SRA_PLATFORM_MIGRATION') {
    const removed = [];
    for (const id of MOCK_ASSET_IDS) {
      if (await deletePersistedRecord(this.domain, RECORD_TYPES.ASSET_ACCOUNT, id)) removed.push(`${RECORD_TYPES.ASSET_ACCOUNT}:${id}`);
    }
    for (const id of MOCK_PROJECT_IDS) {
      if (await deletePersistedRecord(this.domain, RECORD_TYPES.PROJECT_ACCOUNT, id)) removed.push(`${RECORD_TYPES.PROJECT_ACCOUNT}:${id}`);
    }
    if (removed.length && this.domain.database?.audit) {
      await this.domain.database.audit({
        actorId,
        eventType: 'LEGACY_MOCK_MARKETPLACE_RECORDS_REMOVED',
        objectType: 'PLATFORM_DATA_HYGIENE',
        objectId: 'LEGACY_MARKETPLACE_SEED_V1',
        payload: { removed }
      });
    }
    return { removed, removedCount: removed.length };
  }

  async enforceNativeSraPar(actorId = 'SRA_PLATFORM_MIGRATION') {
    const changes = [];
    const coinPositions = this.domain.list(RECORD_TYPES.COIN_POSITION).filter(isNativeCoinPosition);
    const instruments = this.domain.list(RECORD_TYPES.SRA_INSTRUMENT).filter(isNativeInstrument);
    const instrumentIds = new Set(instruments.map((record) => record.instrumentId));
    const listings = this.domain.list(RECORD_TYPES.MARKETPLACE_LISTING)
      .filter((record) => record.platformAssetCode === PLATFORM_ASSET_CODE || instrumentIds.has(record.instrumentId));

    for (const record of coinPositions) changes.push({
      type: RECORD_TYPES.COIN_POSITION,
      id: record.coinPositionId,
      payload: { ...record, unitPrice: 1, currency: 'USD', parValue: 1, parCurrency: 'USD', pricePolicy: 'FIXED_PAR', updatedAt: new Date().toISOString() }
    });
    for (const record of instruments) changes.push({
      type: RECORD_TYPES.SRA_INSTRUMENT,
      id: record.instrumentId,
      payload: { ...record, unitPrice: 1, currency: 'USD', parValue: 1, parCurrency: 'USD', pricePolicy: 'FIXED_PAR', settlementUnit: 'SRA', updatedAt: new Date().toISOString() }
    });
    for (const record of listings) changes.push({
      type: RECORD_TYPES.MARKETPLACE_LISTING,
      id: record.listingId,
      payload: {
        ...record,
        unitPrice: 1,
        currency: 'USD',
        marketPair: 'SRA/USD',
        parValue: 1,
        parCurrency: 'USD',
        pricePolicy: 'FIXED_PAR',
        pricing: { ...(record.pricing || {}), state: 'CONFIGURED', method: 'FIXED_PAR', askingPrice: 1, currency: 'USD' },
        updatedAt: new Date().toISOString()
      }
    });

    for (const change of changes) {
      await this.domain.put(change.type, change.id, change.payload, {
        actorId,
        eventType: 'NATIVE_SRA_PAR_POLICY_ENFORCED'
      });
    }
    return { updatedCount: changes.length, parValue: 1, currency: 'USD' };
  }

  async run() {
    try {
      const cleanup = await this.removeLegacyMockMarketplaceRecords();
      const par = await this.enforceNativeSraPar();
      return { cleanup, par };
    } catch (error) {
      this.logger.error?.('SRA platform data hygiene failed:', error);
      throw error;
    }
  }
}

export { MOCK_ASSET_IDS, MOCK_PROJECT_IDS, PLATFORM_ASSET_CODE };
