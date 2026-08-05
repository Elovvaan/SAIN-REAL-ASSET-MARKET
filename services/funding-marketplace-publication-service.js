import crypto from 'node:crypto';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY', SRA_INSTRUMENT: 'SRA_INSTRUMENT', MARKETPLACE_LISTING: 'MARKETPLACE_LISTING',
  PUBLICATION_REVIEW: 'FUNDING_MARKETPLACE_PUBLICATION_REVIEW', PUBLICATION_AUTHORIZATION: 'FUNDING_MARKETPLACE_PUBLICATION_AUTHORIZATION',
  LIFECYCLE_EVENT: 'LIFECYCLE_EVENT',
});
const DECISIONS = new Set(['AUTHORIZED_FOR_PUBLICATION', 'CHANGES_REQUIRED', 'REJECTED']);
const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const now = () => new Date().toISOString();

export class FundingMarketplacePublicationService {
  constructor(persistentDomain) { this.domain = persistentDomain; }
  async initialize() { await this.domain.hydrate(Object.values(TYPES)); return this.status(); }
  status() { return { service: 'SRA Funding Engine Phase 9', purpose: 'MARKETPLACE_PUBLICATION_AND_LIVE_ACTIVATION', publicationReviews: this.domain.list(TYPES.PUBLICATION_REVIEW).length, publicationAuthorizations: this.domain.list(TYPES.PUBLICATION_AUTHORIZATION).length, liveListings: this.domain.list(TYPES.MARKETPLACE_LISTING).filter((r) => r.state === 'LIVE' && r.publicationStatus === 'PUBLISHED').length }; }
  getListing(listingId) { return this.domain.get(TYPES.MARKETPLACE_LISTING, listingId); }
  getReview(reviewId) { return this.domain.get(TYPES.PUBLICATION_REVIEW, reviewId); }
  listReviews(filters = {}) { return this.domain.list(TYPES.PUBLICATION_REVIEW).filter((r) => (!filters.listingId || r.listingId === filters.listingId) && (!filters.status || r.status === filters.status)); }
  listAuthorizations(filters = {}) { return this.domain.list(TYPES.PUBLICATION_AUTHORIZATION).filter((r) => (!filters.listingId || r.listingId === filters.listingId) && (!filters.status || r.status === filters.status)); }

  assessListing(listingId) {
    const listing = this.getListing(listingId); if (!listing) throw new Error('Marketplace listing was not found.');
    const instrument = this.domain.get(TYPES.SRA_INSTRUMENT, listing.instrumentId); if (!instrument) throw new Error('Issued instrument was not found.');
    const checks = { listingPrepared: listing.state === 'PREPARED', listingNotLive: listing.status === 'NOT_LIVE', notPublished: listing.publicationStatus === 'NOT_PUBLISHED', instrumentIssued: instrument.state === 'ISSUED' && instrument.issuanceStatus === 'ISSUED', priceConfigured: listing.pricing?.state === 'CONFIGURED' && Number(listing.pricing?.askingPrice) > 0, accessConfigured: listing.access?.state === 'CONFIGURED' && Boolean(listing.access?.eligibilityRule), quantityValid: Number(listing.quantity) > 0, transactionRouteConnected: Boolean(listing.transactionRouteId), settlementRouteConnected: Boolean(listing.settlementRouteId), disclosuresPresent: Array.isArray(listing.disclosures) && listing.disclosures.length > 0, noBlockers: Array.isArray(listing.blockers) && listing.blockers.length === 0 };
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return { listingId, instrumentId: listing.instrumentId, checks, blockers, readyForPublicationAuthorization: blockers.length === 0 };
  }

  async startReview(listingId, input = {}, actorId = null) {
    const listing = this.getListing(listingId); if (!listing) throw new Error('Marketplace listing was not found.');
    const existing = this.domain.list(TYPES.PUBLICATION_REVIEW).find((r) => r.listingId === listingId && r.status === 'IN_REVIEW'); if (existing) return existing;
    const timestamp = now();
    const review = { publicationReviewId: input.publicationReviewId || id('FMPRV'), listingId, instrumentId: listing.instrumentId, opportunityId: listing.opportunityId, assessment: this.assessListing(listingId), status: 'IN_REVIEW', startedBy: actorId, startedAt: timestamp, decision: null, rationale: null, decidedBy: null, decidedAt: null };
    await this.domain.atomicPut([
      { type: TYPES.PUBLICATION_REVIEW, id: review.publicationReviewId, payload: review, actorId, eventType: 'FUNDING_MARKETPLACE_PUBLICATION_REVIEW_STARTED' },
      { type: TYPES.MARKETPLACE_LISTING, id: listingId, payload: { ...listing, status: 'PUBLICATION_REVIEW', publicationReviewId: review.publicationReviewId, updatedAt: timestamp }, actorId, eventType: 'FUNDING_MARKETPLACE_LISTING_PUBLICATION_REVIEW_STARTED' },
    ]);
    return review;
  }

  async decide(reviewId, input, actorId = null) {
    const review = this.getReview(reviewId); if (!review) throw new Error('Marketplace publication review was not found.'); if (review.status !== 'IN_REVIEW') throw new Error('Publication review must be in review before a decision is recorded.'); if (!DECISIONS.has(input?.decision)) throw new Error(`Unsupported publication decision: ${input?.decision}`);
    const assessment = this.assessListing(review.listingId); if (input.decision === 'AUTHORIZED_FOR_PUBLICATION' && !assessment.readyForPublicationAuthorization) { const error = new Error('Marketplace listing is not ready for publication authorization.'); error.code = 'MARKETPLACE_PUBLICATION_INCOMPLETE'; error.assessment = assessment; throw error; }
    const listing = this.getListing(review.listingId), decidedAt = now();
    const updatedReview = { ...review, assessment, status: input.decision, decision: input.decision, rationale: input.rationale || null, decidedBy: actorId, decidedAt };
    const updatedListing = { ...listing, status: input.decision === 'AUTHORIZED_FOR_PUBLICATION' ? 'PUBLICATION_AUTHORIZED' : input.decision, publicationDecision: input.decision, updatedAt: decidedAt };
    let authorization = null;
    const changes = [
      { type: TYPES.PUBLICATION_REVIEW, id: reviewId, payload: updatedReview, actorId, eventType: 'FUNDING_MARKETPLACE_PUBLICATION_REVIEW_DECIDED' },
      { type: TYPES.MARKETPLACE_LISTING, id: listing.listingId, payload: updatedListing, actorId, eventType: 'FUNDING_MARKETPLACE_LISTING_PUBLICATION_DECIDED' },
    ];
    if (input.decision === 'AUTHORIZED_FOR_PUBLICATION') {
      authorization = { publicationAuthorizationId: id('FMPA'), publicationReviewId: reviewId, listingId: listing.listingId, instrumentId: listing.instrumentId, opportunityId: listing.opportunityId, effectiveFrom: input.effectiveFrom || null, effectiveUntil: input.effectiveUntil || null, status: 'AUTHORIZED', authorizedBy: actorId, authorizedAt: decidedAt, consumedAt: null };
      changes.push({ type: TYPES.PUBLICATION_AUTHORIZATION, id: authorization.publicationAuthorizationId, payload: authorization, actorId, eventType: 'FUNDING_MARKETPLACE_PUBLICATION_AUTHORIZED' });
    }
    await this.domain.atomicPut(changes);
    return { review: updatedReview, authorization };
  }

  async publish(authorizationId, input = {}, actorId = null) {
    const authorization = this.domain.get(TYPES.PUBLICATION_AUTHORIZATION, authorizationId); if (!authorization) throw new Error('Marketplace publication authorization was not found.'); if (authorization.status !== 'AUTHORIZED' || authorization.consumedAt) throw new Error('Marketplace publication authorization is not available for use.');
    const listing = this.getListing(authorization.listingId); if (!listing) throw new Error('Marketplace listing was not found.');
    const assessment = this.assessListing(listing.listingId); if (!assessment.readyForPublicationAuthorization) { const error = new Error('Marketplace listing no longer satisfies publication requirements.'); error.code = 'MARKETPLACE_PUBLICATION_INCOMPLETE'; error.assessment = assessment; throw error; }
    const publishedAt = input.publishedAt || now();
    const liveListing = { ...listing, state: 'LIVE', status: 'ACTIVE', publicationStatus: 'PUBLISHED', publicationAuthorizationId: authorizationId, publishedBy: actorId, publishedAt, updatedAt: publishedAt };
    const consumed = { ...authorization, status: 'CONSUMED', consumedAt: publishedAt };
    const opportunity = this.domain.get(TYPES.OPPORTUNITY, listing.opportunityId);
    const lifecycle = { id: id('LE'), objectType: TYPES.MARKETPLACE_LISTING, objectId: listing.listingId, eventType: 'FUNDING_MARKETPLACE_LISTING_PUBLISHED', actorId, payload: { instrumentId: listing.instrumentId, publicationAuthorizationId: authorizationId, status: 'ACTIVE', commitmentsStatus: 'NOT_OPENED', settlementStatus: 'NOT_STARTED', onChainStatus: 'NOT_PROJECTED' }, occurredAt: publishedAt };
    const changes = [
      { type: TYPES.MARKETPLACE_LISTING, id: listing.listingId, payload: liveListing, actorId, eventType: 'FUNDING_MARKETPLACE_LISTING_PUBLISHED' },
      { type: TYPES.PUBLICATION_AUTHORIZATION, id: authorizationId, payload: consumed, actorId, eventType: 'FUNDING_MARKETPLACE_PUBLICATION_AUTHORIZATION_CONSUMED' },
      { type: TYPES.LIFECYCLE_EVENT, id: lifecycle.id, payload: lifecycle, actorId, eventType: lifecycle.eventType },
    ];
    if (opportunity) changes.push({ type: TYPES.OPPORTUNITY, id: opportunity.opportunityId, payload: { ...opportunity, status: 'MARKETPLACE_LIVE', fundingPhase: 'MARKETPLACE_PARTICIPATION', marketplacePublicationAuthorizationId: authorizationId, updatedAt: publishedAt, history: [...(opportunity.history || []), { from: opportunity.status, to: 'MARKETPLACE_LIVE', at: publishedAt, actorId, note: listing.listingId }] }, actorId, eventType: 'FUNDING_OPPORTUNITY_MARKETPLACE_PUBLISHED' });
    await this.domain.atomicPut(changes);
    return liveListing;
  }
}

export { TYPES as FUNDING_MARKETPLACE_PUBLICATION_RECORD_TYPES };
