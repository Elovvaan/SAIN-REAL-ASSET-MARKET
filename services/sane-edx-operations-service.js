import { RECORD_TYPES } from './persistent-domain-service.js';

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function formatNumber(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(number);
}

export class SaneEdxOperationsService {
  constructor(persistentDomain, publisherService) {
    this.domain = persistentDomain;
    this.publisherService = publisherService;
  }

  latestReadyPackage(enterpriseId) {
    return this.domain.list(RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE)
      .filter((record) => record.enterpriseId === enterpriseId && record.state === 'ACTIVE')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  }

  preparePublicationPrompt(enterpriseId) {
    const packageRecord = this.latestReadyPackage(enterpriseId);
    if (!packageRecord) {
      return {
        enterpriseId,
        ready: false,
        reply: 'No active Verified Value Package is ready for publication review.',
        actions: []
      };
    }

    const metrics = packageRecord.metrics || {};
    const verifiedParts = [];
    if (metrics.revenue != null) verifiedParts.push(`revenue ${formatNumber(metrics.revenue)}`);
    if (metrics.inventory != null) verifiedParts.push(`inventory ${formatNumber(metrics.inventory)}`);
    if (metrics.production != null) verifiedParts.push(`production ${formatNumber(metrics.production)}`);
    if (metrics.verifiedValue != null) verifiedParts.push(`Verified Value ${formatNumber(metrics.verifiedValue)}`);

    return {
      enterpriseId,
      ready: true,
      valuePackageId: packageRecord.valuePackageId,
      snapshotId: packageRecord.snapshotId,
      verificationStatus: packageRecord.verificationStatus,
      coveragePercent: packageRecord.coveragePercent,
      metrics: packageRecord.metrics,
      reply: `Today's operating records have closed. ${verifiedParts.join(', ')} have been prepared in Verified Value Package v${packageRecord.version}. Would you like to publish it to the marketplace or keep it private?`,
      actions: [
        {
          id: 'PUBLISH_TODAY',
          label: 'Publish Today',
          requiresCompanyApproval: true,
          nextAction: 'CREATE_PUBLICATION_DECISION'
        },
        {
          id: 'KEEP_PRIVATE',
          label: 'Keep Private',
          requiresCompanyApproval: false,
          nextAction: 'CREATE_PRIVATE_DECISION'
        }
      ]
    };
  }

  async recordChoice(input, actorId = null) {
    const enterpriseId = requiredString(input.enterpriseId, 'enterpriseId');
    const choice = requiredString(input.choice, 'choice').toUpperCase();
    const valuePackageId = input.valuePackageId || this.latestReadyPackage(enterpriseId)?.valuePackageId;
    if (!valuePackageId) throw new Error('No active Verified Value Package is ready.');
    if (!['PUBLISH_TODAY', 'KEEP_PRIVATE'].includes(choice)) throw new Error('choice must be PUBLISH_TODAY or KEEP_PRIVATE.');

    const decision = await this.publisherService.createDecision({
      valuePackageId,
      decision: choice,
      reason: input.reason || null
    }, actorId);

    if (choice === 'KEEP_PRIVATE') {
      return {
        decision,
        reply: 'The Verified Value Package remains private. Nothing was published.'
      };
    }

    return {
      decision,
      reply: 'The publication request is prepared. Company approval is still required before anything leaves the platform.',
      requiresCompanyApproval: true,
      approvalEndpoint: `/api/edx/publication-decisions/${decision.publicationDecisionId}/approve`,
      executionEndpoint: `/api/edx/publication-decisions/${decision.publicationDecisionId}/execute`
    };
  }
}
