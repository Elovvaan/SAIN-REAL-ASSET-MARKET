import crypto from 'node:crypto';

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

export class ListingReadinessBatchService {
  constructor(domain) { this.domain = domain; }

  eligibleListings() {
    return this.domain.list(LISTING_TYPE).filter((listing) => {
      if (listing.state !== 'PREPARED') return false;
      if (listing.platformAssetCode === 'SRA_PLATFORM_ASSET') return false;
      const blockers = Array.isArray(listing.blockers) ? listing.blockers : [];
      return blockers.length > 0 && blockers.every((blocker) => ELIGIBLE_BLOCKERS.has(blocker));
    });
  }

  preview(input = {}) {
    requireParPolicy(input);
    const listings = this.eligibleListings();
    const valid = [];
    const invalid = [];
    for (const listing of listings) {
      try { valid.push({ listing, recordedValueUsd: recordedValue(listing) }); }
      catch (error) { invalid.push({ listingId: listing.listingId, error: error.message }); }
    }
    const eligibilityRule = String(input.eligibilityRule || 'SRA_REGISTERED_PARTICIPANTS').toUpperCase();
    const transactionRouteId = String(input.transactionRouteId || 'SRA_INTERNAL_MARKETPLACE').toUpperCase();
    const settlementRouteId = String(input.settlementRouteId || 'SRA_INTERNAL_SETTLEMENT').toUpperCase();
    const minimumOrder = finitePositive(input.minimumOrder || 1, 'minimumOrder');
    return {
      action: 'LISTING_READINESS_BATCH_PREVIEW',
      readOnly: true,
      eligibleListingCount: valid.length,
      invalidListingCount: invalid.length,
      invalidListings: invalid,
      market: 'SRA / USD',
      scope: {
        listingIds: valid.map(({ listing }) => listing.listingId),
        listingState: 'PREPARED',
        excludesNativePlatformAsset: true,
      },
      policy: { askingPriceMethod: SRA_PAR_PRICING_METHOD, unitPrice: 1, currency: 'USD', eligibilityRule, minimumOrder, transactionRouteId, settlementRouteId },
      effect: 'Preserve the verified recorded USD value as SRA quantity at the fixed $1.00 SRA/USD par reference, clear the remaining readiness blockers, and mark covered listings READY_FOR_PUBLICATION_APPROVAL.',
      doesNot: ['REPRICE_SOURCE_ASSETS', 'USE_SOURCE_TOKEN_QUANTITY_AS_SRA_QUANTITY', 'PUBLISH_LISTINGS', 'CREATE_TRANSACTIONS', 'ALLOCATE_POSITIONS', 'SETTLE_VALUE', 'RECOGNIZE_OWNERSHIP', 'CREATE_EXPORT_PACKAGES'],
      approvalRequired: true,
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator approval is required.');
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
      const recordedValueUsd = recordedValue(listing);
      const next = {
        ...listing,
        quantity: recordedValueUsd,
        verifiedRecordedValueUsd: recordedValueUsd,
        recordedValueUsd,
        faceValueUsd: recordedValueUsd,
        pricing: {
          ...(listing.pricing || {}),
          state: 'CONFIGURED',
          method: SRA_PAR_PRICING_METHOD,
          askingPrice: 1,
          unitPrice: 1,
          currency: 'USD',
          faceValueUsd: recordedValueUsd,
          recordedValueUsd,
          parReference: '1 SRA = 1 USD',
        },
        access: { ...(listing.access || {}), state: 'CONFIGURED', eligibilityRule: preview.policy.eligibilityRule, minimumOrder: preview.policy.minimumOrder },
        transactionRouteId: preview.policy.transactionRouteId,
        settlementRouteId: preview.policy.settlementRouteId,
        readiness: {
          instrumentReviewed: true,
          pricingApproved: true,
          accessRulesApproved: true,
          transactionRouteConnected: true,
          settlementRouteConnected: true,
        },
        blockers: [],
        status: 'READY_FOR_PUBLICATION_APPROVAL',
        readinessBatchId: batchId,
        readinessApprovedBy: actorId,
        readinessApprovedAt: approvedAt,
        updatedAt: approvedAt,
      };
      changes.push({ type: LISTING_TYPE, id: listingId, payload: next, actorId, eventType: 'MARKETPLACE_LISTING_READINESS_BATCH_APPROVED' });
      updated.push(listingId);
    }

    const batch = {
      batchId,
      state: 'APPROVED',
      approvedBy: actorId,
      approvedAt,
      policy: preview.policy,
      eligibleListingCount: preview.eligibleListingCount,
      updatedListingCount: updated.length,
      invalidListingCount: 0,
      listingIds: updated,
      publicationExecuted: false,
      protectedNextAction: 'SEPARATE_PUBLICATION_APPROVAL_REQUIRED',
    };
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
