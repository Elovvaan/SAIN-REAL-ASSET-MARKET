import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const LISTING_TYPE = 'MARKETPLACE_LISTING';
const BATCH_TYPE = 'SRA_LISTING_READINESS_BATCH';
const SRA_PAR_PRICING_METHOD = 'VERIFIED_RECORDED_USD_VALUE_AT_SRA_PAR';
const ELIGIBLE_BLOCKERS = new Set([
  'ADMINISTRATIVE_INSTRUMENT_REVIEW_REQUIRED',
  'LISTING_PRICE_REQUIRED',
  'MARKET_ACCESS_RULES_REQUIRED',
  'TRANSACTION_ROUTE_REQUIRED',
  'SETTLEMENT_ROUTE_REQUIRED',
]);
const APPROVABLE_INSTRUMENT_STATES = new Set(['DRAFT','PENDING','PENDING_REVIEW','IN_REVIEW','REVIEW_REQUIRED','AWAITING_APPROVAL']);

function now() { return new Date().toISOString(); }
function id() { return `LRB-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function finitePositive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be greater than zero.`);
  return number;
}
function recordedValue(listing) {
  return finitePositive(
    listing.verifiedRecordedValueUsd
      ?? listing.recordedValueUsd
      ?? listing.faceValueUsd
      ?? listing.quantity,
    `verified recorded USD value for listing ${listing.listingId || 'UNKNOWN'}`
  );
}
function requireParPolicy(input = {}) {
  const requested = input.unitPrice == null ? 1 : Number(input.unitPrice);
  if (!Number.isFinite(requested) || requested !== 1) throw new Error('SRA/USD readiness requires the fixed par unit price of exactly $1.00 per SRA.');
  const method = String(input.askingPriceMethod || SRA_PAR_PRICING_METHOD).toUpperCase();
  if (![SRA_PAR_PRICING_METHOD, 'ADMIN_APPROVED_SRA_USD_UNIT_PRICE'].includes(method)) throw new Error('Unsupported SRA/USD pricing method.');
}
function policyFrom(input = {}) {
  requireParPolicy(input);
  return {
    askingPriceMethod: SRA_PAR_PRICING_METHOD,
    unitPrice: 1,
    currency: 'USD',
    eligibilityRule: String(input.eligibilityRule || 'SRA_REGISTERED_PARTICIPANTS').toUpperCase(),
    minimumOrder: finitePositive(input.minimumOrder || 1, 'minimumOrder'),
    transactionRouteId: String(input.transactionRouteId || 'SRA_INTERNAL_MARKETPLACE').toUpperCase(),
    settlementRouteId: String(input.settlementRouteId || 'SRA_INTERNAL_SETTLEMENT').toUpperCase(),
  };
}
function listingEligible(listing) {
  if (!listing || listing.state !== 'PREPARED' || listing.platformAssetCode === 'SRA_PLATFORM_ASSET') return false;
  const blockers = Array.isArray(listing.blockers) ? listing.blockers : [];
  return blockers.every((blocker) => ELIGIBLE_BLOCKERS.has(blocker));
}
function readyListing(listing, policy, actorId, batchId, approvedAt) {
  const recordedValueUsd = recordedValue(listing);
  return {
    ...listing,
    quantity: recordedValueUsd, verifiedRecordedValueUsd: recordedValueUsd, recordedValueUsd, faceValueUsd: recordedValueUsd,
    pricing: { ...(listing.pricing || {}), state: 'CONFIGURED', method: SRA_PAR_PRICING_METHOD, askingPrice: 1, unitPrice: 1, currency: 'USD', faceValueUsd: recordedValueUsd, recordedValueUsd, parReference: '1 SRA = 1 USD' },
    access: { ...(listing.access || {}), state: 'CONFIGURED', eligibilityRule: policy.eligibilityRule, minimumOrder: policy.minimumOrder },
    transactionRouteId: policy.transactionRouteId, settlementRouteId: policy.settlementRouteId,
    readiness: { instrumentReviewed: true, pricingApproved: true, accessRulesApproved: true, transactionRouteConnected: true, settlementRouteConnected: true },
    blockers: [], status: 'READY_FOR_PUBLICATION_APPROVAL', readinessBatchId: batchId, readinessApprovedBy: actorId, readinessApprovedAt: approvedAt, updatedAt: approvedAt,
  };
}

export class ListingReadinessBatchService {
  constructor(domain) { this.domain = domain; }

  eligibleListings() { return this.domain.list(LISTING_TYPE).filter(listingEligible); }

  preview(input = {}) {
    const policy = policyFrom(input);
    const listings = this.eligibleListings();
    const valid = [];
    const invalid = [];
    for (const listing of listings) {
      try { valid.push({ listing, recordedValueUsd: recordedValue(listing) }); }
      catch (error) { invalid.push({ listingId: listing.listingId, error: error.message }); }
    }
    return {
      action: 'LISTING_READINESS_BATCH_PREVIEW', readOnly: true,
      eligibleListingCount: valid.length, invalidListingCount: invalid.length, invalidListings: invalid,
      market: 'SRA / USD',
      scope: { listingIds: valid.map(({ listing }) => listing.listingId), listingState: 'PREPARED', excludesNativePlatformAsset: true },
      policy,
      effect: 'Preserve the verified recorded USD value as SRA quantity at the fixed $1.00 SRA/USD par reference, clear the remaining readiness blockers, and mark covered listings READY_FOR_PUBLICATION_APPROVAL.',
      doesNot: ['REPRICE_SOURCE_ASSETS','USE_SOURCE_TOKEN_QUANTITY_AS_SRA_QUANTITY','PUBLISH_LISTINGS','CREATE_TRANSACTIONS','ALLOCATE_POSITIONS','SETTLE_VALUE','RECOGNIZE_OWNERSHIP','CREATE_EXPORT_PACKAGES'],
      approvalRequired: true,
    };
  }

  async approveInstrument(instrumentId, actorId = 'SRA_PLATFORM_ADMIN') {
    const instrument = this.domain.get(RECORD_TYPES.SRA_INSTRUMENT, instrumentId);
    if (!instrument) throw new Error(`Instrument ${instrumentId} was not found.`);
    if (instrument.state === 'APPROVED') return { action: 'INSTRUMENT_APPROVAL', batchId: instrumentId, instrument, changed: false, updatedListingCount: 0, policy: { unitPrice: 1 } };
    if (!APPROVABLE_INSTRUMENT_STATES.has(String(instrument.state || '').toUpperCase())) throw new Error(`Instrument ${instrumentId} is not pending approval.`);

    const approvedAt = now();
    const approved = {
      ...instrument,
      state: 'APPROVED', status: 'APPROVED', approvedBy: actorId, approvedAt, updatedAt: approvedAt,
      statusHistory: [...(Array.isArray(instrument.statusHistory) ? instrument.statusHistory : []), { state: 'APPROVED', actorId, occurredAt: approvedAt, reason: 'Approved by Platform Administration.' }],
    };
    const changes = [{ type: RECORD_TYPES.SRA_INSTRUMENT, id: instrumentId, payload: approved, actorId, eventType: 'SRA_INSTRUMENT_APPROVED' }];
    const linkedListings = this.domain.list(LISTING_TYPE).filter((listing) => listing.instrumentId === instrumentId && !['CANCELLED','CLOSED'].includes(String(listing.state || '').toUpperCase()));
    for (const listing of linkedListings) {
      changes.push({
        type: LISTING_TYPE,
        id: listing.listingId,
        actorId,
        eventType: 'MARKETPLACE_LISTING_INSTRUMENT_APPROVED',
        payload: {
          ...listing,
          readiness: { ...(listing.readiness || {}), instrumentReviewed: true },
          blockers: Array.isArray(listing.blockers) ? listing.blockers.filter((blocker) => blocker !== 'ADMINISTRATIVE_INSTRUMENT_REVIEW_REQUIRED') : [],
          instrumentApprovedBy: actorId,
          instrumentApprovedAt: approvedAt,
          updatedAt: approvedAt,
        },
      });
    }
    await this.domain.atomicPut(changes);
    await this.domain.lifecycle({ objectType: RECORD_TYPES.SRA_INSTRUMENT, objectId: instrumentId, eventType: 'SRA_INSTRUMENT_APPROVED', actorId, payload: { linkedListingIds: linkedListings.map((listing) => listing.listingId) } });
    return { action: 'INSTRUMENT_APPROVAL', batchId: instrumentId, instrument: approved, changed: true, updatedListingCount: linkedListings.length, linkedListingIds: linkedListings.map((listing) => listing.listingId), policy: { unitPrice: 1 } };
  }

  async approveListing(listingId, input = {}, actorId = 'SRA-COIN-AGENT') {
    const listing = this.domain.get(LISTING_TYPE, listingId);
    if (!listing) throw new Error(`Listing ${listingId} was not found.`);
    if (listing.status === 'READY_FOR_PUBLICATION_APPROVAL' && listing.state === 'PREPARED' && (!listing.blockers || listing.blockers.length === 0)) return { listing, changed: false, policy: policyFrom(input) };
    if (!listingEligible(listing)) throw new Error(`Listing ${listingId} is not eligible for marketplace readiness.`);
    const policy = policyFrom(input);
    const approvedAt = now();
    const batchId = `LRB-${listingId}`;
    const next = readyListing(listing, policy, actorId, batchId, approvedAt);
    await this.domain.atomicPut([
      { type: LISTING_TYPE, id: listingId, payload: next, actorId, eventType: 'MARKETPLACE_LISTING_READINESS_APPROVED' },
      { type: BATCH_TYPE, id: batchId, payload: { batchId, state: 'APPROVED', mode: 'TARGETED_COIN_MARKET_PROPAGATION', approvedBy: actorId, approvedAt, policy, eligibleListingCount: 1, updatedListingCount: 1, invalidListingCount: 0, listingIds: [listingId], publicationExecuted: false, protectedNextAction: 'PUBLICATION' }, actorId, eventType: 'LISTING_READINESS_BATCH_RECORDED' },
    ]);
    await this.domain.lifecycle?.({ objectType: LISTING_TYPE, objectId: listingId, eventType: 'MARKETPLACE_LISTING_READINESS_APPROVED', actorId, payload: { instrumentId: listing.instrumentId, market: 'SRA / USD', mode: 'TARGETED_COIN_MARKET_PROPAGATION' } });
    return { listing: next, changed: true, policy };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator approval is required.');
    if (input.instrumentId) return this.approveInstrument(String(input.instrumentId), actorId);
    const preview = this.preview(input);
    if (preview.invalidListingCount > 0) {
      const ids = preview.invalidListings.map((item) => item.listingId).join(', ');
      throw new Error(`Readiness approval was not started because ${preview.invalidListingCount} scoped listing(s) lack a positive verified recorded USD value: ${ids}.`);
    }
    const approvedAt = now();
    const batchId = id();
    const changes = [];
    const updated = [];
    for (const listingId of preview.scope.listingIds) {
      const listing = this.domain.get(LISTING_TYPE, listingId);
      if (!listing || listing.state !== 'PREPARED') throw new Error(`Listing ${listingId} changed before approval. Refresh the preview and try again.`);
      const next = readyListing(listing, preview.policy, actorId, batchId, approvedAt);
      changes.push({ type: LISTING_TYPE, id: listingId, payload: next, actorId, eventType: 'MARKETPLACE_LISTING_READINESS_BATCH_APPROVED' });
      updated.push(listingId);
    }
    const batch = { batchId, state: 'APPROVED', approvedBy: actorId, approvedAt, policy: preview.policy, eligibleListingCount: preview.eligibleListingCount, updatedListingCount: updated.length, invalidListingCount: 0, listingIds: updated, publicationExecuted: false, protectedNextAction: 'SEPARATE_PUBLICATION_APPROVAL_REQUIRED' };
    changes.push({ type: BATCH_TYPE, id: batchId, payload: batch, actorId, eventType: 'LISTING_READINESS_BATCH_RECORDED' });
    await this.domain.atomicPut(changes);
    return batch;
  }

  status() {
    const eligible = this.eligibleListings().length;
    const ready = this.domain.list(LISTING_TYPE).filter((listing) => listing.status === 'READY_FOR_PUBLICATION_APPROVAL' && listing.state === 'PREPARED').length;
    const batches = this.domain.list(BATCH_TYPE);
    return { eligibleForBatch: eligible, readyForPublicationApproval: ready, approvedBatchCount: batches.length, latestBatch: batches.sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)))[0] || null };
  }
}

export { BATCH_TYPE as LISTING_READINESS_BATCH_RECORD_TYPE };
