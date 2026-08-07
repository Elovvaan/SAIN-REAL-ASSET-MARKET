import { RECORD_TYPES } from './persistent-domain-service.js';

const APPROVABLE_STATES = new Set(['DRAFT', 'PENDING', 'PENDING_REVIEW', 'IN_REVIEW', 'REVIEW_REQUIRED', 'AWAITING_APPROVAL']);

export class InstrumentApprovalService {
  constructor(domain) {
    this.domain = domain;
  }

  get(instrumentId) {
    return this.domain.get(RECORD_TYPES.SRA_INSTRUMENT, instrumentId);
  }

  async approve(instrumentId, actorId = 'SRA_PLATFORM_ADMIN') {
    const instrument = this.get(instrumentId);
    if (!instrument) throw new Error('Instrument not found.');
    if (instrument.state === 'APPROVED') return { instrument, changed: false };
    if (!APPROVABLE_STATES.has(String(instrument.state || '').toUpperCase())) {
      throw new Error(`Instrument ${instrumentId} is not pending approval.`);
    }

    const approvedAt = new Date().toISOString();
    const approved = {
      ...instrument,
      state: 'APPROVED',
      status: 'APPROVED',
      approvedBy: actorId,
      approvedAt,
      updatedAt: approvedAt,
      statusHistory: [
        ...(Array.isArray(instrument.statusHistory) ? instrument.statusHistory : []),
        { state: 'APPROVED', actorId, occurredAt: approvedAt, reason: 'Approved by Platform Administration.' },
      ],
    };

    const changes = [{
      type: RECORD_TYPES.SRA_INSTRUMENT,
      id: instrumentId,
      payload: approved,
      actorId,
      eventType: 'SRA_INSTRUMENT_APPROVED',
    }];

    const linkedListings = this.domain.list(RECORD_TYPES.MARKETPLACE_LISTING)
      .filter((listing) => listing.instrumentId === instrumentId && !['CANCELLED', 'CLOSED'].includes(String(listing.state || '').toUpperCase()));

    for (const listing of linkedListings) {
      const blockers = Array.isArray(listing.blockers)
        ? listing.blockers.filter((blocker) => blocker !== 'ADMINISTRATIVE_INSTRUMENT_REVIEW_REQUIRED')
        : [];
      const nextListing = {
        ...listing,
        readiness: { ...(listing.readiness || {}), instrumentReviewed: true },
        blockers,
        instrumentApprovedBy: actorId,
        instrumentApprovedAt: approvedAt,
        updatedAt: approvedAt,
      };
      changes.push({
        type: RECORD_TYPES.MARKETPLACE_LISTING,
        id: listing.listingId,
        payload: nextListing,
        actorId,
        eventType: 'MARKETPLACE_LISTING_INSTRUMENT_APPROVED',
      });
    }

    await this.domain.atomicPut(changes);
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.SRA_INSTRUMENT,
      objectId: instrumentId,
      eventType: 'SRA_INSTRUMENT_APPROVED',
      actorId,
      payload: { linkedListingIds: linkedListings.map((listing) => listing.listingId) },
    });
    return { instrument: approved, changed: true, linkedListingIds: linkedListings.map((listing) => listing.listingId) };
  }
}

export { APPROVABLE_STATES };
