import crypto from 'node:crypto';

const LISTING_TYPE = 'MARKETPLACE_LISTING';
const BATCH_TYPE = 'SRA_LISTING_PUBLICATION_BATCH';

function now() { return new Date().toISOString(); }
function id() { return `LPB-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function eligibleListing(listing) {
  return Boolean(
    listing
    && listing.state === 'PREPARED'
    && listing.status === 'READY_FOR_PUBLICATION_APPROVAL'
    && Array.isArray(listing.blockers)
    && listing.blockers.length === 0
    && listing.platformAssetCode !== 'SRA_PLATFORM_ASSET'
    && Number(listing.pricing?.askingPrice || 0) > 0
    && listing.pricing?.currency === 'USD'
    && listing.access?.state === 'CONFIGURED'
    && listing.transactionRouteId
    && listing.settlementRouteId
  );
}
function publishedListing(listing, actorId, batchId, approvedAt, reason = 'Administrator approved governed SRA / USD publication batch.') {
  return {
    ...listing,
    state: 'PUBLISHED',
    status: 'LIVE',
    publicationState: 'PUBLISHED',
    publicVisibility: 'MARKETPLACE',
    publicationBatchId: batchId,
    publicationApprovedBy: actorId,
    publicationApprovedAt: approvedAt,
    publishedAt: approvedAt,
    statusHistory: [
      ...(listing.statusHistory || []),
      { state: 'PUBLISHED', status: 'LIVE', actorId, occurredAt: approvedAt, reason },
    ],
    updatedAt: approvedAt,
  };
}

export class ListingPublicationBatchService {
  constructor(domain) { this.domain = domain; }

  eligibleListings() { return this.domain.list(LISTING_TYPE).filter(eligibleListing); }

  preview() {
    const listings = this.eligibleListings();
    const totalQuantity = listings.reduce((sum, listing) => sum + Number(listing.quantity || 0), 0);
    return {
      action: 'LISTING_PUBLICATION_BATCH_PREVIEW',
      readOnly: true,
      eligibleListingCount: listings.length,
      totalQuantity,
      market: 'SRA / USD',
      scope: {
        listingIds: listings.map((listing) => listing.listingId),
        currentState: 'PREPARED',
        currentStatus: 'READY_FOR_PUBLICATION_APPROVAL',
        excludesNativePlatformAsset: true,
      },
      effect: 'Publish covered SRA / USD listings and make them visible as LIVE marketplace inventory.',
      doesNot: ['CREATE_TRANSACTIONS', 'ALLOCATE_POSITIONS', 'SETTLE_VALUE', 'RECOGNIZE_OWNERSHIP', 'CREATE_EXPORT_PACKAGES'],
      approvalRequired: true,
    };
  }

  async approveListing(listingId, actorId = 'SRA-COIN-AGENT') {
    const listing = this.domain.get(LISTING_TYPE, listingId);
    if (!listing) throw new Error(`Listing ${listingId} was not found.`);
    if (listing.state === 'PUBLISHED' || listing.status === 'LIVE') return { listing, changed: false };
    if (!eligibleListing(listing)) throw new Error(`Listing ${listingId} is not ready for internal marketplace publication.`);
    const approvedAt = now();
    const batchId = `LPB-${listingId}`;
    const next = publishedListing(listing, actorId, batchId, approvedAt, 'Coin Operations Agent published the approved Coin-derived instrument to the internal SRA / USD marketplace after instrument, representation, and source-lineage completion.');
    await this.domain.atomicPut?.([
      { type: LISTING_TYPE, id: listingId, payload: next, actorId, eventType: 'MARKETPLACE_LISTING_PUBLISHED' },
      { type: BATCH_TYPE, id: batchId, payload: { batchId, state: 'APPROVED', mode: 'TARGETED_COIN_MARKET_PROPAGATION', approvedBy: actorId, approvedAt, eligibleListingCount: 1, publishedListingCount: 1, listingIds: [listingId], market: 'SRA / USD', transactionsCreated: 0, settlementExecuted: false, protectedNextAction: 'PARTICIPANT_ORDER_CONFIRMATION_REQUIRED' }, actorId, eventType: 'LISTING_PUBLICATION_BATCH_RECORDED' },
    ]);
    if (!this.domain.atomicPut) {
      await this.domain.put(LISTING_TYPE, listingId, next, { actorId, eventType: 'MARKETPLACE_LISTING_PUBLISHED' });
      await this.domain.put(BATCH_TYPE, batchId, { batchId, state: 'APPROVED', mode: 'TARGETED_COIN_MARKET_PROPAGATION', approvedBy: actorId, approvedAt, eligibleListingCount: 1, publishedListingCount: 1, listingIds: [listingId], market: 'SRA / USD', transactionsCreated: 0, settlementExecuted: false, protectedNextAction: 'PARTICIPANT_ORDER_CONFIRMATION_REQUIRED' }, { actorId, eventType: 'LISTING_PUBLICATION_BATCH_RECORDED' });
    }
    await this.domain.lifecycle?.({ objectType: LISTING_TYPE, objectId: listingId, eventType: 'MARKETPLACE_LISTING_PUBLISHED', actorId, payload: { batchId, market: 'SRA / USD', instrumentId: listing.instrumentId, mode: 'TARGETED_COIN_MARKET_PROPAGATION' } });
    return { listing: next, changed: true };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator publication approval is required.');
    const preview = this.preview();
    const approvedAt = now();
    const batchId = id();
    const updated = [];

    for (const listingId of preview.scope.listingIds) {
      const listing = this.domain.get(LISTING_TYPE, listingId);
      if (!eligibleListing(listing)) continue;
      const next = publishedListing(listing, actorId, batchId, approvedAt);
      await this.domain.put(LISTING_TYPE, listingId, next, { actorId, eventType: 'MARKETPLACE_LISTING_PUBLICATION_BATCH_APPROVED' });
      await this.domain.lifecycle?.({
        objectType: LISTING_TYPE,
        objectId: listingId,
        eventType: 'MARKETPLACE_LISTING_PUBLISHED',
        actorId,
        payload: { batchId, market: 'SRA / USD', instrumentId: listing.instrumentId },
      });
      updated.push(listingId);
    }

    const batch = {
      batchId,
      state: 'APPROVED',
      approvedBy: actorId,
      approvedAt,
      eligibleListingCount: preview.eligibleListingCount,
      publishedListingCount: updated.length,
      listingIds: updated,
      market: 'SRA / USD',
      transactionsCreated: 0,
      settlementExecuted: false,
      protectedNextAction: 'PARTICIPANT_ORDER_CONFIRMATION_REQUIRED',
    };
    await this.domain.put(BATCH_TYPE, batchId, batch, { actorId, eventType: 'LISTING_PUBLICATION_BATCH_RECORDED' });
    return batch;
  }

  status() {
    const eligible = this.eligibleListings().length;
    const live = this.domain.list(LISTING_TYPE).filter((listing) => listing.state === 'PUBLISHED' || listing.status === 'LIVE').length;
    const batches = this.domain.list(BATCH_TYPE);
    return {
      eligibleForPublication: eligible,
      liveListingCount: live,
      approvedPublicationBatchCount: batches.length,
      latestPublicationBatch: batches.sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)))[0] || null,
    };
  }
}

export { BATCH_TYPE as LISTING_PUBLICATION_BATCH_RECORD_TYPE };
