import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

function requireText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function finitePositive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be greater than zero.`);
  return number;
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

  listCoinAccounts() {
    return this.persistentDomain.list(RECORD_TYPES.COIN_ACCOUNT)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  getCoinAccount(coinAccountId) {
    return this.persistentDomain.get(RECORD_TYPES.COIN_ACCOUNT, coinAccountId);
  }

  listCoinPositions(filters = {}) {
    return this.persistentDomain.list(RECORD_TYPES.COIN_POSITION)
      .filter((position) => !filters.state || position.state === filters.state)
      .filter((position) => !filters.coinAccountId || position.coinAccountId === filters.coinAccountId)
      .filter((position) => !filters.financialRecordId || position.financialRecordId === filters.financialRecordId)
      .sort((a, b) => String(b.representedAt).localeCompare(String(a.representedAt)));
  }

  getCoinPosition(coinPositionId) {
    return this.persistentDomain.get(RECORD_TYPES.COIN_POSITION, coinPositionId);
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
      await this.persistentDomain.put(RECORD_TYPES.FINANCIAL_RECORD_ACCOUNT, accountId, account, { actorId, eventType: 'FINANCIAL_RECORD_ACCOUNT_OPENED' });
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

    await this.persistentDomain.put(RECORD_TYPES.FINANCIAL_RECORD, financialRecordId, financialRecord, { actorId, eventType: 'FINANCIAL_RECORD_CREATED' });
    account = { ...account, recordCount: Number(account.recordCount || 0) + 1, latestFinancialRecordId: financialRecordId, updatedAt: now };
    await this.persistentDomain.put(RECORD_TYPES.FINANCIAL_RECORD_ACCOUNT, accountId, account, { actorId, eventType: 'FINANCIAL_RECORD_ACCOUNT_UPDATED' });
    await this.persistentDomain.lifecycle({
      objectType: RECORD_TYPES.FINANCIAL_RECORD,
      objectId: financialRecordId,
      eventType: 'RECOGNIZED_POSITION_RECORDED',
      actorId,
      payload: { recognitionId, observationId: recognition.observationId, financialAccountId: accountId, measurement: recognition.measurement }
    });

    return { financialRecord, account, created: true };
  }

  async representAsCoin(financialRecordId, input = {}, actorId = 'SAIN_AGENT') {
    const record = this.get(financialRecordId);
    if (!record) throw new Error('Financial record not found.');
    if (!['RECORDED', 'ACTIVE', 'RESTRICTED'].includes(record.state)) throw new Error('Only an open financial record can receive coin representation.');

    const existing = this.listCoinPositions({ financialRecordId }).find((position) => position.state !== 'RETIRED');
    if (existing) return { coinPosition: existing, coinAccount: this.getCoinAccount(existing.coinAccountId), created: false };

    const sourceAmount = finitePositive(record.recognizedPosition?.amount, 'recognizedPosition.amount');
    const conversionRate = finitePositive(input.conversionRate ?? 1, 'conversionRate');
    const coinQuantity = Number((sourceAmount * conversionRate).toFixed(8));
    const symbol = requireText(input.symbol || 'SRA', 'symbol').toUpperCase();
    const coinAccountId = input.coinAccountId || `CA-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    const now = new Date().toISOString();

    let coinAccount = this.getCoinAccount(coinAccountId);
    if (!coinAccount) {
      coinAccount = {
        coinAccountId,
        financialAccountId: record.financialAccountId,
        subjectType: record.identity?.subjectType,
        subjectId: record.identity?.subjectId,
        symbol,
        state: 'ACTIVE',
        positionCount: 0,
        representedQuantity: 0,
        createdBy: actorId,
        createdAt: now,
        updatedAt: now
      };
      await this.persistentDomain.put(RECORD_TYPES.COIN_ACCOUNT, coinAccountId, coinAccount, { actorId, eventType: 'COIN_ACCOUNT_OPENED' });
    } else {
      if (coinAccount.financialAccountId !== record.financialAccountId) throw new Error('The coin account does not match the Financial Record Account.');
      if (coinAccount.symbol !== symbol) throw new Error('The coin account symbol does not match the requested symbol.');
    }

    const coinPositionId = `CP-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    const coinPosition = {
      coinPositionId,
      coinAccountId,
      financialRecordId,
      financialAccountId: record.financialAccountId,
      recognitionId: record.recognitionId,
      observationId: record.observationId,
      symbol,
      representationType: requireText(input.representationType || 'FINANCIAL_RECORD_POSITION', 'representationType').toUpperCase(),
      sourcePosition: {
        amount: sourceAmount,
        unit: record.recognizedPosition.unit,
        asOf: record.recognizedPosition.asOf,
        basis: record.recognizedPosition.basis
      },
      conversionRule: {
        method: requireText(input.conversionMethod || 'DIRECT_RATIO', 'conversionMethod').toUpperCase(),
        rate: conversionRate,
        sourceUnit: record.recognizedPosition.unit,
        coinUnit: symbol,
        methodologyReference: input.methodologyReference || null
      },
      quantity: coinQuantity,
      rights: record.rights || [],
      obligations: record.obligations || [],
      restrictions: [...(record.restrictions || []), ...(Array.isArray(input.restrictions) ? input.restrictions : [])],
      sourceLineage: {
        financialRecordId,
        recognitionId: record.recognitionId,
        observationId: record.observationId,
        source: record.source,
        evidence: record.evidence
      },
      state: 'REPRESENTED',
      statusHistory: [{ state: 'REPRESENTED', actorId, occurredAt: now, reason: input.reason || 'Financial Record represented in SRA Coin units.' }],
      phase: 4,
      version: 3,
      representedBy: actorId,
      representedAt: now,
      updatedAt: now
    };

    await this.persistentDomain.put(RECORD_TYPES.COIN_POSITION, coinPositionId, coinPosition, { actorId, eventType: 'COIN_POSITION_REPRESENTED' });
    coinAccount = {
      ...coinAccount,
      positionCount: Number(coinAccount.positionCount || 0) + 1,
      representedQuantity: Number((Number(coinAccount.representedQuantity || 0) + coinQuantity).toFixed(8)),
      latestCoinPositionId: coinPositionId,
      updatedAt: now
    };
    await this.persistentDomain.put(RECORD_TYPES.COIN_ACCOUNT, coinAccountId, coinAccount, { actorId, eventType: 'COIN_ACCOUNT_UPDATED' });
    await this.persistentDomain.lifecycle({
      objectType: RECORD_TYPES.COIN_POSITION,
      objectId: coinPositionId,
      eventType: 'FINANCIAL_RECORD_COIN_REPRESENTATION_CREATED',
      actorId,
      payload: { financialRecordId, coinAccountId, symbol, quantity: coinQuantity, conversionRate }
    });

    return { coinPosition, coinAccount, created: true };
  }

  async changeCoinState(coinPositionId, input = {}, actorId = 'SRA_PLATFORM') {
    const position = this.getCoinPosition(coinPositionId);
    if (!position) throw new Error('Coin position not found.');
    const state = requireText(input.state, 'state').toUpperCase();
    if (!['REPRESENTED', 'ACTIVE', 'RESTRICTED', 'RETIRED'].includes(state)) throw new Error('Unsupported coin position state.');
    const now = new Date().toISOString();
    const updated = {
      ...position,
      state,
      statusHistory: [...(position.statusHistory || []), { state, actorId, occurredAt: now, reason: input.reason || null }],
      updatedAt: now
    };
    await this.persistentDomain.put(RECORD_TYPES.COIN_POSITION, coinPositionId, updated, { actorId, eventType: 'COIN_POSITION_STATE_CHANGED' });
    await this.persistentDomain.lifecycle({ objectType: RECORD_TYPES.COIN_POSITION, objectId: coinPositionId, eventType: 'COIN_POSITION_STATE_CHANGED', actorId, payload: { state, reason: input.reason || null } });
    return updated;
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
    const coinPositions = this.listCoinPositions();
    const byState = {};
    const byClassification = {};
    const coinByState = {};
    const coinBySymbol = {};
    for (const record of records) {
      byState[record.state] = (byState[record.state] || 0) + 1;
      const type = record.classification?.type || 'UNCLASSIFIED';
      byClassification[type] = (byClassification[type] || 0) + 1;
    }
    for (const position of coinPositions) {
      coinByState[position.state] = (coinByState[position.state] || 0) + 1;
      coinBySymbol[position.symbol] = Number(((coinBySymbol[position.symbol] || 0) + Number(position.quantity || 0)).toFixed(8));
    }
    return {
      version: 3,
      phase: 4,
      layer: 'COIN_REPRESENTATION_LAYER',
      financialRecordCount: records.length,
      financialAccountCount: this.listAccounts().length,
      coinAccountCount: this.listCoinAccounts().length,
      coinPositionCount: coinPositions.length,
      byState,
      byClassification,
      coinByState,
      coinBySymbol,
      latestRecordedAt: records[0]?.recordedAt || null,
      latestRepresentedAt: coinPositions[0]?.representedAt || null
    };
  }
}
