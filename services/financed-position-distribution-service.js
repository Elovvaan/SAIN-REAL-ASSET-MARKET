import crypto from 'node:crypto';

const POSITION_TYPE = 'FINANCED_POSITION';
const DISTRIBUTION_AUTHORIZATION_TYPE = 'POSITION_DISTRIBUTION_AUTHORIZATION';
const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const now = () => new Date().toISOString();

function amount(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be greater than zero.`);
  return Number(parsed.toFixed(8));
}

export class FinancedPositionDistributionService {
  constructor(domain) { this.domain = domain; }

  async initialize() {
    await this.domain.hydrate([POSITION_TYPE, DISTRIBUTION_AUTHORIZATION_TYPE]);
    return this.status();
  }

  status() {
    const positions = this.domain.list(POSITION_TYPE);
    const authorizations = this.domain.list(DISTRIBUTION_AUTHORIZATION_TYPE);
    return {
      service: 'SRA_FINANCED_POSITION_DISTRIBUTION',
      positions: positions.length,
      retained: positions.filter((record) => record.distributionStatus === 'RETAINED').length,
      available: positions.filter((record) => record.distributionStatus === 'AVAILABLE').length,
      activeAuthorizations: authorizations.filter((record) => record.status === 'AUTHORIZED').length,
    };
  }

  listPositions(filters = {}) {
    return this.domain.list(POSITION_TYPE).filter((record) => {
      if (filters.status && record.positionStatus !== filters.status) return false;
      if (filters.distributionStatus && record.distributionStatus !== filters.distributionStatus) return false;
      if (filters.opportunityId && record.opportunityId !== filters.opportunityId) return false;
      return true;
    });
  }

  getPosition(positionId) { return this.domain.get(POSITION_TYPE, positionId); }
  getAuthorization(authorizationId) { return this.domain.get(DISTRIBUTION_AUTHORIZATION_TYPE, authorizationId); }
  listAuthorizations(positionId) { return this.domain.list(DISTRIBUTION_AUTHORIZATION_TYPE).filter((record) => record.positionId === positionId); }

  detail(positionId) {
    const position = this.getPosition(positionId);
    if (!position) return null;
    return { position, distributionAuthorizations: this.listAuthorizations(positionId) };
  }

  assessDistributionEligibility(positionId) {
    const position = this.getPosition(positionId);
    if (!position) throw new Error('Financed position was not found.');
    const instrument = this.domain.get('SRA_INSTRUMENT', position.instrumentId);
    const checks = {
      financingFunded: Boolean(position.fundedAt) && ['ACTIVE', 'SERVICING'].includes(position.positionStatus),
      sraOwnsPosition: position.ownerId === 'SRA',
      principalPositive: Number(position.currentPrincipal) > 0,
      instrumentExists: Boolean(instrument),
      instrumentIssued: instrument?.state === 'ISSUED' && instrument?.issuanceStatus === 'ISSUED',
      transferabilityDefined: Boolean(instrument?.transferabilityStatus),
      settlementRulePresent: Boolean(instrument?.settlementRule),
      governingDocumentPresent: Boolean(instrument?.governingDocumentId),
    };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return { positionId, instrumentId: position.instrumentId, checks, blockers, eligibleForDistribution: blockers.length === 0 };
  }

  async makeAvailable(positionId, input = {}, actorId = null) {
    const position = this.getPosition(positionId);
    if (!position) throw new Error('Financed position was not found.');
    const assessment = this.assessDistributionEligibility(positionId);
    if (!assessment.eligibleForDistribution) {
      const error = new Error('Financed position is not eligible for distribution.');
      error.code = 'POSITION_DISTRIBUTION_INELIGIBLE';
      error.assessment = assessment;
      throw error;
    }
    const offeredAmount = amount(input.offeredAmount, 'offeredAmount');
    const currentPrincipal = Number(position.currentPrincipal);
    if (offeredAmount > currentPrincipal) throw new Error('Offered amount cannot exceed the current financed position.');
    const existing = this.listAuthorizations(positionId).find((record) => ['AUTHORIZED', 'IN_MARKET'].includes(record.status));
    if (existing) throw new Error('An active distribution authorization already exists for this position.');

    const timestamp = now();
    const authorizationId = id('PDA');
    const retainedAmount = Number((currentPrincipal - offeredAmount).toFixed(8));
    const authorization = {
      distributionAuthorizationId: authorizationId,
      positionId,
      opportunityId: position.opportunityId,
      financingTransactionId: position.financingTransactionId,
      instrumentId: position.instrumentId,
      originalPositionAmount: currentPrincipal,
      offeredAmount,
      retainedAmount,
      currency: position.currency,
      offeringMode: offeredAmount === currentPrincipal ? 'FULL_OFFER' : 'PARTIAL_OFFER',
      transferRestrictions: Array.isArray(input.transferRestrictions) ? input.transferRestrictions : [],
      offeringConfiguration: input.offeringConfiguration || {},
      status: 'AUTHORIZED',
      authorizedBy: actorId,
      authorizedAt: timestamp,
      consumedAt: null,
    };
    const updatedPosition = {
      ...position,
      retainedAmount,
      availableAmount: offeredAmount,
      offeredAmount: 0,
      transferredAmount: Number(position.transferredAmount || 0),
      distributionStatus: 'AVAILABLE',
      activeDistributionAuthorizationId: authorizationId,
      updatedAt: timestamp,
    };
    await this.domain.atomicPut([
      { type: DISTRIBUTION_AUTHORIZATION_TYPE, id: authorizationId, payload: authorization, actorId, eventType: 'POSITION_DISTRIBUTION_AUTHORIZED' },
      { type: POSITION_TYPE, id: positionId, payload: updatedPosition, actorId, eventType: 'FINANCED_POSITION_MADE_AVAILABLE' },
    ]);
    await this.domain.lifecycle({
      objectType: POSITION_TYPE,
      objectId: positionId,
      eventType: 'FINANCED_POSITION_MADE_AVAILABLE',
      actorId,
      payload: { distributionAuthorizationId: authorizationId, offeredAmount, retainedAmount, offeringMode: authorization.offeringMode },
    });
    return { position: updatedPosition, authorization };
  }

  async markAuthorizationInMarket(authorizationId, marketplacePreparationId, actorId = null) {
    const authorization = this.getAuthorization(authorizationId);
    if (!authorization) throw new Error('Position distribution authorization was not found.');
    if (authorization.status !== 'AUTHORIZED') throw new Error('Position distribution authorization is not available for marketplace use.');
    const position = this.getPosition(authorization.positionId);
    if (!position) throw new Error('Financed position was not found.');
    const timestamp = now();
    const updatedAuthorization = { ...authorization, status: 'IN_MARKET', marketplacePreparationId, consumedAt: timestamp };
    const updatedPosition = { ...position, offeredAmount: authorization.offeredAmount, availableAmount: 0, distributionStatus: 'IN_MARKET', marketplacePreparationId, updatedAt: timestamp };
    await this.domain.atomicPut([
      { type: DISTRIBUTION_AUTHORIZATION_TYPE, id: authorizationId, payload: updatedAuthorization, actorId, eventType: 'POSITION_DISTRIBUTION_ENTERED_MARKET' },
      { type: POSITION_TYPE, id: position.positionId, payload: updatedPosition, actorId, eventType: 'FINANCED_POSITION_ENTERED_MARKET' },
    ]);
    return { position: updatedPosition, authorization: updatedAuthorization };
  }
}

export { POSITION_TYPE as FINANCED_POSITION_RECORD_TYPE, DISTRIBUTION_AUTHORIZATION_TYPE as POSITION_DISTRIBUTION_AUTHORIZATION_RECORD_TYPE };