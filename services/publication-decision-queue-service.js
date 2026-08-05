import { ListingPublicationBatchService } from './listing-publication-batch-service.js';

function asNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function latestTimestamp(listings = []) {
  return listings
    .map((listing) => listing.readinessApprovedAt || listing.updatedAt || listing.createdAt || null)
    .filter(Boolean)
    .sort((a, b) => String(b).localeCompare(String(a)))[0] || null;
}

export class PublicationDecisionQueueService {
  constructor(domain) {
    this.domain = domain;
    this.publication = new ListingPublicationBatchService(domain);
  }

  queue() {
    const listings = this.publication.eligibleListings();
    const totalQuantity = listings.reduce((sum, listing) => sum + asNumber(listing.quantity), 0);
    const totalIndicativeValue = listings.reduce((sum, listing) => (
      sum + (asNumber(listing.quantity) * asNumber(listing.pricing?.askingPrice))
    ), 0);
    const instrumentIds = [...new Set(listings.map((listing) => listing.instrumentId).filter(Boolean))];
    const readinessBatchIds = [...new Set(listings.map((listing) => listing.readinessBatchId).filter(Boolean))];

    return {
      queueState: listings.length ? 'PUBLICATION_DECISION_REQUIRED' : 'CURRENT',
      generatedAt: new Date().toISOString(),
      eligibleListingCount: listings.length,
      instrumentCount: instrumentIds.length,
      totalQuantity,
      totalIndicativeValue,
      currency: 'USD',
      market: 'SRA / USD',
      latestReadyAt: latestTimestamp(listings),
      readinessBatchIds,
      scope: {
        listingIds: listings.map((listing) => listing.listingId),
        instrumentIds,
        excludesNativePlatformAsset: true,
      },
      effect: listings.length
        ? `Publishing will move ${listings.length.toLocaleString()} governed SRA / USD listings from PREPARED to PUBLISHED / LIVE.`
        : 'No listing currently satisfies the governed publication boundary.',
      doesNot: [
        'CREATE_ORDERS',
        'ALLOCATE_POSITIONS',
        'SETTLE_VALUE',
        'RECOGNIZE_OWNERSHIP',
        'CREATE_EXPORT_PACKAGES',
      ],
      approval: {
        required: true,
        requiredValue: 'APPROVE',
        authority: 'PLATFORM_ADMIN',
      },
      nextAction: listings.length
        ? 'Review the queue impact and explicitly authorize publication of the current valid set.'
        : 'No publication action is waiting. Core Services will add newly policy-ready listings to this queue.',
    };
  }

  explain() {
    const queue = this.queue();
    return {
      ...queue,
      reply: queue.eligibleListingCount
        ? `${queue.eligibleListingCount.toLocaleString()} SRA / USD listings are ready for one protected publication decision. Their approved terms are already configured. Publication makes them visible as live market inventory but does not create a participant transaction or settlement.`
        : 'The publication queue is current. No policy-ready listing is waiting for administrator release.',
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    const before = this.queue();
    if (!before.eligibleListingCount) {
      return {
        skipped: true,
        reason: 'NO_ELIGIBLE_PUBLICATION_DECISIONS',
        before,
        after: before,
      };
    }
    const result = await this.publication.approve(input, actorId);
    return {
      decision: 'APPROVED',
      before,
      publicationBatch: result,
      after: this.queue(),
    };
  }
}
