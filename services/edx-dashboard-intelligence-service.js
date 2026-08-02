import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

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

function sortNewest(records, field) {
  return [...records].sort((a, b) => new Date(b[field] || 0) - new Date(a[field] || 0));
}

function latest(records, field) {
  return sortNewest(records, field)[0] || null;
}

function percentChange(current, previous) {
  const a = Number(current) || 0;
  const b = Number(previous) || 0;
  if (!b) return a ? 100 : 0;
  return Number((((a - b) / Math.abs(b)) * 100).toFixed(2));
}

function healthScore(snapshot, valuePackage, connections, policies) {
  if (!snapshot) return 0;
  const verification = Number(snapshot.verificationScore) || 0;
  const coverage = Number(snapshot.coveragePercent) || 0;
  const connectionScore = connections.some((record) => record.state === 'ACTIVE') ? 100 : connections.some((record) => ['CONNECTED', 'DEGRADED'].includes(record.state)) ? 70 : 25;
  const policyScore = policies.some((record) => record.state === 'ACTIVE') ? 100 : policies.length ? 50 : 0;
  const packageScore = valuePackage && ['ACTIVE', 'PUBLISHED'].includes(valuePackage.state) ? 100 : valuePackage ? 60 : 0;
  return Math.round((verification * 0.35) + (coverage * 0.25) + (connectionScore * 0.15) + (policyScore * 0.1) + (packageScore * 0.15));
}

function businessHealth(score) {
  if (score >= 85) return 'STRONG';
  if (score >= 70) return 'STABLE';
  if (score >= 50) return 'WATCH';
  return 'LIMITED_DATA';
}

function trendLabel(value) {
  if (value > 5) return 'RISING';
  if (value < -5) return 'DECLINING';
  return 'STABLE';
}

function marketplaceStatus(valuePackage, projection, pendingDecision) {
  if (projection?.state === 'ACTIVE') return 'PUBLISHED';
  if (pendingDecision?.choice === 'PUBLISH_TODAY') return pendingDecision.state || 'PENDING_APPROVAL';
  if (valuePackage?.state === 'ACTIVE') return 'PACKAGE_READY';
  return 'PRIVATE';
}

export class EdxDashboardIntelligenceService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  enterpriseRecords(type, enterpriseId) {
    return this.domain.list(type).filter((record) => record.enterpriseId === enterpriseId);
  }

  latestSnapshot(enterpriseId) {
    return latest(this.enterpriseRecords(RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, enterpriseId).filter((record) => ['COMPLETE', 'SUPERSEDED'].includes(record.state)), 'generatedAt');
  }

  latestValuePackage(enterpriseId) {
    return latest(this.enterpriseRecords(RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE, enterpriseId).filter((record) => ['ACTIVE', 'PUBLISHED', 'SUPERSEDED'].includes(record.state)), 'createdAt');
  }

  dashboard(enterpriseId) {
    requiredString(enterpriseId, 'enterpriseId');
    const snapshots = sortNewest(this.enterpriseRecords(RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, enterpriseId).filter((record) => ['COMPLETE', 'SUPERSEDED'].includes(record.state)), 'generatedAt');
    const snapshot = snapshots[0] || null;
    const previous = snapshots[1] || null;
    const valuePackage = this.latestValuePackage(enterpriseId);
    const connections = this.enterpriseRecords(RECORD_TYPES.EDX_ENTERPRISE_CONNECTION, enterpriseId);
    const policies = this.enterpriseRecords(RECORD_TYPES.EDX_EXTRACTION_POLICY, enterpriseId);
    const projections = sortNewest(this.enterpriseRecords(RECORD_TYPES.EDX_MARKETPLACE_PROJECTION, enterpriseId), 'createdAt');
    const projection = projections.find((record) => record.state === 'ACTIVE') || null;
    const decisions = sortNewest(this.enterpriseRecords(RECORD_TYPES.EDX_PUBLICATION_DECISION, enterpriseId), 'createdAt');
    const pendingDecision = decisions.find((record) => !['EXECUTED', 'DECLINED', 'CANCELLED'].includes(record.state)) || null;
    const score = healthScore(snapshot, valuePackage, connections, policies);
    const metrics = snapshot?.metrics || {};
    const previousMetrics = previous?.metrics || {};
    const contractRecords = this.enterpriseRecords(RECORD_TYPES.EDX_NORMALIZED_RECORD, enterpriseId).filter((record) => ['ACTIVE_CONTRACT_VALUE', 'COMPLETED_CONTRACT_VALUE'].includes(record.category));
    const contracts = contractRecords.reduce((total, record) => total + (Number(record.value) || 0), 0);
    const readyToPublish = Boolean(valuePackage && valuePackage.state === 'ACTIVE' && ['MARKETPLACE', 'PUBLIC'].includes(valuePackage.visibility) && !projection);

    return {
      enterpriseId,
      generatedAt: now(),
      snapshotId: snapshot?.snapshotId || null,
      valuePackageId: valuePackage?.valuePackageId || null,
      businessHealth: {
        score,
        status: businessHealth(score),
        verificationScore: snapshot?.verificationScore || 0,
        coveragePercent: snapshot?.coveragePercent || 0,
        activeConnections: connections.filter((record) => record.state === 'ACTIVE').length,
        activePolicies: policies.filter((record) => record.state === 'ACTIVE').length
      },
      metrics: {
        revenue: metrics.revenue || 0,
        revenueChangePercent: percentChange(metrics.revenue, previousMetrics.revenue),
        growthPercent: metrics.growthPercent || 0,
        inventory: metrics.inventory || 0,
        inventoryChangePercent: percentChange(metrics.inventory, previousMetrics.inventory),
        production: metrics.production || 0,
        productionChangePercent: percentChange(metrics.production, previousMetrics.production),
        contracts,
        cash: metrics.cashPosition || 0,
        cashChangePercent: percentChange(metrics.cashPosition, previousMetrics.cashPosition),
        verifiedValue: metrics.verifiedValue || 0,
        verifiedValueChangePercent: percentChange(metrics.verifiedValue, previousMetrics.verifiedValue)
      },
      marketplace: {
        status: marketplaceStatus(valuePackage, projection, pendingDecision),
        readyToPublish,
        projectionId: projection?.projectionId || null,
        publicationDecisionId: pendingDecision?.publicationDecisionId || null,
        packageVisibility: valuePackage?.visibility || 'PRIVATE',
        automaticPublication: false,
        companyApprovalRequired: true
      }
    };
  }

  analyze(enterpriseId) {
    requiredString(enterpriseId, 'enterpriseId');
    const dashboard = this.dashboard(enterpriseId);
    const snapshots = sortNewest(this.enterpriseRecords(RECORD_TYPES.EDX_VERIFIED_SNAPSHOT, enterpriseId).filter((record) => ['COMPLETE', 'SUPERSEDED'].includes(record.state)), 'generatedAt');
    const latestSnapshot = snapshots[0] || null;
    const previousSnapshot = snapshots[1] || null;
    const normalized = this.enterpriseRecords(RECORD_TYPES.EDX_NORMALIZED_RECORD, enterpriseId);
    const activePolicies = this.enterpriseRecords(RECORD_TYPES.EDX_EXTRACTION_POLICY, enterpriseId).filter((record) => record.state === 'ACTIVE');
    const authorizedCategories = new Set(activePolicies.map((record) => record.recordCategory));
    const authorizedRecords = normalized.filter((record) => authorizedCategories.has(record.category));

    const inventoryMovement = authorizedRecords.filter((record) => record.category === 'INVENTORY_MOVEMENT').reduce((total, record) => total + Math.abs(Number(record.value) || 0), 0);
    const inventoryValue = Number(latestSnapshot?.metrics?.inventory) || 0;
    const inventoryVelocity = inventoryValue ? Number((inventoryMovement / inventoryValue).toFixed(4)) : 0;
    const activeContracts = authorizedRecords.filter((record) => record.category === 'ACTIVE_CONTRACT_VALUE').reduce((total, record) => total + (Number(record.value) || 0), 0);
    const completedContracts = authorizedRecords.filter((record) => record.category === 'COMPLETED_CONTRACT_VALUE').reduce((total, record) => total + (Number(record.value) || 0), 0);
    const contractCompletionPercent = activeContracts + completedContracts ? Number(((completedContracts / (activeContracts + completedContracts)) * 100).toFixed(2)) : 0;
    const production = Number(latestSnapshot?.metrics?.production) || 0;
    const assets = Number(latestSnapshot?.metrics?.assets) || 0;
    const assetUtilization = assets ? Number((production / assets).toFixed(4)) : 0;
    const liquidityTrend = percentChange(latestSnapshot?.metrics?.cashPosition, previousSnapshot?.metrics?.cashPosition);
    const operationalTrend = percentChange(latestSnapshot?.metrics?.revenue, previousSnapshot?.metrics?.revenue);

    const insights = [
      { type: 'OPERATIONAL_TREND', value: operationalTrend, direction: trendLabel(operationalTrend), authorized: authorizedCategories.has('DAILY_NET_REVENUE') || authorizedCategories.has('DAILY_GROSS_REVENUE') },
      { type: 'LIQUIDITY_TREND', value: liquidityTrend, direction: trendLabel(liquidityTrend), authorized: authorizedCategories.has('CASH_POSITION') || authorizedCategories.has('BANK_SETTLEMENT_SUMMARY') },
      { type: 'INVENTORY_VELOCITY', value: inventoryVelocity, direction: trendLabel(inventoryVelocity), authorized: authorizedCategories.has('INVENTORY_VALUE') || authorizedCategories.has('INVENTORY_MOVEMENT') },
      { type: 'CONTRACT_COMPLETION', value: contractCompletionPercent, direction: trendLabel(contractCompletionPercent), authorized: authorizedCategories.has('ACTIVE_CONTRACT_VALUE') || authorizedCategories.has('COMPLETED_CONTRACT_VALUE') },
      { type: 'ASSET_UTILIZATION', value: assetUtilization, direction: trendLabel(assetUtilization), authorized: authorizedCategories.has('ASSET_ADDITION') || authorizedCategories.has('PRODUCTION_OUTPUT') },
      { type: 'MARKETPLACE_READINESS', value: dashboard.marketplace.readyToPublish ? 100 : 0, direction: dashboard.marketplace.readyToPublish ? 'READY' : 'NOT_READY', authorized: true }
    ].filter((insight) => insight.authorized).map(({ authorized, ...insight }) => insight);

    return {
      enterpriseId,
      generatedAt: now(),
      permissionModel: 'ENTERPRISE_SCOPED_ACTIVE_POLICIES_ONLY',
      crossEnterprisePrivateDataUsed: false,
      authorizedCategories: [...authorizedCategories],
      sourceSnapshotIds: snapshots.slice(0, 2).map((record) => record.snapshotId),
      insights
    };
  }

  listReports(filters = {}) {
    return this.domain.list(RECORD_TYPES.EDX_INTELLIGENCE_REPORT).filter((record) => {
      if (filters.enterpriseId && record.enterpriseId !== filters.enterpriseId) return false;
      return true;
    }).sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
  }

  getReport(intelligenceReportId) {
    return this.domain.get(RECORD_TYPES.EDX_INTELLIGENCE_REPORT, intelligenceReportId);
  }

  async generateReport(enterpriseId, actorId = null) {
    const analysis = this.analyze(enterpriseId);
    const intelligenceReportId = id('EDX-MI');
    const report = {
      intelligenceReportId,
      ...analysis,
      state: 'COMPLETE',
      generatedBy: actorId,
      frozen: true
    };
    await this.domain.put(RECORD_TYPES.EDX_INTELLIGENCE_REPORT, intelligenceReportId, report, { actorId, eventType: 'EDX_INTELLIGENCE_REPORT_CREATED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_INTELLIGENCE_REPORT, objectId: intelligenceReportId, eventType: 'EDX_INTELLIGENCE_REPORT_CREATED', actorId, payload: { enterpriseId, insightCount: report.insights.length } });
    return report;
  }
}
