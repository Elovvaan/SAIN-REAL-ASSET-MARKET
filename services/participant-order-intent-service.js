import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';
import { withCanonicalSraPricing } from './marketplace-listing-service.js';
import { HYBRID_MARKET_DEFINITION, HYBRID_MARKET_REFERENCE, MARKET_MODES } from './hybrid-liquidity-market-service.js';

export const ORDER_INTENT_RECORD_TYPE = 'SRA_TRANSACTION';

function now() { return new Date().toISOString(); }
function id() { return `ORD-${crypto.randomUUID().toUpperCase()}`; }
function positive(value, field) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${field} must be greater than zero.`);
  return result;
}
function recordTime(record) {
  return String(record?.observedAt || record?.recordedAt || record?.updatedAt || record?.createdAt || '');
}

export class ParticipantOrderIntentService {
  constructor(domain) { this.domain = domain; }

  listing(listingId) {
    const stored = this.domain.get('MARKETPLACE_LISTING', listingId);
    if (!stored) throw new Error('Marketplace listing was not found.');
    const financialRecord = stored.financialRecordId
      ? this.domain.get(RECORD_TYPES.FINANCIAL_RECORD, stored.financialRecordId)
      : null;
    const unit = String(financialRecord?.recognizedPosition?.unit || financialRecord?.measurement?.unit || '').toUpperCase();
    if (financialRecord && unit !== 'USD') throw new Error('The linked Financial Record is not denominated in USD.');
    const recordedValueUsd = financialRecord?.recognizedPosition?.amount ?? financialRecord?.measurement?.value ?? null;
    const listing = withCanonicalSraPricing(stored, recordedValueUsd);
    if (!['PUBLISHED', 'ACTIVE'].includes(listing.state) || listing.status !== 'LIVE') throw new Error('Only LIVE marketplace listings can accept order intents.');
    if (String(listing.unit || '').toUpperCase() === 'SRA' && Number(listing.pricing?.askingPrice) !== 1) throw new Error('The LIVE SRA listing does not have canonical $1.00 par execution terms.');
    return listing;
  }

  hybridSpotContext(instrumentId) {
    const market = this.domain.list(HYBRID_MARKET_DEFINITION)
      .filter((item) => item.underlyingInstrumentId === instrumentId)
      .filter((item) => item.mode === MARKET_MODES.SPOT && item.state === 'APPROVED_REFERENCE_MARKET')
      .sort((a, b) => String(b.updatedAt || b.approvedAt || '').localeCompare(String(a.updatedAt || a.approvedAt || '')))[0] || null;
    if (!market) return null;
    const reference = this.domain.list(HYBRID_MARKET_REFERENCE)
      .filter((item) => item.marketId === market.marketId)
      .sort((a, b) => recordTime(b).localeCompare(recordTime(a)))[0] || null;
    return {
      marketId: market.marketId,
      mode: market.mode,
      marketIdentity: market.marketIdentity || 'SRA / USD',
      referenceId: reference?.referenceId || null,
      referenceValue: reference?.referenceValue ?? null,
      referenceQuoteCurrency: reference?.quoteCurrency || null,
      referenceObservedAt: reference?.observedAt || null,
      referenceExecutable: false,
    };
  }

  preview(input = {}, participantId = null) {
    const listing = this.listing(String(input.listingId || '').trim());
    const side = String(input.side || '').toUpperCase();
    if (!['BUY', 'SELL'].includes(side)) throw new Error('side must be BUY or SELL.');
    const orderType = String(input.orderType || 'MARKET').toUpperCase();
    if (!['MARKET', 'LIMIT'].includes(orderType)) throw new Error('orderType must be MARKET or LIMIT.');
    const quantity = positive(input.quantity, 'quantity');
    if (quantity > Number(listing.quantity || 0)) throw new Error('quantity exceeds the listing quantity currently available.');
    const unitPrice = orderType === 'LIMIT' ? positive(input.limitPrice, 'limitPrice') : positive(listing.pricing?.askingPrice || listing.unitPrice, 'market unit price');
    const hybridSpot = this.hybridSpotContext(listing.instrumentId);
    return {
      action: 'ORDER_INTENT_PREVIEW', readOnly: true, participantId: participantId || null,
      listingId: listing.listingId, instrumentId: listing.instrumentId, market: 'SRA / USD', side, orderType,
      quantity, unit: listing.unit || 'SRA', unitPrice, quoteCurrency: 'USD', estimatedNotional: quantity * unitPrice,
      listingState: listing.state,
      pricingMethod: listing.pricing?.method || null,
      pricingAuthority: 'MARKETPLACE_LISTING',
      hybridSpot,
      verifiedRecordedValueUsd: Number(listing.verifiedRecordedValueUsd || listing.recordedValueUsd || listing.faceValueUsd || 0),
      effect: 'Create a queued participant order intent for later matching and authorization review.',
      doesNot: ['MATCH_ORDER', 'ALLOCATE_POSITION', 'MOVE_BALANCE', 'SETTLE_VALUE', 'TRANSFER_OWNERSHIP', 'CREATE_EXPORT_PACKAGE', 'EXECUTE_HYBRID_REFERENCE_PRICE'],
      confirmationRequired: true,
    };
  }

  async confirm(input = {}, participantId = 'SRA_PARTICIPANT') {
    if (String(input.confirmation || '').toUpperCase() !== 'CONFIRM') throw new Error('Explicit participant confirmation is required.');
    const preview = this.preview(input, participantId);
    const createdAt = now();
    const orderIntentId = id();
    const record = {
      transactionId: orderIntentId,
      orderIntentId,
      transactionType: 'PARTICIPANT_ORDER_INTENT',
      participantId,
      listingId: preview.listingId,
      instrumentId: preview.instrumentId,
      market: preview.market,
      side: preview.side,
      orderType: preview.orderType,
      quantity: preview.quantity,
      unit: preview.unit,
      unitPrice: preview.unitPrice,
      quoteCurrency: preview.quoteCurrency,
      estimatedNotional: preview.estimatedNotional,
      pricingMethod: preview.pricingMethod,
      pricingAuthority: preview.pricingAuthority,
      hybridMarketId: preview.hybridSpot?.marketId || null,
      hybridMarketMode: preview.hybridSpot?.mode || null,
      hybridReferenceId: preview.hybridSpot?.referenceId || null,
      hybridReferenceValue: preview.hybridSpot?.referenceValue ?? null,
      hybridReferenceExecutable: false,
      verifiedRecordedValueUsd: preview.verifiedRecordedValueUsd,
      state: 'QUEUED_FOR_ORDER_REVIEW',
      matchingState: 'NOT_STARTED',
      allocationState: 'NOT_STARTED',
      settlementState: 'NOT_STARTED',
      ownershipTransferState: 'NOT_STARTED',
      createdAt,
      updatedAt: createdAt,
      statusHistory: [{ state: 'QUEUED_FOR_ORDER_REVIEW', actorId: participantId, occurredAt: createdAt }],
    };
    await this.domain.put(ORDER_INTENT_RECORD_TYPE, orderIntentId, record, { actorId: participantId, eventType: 'PARTICIPANT_ORDER_INTENT_CONFIRMED' });
    await this.domain.lifecycle?.({ objectType: ORDER_INTENT_RECORD_TYPE, objectId: orderIntentId, eventType: 'PARTICIPANT_ORDER_INTENT_QUEUED', actorId: participantId, payload: { listingId: record.listingId, side: record.side, quantity: record.quantity, unitPrice: record.unitPrice, hybridMarketId: record.hybridMarketId, hybridReferenceId: record.hybridReferenceId } });
    return record;
  }

  listForParticipant(participantId) {
    return this.domain.list(ORDER_INTENT_RECORD_TYPE)
      .filter((item) => item.transactionType === 'PARTICIPANT_ORDER_INTENT' && (!participantId || item.participantId === participantId))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  status() {
    const intents = this.domain.list(ORDER_INTENT_RECORD_TYPE).filter((item) => item.transactionType === 'PARTICIPANT_ORDER_INTENT');
    return {
      orderIntentCount: intents.length,
      queuedForReview: intents.filter((item) => item.state === 'QUEUED_FOR_ORDER_REVIEW').length,
      matched: intents.filter((item) => item.matchingState === 'MATCHED').length,
      settled: intents.filter((item) => item.settlementState === 'SETTLED').length,
      hybridSpotLinked: intents.filter((item) => Boolean(item.hybridMarketId)).length,
    };
  }
}
