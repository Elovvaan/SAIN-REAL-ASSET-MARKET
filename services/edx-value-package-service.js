import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const PACKAGE_STATES = new Set(['DRAFT', 'GENERATING', 'VERIFYING', 'ACTIVE', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED']);
const VISIBILITY_LEVELS = new Set(['PRIVATE', 'INSTITUTIONAL', 'MARKETPLACE', 'PUBLIC']);
const SUPPORTED_USES = new Set([
  'MARKETPLACE_LISTING',
  'PARTICIPATION_OPPORTUNITY',
  'FINANCING_WORKFLOW',
  'PERFORMANCE_TRACKING',
  'ANALYTICS',
  'INSTITUTIONAL_REVIEW'
]);

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim().toUpperCase()))];
}

function packageVersion(existing) {
  if (!existing.length) return 1;
  return Math.max(...existing.map((item) => Number(item.version) || 0)) + 1;
}

function publicMetrics(metrics = {}) {
  return {
    revenue: metrics.revenue ?? 0,
    growthPercent: metrics.growthPercent ?? 0,
    production: metrics.production ?? 0,
    verifiedValue: metrics.verifiedValue ?? 0
  };
}

export class EdxValuePackageService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  listPackages(filters = {}) {
    return this.domain.list(RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE).filter((record) => {
      if (filters.enterpriseId && record.enterpriseId !== filters.enterpriseId) return false;
      if (filters.state && record.state !== filters.state) return false;
      if (filters.visibility && record.visibility !== filters.visibility) return false;
      if (filters.snapshotId && record.snapshotId !== filters.snapshotId) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getPackage(valuePackageId) {
    return this.domain.get(RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE, valuePackageId);
  }

  getLatestPackage(enterpriseId) {
    return this.listPackages({ enterpriseId }).find((record) => ['ACTIVE', 'PUBLISHED', 'SUPERSEDED'].includes(record.state)) || null;
  }

  lineage(valuePackageId) {
    const valuePackage = this.getPackage(valuePackageId);
    if (!valuePackage) throw new Error('Verified Value Package not found.');
    const snapshot = this.domain.get(RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, valuePackage.snapshotId);
    if (!snapshot) throw new Error('Referenced Verified Snapshot not found.');
    const normalizedRecords = (snapshot.sourceRecordIds || []).map((recordId) => this.domain.get(RECORD_TYPES.EDX_NORMALIZED_RECORD, recordId)).filter(Boolean);
    return {
      valuePackageId,
      snapshot,
      normalizedRecords,
      extractionResultIds: [...new Set(normalizedRecords.map((record) => record.extractionResultId).filter(Boolean))]
    };
  }

  async generatePackage(input, actorId = null) {
    const snapshotId = requiredString(input.snapshotId, 'snapshotId');
    const snapshot = this.domain.get(RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, snapshotId);
    if (!snapshot) throw new Error('Verified Snapshot not found.');
    if (!['COMPLETE', 'SUPERSEDED'].includes(snapshot.state)) throw new Error('Verified Snapshot must be complete or superseded.');
    if (!snapshot.frozen) throw new Error('Verified Snapshot must be frozen before package generation.');

    const visibility = requiredString(input.visibility || 'PRIVATE', 'visibility').toUpperCase();
    if (!VISIBILITY_LEVELS.has(visibility)) throw new Error(`Unsupported visibility: ${visibility}.`);

    const supportedUses = uniqueStrings(input.supportedUses || []);
    const unsupported = supportedUses.filter((use) => !SUPPORTED_USES.has(use));
    if (unsupported.length) throw new Error(`Unsupported package uses: ${unsupported.join(', ')}.`);
    if (!supportedUses.length) throw new Error('At least one supported use is required.');

    const existing = this.listPackages({ enterpriseId: snapshot.enterpriseId });
    const valuePackageId = input.valuePackageId || id('EDX-VVP');
    if (this.getPackage(valuePackageId)) throw new Error('Verified Value Package already exists.');
    const version = packageVersion(existing);
    const timestamp = now();

    const draft = {
      valuePackageId,
      enterpriseId: snapshot.enterpriseId,
      snapshotId,
      version,
      schemaVersion: '1.0.0',
      title: input.title || `Verified Value Package v${version}`,
      state: 'DRAFT',
      visibility,
      supportedUses,
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
      activatedAt: null,
      publishedAt: null,
      supersededAt: null,
      archivedAt: null
    };
    await this.domain.put(RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE, valuePackageId, draft, { actorId, eventType: 'EDX_VALUE_PACKAGE_DRAFT' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE, objectId: valuePackageId, eventType: 'EDX_VALUE_PACKAGE_DRAFT', actorId, payload: { snapshotId, version, visibility, supportedUses } });

    const generating = { ...draft, state: 'GENERATING', updatedAt: now() };
    await this.domain.put(RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE, valuePackageId, generating, { actorId, eventType: 'EDX_VALUE_PACKAGE_GENERATING' });

    const verifying = { ...generating, state: 'VERIFYING', updatedAt: now() };
    await this.domain.put(RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE, valuePackageId, verifying, { actorId, eventType: 'EDX_VALUE_PACKAGE_VERIFYING' });

    const completeMetrics = snapshot.metrics || {};
    const packageMetrics = visibility === 'PUBLIC' ? publicMetrics(completeMetrics) : completeMetrics;
    const active = {
      ...verifying,
      state: 'ACTIVE',
      packageDate: snapshot.snapshotDate,
      periodStart: snapshot.periodStart,
      periodEnd: snapshot.periodEnd,
      verificationStatus: snapshot.verificationStatus,
      verificationScore: snapshot.verificationScore,
      coveragePercent: snapshot.coveragePercent,
      categoryCoverage: snapshot.categoryCoverage,
      primaryCurrency: snapshot.primaryCurrency,
      currencies: snapshot.currencies,
      metrics: packageMetrics,
      marketplaceReadiness: {
        listing: supportedUses.includes('MARKETPLACE_LISTING'),
        participation: supportedUses.includes('PARTICIPATION_OPPORTUNITY'),
        financing: supportedUses.includes('FINANCING_WORKFLOW'),
        performanceTracking: supportedUses.includes('PERFORMANCE_TRACKING'),
        analytics: supportedUses.includes('ANALYTICS'),
        institutionalReview: supportedUses.includes('INSTITUTIONAL_REVIEW')
      },
      sourceRecordCount: snapshot.includedRecordCount,
      sourceLineage: snapshot.sourceLineage,
      frozenSnapshotReference: snapshotId,
      activatedAt: now(),
      updatedAt: now()
    };

    const previous = this.getLatestPackage(snapshot.enterpriseId);
    if (previous && ['ACTIVE', 'PUBLISHED'].includes(previous.state)) {
      const superseded = { ...previous, state: 'SUPERSEDED', supersededByValuePackageId: valuePackageId, supersededAt: now(), updatedAt: now() };
      await this.domain.put(RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE, previous.valuePackageId, superseded, { actorId, eventType: 'EDX_VALUE_PACKAGE_SUPERSEDED' });
      await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE, objectId: previous.valuePackageId, eventType: 'EDX_VALUE_PACKAGE_SUPERSEDED', actorId, payload: { supersededByValuePackageId: valuePackageId } });
    }

    await this.domain.put(RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE, valuePackageId, active, { actorId, eventType: 'EDX_VALUE_PACKAGE_ACTIVE' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE, objectId: valuePackageId, eventType: 'EDX_VALUE_PACKAGE_ACTIVE', actorId, payload: { verificationStatus: active.verificationStatus, supportedUses, visibility } });
    return active;
  }

  async publishPackage(valuePackageId, input = {}, actorId = null) {
    const current = this.getPackage(valuePackageId);
    if (!current) throw new Error('Verified Value Package not found.');
    if (current.state !== 'ACTIVE') throw new Error('Only an active package can be published.');
    if (!['MARKETPLACE', 'PUBLIC'].includes(current.visibility)) throw new Error('Package visibility must be MARKETPLACE or PUBLIC before publication.');
    const distributionTargets = uniqueStrings(input.distributionTargets || ['SRA_MARKETPLACE']);
    const published = {
      ...current,
      state: 'PUBLISHED',
      distributionTargets,
      publicationReference: input.publicationReference || id('EDX-PUB'),
      publishedBy: actorId,
      publishedAt: now(),
      updatedAt: now()
    };
    await this.domain.put(RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE, valuePackageId, published, { actorId, eventType: 'EDX_VALUE_PACKAGE_PUBLISHED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE, objectId: valuePackageId, eventType: 'EDX_VALUE_PACKAGE_PUBLISHED', actorId, payload: { distributionTargets, publicationReference: published.publicationReference } });
    return published;
  }

  async archivePackage(valuePackageId, actorId = null) {
    const current = this.getPackage(valuePackageId);
    if (!current) throw new Error('Verified Value Package not found.');
    if (current.state === 'ARCHIVED') return current;
    if (!['ACTIVE', 'PUBLISHED', 'SUPERSEDED'].includes(current.state)) throw new Error('Only active, published, or superseded packages can be archived.');
    const archived = { ...current, state: 'ARCHIVED', archivedAt: now(), updatedAt: now() };
    await this.domain.put(RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE, valuePackageId, archived, { actorId, eventType: 'EDX_VALUE_PACKAGE_ARCHIVED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE, objectId: valuePackageId, eventType: 'EDX_VALUE_PACKAGE_ARCHIVED', actorId, payload: {} });
    return archived;
  }
}

export const EDX_VALUE_PACKAGE_STATES = Object.freeze([...PACKAGE_STATES]);
export const EDX_VALUE_PACKAGE_USES = Object.freeze([...SUPPORTED_USES]);
