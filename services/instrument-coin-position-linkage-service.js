import crypto from 'node:crypto';

const INSTRUMENT_TYPE = 'SRA_INSTRUMENT';
const POSITION_TYPE = 'COIN_POSITION';
const APPROVAL_TYPE = 'INSTRUMENT_REPRESENTATION_APPROVAL';
const EVENT_TYPE = 'LIFECYCLE_EVENT';
const INSTRUMENT_STATES = new Set(['APPROVED', 'ISSUED', 'ACTIVE', 'RECORDED', 'DEPOSITED_RECOGNIZED_USD']);
const POSITION_STATES = new Set(['ACTIVE', 'REPRESENTED', 'AVAILABLE', 'RECORDED']);

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const instrumentIdOf = (record) => record?.instrumentId || record?.id || null;
const positionIdOf = (record) => record?.coinPositionId || record?.positionId || record?.id || null;
const approvalId = (instrumentId) => `IRA-${instrumentId}`;

function authorizedQuantity(instrument) {
  return number(instrument?.authorizedSupply ?? instrument?.authorizedAmount ?? instrument?.quantity
    ?? instrument?.faceAmount ?? instrument?.faceValue ?? instrument?.faceValueUsd
    ?? instrument?.principalQuantity ?? instrument?.denomination?.principalQuantity
    ?? instrument?.representedSraQuantity);
}

function availableQuantity(position) {
  const explicit = Number(position?.availableQuantity);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  return Math.max(0, number(position?.quantity) - number(position?.reservedQuantity)
    - number(position?.externalizedQuantity ?? position?.externallyTransferredQuantity));
}

function isDerivative(position) {
  const id = positionIdOf(position);
  return Boolean(position?.parentPositionId || position?.segmentationState === 'ACTIVE_CHILD'
    || (position?.sourcePositionId && position.sourcePositionId !== id));
}

function positionInstrumentId(position) {
  return position?.instrumentId || position?.sraInstrumentId || position?.linkedInstrumentId || null;
}

function instrumentPositionId(instrument) {
  return instrument?.coinPositionId || instrument?.sourcePositionId || null;
}

function linkageEvent({ instrumentId, coinPositionId, actorId, linkedAt, instrument, position }) {
  const id = `LE-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
  return {
    id,
    eventId: id,
    objectType: INSTRUMENT_TYPE,
    objectId: instrumentId,
    eventType: 'INSTRUMENT_COIN_POSITION_LINKED',
    actorId,
    occurredAt: linkedAt,
    payload: {
      instrumentId,
      coinPositionId,
      financialRecordId: position.financialRecordId || instrument.financialRecordId || null,
      authorizedQuantity: authorizedQuantity(instrument),
      availableQuantityAtLinkage: availableQuantity(position),
      effect: 'REGISTERS_SOURCE_POSITION_FOR_EXISTING_INSTRUMENT',
      doesNot: ['MINT', 'ISSUE', 'TRANSFER', 'RESERVE', 'CHANGE_BALANCE', 'CHANGE_VERIFIED_VALUE'],
    },
  };
}

export class InstrumentCoinPositionLinkageService {
  constructor(domain) { this.domain = domain; }

  evaluate(instrumentId, coinPositionId) {
    const instrument = this.domain.get(INSTRUMENT_TYPE, instrumentId);
    const position = this.domain.get(POSITION_TYPE, coinPositionId);
    const approval = this.domain.get(APPROVAL_TYPE, approvalId(instrumentId));
    const blockers = [];
    if (!instrument) blockers.push('INSTRUMENT_NOT_FOUND');
    if (!position) blockers.push('COIN_POSITION_NOT_FOUND');
    if (!instrument || !position) return { eligible: false, instrumentId, coinPositionId, blockers, instrument, position, approval };

    if (!INSTRUMENT_STATES.has(upper(instrument.state || instrument.status))) blockers.push('INSTRUMENT_NOT_APPROVED');
    if (approval?.state !== 'APPROVED') blockers.push('REPRESENTATION_APPROVAL_REQUIRED');
    if (!POSITION_STATES.has(upper(position.state || position.status))) blockers.push('COIN_POSITION_NOT_ACTIVE');
    if (isDerivative(position)) blockers.push('ROOT_COIN_POSITION_REQUIRED');
    if (upper(position.symbol || position.assetCode || 'SRA') !== 'SRA') blockers.push('SRA_DENOMINATION_REQUIRED');
    if (!text(position.ownerId || position.participantId || position.coinAccountId)) blockers.push('COIN_POSITION_AUTHORITY_REQUIRED');
    if (Array.isArray(position.restrictions) && position.restrictions.length) blockers.push('COIN_POSITION_RESTRICTED');
    if (position.frozen || position.complianceHold || position.transferRestricted || position.externalTransferRestricted || position.disputeState === 'OPEN') blockers.push('COIN_POSITION_RESTRICTED');
    const existingPositionId = instrumentPositionId(instrument);
    const existingInstrumentId = positionInstrumentId(position);
    const fullyLinked = existingPositionId === coinPositionId
      && existingInstrumentId === instrumentId
      && (approval?.linkedCoinPositionIds || []).includes(coinPositionId);
    if (existingPositionId && existingPositionId !== coinPositionId) blockers.push('INSTRUMENT_ALREADY_LINKED');
    if (existingInstrumentId && existingInstrumentId !== instrumentId) blockers.push('COIN_POSITION_ALREADY_LINKED');
    const required = authorizedQuantity(instrument);
    const available = availableQuantity(position);
    if (!fullyLinked && !(required > 0)) blockers.push('INSTRUMENT_AUTHORIZED_QUANTITY_REQUIRED');
    if (!fullyLinked && required > available) blockers.push('INSUFFICIENT_AVAILABLE_QUANTITY');

    return {
      eligible: blockers.length === 0,
      alreadyLinked: fullyLinked,
      instrumentId,
      coinPositionId,
      blockers,
      authorizedQuantity: required,
      availableQuantity: available,
      instrument,
      position,
      approval,
    };
  }

  read() {
    const instruments = this.domain.list(INSTRUMENT_TYPE)
      .filter((item) => INSTRUMENT_STATES.has(upper(item.state || item.status)))
      .map((instrument) => {
        const instrumentId = instrumentIdOf(instrument);
        const approval = this.domain.get(APPROVAL_TYPE, approvalId(instrumentId));
        return {
          instrumentId,
          state: upper(instrument.state || instrument.status),
          instrumentType: instrument.instrumentType || instrument.type || 'INSTRUMENT',
          authorizedQuantity: authorizedQuantity(instrument),
          financialRecordId: instrument.financialRecordId || null,
          obligationId: instrument.obligationId || null,
          collateralId: instrument.collateralId || instrument.assetId || null,
          coinPositionId: instrumentPositionId(instrument),
          representationApproved: approval?.state === 'APPROVED',
        };
      });
    const positions = this.domain.list(POSITION_TYPE).map((position) => ({
      coinPositionId: positionIdOf(position),
      state: upper(position.state || position.status),
      symbol: upper(position.symbol || position.assetCode || 'SRA'),
      quantity: number(position.quantity),
      availableQuantity: availableQuantity(position),
      financialRecordId: position.financialRecordId || null,
      ownerId: position.ownerId || position.participantId || position.coinAccountId || null,
      instrumentId: positionInstrumentId(position),
      rootPosition: !isDerivative(position),
      restricted: Array.isArray(position.restrictions) && position.restrictions.length > 0,
    }));
    return { model: 'INSTRUMENT_COIN_POSITION_LINKAGE', instruments, positions };
  }

  async link(instrumentId, coinPositionId, actorId = 'SRA_PLATFORM_ADMIN') {
    const assessment = this.evaluate(instrumentId, coinPositionId);
    if (!assessment.eligible) {
      const error = new Error(`Coin Position linkage is blocked: ${assessment.blockers.join(', ')}`);
      error.code = 'INSTRUMENT_COIN_POSITION_LINKAGE_BLOCKED';
      error.assessment = assessment;
      throw error;
    }
    if (assessment.alreadyLinked) return { changed: false, assessment, instrument: assessment.instrument, coinPosition: assessment.position };

    const linkedAt = new Date().toISOString();
    const instrument = {
      ...assessment.instrument,
      coinPositionId,
      linkedCoinPositionIds: [...new Set([...(assessment.instrument.linkedCoinPositionIds || []), coinPositionId])],
      coinPositionLinkedAt: linkedAt,
      coinPositionLinkedBy: actorId,
      updatedAt: linkedAt,
    };
    const coinPosition = {
      ...assessment.position,
      instrumentId,
      linkedInstrumentId: instrumentId,
      instrumentLinkedAt: linkedAt,
      instrumentLinkedBy: actorId,
      updatedAt: linkedAt,
    };
    const approval = {
      ...assessment.approval,
      linkedCoinPositionIds: [...new Set([...(assessment.approval.linkedCoinPositionIds || []), coinPositionId])],
      updatedAt: linkedAt,
    };
    const event = linkageEvent({ instrumentId, coinPositionId, actorId, linkedAt, instrument, position: coinPosition });

    await this.domain.atomicPut([
      { type: INSTRUMENT_TYPE, id: instrumentId, payload: instrument, actorId, eventType: 'INSTRUMENT_COIN_POSITION_LINKED' },
      { type: POSITION_TYPE, id: coinPositionId, payload: coinPosition, actorId, eventType: 'INSTRUMENT_COIN_POSITION_LINKED' },
      { type: APPROVAL_TYPE, id: approval.approvalId || approval.id, payload: approval, actorId, eventType: 'INSTRUMENT_COIN_POSITION_LINKED' },
      { type: EVENT_TYPE, id: event.id, payload: event, actorId, eventType: 'INSTRUMENT_COIN_POSITION_LINKED' },
    ]);
    return { changed: true, assessment: this.evaluate(instrumentId, coinPositionId), instrument, coinPosition, approval, event };
  }
}

export const INSTRUMENT_COIN_POSITION_LINKAGE_EVENT = 'INSTRUMENT_COIN_POSITION_LINKED';
