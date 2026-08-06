const TRANSACTION_TYPE = 'SRA_TRANSACTION';
const FUNDING_TYPES = ['COIN_ACCOUNT', 'COIN_POSITION', 'PARTICIPATION_POSITION', 'TRANSFERABLE_POSITION'];
const POSITION_TYPES = ['COIN_POSITION', 'PARTICIPATION_POSITION', 'TRANSFERABLE_POSITION'];
const settlementLocks = new Map();

function now() { return new Date().toISOString(); }
function settlementId(allocationId) { return `STL-${String(allocationId).replace(/^ALC-/, '')}`; }
function ownershipId(allocationId) { return `OWN-${String(allocationId).replace(/^ALC-/, '')}`; }
function buyerPositionId(allocationId) { return `CP-${String(allocationId).replace(/^ALC-/, '')}`; }
function ownerId(record) { return record?.participantId || record?.ownerParticipantId || record?.ownerId || record?.accountHolderId || record?.holderId || null; }
function denomination(record) { return String(record?.currency || record?.quoteCurrency || record?.unit || record?.symbol || record?.denomination?.symbol || '').toUpperCase(); }
function linkedInstrumentId(record) { return record?.instrumentId || record?.linkedInstrumentId || record?.underlyingInstrumentId || null; }
function numericField(record, fields) {
  for (const field of fields) {
    const value = field.split('.').reduce((current, part) => current?.[part], record);
    if (Number.isFinite(Number(value))) return { field, value: Number(value) };
  }
  return null;
}
function setPath(record, path, value) {
  const clone = structuredClone(record);
  const parts = path.split('.');
  let current = clone;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current[parts[index]] = current[parts[index]] && typeof current[parts[index]] === 'object' ? current[parts[index]] : {};
    current = current[parts[index]];
  }
  current[parts.at(-1)] = value;
  return clone;
}

export class SettlementAuthorizationService {
  constructor(domain) { this.domain = domain; }

  resolve(types, id, label) {
    for (const type of types) {
      const record = this.domain.get(type, id);
      if (record) return { type, record };
    }
    throw new Error(`${label} was not found.`);
  }

  allocation(allocationId) {
    const allocation = this.domain.get(TRANSACTION_TYPE, allocationId);
    if (!allocation || allocation.transactionType !== 'POSITION_ALLOCATION_APPROVAL') throw new Error('Allocation approval was not found.');
    if (allocation.state !== 'ALLOCATION_APPROVED_PENDING_SETTLEMENT' || allocation.settlementState !== 'NOT_STARTED') throw new Error('Allocation is not awaiting settlement authorization.');
    if (allocation.settlementId || this.domain.get(TRANSACTION_TYPE, settlementId(allocationId))) throw new Error('Allocation has already been settled or claimed for settlement.');
    return allocation;
  }

  reservation(allocation) {
    const reservation = this.domain.get(TRANSACTION_TYPE, allocation.reservationId);
    if (!reservation || reservation.transactionType !== 'PRE_ALLOCATION_RESERVATION') throw new Error('Linked reservation was not found.');
    if (reservation.state !== 'ALLOCATION_APPROVED_PENDING_SETTLEMENT') throw new Error('Linked reservation is not awaiting settlement.');
    if (reservation.valueReservation?.state !== 'HELD' || reservation.positionReservation?.state !== 'HELD') throw new Error('Both reservation holds must remain active through settlement.');
    if (reservation.allocationId !== allocation.allocationId) throw new Error('Reservation is not linked to this allocation.');
    return reservation;
  }

  validateFundingRecord(source, participantId, amount, role) {
    if (ownerId(source.record) !== participantId) throw new Error(`${role} source is not owned by the expected participant.`);
    const currency = denomination(source.record);
    const isUsd = currency === 'USD';
    const isParSra = currency === 'SRA' && (source.record.pricingPolicy === 'FIXED_PAR' || Number(source.record.parValue) === 1 || Number(source.record.unitPrice) === 1);
    if (!isUsd && !isParSra) throw new Error(`${role} source must be denominated in USD or fixed-par SRA.`);
    const balance = numericField(source.record, ['availableBalance', 'availableAmount', 'spendableBalance', 'balance.available', 'balance', 'quantityAvailable', 'availableQuantity', 'quantity']);
    if (!balance) throw new Error(`${role} source does not expose a usable balance.`);
    if (role === 'Buyer funding' && balance.value < amount) throw new Error('Buyer funding source no longer covers the reserved value.');
    return { ...source, currency, balance };
  }

  validateSellerPosition(reservation, quantity) {
    const position = this.resolve(POSITION_TYPES, reservation.sellerPositionId, 'Seller position');
    if (position.type !== reservation.sellerPositionType) throw new Error('Seller position type changed after reservation.');
    if (ownerId(position.record) !== reservation.sellerParticipantId) throw new Error('Seller no longer owns the reserved position.');
    if (linkedInstrumentId(position.record) !== reservation.instrumentId) throw new Error('Seller position no longer represents the matched instrument.');
    const available = numericField(position.record, ['availableQuantity', 'quantityAvailable', 'transferableQuantity', 'balance.available', 'quantity', 'balance']);
    if (!available || available.value < quantity) throw new Error('Seller position no longer covers the reserved quantity.');
    return { ...position, available };
  }

  preview(input = {}) {
    const allocation = this.allocation(String(input.allocationId || '').trim());
    const reservation = this.reservation(allocation);
    const sellerSettlementDestinationId = String(input.sellerSettlementDestinationId || '').trim();
    if (!sellerSettlementDestinationId) throw new Error('sellerSettlementDestinationId is required.');
    const amount = Number(reservation.valueReservation.amount);
    const quantity = Number(reservation.positionReservation.quantity);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Settlement amounts are invalid.');
    const buyerSource = this.resolve([reservation.buyerReservationSourceType], reservation.buyerReservationSourceId, 'Buyer funding source');
    const validatedBuyer = this.validateFundingRecord(buyerSource, reservation.buyerParticipantId, amount, 'Buyer funding');
    const sellerDestination = this.resolve(FUNDING_TYPES, sellerSettlementDestinationId, 'Seller settlement destination');
    const validatedSellerDestination = this.validateFundingRecord(sellerDestination, reservation.sellerParticipantId, 0, 'Seller settlement destination');
    if (validatedBuyer.currency !== validatedSellerDestination.currency) throw new Error('Buyer funding and seller settlement destination must use the same settlement denomination.');
    const sellerPosition = this.validateSellerPosition(reservation, quantity);
    return {
      action: 'SETTLEMENT_AUTHORIZATION_PREVIEW', readOnly: true,
      allocationId: allocation.allocationId || allocation.transactionId,
      reservationId: reservation.reservationId || reservation.transactionId,
      matchReviewId: allocation.matchReviewId,
      listingId: allocation.listingId, instrumentId: allocation.instrumentId,
      buyerParticipantId: allocation.buyerParticipantId, sellerParticipantId: allocation.sellerParticipantId,
      buyerReservationSourceId: reservation.buyerReservationSourceId,
      buyerReservationSourceType: reservation.buyerReservationSourceType,
      sellerSettlementDestinationId,
      sellerSettlementDestinationType: validatedSellerDestination.type,
      sellerPositionId: reservation.sellerPositionId,
      sellerPositionType: sellerPosition.type,
      amount, currency: validatedBuyer.currency, quantity,
      buyerBalanceBefore: validatedBuyer.balance.value,
      sellerBalanceBefore: validatedSellerDestination.balance.value,
      sellerQuantityBefore: sellerPosition.available.value,
      buyerPositionId: buyerPositionId(allocation.allocationId || allocation.transactionId),
      effect: 'Atomically debit the validated buyer source, credit the seller destination, reduce the seller position, create the buyer position, release both holds, recognize ownership, and complete the transaction.',
      approvalRequired: true,
      atomicCompletionRequired: true,
      doesNot: ['CREATE_EXPORT_PACKAGE', 'ENABLE_EXTERNAL_WITHDRAWAL'],
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit settlement authorization is required.');
    const allocationId = String(input.allocationId || '').trim();
    if (!allocationId) throw new Error('allocationId is required.');
    const prior = settlementLocks.get(allocationId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    settlementLocks.set(allocationId, prior.then(() => current));
    await prior;
    try {
      const preview = this.preview(input);
      const completedAt = now();
      const sid = settlementId(allocationId);
      const oid = ownershipId(allocationId);
      const allocation = this.allocation(allocationId);
      const reservation = this.reservation(allocation);
      const buyerSource = this.resolve([preview.buyerReservationSourceType], preview.buyerReservationSourceId, 'Buyer funding source');
      const sellerDestination = this.resolve([preview.sellerSettlementDestinationType], preview.sellerSettlementDestinationId, 'Seller settlement destination');
      const sellerPosition = this.resolve([preview.sellerPositionType], preview.sellerPositionId, 'Seller position');
      const buyerBalance = numericField(buyerSource.record, ['availableBalance', 'availableAmount', 'spendableBalance', 'balance.available', 'balance', 'quantityAvailable', 'availableQuantity', 'quantity']);
      const sellerBalance = numericField(sellerDestination.record, ['availableBalance', 'availableAmount', 'spendableBalance', 'balance.available', 'balance', 'quantityAvailable', 'availableQuantity', 'quantity']);
      const sellerQuantity = numericField(sellerPosition.record, ['availableQuantity', 'quantityAvailable', 'transferableQuantity', 'balance.available', 'quantity', 'balance']);
      if (!buyerBalance || buyerBalance.value < preview.amount) throw new Error('Buyer funding source changed and is no longer sufficient.');
      if (!sellerBalance) throw new Error('Seller settlement destination no longer exposes a balance.');
      if (!sellerQuantity || sellerQuantity.value < preview.quantity) throw new Error('Seller position changed and is no longer sufficient.');

      const updatedBuyerSource = setPath(buyerSource.record, buyerBalance.field, buyerBalance.value - preview.amount);
      const updatedSellerDestination = setPath(sellerDestination.record, sellerBalance.field, sellerBalance.value + preview.amount);
      const updatedSellerPosition = setPath(sellerPosition.record, sellerQuantity.field, sellerQuantity.value - preview.quantity);
      const buyerPosition = {
        coinPositionId: preview.buyerPositionId, positionId: preview.buyerPositionId,
        participantId: preview.buyerParticipantId, ownerParticipantId: preview.buyerParticipantId,
        instrumentId: preview.instrumentId, linkedInstrumentId: preview.instrumentId,
        quantity: preview.quantity, availableQuantity: preview.quantity, unit: 'SRA',
        state: 'ACTIVE', ownershipState: 'RECOGNIZED', settlementId: sid,
        acquiredAt: completedAt, createdAt: completedAt, updatedAt: completedAt,
      };
      const ownership = {
        ownershipRecognitionId: oid, instrumentId: preview.instrumentId, positionId: preview.buyerPositionId,
        participantId: preview.buyerParticipantId, previousParticipantId: preview.sellerParticipantId,
        quantity: preview.quantity, unit: 'SRA', state: 'RECOGNIZED', settlementId: sid,
        recognizedBy: actorId, recognizedAt: completedAt, createdAt: completedAt, updatedAt: completedAt,
      };
      const settlement = {
        transactionId: sid, settlementId: sid, transactionType: 'ATOMIC_ORDER_SETTLEMENT',
        allocationId: preview.allocationId, reservationId: preview.reservationId, matchReviewId: preview.matchReviewId,
        listingId: preview.listingId, instrumentId: preview.instrumentId,
        buyerParticipantId: preview.buyerParticipantId, sellerParticipantId: preview.sellerParticipantId,
        buyerPositionId: preview.buyerPositionId, ownershipRecognitionId: oid,
        amount: preview.amount, currency: preview.currency, quantity: preview.quantity,
        state: 'SETTLED', allocationState: 'COMPLETED', settlementState: 'SETTLED',
        ownershipTransferState: 'RECOGNIZED', holdsState: 'RELEASED_AND_CONSUMED',
        approvedBy: actorId, approvedAt: completedAt, settledAt: completedAt,
        createdAt: completedAt, updatedAt: completedAt,
        statusHistory: [{ state: 'SETTLED', actorId, occurredAt: completedAt }],
      };
      const updatedReservation = {
        ...reservation, state: 'SETTLED', settlementId: sid, settlementState: 'SETTLED', ownershipTransferState: 'RECOGNIZED',
        valueReservation: { ...reservation.valueReservation, state: 'CONSUMED' },
        positionReservation: { ...reservation.positionReservation, state: 'CONSUMED' },
        updatedAt: completedAt,
        statusHistory: [...(reservation.statusHistory || []), { state: 'SETTLED', actorId, occurredAt: completedAt }],
      };
      const updatedAllocation = {
        ...allocation, state: 'SETTLED', settlementId: sid, settlementState: 'SETTLED', allocationState: 'COMPLETED',
        ownershipTransferState: 'RECOGNIZED', pendingPosition: { ...allocation.pendingPosition, state: 'ACTIVE' }, updatedAt: completedAt,
        statusHistory: [...(allocation.statusHistory || []), { state: 'SETTLED', actorId, occurredAt: completedAt }],
      };
      const review = this.domain.get(TRANSACTION_TYPE, preview.matchReviewId);
      if (!review || review.transactionType !== 'ORDER_MATCH_REVIEW' || review.allocationId !== allocationId) throw new Error('Linked order-match review is inconsistent.');
      const updatedReview = {
        ...review, state: 'SETTLED', settlementId: sid, settlementState: 'SETTLED', allocationState: 'COMPLETED',
        ownershipTransferState: 'RECOGNIZED', updatedAt: completedAt,
        statusHistory: [...(review.statusHistory || []), { state: 'SETTLED', actorId, occurredAt: completedAt }],
      };
      if (typeof this.domain.atomicPut !== 'function') throw new Error('Atomic settlement persistence is unavailable.');
      await this.domain.atomicPut([
        { type: preview.buyerReservationSourceType, id: preview.buyerReservationSourceId, payload: updatedBuyerSource, actorId, eventType: 'BUYER_SETTLEMENT_SOURCE_DEBITED' },
        { type: preview.sellerSettlementDestinationType, id: preview.sellerSettlementDestinationId, payload: updatedSellerDestination, actorId, eventType: 'SELLER_SETTLEMENT_DESTINATION_CREDITED' },
        { type: preview.sellerPositionType, id: preview.sellerPositionId, payload: updatedSellerPosition, actorId, eventType: 'SELLER_POSITION_SETTLED' },
        { type: 'COIN_POSITION', id: preview.buyerPositionId, payload: buyerPosition, actorId, eventType: 'BUYER_POSITION_CREATED' },
        { type: 'OWNERSHIP_RECOGNITION', id: oid, payload: ownership, actorId, eventType: 'OWNERSHIP_RECOGNIZED' },
        { type: TRANSACTION_TYPE, id: sid, payload: settlement, actorId, eventType: 'ORDER_SETTLEMENT_COMPLETED' },
        { type: TRANSACTION_TYPE, id: preview.reservationId, payload: updatedReservation, actorId, eventType: 'RESERVATION_CONSUMED' },
        { type: TRANSACTION_TYPE, id: preview.allocationId, payload: updatedAllocation, actorId, eventType: 'ALLOCATION_SETTLED' },
        { type: TRANSACTION_TYPE, id: preview.matchReviewId, payload: updatedReview, actorId, eventType: 'ORDER_MATCH_SETTLED' },
      ]);
      return settlement;
    } finally {
      release();
      if (settlementLocks.get(allocationId) === current) settlementLocks.delete(allocationId);
    }
  }

  list() {
    return this.domain.list(TRANSACTION_TYPE)
      .filter((item) => item.transactionType === 'ATOMIC_ORDER_SETTLEMENT')
      .sort((a, b) => String(b.settledAt).localeCompare(String(a.settledAt)));
  }

  status() {
    const settlements = this.list();
    return { settlementCount: settlements.length, completed: settlements.filter((item) => item.state === 'SETTLED').length, latestSettlement: settlements[0] || null };
  }
}
