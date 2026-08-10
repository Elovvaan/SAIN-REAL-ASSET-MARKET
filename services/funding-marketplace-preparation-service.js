import crypto from 'node:crypto';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  SRA_INSTRUMENT: 'SRA_INSTRUMENT',
  FINANCED_POSITION: 'FINANCED_POSITION',
  DISTRIBUTION_AUTHORIZATION: 'POSITION_DISTRIBUTION_AUTHORIZATION',
  MARKETPLACE_PREPARATION: 'FUNDING_MARKETPLACE_PREPARATION',
  MARKETPLACE_REVIEW: 'FUNDING_MARKETPLACE_PREPARATION_REVIEW',
  MARKETPLACE_LISTING: 'MARKETPLACE_LISTING',
});

const REVIEW_DECISIONS = new Set(['APPROVED_FOR_LISTING_CREATION', 'CHANGES_REQUIRED', 'REJECTED']);
const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const now = () => new Date().toISOString();
const unique = (values = []) => [...new Set(values.filter(Boolean))];

export class FundingMarketplacePreparationService {
  constructor(persistentDomain) { this.domain = persistentDomain; }

  async initialize() { await this.domain.hydrate(Object.values(TYPES)); return this.status(); }

  status() {
    return {
      service: 'SRA Funding Engine Phase 8',
      purpose: 'FUNDED_POSITION_MARKETPLACE_PREPARATION',
      preparations: this.domain.list(TYPES.MARKETPLACE_PREPARATION).length,
      reviews: this.domain.list(TYPES.MARKETPLACE_REVIEW).length,
      preparedListings: this.domain.list(TYPES.MARKETPLACE_LISTING).filter((record) => record.state === 'PREPARED').length,
      fundedPositions: this.domain.list(TYPES.FINANCED_POSITION).length,
    };
  }

  getPreparation(preparationId) { return this.domain.get(TYPES.MARKETPLACE_PREPARATION, preparationId); }
  getReview(reviewId) { return this.domain.get(TYPES.MARKETPLACE_REVIEW, reviewId); }
  listPreparations(filters = {}) {
    return this.domain.list(TYPES.MARKETPLACE_PREPARATION).filter((record) => {
      if (filters.instrumentId && record.instrumentId !== filters.instrumentId) return false;
      if (filters.positionId && record.positionId !== filters.positionId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  assessInstrument(instrumentId) {
    const instrument = this.domain.get(TYPES.SRA_INSTRUMENT, instrumentId);
    if (!instrument) throw new Error('Issued instrument was not found.');
    const fundedPositions = this.domain.list(TYPES.FINANCED_POSITION).filter((record) => record.instrumentId === instrumentId && ['ACTIVE','SERVICING'].includes(record.positionStatus));
    const checks = {
      instrumentIssued: instrument.state === 'ISSUED',
      issuanceStatusIssued: instrument.issuanceStatus === 'ISSUED',
      issuanceTransactionLinked: Boolean(instrument.issuanceTransactionId),
      issuerPresent: Boolean(instrument.issuerParticipantId),
      faceValueValid: Number(instrument.faceValue) > 0,
      currencyPresent: Boolean(instrument.currency),
      purposePresent: Boolean(instrument.purpose),
      transferabilityDefined: Boolean(instrument.transferabilityStatus),
      settlementRulePresent: Boolean(instrument.settlementRule),
      governingDocumentPresent: Boolean(instrument.governingDocumentId),
      fundedPositionExists: fundedPositions.length > 0,
    };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return { instrumentId, checks, blockers, fundedPositionIds: fundedPositions.map((record) => record.positionId), eligibleForMarketplacePreparation: false, note: 'Instrument issuance alone does not authorize marketplace preparation. A funded position and distribution authorization are required.' };
  }

  assessPosition(positionId, distributionAuthorizationId) {
    const position = this.domain.get(TYPES.FINANCED_POSITION, positionId);
    if (!position) throw new Error('Financed position was not found.');
    const authorization = distributionAuthorizationId ? this.domain.get(TYPES.DISTRIBUTION_AUTHORIZATION, distributionAuthorizationId) : null;
    const instrument = this.domain.get(TYPES.SRA_INSTRUMENT, position.instrumentId);
    const checks = {
      financingFunded: Boolean(position.fundedAt) && ['ACTIVE','SERVICING'].includes(position.positionStatus),
      sraOwnsPosition: position.ownerId === 'SRA',
      distributionAvailable: position.distributionStatus === 'AVAILABLE' && Number(position.availableAmount) > 0,
      authorizationPresent: Boolean(authorization),
      authorizationMatchesPosition: authorization?.positionId === positionId,
      authorizationActive: authorization?.status === 'AUTHORIZED',
      authorizedAmountValid: Number(authorization?.offeredAmount) > 0 && Number(authorization?.offeredAmount) <= Number(position.currentPrincipal),
      instrumentIssued: instrument?.state === 'ISSUED' && instrument?.issuanceStatus === 'ISSUED',
      transferabilityDefined: Boolean(instrument?.transferabilityStatus),
      settlementRulePresent: Boolean(instrument?.settlementRule),
      governingDocumentPresent: Boolean(instrument?.governingDocumentId),
    };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return { positionId, instrumentId: position.instrumentId, distributionAuthorizationId: distributionAuthorizationId || null, checks, blockers, eligibleForMarketplacePreparation: blockers.length === 0 };
  }

  async createPreparation(positionId, input = {}, actorId = null) {
    const position = this.domain.get(TYPES.FINANCED_POSITION, positionId);
    if (!position) throw new Error('Financed position was not found.');
    const distributionAuthorizationId = String(input.distributionAuthorizationId || '').trim();
    if (!distributionAuthorizationId) throw new Error('distributionAuthorizationId is required.');
    const assessment = this.assessPosition(positionId, distributionAuthorizationId);
    if (!assessment.eligibleForMarketplacePreparation) {
      const error = new Error('Funded position is not ready for marketplace preparation.');
      error.code = 'MARKETPLACE_PREPARATION_INCOMPLETE';
      error.assessment = assessment;
      throw error;
    }
    const instrument = this.domain.get(TYPES.SRA_INSTRUMENT, position.instrumentId);
    const authorization = this.domain.get(TYPES.DISTRIBUTION_AUTHORIZATION, distributionAuthorizationId);
    const existing = this.domain.list(TYPES.MARKETPLACE_PREPARATION).find((record) => record.positionId === positionId && !['CLOSED','CANCELLED'].includes(record.status));
    if (existing) return existing;
    const timestamp = now();
    const preparationId = input.marketplacePreparationId || id('FMP');
    const preparation = {
      marketplacePreparationId: preparationId,
      positionId,
      distributionAuthorizationId,
      instrumentId: position.instrumentId,
      opportunityId: position.opportunityId,
      issuerParticipantId: instrument.issuerParticipantId,
      instrumentFamily: instrument.instrumentFamily,
      originalPositionAmount: position.currentPrincipal,
      authorizedOfferedAmount: authorization.offeredAmount,
      retainedAmount: authorization.retainedAmount,
      currency: position.currency,
      title: input.title || `${instrument.instrumentFamily} Financed Position`,
      summary: input.summary || instrument.purpose,
      listingType: input.listingType || 'FINANCED_POSITION_OFFERING',
      offeredQuantity: Number(input.offeredQuantity ?? authorization.offeredAmount),
      unit: input.unit || position.currency || instrument.denomination?.symbol || 'POSITION',
      pricing: { method: input.pricing?.method || null, askingPrice: input.pricing?.askingPrice ?? null, currency: input.pricing?.currency || position.currency },
      accessRules: { eligibilityRule: input.accessRules?.eligibilityRule || null, minimumOrder: input.accessRules?.minimumOrder ?? null, maximumOrder: input.accessRules?.maximumOrder ?? null, participantClasses: unique(input.accessRules?.participantClasses || []) },
      transactionRouteId: input.transactionRouteId || null,
      settlementRouteId: input.settlementRouteId || null,
      disclosures: unique(input.disclosures || []),
      restrictions: unique([...(instrument.restrictions || []), ...(authorization.transferRestrictions || []), ...(input.restrictions || [])]),
      assessment,
      status: 'PREPARATION_IN_PROGRESS',
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (!Number.isFinite(preparation.offeredQuantity) || preparation.offeredQuantity <= 0 || preparation.offeredQuantity > Number(authorization.offeredAmount)) throw new Error('Offered quantity must be greater than zero and cannot exceed the authorized position amount.');
    const updatedAuthorization = { ...authorization, status: 'IN_MARKET', marketplacePreparationId: preparationId, consumedAt: timestamp };
    const updatedPosition = { ...position, distributionStatus: 'IN_MARKET', offeredAmount: authorization.offeredAmount, availableAmount: 0, marketplacePreparationId: preparationId, updatedAt: timestamp };
    await this.domain.atomicPut([
      { type: TYPES.MARKETPLACE_PREPARATION, id: preparationId, payload: preparation, actorId, eventType: 'FUNDING_MARKETPLACE_PREPARATION_CREATED' },
      { type: TYPES.DISTRIBUTION_AUTHORIZATION, id: distributionAuthorizationId, payload: updatedAuthorization, actorId, eventType: 'POSITION_DISTRIBUTION_ENTERED_MARKET' },
      { type: TYPES.FINANCED_POSITION, id: positionId, payload: updatedPosition, actorId, eventType: 'FINANCED_POSITION_ENTERED_MARKET' },
    ]);
    return preparation;
  }

  assessPreparation(preparationId) {
    const preparation = this.getPreparation(preparationId);
    if (!preparation) throw new Error('Marketplace preparation record was not found.');
    const checks = {
      fundedPositionLinked: Boolean(preparation.positionId),
      distributionAuthorizationLinked: Boolean(preparation.distributionAuthorizationId),
      titlePresent: Boolean(preparation.title),
      summaryPresent: Boolean(preparation.summary),
      quantityValid: Number(preparation.offeredQuantity) > 0 && Number(preparation.offeredQuantity) <= Number(preparation.authorizedOfferedAmount),
      pricingMethodPresent: Boolean(preparation.pricing?.method),
      askingPriceValid: Number(preparation.pricing?.askingPrice) > 0,
      eligibilityRulePresent: Boolean(preparation.accessRules?.eligibilityRule),
      minimumOrderValid: Number(preparation.accessRules?.minimumOrder) > 0,
      transactionRouteConnected: Boolean(preparation.transactionRouteId),
      settlementRouteConnected: Boolean(preparation.settlementRouteId),
      disclosuresPresent: Array.isArray(preparation.disclosures) && preparation.disclosures.length > 0,
    };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return { marketplacePreparationId: preparationId, positionId: preparation.positionId, instrumentId: preparation.instrumentId, checks, blockers, readyForListingCreation: blockers.length === 0 };
  }

  async review(preparationId, input, actorId = null) {
    const preparation = this.getPreparation(preparationId);
    if (!preparation) throw new Error('Marketplace preparation record was not found.');
    if (!REVIEW_DECISIONS.has(input?.decision)) throw new Error(`Unsupported marketplace preparation decision: ${input?.decision}`);
    const assessment = this.assessPreparation(preparationId);
    if (input.decision === 'APPROVED_FOR_LISTING_CREATION' && !assessment.readyForListingCreation) {
      const error = new Error('Marketplace preparation is not ready for listing creation.');
      error.code = 'MARKETPLACE_PREPARATION_INCOMPLETE';
      error.assessment = assessment;
      throw error;
    }
    const review = { marketplaceReviewId: input.marketplaceReviewId || id('FMPR'), marketplacePreparationId: preparationId, positionId: preparation.positionId, instrumentId: preparation.instrumentId, opportunityId: preparation.opportunityId, decision: input.decision, rationale: input.rationale || null, assessment, status: input.decision, reviewedBy: actorId, reviewedAt: now() };
    await this.domain.put(TYPES.MARKETPLACE_REVIEW, review.marketplaceReviewId, review, { actorId, eventType: 'FUNDING_MARKETPLACE_PREPARATION_REVIEWED' });
    await this.domain.put(TYPES.MARKETPLACE_PREPARATION, preparationId, { ...preparation, status: input.decision === 'APPROVED_FOR_LISTING_CREATION' ? 'APPROVED' : input.decision, marketplaceReviewId: review.marketplaceReviewId, updatedAt: now() }, { actorId, eventType: 'FUNDING_MARKETPLACE_PREPARATION_UPDATED' });
    return review;
  }

  async createPreparedListing(preparationId, actorId = null) {
    const preparation = this.getPreparation(preparationId);
    if (!preparation) throw new Error('Marketplace preparation record was not found.');
    if (preparation.status !== 'APPROVED') throw new Error('Marketplace preparation must be approved before listing creation.');
    const existing = this.domain.list(TYPES.MARKETPLACE_LISTING).find((record) => record.positionId === preparation.positionId && !['CANCELLED','CLOSED'].includes(record.state));
    if (existing) return existing;
    const listing = {
      listingId: id('ML'), positionId: preparation.positionId, distributionAuthorizationId: preparation.distributionAuthorizationId,
      instrumentId: preparation.instrumentId, opportunityId: preparation.opportunityId, issuerParticipantId: preparation.issuerParticipantId,
      listingType: preparation.listingType, title: preparation.title, summary: preparation.summary, quantity: preparation.offeredQuantity, unit: preparation.unit,
      pricing: { ...preparation.pricing, state: 'CONFIGURED' }, access: { ...preparation.accessRules, state: 'CONFIGURED' }, transactionRouteId: preparation.transactionRouteId, settlementRouteId: preparation.settlementRouteId,
      disclosures: preparation.disclosures, restrictions: preparation.restrictions,
      readiness: { fundedPositionConfirmed: true, distributionAuthorized: true, instrumentReviewed: true, pricingApproved: true, accessRulesApproved: true, transactionRouteConnected: true, settlementRouteConnected: true }, blockers: [],
      state: 'PREPARED', status: 'NOT_LIVE', publicationStatus: 'NOT_PUBLISHED', createdBy: actorId, createdAt: now(), updatedAt: now(), publishedAt: null,
    };
    await this.domain.put(TYPES.MARKETPLACE_LISTING, listing.listingId, listing, { actorId, eventType: 'FUNDING_MARKETPLACE_LISTING_PREPARED' });
    await this.domain.put(TYPES.MARKETPLACE_PREPARATION, preparationId, { ...preparation, status: 'LISTING_CREATED', listingId: listing.listingId, updatedAt: now() }, { actorId, eventType: 'FUNDING_MARKETPLACE_PREPARATION_COMPLETED' });
    await this.domain.lifecycle({ objectType: TYPES.MARKETPLACE_LISTING, objectId: listing.listingId, eventType: 'FUNDED_POSITION_MARKETPLACE_LISTING_PREPARED', actorId, payload: { positionId: listing.positionId, instrumentId: listing.instrumentId, distributionAuthorizationId: listing.distributionAuthorizationId, publicationStatus: listing.publicationStatus, onChainStatus: 'NOT_PROJECTED' } });
    return listing;
  }
}

export { TYPES as FUNDING_MARKETPLACE_PREPARATION_RECORD_TYPES };