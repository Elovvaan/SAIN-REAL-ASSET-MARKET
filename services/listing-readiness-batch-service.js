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
    'verified recorded USD value'
  );
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
    const listings = this.eligibleListings();
    const askingPriceMethod = SRA_PAR_PRICING_METHOD;
    const unitPrice = 1;
    const eligibilityRule = String(input.eligibilityRule || 'SRA_REGISTERED_PARTICIPANTS').toUpperCase();
    const transactionRouteId = String(input.transactionRouteId || 'SRA_INTERNAL_MARKETPLACE').toUpperCase();
    const settlementRouteId = String(input.settlementRouteId || 'SRA_INTERNAL_SETTLEMENT').toUpperCase();
    const minimumOrder = finitePositive(input.minimumOrder || 1, 'minimumOrder');
    return {
      action: 'LISTING_READINESS_BATCH_PREVIEW',
      readOnly: true,
      eligibleListingCount: listings.length,
      market: 'SRA / USD',
      scope: {
        listingIds: listings.map((listing) => listing.listingId),
        listingState: 'PREPARED',
        excludesNativePlatformAsset: true,
      },
      policy: { askingPriceMethod, unitPrice, currency: 'USD', eligibilityRule, minimumOrder, transactionRouteId, settlementRouteId },
      effect: 'Preserve the verified recorded USD value as SRA quantity at the fixed $1.00 SRA/USD par reference, clear the remaining readiness blockers, and mark covered listings READY_FOR_PUBLICATION_APPROVAL.',
      doesNot: ['REPRICE_SOURCE_ASSETS', 'USE_SOURCE_TOKEN_QUANTITY_AS_SRA_QUANTITY', 'PUBLISH_LISTINGS', 'CREATE_TRANSACTIONS', 'ALLOCATE_POSITIONS', 'SETTLE_VALUE', 'RECOGNIZE_OWNERSHIP', 'CREATE_EXPORT_PACKAGES'],
      approvalRequired: true,
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator approval is required.');
    const preview = this.preview(input);
    const approvedAt = now();
    const batchId = id();
    const updated = [];

    for (const listingId of preview.scope.listingIds) {
      const listing = this.domain.get(LISTING_TYPE, listingId);
      if (!listing || listing.state !== 'PREPARED') continue;
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
          method: preview.policy.askingPriceMethod,
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
      await this.domain.put(LISTING_TYPE, listingId, next, { actorId, eventType: 'MARKETPLACE_LISTING_READINESS_BATCH_APPROVED' });
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
      listingIds: updated,
      publicationExecuted: false,
      protectedNextAction: 'SEPARATE_PUBLICATION_APPROVAL_REQUIRED',
    };
    await this.domain.put(BATCH_TYPE, batchId, batch, { actorId, eventType: 'LISTING_READINESS_BATCH_RECORDED' });
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
