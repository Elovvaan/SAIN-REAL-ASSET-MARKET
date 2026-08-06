import crypto from 'node:crypto';
import { PreAllocationReservationService } from './pre-allocation-reservation-service.js';
import { AllocationApprovalService } from './allocation-approval-service.js';

const TRANSACTION_TYPE = 'SRA_TRANSACTION';
function now() { return new Date().toISOString(); }
function id() { return `OMR-${crypto.randomUUID().toUpperCase()}`; }
function isIntent(record) { return record?.transactionType === 'PARTICIPANT_ORDER_INTENT'; }
function isReview(record) { return record?.transactionType === 'ORDER_MATCH_REVIEW'; }
function openIntent(record) { return isIntent(record) && record.state === 'QUEUED_FOR_ORDER_REVIEW' && ['NOT_STARTED', 'REVIEW_PENDING'].includes(record.matchingState || 'NOT_STARTED'); }
function compatiblePrice(buy, sell) { return buy.orderType === 'MARKET' || sell.orderType === 'MARKET' || Number(buy.unitPrice || 0) >= Number(sell.unitPrice || 0); }
function proposedPrice(buy, sell) { return buy.orderType === 'LIMIT' && sell.orderType === 'LIMIT' ? Number(((Number(buy.unitPrice) + Number(sell.unitPrice)) / 2).toFixed(8)) : Number(sell.unitPrice || buy.unitPrice || 0); }

export class OrderReviewMatchingService {
  constructor(domain) {
    this.domain = domain;
    this.reservations = new PreAllocationReservationService(domain);
    this.allocations = new AllocationApprovalService(domain);
  }
  intents() { return this.domain.list(TRANSACTION_TYPE).filter(openIntent); }
  queue() {
    const intents = this.intents();
    const byListing = new Map();
    for (const intent of intents) {
      if (!byListing.has(intent.listingId)) byListing.set(intent.listingId, { listingId: intent.listingId, instrumentId: intent.instrumentId, buys: [], sells: [] });
      byListing.get(intent.listingId)[intent.side === 'BUY' ? 'buys' : 'sells'].push(intent);
    }
    const markets = [...byListing.values()].map((entry) => ({ ...entry,
      buys: entry.buys.sort((a, b) => Number(b.unitPrice) - Number(a.unitPrice) || String(a.createdAt).localeCompare(String(b.createdAt))),
      sells: entry.sells.sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice) || String(a.createdAt).localeCompare(String(b.createdAt))) }));
    return { generatedAt: now(), state: intents.length ? 'ORDER_REVIEW_WAITING' : 'CURRENT', queuedIntentCount: intents.length,
      buyIntentCount: intents.filter((item) => item.side === 'BUY').length, sellIntentCount: intents.filter((item) => item.side === 'SELL').length,
      listingCount: markets.length, markets: markets.map((entry) => ({ listingId: entry.listingId, instrumentId: entry.instrumentId,
        buyCount: entry.buys.length, sellCount: entry.sells.length,
        buyQuantity: entry.buys.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        sellQuantity: entry.sells.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        bestBid: entry.buys[0]?.unitPrice || null, bestAsk: entry.sells[0]?.unitPrice || null,
        matchPossible: Boolean(entry.buys[0] && entry.sells[0] && compatiblePrice(entry.buys[0], entry.sells[0])) })),
      protectedBoundary: ['NO_BALANCE_MOVEMENT', 'NO_POSITION_ALLOCATION', 'NO_SETTLEMENT', 'NO_OWNERSHIP_TRANSFER'] };
  }
  preview(input = {}) {
    const action = String(input.action || '').toUpperCase();
    if (action === 'RESERVE') return this.reservations.preview(input);
    if (action === 'ALLOCATE') return this.allocations.preview(input);
    const listingId = String(input.listingId || '').trim();
    if (!listingId) throw new Error('listingId is required.');
    const listing = this.domain.get('MARKETPLACE_LISTING', listingId);
    if (!listing || !['PUBLISHED', 'ACTIVE'].includes(listing.state) || listing.status !== 'LIVE') throw new Error('The listing is not currently LIVE.');
    const intents = this.intents().filter((item) => item.listingId === listingId);
    const buys = intents.filter((item) => item.side === 'BUY').sort((a, b) => Number(b.unitPrice) - Number(a.unitPrice) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const sells = intents.filter((item) => item.side === 'SELL').sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const buy = buys[0] || null; const sell = sells[0] || null;
    if (!buy || !sell) return { action: 'ORDER_MATCH_PREVIEW', readOnly: true, listingId, instrumentId: listing.instrumentId, state: 'NO_COMPATIBLE_COUNTERSIDE', matchPossible: false, reason: !buy ? 'No queued BUY intent exists.' : 'No queued SELL intent exists.', approvalRequired: true };
    if (!compatiblePrice(buy, sell)) return { action: 'ORDER_MATCH_PREVIEW', readOnly: true, listingId, instrumentId: listing.instrumentId, state: 'PRICE_NOT_CROSSED', matchPossible: false, bestBid: buy.unitPrice, bestAsk: sell.unitPrice, reason: 'The best bid is below the best ask.', approvalRequired: true };
    const matchedQuantity = Math.min(Number(buy.quantity), Number(sell.quantity)); const matchPrice = proposedPrice(buy, sell);
    return { action: 'ORDER_MATCH_PREVIEW', readOnly: true, listingId, instrumentId: listing.instrumentId, state: 'MATCH_PROPOSED', matchPossible: true,
      buyIntentId: buy.orderIntentId, sellIntentId: sell.orderIntentId, buyerParticipantId: buy.participantId, sellerParticipantId: sell.participantId,
      matchedQuantity, unit: buy.unit || sell.unit || 'SRA', matchPrice, quoteCurrency: 'USD', proposedNotional: matchedQuantity * matchPrice,
      effect: 'Record an administrator-approved proposed match and move both intents to MATCH_APPROVED_PENDING_ALLOCATION.',
      doesNot: ['ALLOCATE_POSITION', 'MOVE_BALANCE', 'SETTLE_VALUE', 'TRANSFER_OWNERSHIP', 'CREATE_EXPORT_PACKAGE'], approvalRequired: true };
  }
  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    const action = String(input.action || '').toUpperCase();
    if (action === 'RESERVE') return this.reservations.approve(input, actorId);
    if (action === 'ALLOCATE') return this.allocations.approve(input, actorId);
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit order-match approval is required.');
    const preview = this.preview(input); if (!preview.matchPossible) throw new Error(preview.reason || 'No compatible order match is available.');
    const approvedAt = now(); const matchReviewId = id();
    const review = { transactionId: matchReviewId, transactionType: 'ORDER_MATCH_REVIEW', matchReviewId,
      listingId: preview.listingId, instrumentId: preview.instrumentId, buyIntentId: preview.buyIntentId, sellIntentId: preview.sellIntentId,
      buyerParticipantId: preview.buyerParticipantId, sellerParticipantId: preview.sellerParticipantId,
      matchedQuantity: preview.matchedQuantity, unit: preview.unit, matchPrice: preview.matchPrice, quoteCurrency: preview.quoteCurrency,
      proposedNotional: preview.proposedNotional, state: 'MATCH_APPROVED_PENDING_ALLOCATION', approvedBy: actorId, approvedAt,
      allocationState: 'NOT_STARTED', settlementState: 'NOT_STARTED', ownershipTransferState: 'NOT_STARTED', createdAt: approvedAt, updatedAt: approvedAt,
      statusHistory: [{ state: 'MATCH_APPROVED_PENDING_ALLOCATION', actorId, occurredAt: approvedAt }] };
    await this.domain.put(TRANSACTION_TYPE, matchReviewId, review, { actorId, eventType: 'ORDER_MATCH_REVIEW_APPROVED' });
    for (const intentId of [preview.buyIntentId, preview.sellIntentId]) {
      const intent = this.domain.get(TRANSACTION_TYPE, intentId); if (!intent || !openIntent(intent)) continue;
      await this.domain.put(TRANSACTION_TYPE, intentId, { ...intent, state: 'MATCH_APPROVED_PENDING_ALLOCATION', matchingState: 'MATCH_APPROVED', matchReviewId,
        matchedQuantity: preview.matchedQuantity, matchPrice: preview.matchPrice, updatedAt: approvedAt,
        statusHistory: [...(intent.statusHistory || []), { state: 'MATCH_APPROVED_PENDING_ALLOCATION', actorId, occurredAt: approvedAt }] },
      { actorId, eventType: 'PARTICIPANT_ORDER_INTENT_MATCH_APPROVED' });
    }
    return review;
  }
  reviews() { return this.domain.list(TRANSACTION_TYPE).filter(isReview).sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt))); }
  status() {
    const queue = this.queue(); const reviews = this.reviews();
    return { ...queue, approvedMatchCount: reviews.length,
      pendingAllocationCount: reviews.filter((item) => item.state === 'MATCH_APPROVED_PENDING_ALLOCATION').length,
      latestApprovedMatch: reviews[0] || null, reservations: this.reservations.status(), allocations: this.allocations.status() };
  }
}
