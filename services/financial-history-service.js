import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const ORIGINS = new Set(['NATIVE', 'HISTORICAL', 'IMPORTED']);
const HISTORY_TYPES = new Set(['RETAIL_RECEIPT', 'BANK_STATEMENT', 'BANK_TRANSACTION', 'INVOICE', 'BILL', 'PAYMENT_CONFIRMATION', 'DEPOSIT_SLIP', 'PAYROLL_STUB', 'TAX_RECEIPT', 'INSURANCE_STATEMENT', 'OTHER']);

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function text(value, field) { const result = String(value || '').trim(); if (!result) throw new Error(`${field} is required.`); return result; }
function optionalMoney(value, field) { if (value == null || value === '') return null; const amount = Number(value); if (!Number.isFinite(amount)) throw new Error(`${field} must be numeric.`); return Number(amount.toFixed(2)); }
function normalizedOrigin(value) { const origin = String(value || 'HISTORICAL').toUpperCase(); if (!ORIGINS.has(origin)) throw new Error('Unsupported recordOrigin.'); return origin; }
function normalizedHistoryType(value) { const type = String(value || '').toUpperCase(); if (!HISTORY_TYPES.has(type)) throw new Error('Unsupported financial history type.'); return type; }

export class FinancialHistoryService {
  constructor(domain) { this.domain = domain; }

  list(filters = {}) {
    return this.domain.list(RECORD_TYPES.FINANCIAL_HISTORY_RECORD)
      .filter((record) => !filters.ownerId || record.ownerId === filters.ownerId)
      .filter((record) => !filters.historyType || record.historyType === String(filters.historyType).toUpperCase())
      .filter((record) => !filters.recordOrigin || record.recordOrigin === String(filters.recordOrigin).toUpperCase())
      .filter((record) => !filters.state || record.state === String(filters.state).toUpperCase())
      .sort((a, b) => String(b.effectiveAt || b.createdAt).localeCompare(String(a.effectiveAt || a.createdAt)));
  }

  get(financialHistoryRecordId) { return this.domain.get(RECORD_TYPES.FINANCIAL_HISTORY_RECORD, financialHistoryRecordId); }

  async record(input = {}, actorId = 'SRA_PLATFORM') {
    const recordOrigin = normalizedOrigin(input.recordOrigin);
    if (recordOrigin !== 'HISTORICAL' && recordOrigin !== 'IMPORTED') throw new Error('Financial history intake accepts HISTORICAL or IMPORTED records.');
    const historyType = normalizedHistoryType(input.historyType);
    const financialHistoryRecordId = input.financialHistoryRecordId || id('FHR');
    if (this.get(financialHistoryRecordId)) return { created: false, record: this.get(financialHistoryRecordId) };

    const recognitionId = id('REC');
    const financialRecordId = id('FR');
    const createdAt = now();
    const amount = optionalMoney(input.amount, 'amount');
    const currency = String(input.currency || 'USD').toUpperCase();
    const evidenceIds = Array.isArray(input.evidenceIds) ? [...new Set(input.evidenceIds.filter(Boolean).map(String))] : [];
    const sourceReference = text(input.sourceReference, 'sourceReference');
    const ownerId = text(input.ownerId, 'ownerId');
    const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt).toISOString() : createdAt;

    const recognition = {
      recognitionId,
      recordOrigin,
      sourceReference,
      subjectId: ownerId,
      decision: 'RECOGNIZED',
      recognitionBasis: input.recognitionBasis || 'EXISTING_FINANCIAL_EVENT_EVIDENCE',
      evidenceIds,
      recognizedAt: createdAt,
      recognizedBy: actorId,
    };

    const financialRecord = {
      financialRecordId,
      recognitionId,
      recordOrigin,
      recordType: 'FINANCIAL_HISTORY',
      historyType,
      ownerId,
      amount,
      currency,
      effectiveAt,
      sourceReference,
      description: input.description || null,
      state: 'RECORDED',
      recordedAt: createdAt,
      recordedBy: actorId,
    };

    const historyRecord = {
      financialHistoryRecordId,
      recognitionId,
      financialRecordId,
      recordOrigin,
      historyType,
      ownerId,
      sourceReference,
      sourceSystem: input.sourceSystem || null,
      merchantName: input.merchantName || null,
      accountReference: input.accountReference || null,
      statementPeriodStart: input.statementPeriodStart || null,
      statementPeriodEnd: input.statementPeriodEnd || null,
      transactionReference: input.transactionReference || null,
      amount,
      currency,
      effectiveAt,
      description: input.description || null,
      category: input.category || null,
      evidenceIds,
      linkedRecordIds: Array.isArray(input.linkedRecordIds) ? [...new Set(input.linkedRecordIds.filter(Boolean).map(String))] : [],
      economicOutcome: true,
      marketplaceEligible: false,
      instrumentEligible: false,
      state: 'RECOGNIZED',
      createdAt,
      createdBy: actorId,
    };

    await this.domain.atomicPut([
      { type: RECORD_TYPES.RECOGNITION_ASSESSMENT, id: recognitionId, payload: recognition, actorId, eventType: 'FINANCIAL_HISTORY_RECOGNIZED' },
      { type: RECORD_TYPES.FINANCIAL_RECORD, id: financialRecordId, payload: financialRecord, actorId, eventType: 'FINANCIAL_HISTORY_FINANCIAL_RECORD_CREATED' },
      { type: RECORD_TYPES.FINANCIAL_HISTORY_RECORD, id: financialHistoryRecordId, payload: historyRecord, actorId, eventType: 'FINANCIAL_HISTORY_RECORD_CREATED' },
    ]);

    await this.domain.lifecycle({
      objectType: RECORD_TYPES.FINANCIAL_HISTORY_RECORD,
      objectId: financialHistoryRecordId,
      eventType: 'SRA_FINANCIAL_HISTORY_RECORDED',
      actorId,
      payload: { recordOrigin, historyType, recognitionId, financialRecordId, sourceReference, economicOutcome: true },
    });

    return { created: true, record: historyRecord, recognition, financialRecord };
  }

  summary(ownerId = null) {
    const records = this.list(ownerId ? { ownerId } : {});
    const byType = {};
    let inflow = 0;
    let outflow = 0;
    for (const record of records) {
      byType[record.historyType] = (byType[record.historyType] || 0) + 1;
      const amount = Number(record.amount || 0);
      if (record.category === 'INFLOW') inflow += amount;
      if (record.category === 'OUTFLOW') outflow += amount;
    }
    return { recordCount: records.length, byType, inflow: Number(inflow.toFixed(2)), outflow: Number(outflow.toFixed(2)), net: Number((inflow - outflow).toFixed(2)), ownerId };
  }
}

export { ORIGINS as FINANCIAL_RECORD_ORIGINS, HISTORY_TYPES as FINANCIAL_HISTORY_TYPES };
