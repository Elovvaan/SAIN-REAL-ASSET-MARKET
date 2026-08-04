import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

function requireText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

export class FinancialRecordService {
  constructor(persistentDomain) {
    this.persistentDomain = persistentDomain;
  }

  list(filters = {}) {
    return this.persistentDomain.list(RECORD_TYPES.FINANCIAL_RECORD)
      .filter((record) => !filters.state || record.state === filters.state)
      .filter((record) => !filters.accountId || record.financialAccountId === filters.accountId)
      .filter((record) => !filters.classification || record.classification?.type === filters.classification)
      .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
  }

  get(financialRecordId) {
    return this.persistentDomain.get(RECORD_TYPES.FINANCIAL_RECORD, financialRecordId);
  }

  listAccounts() {
    return this.persistentDomain.list(RECORD_TYPES.FINANCIAL_RECORD_ACCOUNT)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  getAccount(accountId) {
    return this.persistentDomain.get(RECORD_TYPES.FINANCIAL_RECORD_ACCOUNT, accountId);
  }

  async createFromRecognition(recognitionId, input = {}, actorId = 'SAIN_AGENT') {
    const recognition = this.persistentDomain.get(RECORD_TYPES.RECOGNITION_ASSESSMENT, recognitionId);
    if (!recognition) throw new Error('Recognition assessment not found.');
    if (recognition.decision !== 'RECOGNIZED') throw new Error('Only a RECOGNIZED assessment can become a financial record.');

    const existing = this.list().find((record) => record.recognitionId === recognitionId && record.state !== 'SUPERSEDED');
    if (existing) return { financialRecord: existing, account: this.getAccount(existing.financialAccountId), created: false };

    const accountId = input.financialAccountId || `FRA-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    let account = this.getAccount(accountId);
    const now = new Date().toISOString();
    if (!account) {
      account = {
        financialAccountId: accountId,
        name: requireText(input.accountName || recognition.identity?.displayName || recognition.identity?.subjectId, 'accountName'),
        subjectType: recognition.identity.subjectType,
        subjectId: recognition.identity.subjectId,
        currencyOrUnit: recognition.measurement.unit,
        state: 'ACTIVE',
        recordCount: 0,
        createdBy: actorId,
        createdAt: now,
        updatedAt: now
      };
      await this.persistentDomain.put(RECORD_TYPES.FINANCIAL_RECORD_ACCOUNT, accountId, account, {
        actorId,
        eventType: 'FINANCIAL_RECORD_ACCOUNT_OPENED'
      });
    } else if (account.subjectId !== recognition.identity.subjectId || account.subjectType !== recognition.identity.subjectType) {
      throw new Error('The financial account does not match the recognized subject.');
    }

    const financialRecordId = `FR-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    const financialRecord = {
      financialRecordId,
      financialAccountId: accountId,
      recognitionId,
      observationId: recognition.observationId,
      recordType: requireText(input.recordType || 'RECOGNIZED_MARKET_POSITION', 'recordType').toUpperCase(),
      identity: recognition.identity,
      source: recognition.source,
      authority: recognition.authority,
      evidence: recognition.evidence,
      classification: recognition.classification,
      relationships: recognition.relationships,
      measurement: recognition.measurement,
      recognizedPosition: {
        amount: recognition.measurement.value,
        unit: recognition.measurement.unit,
        asOf: recognition.measurement.asOf,
        basis: recognition.measurement.method
      },
      rights: Array.isArray(input.rights) ? input.rights : [],
      obligations: Array.isArray(input.obligations) ? input.obligations : [],
      restrictions: Array.isArray(input.restrictions) ? input.restrictions : [],
      state: 'RECORDED',
      statusHistory: [{ state: 'RECORDED', actorId, occurredAt: now, reason: input.reason || 'Recognition accepted into the Financial Record Layer.' }],
      phase: 3,
      version: 3,
      recordedBy: actorId,
      recordedAt: now,
      updatedAt: now
    };

    await this.persistentDomain.put(RECORD_TYPES.FINANCIAL_RECORD, financialRecordId, financialRecord, {
      actorId,
      eventType: 'FINANCIAL_RECORD_CREATED'
    });
    account = { ...account, recordCount: Number(account.recordCount || 0) + 1, latestFinancialRecordId: financialRecordId, updatedAt: now };
    await this.persistentDomain.put(RECORD_TYPES.FINANCIAL_RECORD_ACCOUNT, accountId, account, {
      actorId,
      eventType: 'FINANCIAL_RECORD_ACCOUNT_UPDATED'
    });
    await this.persistentDomain.lifecycle({
      objectType: RECORD_TYPES.FINANCIAL_RECORD,
      objectId: financialRecordId,
      eventType: 'RECOGNIZED_POSITION_RECORDED',
      actorId,
      payload: { recognitionId, observationId: recognition.observationId, financialAccountId: accountId, measurement: recognition.measurement }
    });

    return { financialRecord, account, created: true };
  }

  async changeState(financialRecordId, input = {}, actorId = 'SRA_PLATFORM') {
    const record = this.get(financialRecordId);
    if (!record) throw new Error('Financial record not found.');
    const state = requireText(input.state, 'state').toUpperCase();
    if (!['RECORDED', 'ACTIVE', 'RESTRICTED', 'SUPERSEDED', 'CLOSED'].includes(state)) throw new Error('Unsupported financial record state.');
    const now = new Date().toISOString();
    const updated = {
      ...record,
      state,
      statusHistory: [...(record.statusHistory || []), { state, actorId, occurredAt: now, reason: input.reason || null }],
      updatedAt: now
    };
    await this.persistentDomain.put(RECORD_TYPES.FINANCIAL_RECORD, financialRecordId, updated, { actorId, eventType: 'FINANCIAL_RECORD_STATE_CHANGED' });
    await this.persistentDomain.lifecycle({ objectType: RECORD_TYPES.FINANCIAL_RECORD, objectId: financialRecordId, eventType: 'FINANCIAL_RECORD_STATE_CHANGED', actorId, payload: { state, reason: input.reason || null } });
    return updated;
  }

  summary() {
    const records = this.list();
    const byState = {};
    const byClassification = {};
    for (const record of records) {
      byState[record.state] = (byState[record.state] || 0) + 1;
      const type = record.classification?.type || 'UNCLASSIFIED';
      byClassification[type] = (byClassification[type] || 0) + 1;
    }
    return { version: 3, phase: 3, layer: 'FINANCIAL_RECORD_LAYER', financialRecordCount: records.length, financialAccountCount: this.listAccounts().length, byState, byClassification, latestRecordedAt: records[0]?.recordedAt || null };
  }
}
