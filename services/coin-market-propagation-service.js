import { MarketplaceListingService } from './marketplace-listing-service.js';
import { ListingReadinessBatchService } from './listing-readiness-batch-service.js';
import { ListingPublicationBatchService } from './listing-publication-batch-service.js';
import { InstrumentCoinPositionLinkageService } from './instrument-coin-position-linkage-service.js';

const INSTRUMENT_TYPE = 'SRA_INSTRUMENT';
const APPROVAL_TYPE = 'INSTRUMENT_REPRESENTATION_APPROVAL';
const LISTING_TYPE = 'MARKETPLACE_LISTING';
const ELIGIBLE_INSTRUMENT_STATES = new Set(['APPROVED', 'ISSUED', 'ACTIVE']);

function upper(value) { return String(value ?? '').trim().toUpperCase(); }
function instrumentIdOf(record) { return record?.instrumentId || record?.id || null; }
function coinPositionIdOf(record) { return record?.coinPositionId || record?.sourcePositionId || record?.linkedCoinPositionIds?.[0] || null; }
function purposeOf(record) { return upper(record?.purpose || record?.terms?.purpose || record?.sourceLineage?.purpose); }
function typeOf(record) { return upper(record?.instrumentType || record?.type); }

export class CoinMarketPropagationService {
  constructor(domain, options = {}) {
    this.domain = domain;
    this.actorId = options.actorId || 'SRA-COIN-AGENT';
    this.listings = new MarketplaceListingService(domain, { autoStart: false });
    this.readiness = new ListingReadinessBatchService(domain);
    this.publication = new ListingPublicationBatchService(domain);
    this.linkages = new InstrumentCoinPositionLinkageService(domain);
  }

  isCoinDerived(instrument) {
    if (!instrument) return false;
    return typeOf(instrument) === 'SRA_VALUE_INSTRUMENT'
      && purposeOf(instrument) === 'RECORDED_MARKET_TRANSACTION_OBLIGATION'
      && Boolean(coinPositionIdOf(instrument));
  }

  marketplaceListing(instrumentId) {
    return this.domain.list(LISTING_TYPE).find((listing) => listing.instrumentId === instrumentId && !['CANCELLED', 'CLOSED'].includes(upper(listing.state))) || null;
  }

  statusFor(instrumentId) {
    const instrument = this.domain.get(INSTRUMENT_TYPE, instrumentId);
    if (!instrument) return { instrumentId, eligible: false, state: 'NOT_FOUND', blockers: ['INSTRUMENT_NOT_FOUND'] };
    if (!this.isCoinDerived(instrument)) return { instrumentId, eligible: false, state: 'NOT_COIN_DERIVED', blockers: ['COIN_DERIVED_INSTRUMENT_REQUIRED'] };
    const state = upper(instrument.state || instrument.status);
    const coinPositionId = coinPositionIdOf(instrument);
    const representation = this.domain.get(APPROVAL_TYPE, `IRA-${instrumentId}`);
    const linkage = coinPositionId ? this.linkages.evaluate(instrumentId, coinPositionId) : null;
    const listing = this.marketplaceListing(instrumentId);
    const blockers = [];
    if (!ELIGIBLE_INSTRUMENT_STATES.has(state)) blockers.push('INSTRUMENT_APPROVAL_REQUIRED');
    if (representation?.state !== 'APPROVED') blockers.push('REPRESENTATION_APPROVAL_REQUIRED');
    if (!linkage?.alreadyLinked) blockers.push('COIN_POSITION_LINKAGE_REQUIRED');
    return {
      instrumentId,
      coinPositionId,
      eligible: blockers.length === 0,
      state,
      blockers,
      representationState: representation?.state || 'NOT_APPROVED',
      linkageState: linkage?.alreadyLinked ? 'LINKED' : 'NOT_LINKED',
      listingId: listing?.listingId || null,
      marketplaceState: listing?.status === 'LIVE' || listing?.state === 'PUBLISHED' ? 'LIVE' : listing?.status || listing?.state || 'NOT_PREPARED',
      listing,
    };
  }

  async propagate(instrumentId, actorId = this.actorId) {
    const status = this.statusFor(instrumentId);
    if (!status.eligible) return { ...status, changed: false };

    let listing = status.listing;
    let prepared = false;
    let readinessChanged = false;
    let publicationChanged = false;

    if (!listing) {
      const preparedResult = await this.listings.prepareFromInstrument(instrumentId, {}, actorId);
      listing = preparedResult.listing;
      prepared = Boolean(preparedResult.created);
    }
    if (!listing) return { ...this.statusFor(instrumentId), changed: prepared, blockers: ['LISTING_PREPARATION_UNAVAILABLE'] };

    if (!(listing.status === 'READY_FOR_PUBLICATION_APPROVAL' && listing.state === 'PREPARED') && !(listing.status === 'LIVE' || listing.state === 'PUBLISHED')) {
      const readinessResult = await this.readiness.approveListing(listing.listingId, {}, actorId);
      listing = readinessResult.listing;
      readinessChanged = Boolean(readinessResult.changed);
    }

    if (!(listing.status === 'LIVE' || listing.state === 'PUBLISHED')) {
      const publicationResult = await this.publication.approveListing(listing.listingId, actorId);
      listing = publicationResult.listing;
      publicationChanged = Boolean(publicationResult.changed);
    }

    const changed = prepared || readinessChanged || publicationChanged;
    if (changed) {
      await this.domain.lifecycle?.({
        objectType: INSTRUMENT_TYPE,
        objectId: instrumentId,
        eventType: 'COIN_INSTRUMENT_INTERNAL_MARKET_PROPAGATED',
        actorId,
        payload: { coinPositionId: status.coinPositionId, listingId: listing.listingId, marketplaceState: listing.status || listing.state, publicVisibility: listing.publicVisibility || null },
      });
    }
    return { ...this.statusFor(instrumentId), listing, changed, prepared, readinessChanged, publicationChanged };
  }

  async reconcile(options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit) || 250, 1000));
    const actorId = options.actorId || this.actorId;
    const candidates = this.domain.list(INSTRUMENT_TYPE)
      .filter((instrument) => this.isCoinDerived(instrument))
      .filter((instrument) => ELIGIBLE_INSTRUMENT_STATES.has(upper(instrument.state || instrument.status)))
      .slice(0, limit);
    const propagated = [];
    const waiting = [];
    const failed = [];
    for (const instrument of candidates) {
      const instrumentId = instrumentIdOf(instrument);
      try {
        const result = await this.propagate(instrumentId, actorId);
        if (result.marketplaceState === 'LIVE') propagated.push({ instrumentId, listingId: result.listingId, changed: result.changed });
        else waiting.push({ instrumentId, blockers: result.blockers, marketplaceState: result.marketplaceState });
      } catch (error) {
        failed.push({ instrumentId, error: error?.message || String(error) });
      }
    }
    return { scanned: candidates.length, live: propagated.length, waiting: waiting.length, failed: failed.length, propagated, waitingRecords: waiting, failures: failed };
  }
}
