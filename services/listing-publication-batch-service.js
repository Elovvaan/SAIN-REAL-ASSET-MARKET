import crypto from 'node:crypto';

const LISTING_TYPE = 'MARKETPLACE_LISTING';
const BATCH_TYPE = 'SRA_LISTING_PUBLICATION_BATCH';

function now() { return new Date().toISOString(); }
function id() { return `LPB-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }

export class ListingPublicationBatchService {
  constructor(domain) { this.domain = domain; }

  eligibleListings() {
    return this.domain.list(LISTING_TYPE).filter((listing) => (
      listing.state === 'PREPARED'
      && listing.status === 'READY_FOR_PUBLICATION_APPROVAL'
      && Array.isArray(listing.blockers)
      && listing.blockers.length === 0
      && listing.platformAssetCode !== 'SRA_PLATFORM_ASSET'
      && Number(listing.pricing?.askingPrice || 0) > 0
      && listing.pricing?.currency === 'USD'
      && listing.access?.state === 'CONFIGURED'
      && listing.transactionRouteId
      && listing.settlementRouteId
    ));
  }

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

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator publication approval is required.');
    const preview = this.preview();
    const approvedAt = now();
    const batchId = id();
    const updated = [];

    for (const listingId of preview.scope.listingIds) {
      const listing = this.domain.get(LISTING_TYPE, listingId);
      if (!listing || listing.state !== 'PREPARED' || listing.status !== 'READY_FOR_PUBLICATION_APPROVAL') continue;
      const next = {
        ...listing,
        state: 'PUBLISHED',
        status: 'LIVE',
        publicationBatchId: batchId,
        publicationApprovedBy: actorId,
        publicationApprovedAt: approvedAt,
        publishedAt: approvedAt,
        statusHistory: [
          ...(listing.statusHistory || []),
          { state: 'PUBLISHED', status: 'LIVE', actorId, occurredAt: approvedAt, reason: 'Administrator approved governed SRA / USD publication batch.' },
        ],
        updatedAt: approvedAt,
      };
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
