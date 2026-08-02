import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const SNAPSHOT_STATES = new Set(['GENERATING', 'VERIFYING', 'COMPLETE', 'SUPERSEDED', 'ARCHIVED']);
const INCLUDED_VERIFICATION_STATES = new Set(['SOURCE_CONFIRMED', 'STRUCTURE_VALIDATED', 'CROSS_CHECKED', 'VERIFIED']);
const CATEGORIES = Object.freeze({
  revenue: ['DAILY_GROSS_REVENUE', 'DAILY_NET_REVENUE'],
  expenses: ['DAILY_EXPENSE'],
  assets: ['ASSET_ADDITION', 'ASSET_DISPOSITION'],
  inventory: ['INVENTORY_VALUE', 'INVENTORY_MOVEMENT'],
  production: ['PRODUCTION_OUTPUT'],
  cashPosition: ['CASH_POSITION', 'BANK_SETTLEMENT_SUMMARY'],
  receivables: ['RECEIVABLE_BALANCE'],
  payables: ['PAYABLE_BALANCE'],
  contracts: ['ACTIVE_CONTRACT_VALUE', 'COMPLETED_CONTRACT_VALUE'],
  orders: ['COMPLETED_ORDER_COUNT', 'COMPLETED_ORDER_VALUE'],
  projects: ['PROJECT_MILESTONE'],
  labor: ['LABOR_COST_SUMMARY']
});

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

function asDate(value, field) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is invalid.`);
  return date;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function recordTimestamp(record) {
  return record.sourceTimestamp || record.extractedAt || record.createdAt || null;
}

function inRange(record, start, end) {
  const timestamp = recordTimestamp(record);
  if (!timestamp) return false;
  const time = new Date(timestamp).getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function valueOf(record) {
  const candidates = [
    record.value,
    record.amount,
    record.total,
    record.quantity,
    record.metricValue,
    record.normalizedValue,
    record.fields?.value,
    record.fields?.amount,
    record.fields?.total,
    record.fields?.quantity,
    record.fields?.metricValue
  ];
  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function sum(records) {
  return records.reduce((total, record) => total + valueOf(record), 0);
}

function latestValue(records) {
  if (!records.length) return 0;
  const sorted = [...records].sort((a, b) => new Date(recordTimestamp(b) || 0) - new Date(recordTimestamp(a) || 0));
  return valueOf(sorted[0]);
}

function groupByCategory(records) {
  return records.reduce((groups, record) => {
    const category = record.category || 'UNKNOWN';
    groups[category] ||= [];
    groups[category].push(record);
    return groups;
  }, {});
}

function metricRecords(grouped, categories) {
  return categories.flatMap((category) => grouped[category] || []);
}

function percentageChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(2));
}

function currencySet(records) {
  return [...new Set(records.map((record) => record.currency).filter(Boolean))];
}

function verificationScore(records) {
  if (!records.length) return 0;
  const weights = { PENDING: 0.2, SOURCE_CONFIRMED: 0.5, STRUCTURE_VALIDATED: 0.7, CROSS_CHECKED: 0.85, VERIFIED: 1 };
  const total = records.reduce((score, record) => score + (weights[record.verificationState] || 0), 0);
  return Math.round((total / records.length) * 100);
}

export class EdxSnapshotService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  listSnapshots(filters = {}) {
    return this.domain.list(RECORD_TYPES.EDX_VERIFIED_SNAPSHOT).filter((snapshot) => {
      if (filters.enterpriseId && snapshot.enterpriseId !== filters.enterpriseId) return false;
      if (filters.state && snapshot.state !== filters.state) return false;
      if (filters.snapshotDate && snapshot.snapshotDate !== filters.snapshotDate) return false;
      return true;
    }).sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
  }

  getSnapshot(snapshotId) {
    return this.domain.get(RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, snapshotId);
  }

  getLatestSnapshot(enterpriseId) {
    return this.listSnapshots({ enterpriseId }).find((snapshot) => ['COMPLETE', 'SUPERSEDED'].includes(snapshot.state)) || null;
  }

  sourceRecords(snapshotId) {
    const snapshot = this.getSnapshot(snapshotId);
    if (!snapshot) throw new Error('Verified Snapshot not found.');
    return snapshot.sourceRecordIds.map((recordId) => this.domain.get(RECORD_TYPES.EDX_NORMALIZED_RECORD, recordId)).filter(Boolean);
  }

  verificationDetail(snapshotId) {
    const snapshot = this.getSnapshot(snapshotId);
    if (!snapshot) throw new Error('Verified Snapshot not found.');
    return {
      snapshotId,
      enterpriseId: snapshot.enterpriseId,
      state: snapshot.state,
      verificationStatus: snapshot.verificationStatus,
      verificationScore: snapshot.verificationScore,
      coveragePercent: snapshot.coveragePercent,
      includedRecordCount: snapshot.includedRecordCount,
      excludedRecordCount: snapshot.excludedRecordCount,
      categoryCoverage: snapshot.categoryCoverage,
      sourceLineage: snapshot.sourceLineage
    };
  }

  async generateSnapshot(input, actorId = null) {
    const enterpriseId = requiredString(input.enterpriseId, 'enterpriseId');
    const end = asDate(input.periodEnd, 'periodEnd');
    const start = input.periodStart ? asDate(input.periodStart, 'periodStart') : new Date(`${dateOnly(end)}T00:00:00.000Z`);
    if (start > end) throw new Error('periodStart must be before periodEnd.');

    const normalized = this.domain.list(RECORD_TYPES.EDX_NORMALIZED_RECORD).filter((record) => record.enterpriseId === enterpriseId && inRange(record, start, end));
    const included = normalized.filter((record) => INCLUDED_VERIFICATION_STATES.has(record.verificationState));
    const excluded = normalized.filter((record) => !INCLUDED_VERIFICATION_STATES.has(record.verificationState));
    if (!included.length) throw new Error('No eligible normalized records are available for this snapshot period.');

    const snapshotId = input.snapshotId || id('EDX-VS');
    if (this.getSnapshot(snapshotId)) throw new Error('Verified Snapshot already exists.');

    const generatedAt = now();
    const generating = {
      snapshotId,
      enterpriseId,
      schemaVersion: '1.0.0',
      snapshotDate: dateOnly(end),
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      state: 'GENERATING',
      generatedBy: actorId,
      generatedAt,
      completedAt: null,
      supersededAt: null,
      archivedAt: null
    };
    await this.domain.put(RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, snapshotId, generating, { actorId, eventType: 'EDX_SNAPSHOT_GENERATING' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, objectId: snapshotId, eventType: 'EDX_SNAPSHOT_GENERATING', actorId, payload: { enterpriseId, periodStart: generating.periodStart, periodEnd: generating.periodEnd } });

    await this.domain.put(RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, snapshotId, { ...generating, state: 'VERIFYING' }, { actorId, eventType: 'EDX_SNAPSHOT_VERIFYING' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, objectId: snapshotId, eventType: 'EDX_SNAPSHOT_VERIFYING', actorId, payload: { includedRecordCount: included.length, excludedRecordCount: excluded.length } });

    const grouped = groupByCategory(included);
    const revenueRecords = metricRecords(grouped, CATEGORIES.revenue);
    const expenseRecords = metricRecords(grouped, CATEGORIES.expenses);
    const assetAdditions = grouped.ASSET_ADDITION || [];
    const assetDispositions = grouped.ASSET_DISPOSITION || [];
    const inventoryRecords = grouped.INVENTORY_VALUE || [];
    const inventoryMovement = grouped.INVENTORY_MOVEMENT || [];
    const productionRecords = grouped.PRODUCTION_OUTPUT || [];
    const cashRecords = metricRecords(grouped, CATEGORIES.cashPosition);
    const receivableRecords = grouped.RECEIVABLE_BALANCE || [];
    const payableRecords = grouped.PAYABLE_BALANCE || [];

    const revenue = sum(revenueRecords);
    const expenses = sum(expenseRecords);
    const assets = sum(assetAdditions) - sum(assetDispositions);
    const inventory = inventoryRecords.length ? latestValue(inventoryRecords) : sum(inventoryMovement);
    const production = sum(productionRecords);
    const cashPosition = latestValue(cashRecords);
    const receivables = latestValue(receivableRecords);
    const payables = latestValue(payableRecords);
    const netOperatingResult = revenue - expenses;
    const workingCapital = cashPosition + receivables - payables;

    const previous = this.getLatestSnapshot(enterpriseId);
    const growth = previous ? percentageChange(revenue, previous.metrics?.revenue || 0) : 0;
    const verifiedValue = Number((assets + inventory + cashPosition + receivables + Math.max(netOperatingResult, 0)).toFixed(2));

    const requiredCategories = ['revenue', 'expenses', 'assets', 'inventory', 'production', 'cashPosition'];
    const categoryCoverage = Object.fromEntries(requiredCategories.map((name) => [name, metricRecords(grouped, CATEGORIES[name]).length > 0]));
    const covered = Object.values(categoryCoverage).filter(Boolean).length;
    const coveragePercent = Math.round((covered / requiredCategories.length) * 100);
    const score = verificationScore(included);
    const currencies = currencySet(included);

    const complete = {
      ...generating,
      state: 'COMPLETE',
      title: input.title || `Today's Verified Snapshot — ${dateOnly(end)}`,
      visibility: input.visibility || 'PRIVATE',
      verificationStatus: score >= 85 ? 'VERIFIED' : score >= 60 ? 'SUBSTANTIALLY_VERIFIED' : 'PARTIALLY_VERIFIED',
      verificationScore: score,
      coveragePercent,
      categoryCoverage,
      currencies,
      primaryCurrency: input.primaryCurrency || currencies[0] || null,
      metrics: {
        revenue,
        expenses,
        netOperatingResult,
        assets,
        inventory,
        production,
        growthPercent: growth,
        cashPosition,
        receivables,
        payables,
        workingCapital,
        verifiedValue
      },
      includedRecordCount: included.length,
      excludedRecordCount: excluded.length,
      sourceRecordIds: included.map((record) => record.normalizedRecordId),
      excludedRecordIds: excluded.map((record) => record.normalizedRecordId),
      sourceLineage: [...new Set(included.map((record) => record.extractionResultId).filter(Boolean))],
      calculatedAt: now(),
      completedAt: now(),
      previousSnapshotId: previous?.snapshotId || null,
      frozen: true
    };

    if (previous && previous.state === 'COMPLETE') {
      const superseded = { ...previous, state: 'SUPERSEDED', supersededBySnapshotId: snapshotId, supersededAt: now() };
      await this.domain.put(RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, previous.snapshotId, superseded, { actorId, eventType: 'EDX_SNAPSHOT_SUPERSEDED' });
      await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, objectId: previous.snapshotId, eventType: 'EDX_SNAPSHOT_SUPERSEDED', actorId, payload: { supersededBySnapshotId: snapshotId } });
    }

    await this.domain.put(RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, snapshotId, complete, { actorId, eventType: 'EDX_SNAPSHOT_COMPLETE' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, objectId: snapshotId, eventType: 'EDX_SNAPSHOT_COMPLETE', actorId, payload: { verificationStatus: complete.verificationStatus, coveragePercent, verifiedValue } });
    return complete;
  }

  async archiveSnapshot(snapshotId, actorId = null) {
    const snapshot = this.getSnapshot(snapshotId);
    if (!snapshot) throw new Error('Verified Snapshot not found.');
    if (snapshot.state === 'ARCHIVED') return snapshot;
    if (!['COMPLETE', 'SUPERSEDED'].includes(snapshot.state)) throw new Error('Only complete or superseded snapshots can be archived.');
    const archived = { ...snapshot, state: 'ARCHIVED', archivedAt: now() };
    await this.domain.put(RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, snapshotId, archived, { actorId, eventType: 'EDX_SNAPSHOT_ARCHIVED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, objectId: snapshotId, eventType: 'EDX_SNAPSHOT_ARCHIVED', actorId, payload: {} });
    return archived;
  }
}

export const EDX_SNAPSHOT_STATES = Object.freeze([...SNAPSHOT_STATES]);
