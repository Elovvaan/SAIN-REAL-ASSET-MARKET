import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const SERIES_STATES = new Set(['DRAFT', 'ISSUED', 'ACTIVE', 'SUSPENDED', 'SETTLED', 'CLOSED', 'ARCHIVED']);

function now() {
  return new Date().toISOString();
}

function requireRecord(record, message) {
  if (!record) throw new Error(message);
  return record;
}

export class InstrumentService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  listFamilies() {
    return this.domain.list(RECORD_TYPES.INSTRUMENT_FAMILY);
  }

  getFamily(familyId) {
    return this.domain.get(RECORD_TYPES.INSTRUMENT_FAMILY, familyId);
  }

  listSeries(filters = {}) {
    return this.domain.list(RECORD_TYPES.INSTRUMENT_SERIES).filter((series) => {
      if (filters.assetId && series.assetId !== filters.assetId) return false;
      if (filters.projectId && series.projectId !== filters.projectId) return false;
      if (filters.familyId && series.familyId !== filters.familyId) return false;
      if (filters.state && series.state !== filters.state) return false;
      return true;
    });
  }

  getSeries(seriesId) {
    return this.domain.get(RECORD_TYPES.INSTRUMENT_SERIES, seriesId);
  }

  async createFamily(input, actorId = null) {
    if (!input?.name || !input?.purpose) throw new Error('Instrument family name and purpose are required.');
    const familyId = input.familyId || `IF-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    if (this.getFamily(familyId)) throw new Error(`Instrument family already exists: ${familyId}`);

    const family = {
      id: familyId,
      familyId,
      name: input.name,
      purpose: input.purpose,
      description: input.description || '',
      supportedAssetClassifications: input.supportedAssetClassifications || [],
      permittedPurposes: input.permittedPurposes || [],
      lifecycle: input.lifecycle || ['DRAFT', 'ISSUED', 'ACTIVE', 'SETTLED', 'CLOSED', 'ARCHIVED'],
      status: input.status || 'ACTIVE',
      createdAt: now(),
      updatedAt: now()
    };

    await this.domain.put(RECORD_TYPES.INSTRUMENT_FAMILY, familyId, family, {
      actorId,
      eventType: 'INSTRUMENT_FAMILY_CREATED'
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.INSTRUMENT_FAMILY,
      objectId: familyId,
      eventType: 'INSTRUMENT_FAMILY_CREATED',
      actorId,
      payload: { name: family.name, purpose: family.purpose }
    });
    return family;
  }

  async createSeries(input, actorId = null) {
    const asset = requireRecord(
      this.domain.get(RECORD_TYPES.ASSET_ACCOUNT, input.assetId),
      `Permanent Asset Account not found: ${input.assetId}`
    );
    const family = requireRecord(
      this.getFamily(input.familyId),
      `Instrument family not found: ${input.familyId}`
    );
    const verifiedValuePackage = requireRecord(
      this.domain.get(RECORD_TYPES.V4V_PACKAGE, input.verifiedValuePackageId),
      `Verified Value Package not found: ${input.verifiedValuePackageId}`
    );

    if (verifiedValuePackage.assetId && ![asset.id, asset.assetId].includes(verifiedValuePackage.assetId)) {
      throw new Error('Verified Value Package does not belong to the selected Permanent Asset Account.');
    }

    if (!input.purpose) throw new Error('Instrument series purpose is required.');
    const seriesId = input.seriesId || `IS-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    if (this.getSeries(seriesId)) throw new Error(`Instrument series already exists: ${seriesId}`);

    const series = {
      id: seriesId,
      seriesId,
      familyId: family.familyId,
      familyName: family.name,
      assetId: asset.assetId || asset.id,
      projectId: input.projectId || null,
      verifiedValuePackageId: input.verifiedValuePackageId,
      purpose: input.purpose,
      authorizedValue: input.authorizedValue ?? null,
      currency: input.currency || 'USD',
      term: input.term || null,
      participationWindow: input.participationWindow || null,
      state: 'DRAFT',
      identifiers: input.identifiers || [],
      relatedTrueBillIds: input.relatedTrueBillIds || [],
      restrictions: input.restrictions || [],
      conditions: input.conditions || [],
      issuedAt: null,
      activatedAt: null,
      settledAt: null,
      closedAt: null,
      archivedAt: null,
      createdAt: now(),
      updatedAt: now()
    };

    await this.domain.put(RECORD_TYPES.INSTRUMENT_SERIES, seriesId, series, {
      actorId,
      eventType: 'INSTRUMENT_SERIES_CREATED'
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.INSTRUMENT_SERIES,
      objectId: seriesId,
      eventType: 'INSTRUMENT_SERIES_CREATED',
      actorId,
      payload: {
        familyId: series.familyId,
        assetId: series.assetId,
        projectId: series.projectId,
        verifiedValuePackageId: series.verifiedValuePackageId,
        purpose: series.purpose
      }
    });
    return series;
  }

  async transitionSeries(seriesId, targetState, actorId = null, payload = {}) {
    if (!SERIES_STATES.has(targetState)) throw new Error(`Unsupported instrument series state: ${targetState}`);
    const series = requireRecord(this.getSeries(seriesId), `Instrument series not found: ${seriesId}`);

    const allowed = {
      DRAFT: ['ISSUED', 'ARCHIVED'],
      ISSUED: ['ACTIVE', 'SUSPENDED', 'CLOSED'],
      ACTIVE: ['SUSPENDED', 'SETTLED', 'CLOSED'],
      SUSPENDED: ['ACTIVE', 'CLOSED'],
      SETTLED: ['CLOSED'],
      CLOSED: ['ARCHIVED'],
      ARCHIVED: []
    };

    if (!allowed[series.state]?.includes(targetState)) {
      throw new Error(`Invalid instrument series transition: ${series.state} -> ${targetState}`);
    }

    const timestamp = now();
    const updated = {
      ...series,
      state: targetState,
      updatedAt: timestamp,
      issuedAt: targetState === 'ISSUED' ? timestamp : series.issuedAt,
      activatedAt: targetState === 'ACTIVE' ? timestamp : series.activatedAt,
      settledAt: targetState === 'SETTLED' ? timestamp : series.settledAt,
      closedAt: targetState === 'CLOSED' ? timestamp : series.closedAt,
      archivedAt: targetState === 'ARCHIVED' ? timestamp : series.archivedAt
    };

    await this.domain.put(RECORD_TYPES.INSTRUMENT_SERIES, seriesId, updated, {
      actorId,
      eventType: `INSTRUMENT_SERIES_${targetState}`
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.INSTRUMENT_SERIES,
      objectId: seriesId,
      eventType: `INSTRUMENT_SERIES_${targetState}`,
      actorId,
      payload: { priorState: series.state, state: targetState, ...payload }
    });
    return updated;
  }

  getSeriesWorkspace(seriesId) {
    const series = requireRecord(this.getSeries(seriesId), `Instrument series not found: ${seriesId}`);
    return {
      series,
      family: this.getFamily(series.familyId),
      asset: this.domain.get(RECORD_TYPES.ASSET_ACCOUNT, series.assetId),
      project: series.projectId ? this.domain.get(RECORD_TYPES.PROJECT_ACCOUNT, series.projectId) : null,
      verifiedValuePackage: this.domain.get(RECORD_TYPES.V4V_PACKAGE, series.verifiedValuePackageId),
      participationPositions: this.domain.list(RECORD_TYPES.PARTICIPATION_POSITION).filter((item) => item.seriesId === seriesId),
      transferablePositions: this.domain.list(RECORD_TYPES.TRANSFERABLE_POSITION).filter((item) => item.seriesId === seriesId),
      verifiedMarketEvents: this.domain.list(RECORD_TYPES.VERIFIED_MARKET_EVENT).filter((item) => item.seriesId === seriesId),
      lifecycleEvents: this.domain.list(RECORD_TYPES.LIFECYCLE_EVENT).filter((item) => item.objectId === seriesId)
    };
  }
}
