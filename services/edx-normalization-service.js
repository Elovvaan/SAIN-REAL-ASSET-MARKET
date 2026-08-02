import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const CATEGORIES = new Set([
  'DAILY_GROSS_REVENUE', 'DAILY_NET_REVENUE', 'DAILY_EXPENSE', 'CASH_POSITION',
  'RECEIVABLE_BALANCE', 'PAYABLE_BALANCE', 'INVENTORY_VALUE', 'INVENTORY_MOVEMENT',
  'PRODUCTION_OUTPUT', 'COMPLETED_ORDER_COUNT', 'COMPLETED_ORDER_VALUE',
  'ACTIVE_CONTRACT_VALUE', 'COMPLETED_CONTRACT_VALUE', 'ASSET_ADDITION',
  'ASSET_DISPOSITION', 'PROJECT_MILESTONE', 'LABOR_COST_SUMMARY',
  'BANK_SETTLEMENT_SUMMARY', 'CUSTOM_APPROVED_METRIC'
]);

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}
function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function asNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be numeric.`);
  return number;
}
function parseTimestamp(value, field) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is invalid.`);
  return date.toISOString();
}

const DEFAULT_MAPPINGS = Object.freeze({
  DAILY_GROSS_REVENUE: { value: ['gross_total', 'gross_sales', 'revenue', 'amount'], currency: ['currency'], period: ['posting_date', 'date', 'created_at'] },
  DAILY_NET_REVENUE: { value: ['net_total', 'net_sales', 'net_revenue', 'amount'], currency: ['currency'], period: ['posting_date', 'date', 'created_at'] },
  DAILY_EXPENSE: { value: ['expense_total', 'expenses', 'amount'], currency: ['currency'], period: ['posting_date', 'date', 'created_at'] },
  CASH_POSITION: { value: ['cash_balance', 'available_balance', 'balance', 'amount'], currency: ['currency'], period: ['as_of', 'date', 'created_at'] },
  RECEIVABLE_BALANCE: { value: ['receivable_balance', 'accounts_receivable', 'balance', 'amount'], currency: ['currency'], period: ['as_of', 'date'] },
  PAYABLE_BALANCE: { value: ['payable_balance', 'accounts_payable', 'balance', 'amount'], currency: ['currency'], period: ['as_of', 'date'] },
  INVENTORY_VALUE: { value: ['inventory_value', 'stock_value', 'value', 'amount'], currency: ['currency'], period: ['as_of', 'date'] },
  INVENTORY_MOVEMENT: { value: ['quantity_change', 'movement', 'quantity', 'amount'], currency: [], period: ['posting_date', 'date'] },
  PRODUCTION_OUTPUT: { value: ['output', 'units_produced', 'quantity', 'amount'], currency: [], period: ['production_date', 'date'] },
  COMPLETED_ORDER_COUNT: { value: ['completed_count', 'order_count', 'count'], currency: [], period: ['date'] },
  COMPLETED_ORDER_VALUE: { value: ['completed_value', 'order_value', 'amount'], currency: ['currency'], period: ['date'] },
  ACTIVE_CONTRACT_VALUE: { value: ['active_contract_value', 'contract_value', 'amount'], currency: ['currency'], period: ['as_of', 'date'] },
  COMPLETED_CONTRACT_VALUE: { value: ['completed_contract_value', 'contract_value', 'amount'], currency: ['currency'], period: ['completion_date', 'date'] },
  ASSET_ADDITION: { value: ['asset_value', 'value', 'amount'], currency: ['currency'], period: ['acquired_at', 'date'] },
  ASSET_DISPOSITION: { value: ['disposition_value', 'sale_value', 'amount'], currency: ['currency'], period: ['disposed_at', 'date'] },
  PROJECT_MILESTONE: { value: ['completion_percent', 'progress', 'value'], currency: [], period: ['completed_at', 'date'] },
  LABOR_COST_SUMMARY: { value: ['labor_cost', 'payroll_total', 'amount'], currency: ['currency'], period: ['period_end', 'date'] },
  BANK_SETTLEMENT_SUMMARY: { value: ['settlement_total', 'settled_amount', 'amount'], currency: ['currency'], period: ['settlement_date', 'date'] },
  CUSTOM_APPROVED_METRIC: { value: ['value', 'amount'], currency: ['currency'], period: ['date', 'as_of'] }
});

function firstValue(row, candidates = []) {
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== '' && row[key] != null) return row[key];
  }
  return null;
}

export class EdxNormalizationService {
  constructor(domain) { this.domain = domain; }

  listRecords(filters = {}) {
    return this.domain.list(RECORD_TYPES.EDX_NORMALIZED_RECORD).filter((record) => {
      if (filters.enterpriseId && record.enterpriseId !== filters.enterpriseId) return false;
      if (filters.category && record.category !== filters.category) return false;
      if (filters.extractionResultId && record.extractionResultId !== filters.extractionResultId) return false;
      if (filters.verificationState && record.verificationState !== filters.verificationState) return false;
      return true;
    });
  }

  getRecord(normalizedRecordId) {
    return this.domain.get(RECORD_TYPES.EDX_NORMALIZED_RECORD, normalizedRecordId);
  }

  async normalizeExtractionResult(extractionResultId, input = {}, actorId = null) {
    const result = this.domain.get(RECORD_TYPES.EDX_EXTRACTION_RESULT, extractionResultId);
    if (!result) throw new Error('Extraction result not found.');
    if (result.state !== 'IMMUTABLE_FILTERED_RESULT') throw new Error('Extraction result is not eligible for normalization.');

    const category = requiredString(input.category || result.recordCategory, 'category').toUpperCase();
    if (!CATEGORIES.has(category)) throw new Error(`Unsupported normalized category: ${category}.`);
    const mapping = { ...DEFAULT_MAPPINGS[category], ...(input.mapping || {}) };
    const schemaVersion = input.schemaVersion || '1.0.0';
    const created = [];
    const duplicates = [];
    const rejected = [];

    for (const item of result.records || []) {
      const row = item.fields || {};
      try {
        const rawValue = firstValue(row, mapping.value);
        if (rawValue == null) throw new Error('No mapped value field was found.');
        const value = asNumber(rawValue, 'value');
        const currency = firstValue(row, mapping.currency) || input.defaultCurrency || null;
        const periodValue = firstValue(row, mapping.period) || result.sourceTimestamp || result.extractedAt;
        const periodEnd = parseTimestamp(periodValue, 'period');
        const periodStart = parseTimestamp(input.periodStart || periodValue, 'periodStart');
        const unit = input.unit || (currency ? 'CURRENCY' : 'COUNT_OR_QUANTITY');
        const fingerprint = hash({ enterpriseId: result.enterpriseId, category, periodStart, periodEnd, value, currency, unit, source: extractionResultId, row: item.sourceRowIndex });
        const existing = this.listRecords().find((record) => record.fingerprint === fingerprint);
        if (existing) {
          duplicates.push(existing.normalizedRecordId);
          continue;
        }

        const normalizedRecordId = id('EDX-NR');
        const record = {
          normalizedRecordId,
          enterpriseId: result.enterpriseId,
          connectionId: result.connectionId,
          policyId: result.policyId,
          extractionRequestId: result.extractionRequestId,
          extractionResultId,
          sourceRowIndex: item.sourceRowIndex,
          sourceSystem: input.sourceSystem || null,
          category,
          schemaVersion,
          periodStart,
          periodEnd,
          currency,
          value,
          unit,
          dimensions: input.dimensions || {},
          sourceTimestamp: result.sourceTimestamp || null,
          extractedAt: result.extractedAt,
          normalizedAt: now(),
          provenance: {
            sourcePayloadReference: result.sourcePayloadReference || null,
            extractionResultId,
            mapping,
            sourceFields: Object.keys(row)
          },
          fingerprint,
          verificationState: 'PENDING',
          visibility: result.visibility,
          state: 'ACTIVE'
        };

        await this.domain.put(RECORD_TYPES.EDX_NORMALIZED_RECORD, normalizedRecordId, record, { actorId, eventType: 'EDX_RECORD_NORMALIZED' });
        await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_NORMALIZED_RECORD, objectId: normalizedRecordId, eventType: 'EDX_RECORD_NORMALIZED', actorId, payload: { category, extractionResultId, fingerprint } });
        created.push(record);
      } catch (error) {
        rejected.push({ sourceRowIndex: item.sourceRowIndex, reason: error.message });
      }
    }

    return { category, schemaVersion, createdCount: created.length, duplicateCount: duplicates.length, rejectedCount: rejected.length, records: created, duplicateRecordIds: duplicates, rejected };
  }

  async transitionVerification(normalizedRecordId, targetState, input = {}, actorId = null) {
    const record = this.getRecord(normalizedRecordId);
    if (!record) throw new Error('Normalized record not found.');
    const allowed = ['SOURCE_CONFIRMED', 'STRUCTURE_VALIDATED', 'CROSS_CHECKED', 'VERIFIED', 'REJECTED', 'SUPERSEDED'];
    const state = requiredString(targetState, 'verificationState').toUpperCase();
    if (!allowed.includes(state)) throw new Error(`Unsupported verification state: ${state}.`);
    const updated = { ...record, verificationState: state, verificationNote: input.note || null, verifiedBy: state === 'VERIFIED' ? actorId : record.verifiedBy || null, verifiedAt: state === 'VERIFIED' ? now() : record.verifiedAt || null, updatedAt: now() };
    await this.domain.put(RECORD_TYPES.EDX_NORMALIZED_RECORD, normalizedRecordId, updated, { actorId, eventType: `EDX_RECORD_${state}` });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_NORMALIZED_RECORD, objectId: normalizedRecordId, eventType: `EDX_RECORD_${state}`, actorId, payload: { previousState: record.verificationState, verificationState: state, note: input.note || null } });
    return updated;
  }
}

export const EDX_NORMALIZED_CATEGORIES = Object.freeze([...CATEGORIES]);
