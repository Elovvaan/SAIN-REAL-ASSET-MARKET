import crypto from 'node:crypto';
import { withCanonicalSraPricing } from './marketplace-listing-service.js';

export const ORDER_INTENT_RECORD_TYPE = 'SRA_TRANSACTION';

function now() { return new Date().toISOString(); }
function id() { return `ORD-${crypto.randomUUID().toUpperCase()}`; }
function positive(value, field) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${field} must be greater than zero.`);
  return result;
}

export class ParticipantOrderIntentService {
  constructor(domain) { this.domain = domain; }

  listing(listingId) {
    const stored = this.domain.get('MARKETPLACE_LISTING', listingId);
    if (!stored) throw new Error('Marketplace listing was not found.');
    const listing = withCanonicalSraPricing(stored);
    if (!['PUBLISHED', 'ACTIVE'].includes(listing.state) || listing.status !== 'LIVE') throw new Error('Only LIVE marketplace listings can accept order intents.');
    return listing;
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
    return {
      action: 'ORDER_INTENT_PREVIEW', readOnly: true, participantId: participantId || null,
      listingId: listing.listingId, instrumentId: listing.instrumentId, market: 'SRA / USD', side, orderType,
      quantity, unit: listing.unit || 'SRA', unitPrice, quoteCurrency: 'USD', estimatedNotional: quantity * unitPrice,
      listingState: listing.state,
      pricingMethod: listing.pricing?.method || null,
      verifiedRecordedValueUsd: Number(listing.verifiedRecordedValueUsd || listing.recordedValueUsd || listing.faceValueUsd || 0),
      effect: 'Create a queued participant order intent for later matching and authorization review.',
      doesNot: ['MATCH_ORDER', 'ALLOCATE_POSITION', 'MOVE_BALANCE', 'SETTLE_VALUE', 'TRANSFER_OWNERSHIP', 'CREATE_EXPORT_PACKAGE'],
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
    await this.domain.lifecycle?.({ objectType: ORDER_INTENT_RECORD_TYPE, objectId: orderIntentId, eventType: 'PARTICIPANT_ORDER_INTENT_QUEUED', actorId: participantId, payload: { listingId: record.listingId, side: record.side, quantity: record.quantity, unitPrice: record.unitPrice } });
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
    };
  }
}
