import { RECORD_TYPES } from './persistent-domain-service.js';
import { CoinPositionLifecycleReadService } from './coin-position-lifecycle-read-service.js';
import { MarketplaceListingService } from './marketplace-listing-service.js';

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const stateOf = (record) => String(record?.state || record?.status || record?.lifecycleState || 'UNKNOWN').toUpperCase();
const idOf = (record) => record?.positionId || record?.coinPositionId || record?.transactionId || record?.instrumentId || record?.opportunityId || record?.id || null;
const when = (record) => record?.updatedAt || record?.createdAt || record?.occurredAt || record?.recordedAt || record?.settledAt || null;

function identityKeys(session) {
  return new Set([session?.id, session?.universalAccountId].filter(Boolean));
}

function belongsTo(record, keys) {
  const values = [
    record?.participantId, record?.ownerId, record?.holderId, record?.accountId, record?.universalAccountId,
    record?.fromAccountId, record?.toAccountId, record?.createdBy, record?.applicantId, record?.payerId,
  ];
  return values.some((value) => value && keys.has(value));
}

function sortNewest(records = []) {
  return [...records].sort((a, b) => new Date(when(b) || 0) - new Date(when(a) || 0));
}

function positionProjection(record, sourceType) {
  return {
    id: idOf(record),
    sourceType,
    state: stateOf(record),
    title: record?.opportunityTitle || record?.title || record?.assetName || record?.instrumentName || record?.instrumentId || idOf(record),
    participationType: record?.participationType || record?.positionType || record?.type || null,
    amount: n(record?.contribution?.statedAmount ?? record?.amount ?? record?.quantity ?? record?.allocatedQuantity),
    denomination: record?.contribution?.denomination || record?.currency || record?.unit || record?.symbol || null,
    projectId: record?.projectId || null,
    instrumentId: record?.instrumentId || null,
    listingId: record?.listingId || null,
    updatedAt: when(record),
  };
}

function coinProjection(record) {
  return {
    coinPositionId: record?.coinPositionId || record?.positionId || record?.id || null,
    state: stateOf(record),
    quantitySra: n(record?.quantity),
    availableSra: n(record?.availableQuantity ?? record?.quantity),
    reservedSra: n(record?.reservedQuantity),
    externalizedSra: n(record?.externalizedQuantity ?? record?.externallyTransferredQuantity),
    sourceAmount: n(record?.sourcePosition?.amount ?? record?.nativeQuantity ?? record?.sourceQuantity),
    sourceUnit: String(record?.sourcePosition?.unit || record?.nativeUnit || record?.sourceUnit || 'SOURCE').toUpperCase(),
    recognizedUsd: n(record?.recordedValue?.amount ?? record?.representedValueUsd),
    financialRecordId: record?.financialRecordId || null,
    updatedAt: when(record),
  };
}

export class ParticipantWorkspaceReadService {
  constructor(domain, marketplace) {
    this.domain = domain;
    this.marketplace = marketplace;
    this.coinLifecycle = new CoinPositionLifecycleReadService(domain);
    this.listings = new MarketplaceListingService(domain, { autoStart: false });
  }

  read(session) {
    if (!session) throw new Error('Participant session is required.');
    const keys = identityKeys(session);

    const participationPositions = this.domain.list(RECORD_TYPES.PARTICIPATION_POSITION).filter((record) => belongsTo(record, keys));
    const marketplacePositions = this.domain.list(RECORD_TYPES.FUNDING_MARKETPLACE_POSITION).filter((record) => belongsTo(record, keys));
    const transferablePositions = this.domain.list(RECORD_TYPES.TRANSFERABLE_POSITION).filter((record) => belongsTo(record, keys));
    const positions = sortNewest([
      ...participationPositions.map((record) => positionProjection(record, 'PARTICIPATION_POSITION')),
      ...marketplacePositions.map((record) => positionProjection(record, 'FUNDING_MARKETPLACE_POSITION')),
      ...transferablePositions.map((record) => positionProjection(record, 'TRANSFERABLE_POSITION')),
    ]);

    const coinAccounts = this.domain.list(RECORD_TYPES.COIN_ACCOUNT).filter((record) => belongsTo(record, keys));
    const linkedCoinAccountIds = new Set(coinAccounts.map((record) => record.coinAccountId || record.accountId || record.id).filter(Boolean));
    const linkedCoinPositionIds = new Set(coinAccounts.flatMap((record) => record.positionIds || record.coinPositionIds || []).filter(Boolean));
    const coinPositions = this.domain.list(RECORD_TYPES.COIN_POSITION).filter((record) => {
      const id = record.coinPositionId || record.positionId || record.id;
      return belongsTo(record, keys) || linkedCoinPositionIds.has(id) || linkedCoinAccountIds.has(record.coinAccountId || record.accountId);
    }).map(coinProjection);

    const transactions = (this.marketplace?.transactions || []).filter((record) => belongsTo(record, keys)).slice(0, 100);
    const fundingOpportunities = this.domain.list(RECORD_TYPES.FUNDING_OPPORTUNITY).filter((record) => belongsTo(record, keys));
    const instruments = this.domain.list(RECORD_TYPES.SRA_INSTRUMENT).filter((record) => belongsTo(record, keys));
    const recognizedRecords = this.domain.list(RECORD_TYPES.FINANCIAL_RECORD).filter((record) => belongsTo(record, keys));

    const liveListings = this.listings.list({ state: 'LIVE' }).filter((listing) => !listing.executionBlocked && !(listing.blockers || []).length);
    const networkCoin = this.coinLifecycle.read();
    const participantSra = coinPositions.reduce((sum, record) => sum + n(record.quantitySra), 0);
    const participantAvailableSra = coinPositions.reduce((sum, record) => sum + n(record.availableSra), 0);
    const recognizedUsd = recognizedRecords.reduce((sum, record) => sum + n(record?.recognizedPosition?.unit === 'USD' ? record.recognizedPosition.amount : record?.measurement?.unit === 'USD' ? record.measurement.value : 0), 0);

    return {
      generatedAt: new Date().toISOString(),
      participant: {
        id: session.id,
        universalAccountId: session.universalAccountId || null,
        displayName: session.displayName || null,
        activeCapacity: session.activeCapacity || 'UNIVERSAL',
      },
      home: {
        recognizedUsd,
        participantSra,
        participantAvailableSra,
        activeInstrumentCount: instruments.filter((record) => !['CLOSED', 'CANCELLED', 'RETIRED'].includes(stateOf(record))).length,
        positionCount: positions.length,
        fundingOpportunityCount: fundingOpportunities.length,
        pendingActionCount: [...positions, ...fundingOpportunities, ...instruments].filter((record) => /PENDING|AWAITING|REVIEW|READY|AUTHORIZED/.test(stateOf(record))).length,
      },
      marketplace: {
        status: this.marketplace?.marketStatus || 'LIVE',
        liveListingCount: liveListings.length,
        listings: liveListings.map((listing) => ({
          listingId: listing.listingId,
          instrumentId: listing.instrumentId,
          title: listing.title || listing.instrumentId,
          state: listing.state,
          status: listing.status,
          quantitySra: n(listing.quantity),
          unitPriceUsd: n(listing.pricing?.unitPrice || listing.pricing?.askingPrice || 1),
          recordedValueUsd: n(listing.recordedValueUsd || listing.verifiedRecordedValueUsd || listing.faceValueUsd),
          minimumOrder: listing.access?.minimumOrder ?? null,
          maximumOrder: listing.access?.maximumOrder ?? null,
        })),
      },
      positions: { count: positions.length, records: positions.slice(0, 100) },
      transactions: { count: transactions.length, records: transactions },
      sraCoin: {
        participant: { positionCount: coinPositions.length, totalSra: participantSra, availableSra: participantAvailableSra, positions: coinPositions.slice(0, 50) },
        network: {
          totalPositionCount: networkCoin.counts.coinPositionCount,
          rootPositionCount: networkCoin.reconciliation.rootPositionCount,
          derivativePositionCount: networkCoin.reconciliation.derivativePositionCount,
          activeSra: networkCoin.supply.activeSra,
          recognizedUsd: networkCoin.supply.recognizedUsd,
          availableSra: networkCoin.supply.availableSra,
          representationCoveragePct: networkCoin.reconciliation.representationCoveragePct,
          mismatchCount: networkCoin.reconciliation.mismatchCount,
          parReference: '1 SRA = 1 USD',
          sourceMix: networkCoin.sourceMix,
        },
      },
    };
  }
}
