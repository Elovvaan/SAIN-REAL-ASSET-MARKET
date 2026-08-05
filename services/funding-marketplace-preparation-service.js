import crypto from 'node:crypto';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  SRA_INSTRUMENT: 'SRA_INSTRUMENT',
  MARKETPLACE_PREPARATION: 'FUNDING_MARKETPLACE_PREPARATION',
  MARKETPLACE_REVIEW: 'FUNDING_MARKETPLACE_PREPARATION_REVIEW',
  MARKETPLACE_LISTING: 'MARKETPLACE_LISTING',
});

const REVIEW_DECISIONS = new Set(['APPROVED_FOR_LISTING_CREATION', 'CHANGES_REQUIRED', 'REJECTED']);

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function now() {
  return new Date().toISOString();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export class FundingMarketplacePreparationService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  async initialize() {
    await this.domain.hydrate(Object.values(TYPES));
    return this.status();
  }

  status() {
    return {
      service: 'SRA Funding Engine Phase 8',
      purpose: 'MARKETPLACE_PREPARATION_AND_NON_LIVE_LISTING_CREATION',
      preparations: this.domain.list(TYPES.MARKETPLACE_PREPARATION).length,
      reviews: this.domain.list(TYPES.MARKETPLACE_REVIEW).length,
      preparedListings: this.domain.list(TYPES.MARKETPLACE_LISTING).filter((record) => record.state === 'PREPARED').length,
    };
  }

  getPreparation(preparationId) {
    return this.domain.get(TYPES.MARKETPLACE_PREPARATION, preparationId);
  }

  listPreparations(filters = {}) {
    return this.domain.list(TYPES.MARKETPLACE_PREPARATION).filter((record) => {
      if (filters.instrumentId && record.instrumentId !== filters.instrumentId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  getReview(reviewId) {
    return this.domain.get(TYPES.MARKETPLACE_REVIEW, reviewId);
  }

  assessInstrument(instrumentId) {
    const instrument = this.domain.get(TYPES.SRA_INSTRUMENT, instrumentId);
    if (!instrument) throw new Error('Issued instrument was not found.');

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
    };

    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return {
      instrumentId,
      checks,
      blockers,
      eligibleForMarketplacePreparation: blockers.length === 0,
    };
  }

  async createPreparation(instrumentId, input = {}, actorId = null) {
    const instrument = this.domain.get(TYPES.SRA_INSTRUMENT, instrumentId);
    if (!instrument) throw new Error('Issued instrument was not found.');
    const assessment = this.assessInstrument(instrumentId);
    if (!assessment.eligibleForMarketplacePreparation) {
      const error = new Error('Issued instrument is not ready for marketplace preparation.');
      error.code = 'MARKETPLACE_PREPARATION_INCOMPLETE';
      error.assessment = assessment;
      throw error;
    }

    const existing = this.domain.list(TYPES.MARKETPLACE_PREPARATION).find((record) => record.instrumentId === instrumentId && !['CLOSED', 'CANCELLED'].includes(record.status));
    if (existing) return existing;

    const preparation = {
      marketplacePreparationId: input.marketplacePreparationId || id('FMP'),
      instrumentId,
      opportunityId: instrument.opportunityId,
      issuerParticipantId: instrument.issuerParticipantId,
      instrumentFamily: instrument.instrumentFamily,
      faceValue: instrument.faceValue,
      currency: instrument.currency,
      title: input.title || `${instrument.instrumentFamily} Funding Opportunity`,
      summary: input.summary || instrument.purpose,
      listingType: input.listingType || 'SRA_INSTRUMENT_OFFERING',
      offeredQuantity: Number(input.offeredQuantity ?? 1),
      unit: input.unit || instrument.denomination?.symbol || 'POSITION',
      pricing: {
        method: input.pricing?.method || null,
        askingPrice: input.pricing?.askingPrice ?? null,
        currency: input.pricing?.currency || instrument.currency,
      },
      accessRules: {
        eligibilityRule: input.accessRules?.eligibilityRule || null,
        minimumOrder: input.accessRules?.minimumOrder ?? null,
        maximumOrder: input.accessRules?.maximumOrder ?? null,
        participantClasses: unique(input.accessRules?.participantClasses || []),
      },
      transactionRouteId: input.transactionRouteId || null,
      settlementRouteId: input.settlementRouteId || null,
      disclosures: unique(input.disclosures || []),
      restrictions: unique([...(instrument.restrictions || []), ...(input.restrictions || [])]),
      assessment,
      status: 'PREPARATION_IN_PROGRESS',
      createdBy: actorId,
      createdAt: now(),
      updatedAt: now(),
    };

    if (!Number.isFinite(preparation.offeredQuantity) || preparation.offeredQuantity <= 0) throw new Error('Offered quantity must be greater than zero.');

    await this.domain.put(TYPES.MARKETPLACE_PREPARATION, preparation.marketplacePreparationId, preparation, { actorId, eventType: 'FUNDING_MARKETPLACE_PREPARATION_CREATED' });
    await this.domain.put(TYPES.OPPORTUNITY, instrument.opportunityId, {
      ...this.domain.get(TYPES.OPPORTUNITY, instrument.opportunityId),
      fundingPhase: 'MARKETPLACE_PREPARATION',
      marketplacePreparationId: preparation.marketplacePreparationId,
      updatedAt: now(),
    }, { actorId, eventType: 'FUNDING_OPPORTUNITY_MARKETPLACE_PREPARATION_STARTED' });
    return preparation;
  }

  assessPreparation(preparationId) {
    const preparation = this.getPreparation(preparationId);
    if (!preparation) throw new Error('Marketplace preparation record was not found.');

    const checks = {
      titlePresent: Boolean(preparation.title),
      summaryPresent: Boolean(preparation.summary),
      quantityValid: Number(preparation.offeredQuantity) > 0,
      pricingMethodPresent: Boolean(preparation.pricing?.method),
      askingPriceValid: Number(preparation.pricing?.askingPrice) > 0,
      eligibilityRulePresent: Boolean(preparation.accessRules?.eligibilityRule),
      minimumOrderValid: Number(preparation.accessRules?.minimumOrder) > 0,
      transactionRouteConnected: Boolean(preparation.transactionRouteId),
      settlementRouteConnected: Boolean(preparation.settlementRouteId),
      disclosuresPresent: Array.isArray(preparation.disclosures) && preparation.disclosures.length > 0,
    };

    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return {
      marketplacePreparationId: preparationId,
      instrumentId: preparation.instrumentId,
      checks,
      blockers,
      readyForListingCreation: blockers.length === 0,
    };
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

    const review = {
      marketplaceReviewId: input.marketplaceReviewId || id('FMPR'),
      marketplacePreparationId: preparationId,
      instrumentId: preparation.instrumentId,
      opportunityId: preparation.opportunityId,
      decision: input.decision,
      rationale: input.rationale || null,
      assessment,
      status: input.decision,
      reviewedBy: actorId,
      reviewedAt: now(),
    };
    await this.domain.put(TYPES.MARKETPLACE_REVIEW, review.marketplaceReviewId, review, { actorId, eventType: 'FUNDING_MARKETPLACE_PREPARATION_REVIEWED' });
    await this.domain.put(TYPES.MARKETPLACE_PREPARATION, preparationId, {
      ...preparation,
      status: input.decision === 'APPROVED_FOR_LISTING_CREATION' ? 'APPROVED' : input.decision,
      marketplaceReviewId: review.marketplaceReviewId,
      updatedAt: now(),
    }, { actorId, eventType: 'FUNDING_MARKETPLACE_PREPARATION_UPDATED' });
    return review;
  }

  async createPreparedListing(preparationId, actorId = null) {
    const preparation = this.getPreparation(preparationId);
    if (!preparation) throw new Error('Marketplace preparation record was not found.');
    if (preparation.status !== 'APPROVED') throw new Error('Marketplace preparation must be approved before listing creation.');

    const existing = this.domain.list(TYPES.MARKETPLACE_LISTING).find((record) => record.instrumentId === preparation.instrumentId && !['CANCELLED', 'CLOSED'].includes(record.state));
    if (existing) return existing;

    const listing = {
      listingId: id('ML'),
      instrumentId: preparation.instrumentId,
      opportunityId: preparation.opportunityId,
      issuerParticipantId: preparation.issuerParticipantId,
      listingType: preparation.listingType,
      title: preparation.title,
      summary: preparation.summary,
      quantity: preparation.offeredQuantity,
      unit: preparation.unit,
      pricing: { ...preparation.pricing, state: 'CONFIGURED' },
      access: { ...preparation.accessRules, state: 'CONFIGURED' },
      transactionRouteId: preparation.transactionRouteId,
      settlementRouteId: preparation.settlementRouteId,
      disclosures: preparation.disclosures,
      restrictions: preparation.restrictions,
      readiness: {
        instrumentReviewed: true,
        pricingApproved: true,
        accessRulesApproved: true,
        transactionRouteConnected: true,
        settlementRouteConnected: true,
      },
      blockers: [],
      state: 'PREPARED',
      status: 'NOT_LIVE',
      publicationStatus: 'NOT_PUBLISHED',
      createdBy: actorId,
      createdAt: now(),
      updatedAt: now(),
      publishedAt: null,
    };

    await this.domain.put(TYPES.MARKETPLACE_LISTING, listing.listingId, listing, { actorId, eventType: 'FUNDING_MARKETPLACE_LISTING_PREPARED' });
    await this.domain.put(TYPES.MARKETPLACE_PREPARATION, preparationId, { ...preparation, status: 'LISTING_CREATED', listingId: listing.listingId, updatedAt: now() }, { actorId, eventType: 'FUNDING_MARKETPLACE_PREPARATION_COMPLETED' });

    const opportunity = this.domain.get(TYPES.OPPORTUNITY, preparation.opportunityId);
    if (opportunity) {
      await this.domain.put(TYPES.OPPORTUNITY, opportunity.opportunityId, {
        ...opportunity,
        status: 'MARKETPLACE_LISTING_PREPARED',
        fundingPhase: 'MARKETPLACE_PUBLICATION_REVIEW',
        marketplaceListingId: listing.listingId,
        updatedAt: now(),
      }, { actorId, eventType: 'FUNDING_OPPORTUNITY_MARKETPLACE_LISTING_PREPARED' });
    }

    await this.domain.lifecycle({
      objectType: TYPES.MARKETPLACE_LISTING,
      objectId: listing.listingId,
      eventType: 'FUNDING_MARKETPLACE_LISTING_PREPARED',
      actorId,
      payload: { instrumentId: listing.instrumentId, publicationStatus: listing.publicationStatus, onChainStatus: 'NOT_PROJECTED' },
    });
    return listing;
  }
}

export { TYPES as FUNDING_MARKETPLACE_PREPARATION_RECORD_TYPES };
