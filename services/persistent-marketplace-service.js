import { RECORD_TYPES } from './persistent-domain-service.js';
import { PlatformDataHygieneService, MOCK_ASSET_IDS, MOCK_PROJECT_IDS } from './platform-data-hygiene-service.js';

const MOCK_ASSET_ID_SET = new Set(MOCK_ASSET_IDS);
const MOCK_PROJECT_ID_SET = new Set(MOCK_PROJECT_IDS);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function occurredAt(record) {
  return firstValue(record.occurredAt, record.completedAt, record.settledAt, record.executedAt, record.postedAt, record.createdAt, record.updatedAt) || null;
}

function transactionAmount(record) {
  return number(firstValue(record.amount, record.settlementAmount, record.executedAmount, record.value, record.totalDebits, record.payload?.amount, record.payload?.settlementAmount, record.payload?.value));
}

function transactionCurrency(record) { return firstValue(record.currency, record.payload?.currency, 'USD'); }
function transactionState(record) { return String(firstValue(record.state, record.status, record.eventType, 'RECORDED')).toUpperCase(); }
function transactionKind(record, sourceType) { return firstValue(record.transactionType, record.kind, record.eventType, record.type, sourceType); }
function transactionId(record, sourceType, index) {
  return firstValue(record.transactionId, record.entryId, record.settlementId, record.settlementRecordId, record.instructionId, record.paymentOrderId, record.eventId, record.id, `${sourceType}-${index + 1}`);
}

function normalizeTransaction(record, sourceType, index) {
  const kind = transactionKind(record, sourceType);
  const directFeePayment = kind === 'PLATFORM_FEE_PAYMENT_CONFIRMED';
  return {
    transactionId: transactionId(record, sourceType, index),
    sourceType,
    kind,
    state: transactionState(record),
    amount: transactionAmount(record),
    currency: transactionCurrency(record),
    occurredAt: occurredAt(record),
    assetId: firstValue(record.assetId, record.payload?.assetId, null),
    projectId: firstValue(record.projectId, record.payload?.projectId, null),
    participantId: firstValue(record.participantId, record.ownerId, record.payload?.participantId, null),
    fromAccountId: directFeePayment ? null : firstValue(record.fromAccountId, record.debitAccountId, record.payload?.fromAccountId, null),
    toAccountId: firstValue(record.toAccountId, record.creditAccountId, record.payload?.toAccountId, null),
    referenceId: firstValue(record.referenceId, record.externalReference, record.payload?.referenceId, null),
    verified: sourceType === RECORD_TYPES.VERIFIED_MARKET_EVENT || Boolean(record.verifiedAt || record.evidenceId || record.evidenceReferences?.length),
    rawState: firstValue(record.state, record.status, null)
  };
}

function isCompleted(transaction) {
  return ['COMPLETED', 'SETTLED', 'POSTED', 'EXECUTED', 'EVIDENCED', 'VERIFIED', 'CLOSED'].some((state) => transaction.state.includes(state));
}
function isPending(transaction) {
  return ['PENDING', 'QUEUED', 'AUTHORIZED', 'SUBMITTED', 'PROCESSING', 'AVAILABLE'].some((state) => transaction.state.includes(state));
}

export class PersistentMarketplaceService {
  constructor(persistentDomain, seed = {}) {
    this.persistentDomain = persistentDomain;
    this.seed = seed;
    this.dataHygiene = new PlatformDataHygieneService(persistentDomain);
    this.dataHygieneState = 'STARTING';
    queueMicrotask(() => {
      void this.dataHygiene.run()
        .then(() => { this.dataHygieneState = 'CURRENT'; })
        .catch(() => { this.dataHygieneState = 'FAILED'; });
    });
  }
  get assets() {
    return this.persistentDomain.list(RECORD_TYPES.ASSET_ACCOUNT)
      .filter((asset) => !MOCK_ASSET_ID_SET.has(asset.assetId || asset.id));
  }
  get projects() {
    return this.persistentDomain.list(RECORD_TYPES.PROJECT_ACCOUNT)
      .filter((project) => !MOCK_PROJECT_ID_SET.has(project.projectId || project.id));
  }
  get completionWatch() { return Array.isArray(this.seed.completionWatch) ? this.seed.completionWatch : []; }
  get activity() {
    const lifecycle = this.persistentDomain.list(RECORD_TYPES.LIFECYCLE_EVENT).slice(-20).reverse().map((event) => ({
      time: new Date(event.occurredAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      kind: event.eventType,
      label: event.eventType.replaceAll('_', ' '),
      project: event.objectType === 'PROJECT_ACCOUNT' ? event.objectId : event.payload?.projectId || null,
      amount: event.payload?.amount || null
    }));
    return lifecycle.length ? lifecycle : (Array.isArray(this.seed.activity) ? this.seed.activity : []);
  }
  get transactions() {
    const sources = [RECORD_TYPES.LEDGER_ENTRY, RECORD_TYPES.SRA_SETTLEMENT, RECORD_TYPES.SRA_SETTLEMENT_RECORD, RECORD_TYPES.SETTLEMENT_RAIL_INSTRUCTION, RECORD_TYPES.TREASURY_PAYMENT_ORDER, RECORD_TYPES.VERIFIED_MARKET_EVENT];
    return sources.flatMap((sourceType) => this.persistentDomain.list(sourceType).map((record, index) => normalizeTransaction(record, sourceType, index))).sort((left, right) => {
      const leftTime = left.occurredAt ? new Date(left.occurredAt).getTime() : 0;
      const rightTime = right.occurredAt ? new Date(right.occurredAt).getTime() : 0;
      return rightTime - leftTime;
    });
  }
  get transactionMarket() {
    const transactions = this.transactions;
    const completed = transactions.filter(isCompleted);
    const pending = transactions.filter(isPending);
    const verified = transactions.filter((transaction) => transaction.verified);
    const totalVolume = completed.reduce((total, transaction) => total + transaction.amount, 0);
    const verifiedVolume = verified.reduce((total, transaction) => total + transaction.amount, 0);
    const averageTransactionSize = completed.length ? totalVolume / completed.length : 0;
    const latestOccurredAt = transactions.find((transaction) => transaction.occurredAt)?.occurredAt || null;
    const volumeByKind = transactions.reduce((summary, transaction) => {
      const key = transaction.kind || 'UNCLASSIFIED';
      if (!summary[key]) summary[key] = { count: 0, volume: 0 };
      summary[key].count += 1;
      summary[key].volume += transaction.amount;
      return summary;
    }, {});
    return {
      status: transactions.length ? 'ACTIVE' : 'READY',
      transactionCount: transactions.length,
      completedTransactionCount: completed.length,
      pendingTransactionCount: pending.length,
      verifiedTransactionCount: verified.length,
      totalVolume,
      verifiedVolume,
      averageTransactionSize,
      latestOccurredAt,
      volumeByKind,
      recentTransactions: transactions.slice(0, 25)
    };
  }
  get marketStatus() { return 'LIVE'; }
  get verifiedValue() { return this.assets.reduce((total, asset) => total + number(asset.verifiedValue ?? asset.value), 0); }
  get projectedMarketplaceGain() { return this.projects.reduce((total, project) => total + number(project.projectedGain), 0); }
  get activeProjects() { return this.projects.filter((project) => project.status !== 'CLOSED').length; }
  get participatingAssets() { return this.assets.length; }
  get openPositions() { return this.persistentDomain.list(RECORD_TYPES.PARTICIPATION_POSITION).filter((position) => !['CLOSED', 'SETTLED', 'DISCHARGED'].includes(position.state)).length; }
  get completionCandidates() { return this.projects.filter((project) => ['WATCH', 'ELIGIBLE', 'PENDING'].includes(project.completionState)).length; }
  get instrumentsActive() { return this.projects.filter((project) => project.trueBill && project.trueBill.state !== 'CLOSED').length; }
  get completionNeed() { return this.completionWatch.reduce((total, item) => total + number(item.gap), 0); }
  get completionReturn() { return this.completionWatch.reduce((total, item) => total + number(item.platformReturn), 0); }
  snapshot() {
    return {
      marketStatus: this.marketStatus,
      dataHygieneState: this.dataHygieneState,
      nativeSraPar: { unit: 'SRA', quoteCurrency: 'USD', parValue: 1, policy: 'FIXED_PAR' },
      verifiedValue: this.verifiedValue,
      projectedMarketplaceGain: this.projectedMarketplaceGain,
      activeProjects: this.activeProjects,
      participatingAssets: this.participatingAssets,
      openPositions: this.openPositions,
      completionCandidates: this.completionCandidates,
      instrumentsActive: this.instrumentsActive,
      completionNeed: this.completionNeed,
      completionReturn: this.completionReturn,
      transactionMarket: this.transactionMarket,
      assets: this.assets,
      projects: this.projects,
      completionWatch: this.completionWatch,
      activity: this.activity
    };
  }
}
