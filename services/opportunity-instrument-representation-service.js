import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const APPROVED_INSTRUMENT_STATES = new Set(['ISSUED', 'ACTIVE']);
const digest = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16).toUpperCase();
const idsFor = (instrumentId) => {
  const suffix = digest(instrumentId);
  return {
    financialAccountId: `FRA-OPPORTUNITY-${suffix}`,
    financialRecordId: `FR-OPPORTUNITY-${suffix}`,
    coinAccountId: `CA-OPPORTUNITY-${suffix}`,
    coinPositionId: `CP-OPPORTUNITY-${suffix}`,
    lifecycleEventId: `LE-OPPORTUNITY-COIN-${suffix}`,
  };
};
const amountOf = (instrument) => Number(instrument?.faceValue ?? instrument?.authorizedAmount
  ?? instrument?.principalQuantity ?? instrument?.denomination?.principalQuantity ?? 0);
const unique = (values = []) => [...new Set(values.filter(Boolean))];

export class OpportunityInstrumentRepresentationService {
  constructor(domain) { this.domain = domain; }

  inspect(instrumentId) {
    const instrument = this.domain.get(RECORD_TYPES.SRA_INSTRUMENT, instrumentId);
    const opportunity = instrument?.opportunityId
      ? this.domain.get(RECORD_TYPES.FUNDING_OPPORTUNITY, instrument.opportunityId)
      : null;
    const ids = idsFor(instrumentId);
    const coinPosition = this.domain.get(RECORD_TYPES.COIN_POSITION, ids.coinPositionId)
      || this.domain.list(RECORD_TYPES.COIN_POSITION).find((position) => [position.instrumentId, position.sourceInstrumentId, position.linkedInstrumentId].includes(instrumentId))
      || null;
    const blockers = [];
    if (!instrument) blockers.push('INSTRUMENT_NOT_FOUND');
    if (instrument && !instrument.opportunityId) blockers.push('FUNDING_OPPORTUNITY_REQUIRED');
    if (instrument && !APPROVED_INSTRUMENT_STATES.has(String(instrument.state || instrument.status).toUpperCase())) blockers.push('ISSUED_INSTRUMENT_REQUIRED');
    if (instrument && instrument.issuanceStatus && instrument.issuanceStatus !== 'ISSUED') blockers.push('INSTRUMENT_ISSUANCE_REQUIRED');
    if (instrument?.opportunityId && !opportunity) blockers.push('FUNDING_OPPORTUNITY_NOT_FOUND');
    if (instrument && !(amountOf(instrument) > 0)) blockers.push('INSTRUMENT_AMOUNT_REQUIRED');
    return { eligible: blockers.length === 0, blockers, instrument, opportunity, coinPosition, ids, amount: amountOf(instrument) };
  }

  records(assessment, actorId, timestamp = new Date().toISOString()) {
    const { instrument, opportunity, ids, amount } = assessment;
    const ownerId = instrument.ownerId || instrument.issuerParticipantId || opportunity.applicantParticipantId || 'SRA_PLATFORM';
    const currency = String(instrument.currency || instrument.recognizedReferenceCurrency || opportunity.currency || 'USD').toUpperCase();
    const relatedAssetIds = unique([...(opportunity.relatedAssetIds || []), instrument.assetId, instrument.collateralId]);
    const relatedProjectIds = unique([...(opportunity.relatedProjectIds || []), instrument.projectId]);
    const financialAccount = {
      financialAccountId: ids.financialAccountId,
      name: opportunity.title || instrument.purpose || `Opportunity ${opportunity.opportunityId}`,
      subjectType: 'FUNDING_OPPORTUNITY_OBLIGATION',
      subjectId: opportunity.opportunityId,
      ownerId,
      currencyOrUnit: currency,
      state: 'ACTIVE',
      recordCount: 1,
      latestFinancialRecordId: ids.financialRecordId,
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const financialRecord = {
      financialRecordId: ids.financialRecordId,
      financialAccountId: ids.financialAccountId,
      recordType: 'ISSUED_FUNDING_OPPORTUNITY_OBLIGATION',
      opportunityId: opportunity.opportunityId,
      instrumentId: instrument.instrumentId,
      issuanceTransactionId: instrument.issuanceTransactionId || opportunity.issuanceTransactionId || null,
      canonicalVerifiedValueRecordId: instrument.canonicalVerifiedValueRecordId || opportunity.canonicalVerifiedValueRecordId || null,
      referencedDeterminationId: instrument.referencedDeterminationId || opportunity.determinationId || null,
      referencedSnapshotId: instrument.referencedSnapshotId || opportunity.snapshotId || null,
      identity: { subjectType: 'FUNDING_OPPORTUNITY_OBLIGATION', subjectId: opportunity.opportunityId, displayName: opportunity.title || instrument.purpose || opportunity.opportunityId },
      classification: { type: instrument.instrumentFamily || instrument.instrumentType || 'FUNDING_INSTRUMENT', fundingModel: instrument.fundingModel || null },
      recognizedPosition: { amount, unit: currency, asOf: instrument.issuedAt || timestamp, basis: 'ISSUED_INSTRUMENT_FACE_VALUE' },
      recordedValue: { amount, currency },
      recognizedReferenceValue: Number(instrument.recognizedReferenceValue || 0) || null,
      rights: instrument.rights || [],
      obligations: instrument.obligations || [],
      restrictions: instrument.restrictions || [],
      relationships: { relatedAssetIds, relatedProjectIds, collateralId: instrument.collateralId || null, servicingAccountId: instrument.servicingAccountId || opportunity.servicingAccountId || null },
      sourceLineage: { opportunityId: opportunity.opportunityId, instrumentId: instrument.instrumentId, issuanceTransactionId: instrument.issuanceTransactionId || opportunity.issuanceTransactionId || null, canonicalVerifiedValueRecordId: instrument.canonicalVerifiedValueRecordId || opportunity.canonicalVerifiedValueRecordId || null },
      state: 'RECORDED',
      statusHistory: [{ state: 'RECORDED', actorId, occurredAt: timestamp, reason: 'Issued opportunity obligation entered the Financial Record Layer.' }],
      recordedBy: actorId,
      recordedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const coinAccount = {
      coinAccountId: ids.coinAccountId,
      financialAccountId: ids.financialAccountId,
      subjectType: 'FUNDING_OPPORTUNITY_OBLIGATION',
      subjectId: opportunity.opportunityId,
      ownerId,
      symbol: 'SRA',
      state: 'ACTIVE',
      positionCount: 1,
      representedQuantity: amount,
      latestCoinPositionId: ids.coinPositionId,
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const coinPosition = {
      coinPositionId: ids.coinPositionId,
      coinAccountId: ids.coinAccountId,
      financialRecordId: ids.financialRecordId,
      financialAccountId: ids.financialAccountId,
      sourceInstrumentId: instrument.instrumentId,
      opportunityId: opportunity.opportunityId,
      issuanceTransactionId: instrument.issuanceTransactionId || opportunity.issuanceTransactionId || null,
      ownerId,
      ownerType: ownerId === 'SRA_PLATFORM' ? 'PLATFORM' : 'PARTICIPANT',
      symbol: 'SRA',
      representationType: 'FUNDING_OPPORTUNITY_OBLIGATION_POSITION',
      sourcePosition: { amount, unit: currency, asOf: instrument.issuedAt || timestamp, basis: 'ISSUED_INSTRUMENT_FACE_VALUE' },
      recordedValue: { amount, currency: currency === 'USD' ? 'USD' : currency },
      conversionRule: { method: currency === 'USD' ? 'RECORDED_USD_VALUE_AT_PAR' : 'AUTHORIZED_INSTRUMENT_DENOMINATION', rate: 1, sourceUnit: currency, coinUnit: 'SRA', methodologyReference: 'ISSUED_OPPORTUNITY_INSTRUMENT_TERMS' },
      quantity: amount,
      availableQuantity: amount,
      reservedQuantity: 0,
      externalizedQuantity: 0,
      rights: instrument.rights || [],
      obligations: instrument.obligations || [],
      restrictions: instrument.restrictions || [],
      collateral: { relatedAssetIds, relatedProjectIds, collateralId: instrument.collateralId || null },
      sourceLineage: { opportunityId: opportunity.opportunityId, financialRecordId: ids.financialRecordId, instrumentId: instrument.instrumentId, issuanceTransactionId: instrument.issuanceTransactionId || opportunity.issuanceTransactionId || null, canonicalVerifiedValueRecordId: instrument.canonicalVerifiedValueRecordId || opportunity.canonicalVerifiedValueRecordId || null },
      state: 'REPRESENTED',
      statusHistory: [{ state: 'REPRESENTED', actorId, occurredAt: timestamp, reason: 'Issued opportunity obligation prepared as an SRA Coin Position.' }],
      representedBy: actorId,
      representedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const lifecycleEvent = {
      id: ids.lifecycleEventId,
      eventId: ids.lifecycleEventId,
      objectType: RECORD_TYPES.COIN_POSITION,
      objectId: ids.coinPositionId,
      eventType: 'FUNDING_OPPORTUNITY_COIN_POSITION_PREPARED',
      actorId,
      occurredAt: timestamp,
      payload: { opportunityId: opportunity.opportunityId, instrumentId: instrument.instrumentId, financialRecordId: ids.financialRecordId, coinAccountId: ids.coinAccountId, coinPositionId: ids.coinPositionId, quantity: amount, symbol: 'SRA', effect: 'PREPARES_POSITION_FOR_GOVERNED_INSTRUMENT_LINKAGE' },
    };
    return { financialAccount, financialRecord, coinAccount, coinPosition, lifecycleEvent };
  }

  async ensureForInstrument(instrumentId, actorId = 'SRA_OPPORTUNITY_REPRESENTATION_SYSTEM') {
    const assessment = this.inspect(instrumentId);
    if (!assessment.eligible) return { created: false, assessment };
    if (assessment.coinPosition) return { created: false, assessment, coinPosition: assessment.coinPosition };
    const timestamp = new Date().toISOString();
    const records = this.records(assessment, actorId, timestamp);
    const instrument = { ...assessment.instrument, preparedFinancialRecordId: assessment.ids.financialRecordId, preparedCoinPositionId: assessment.ids.coinPositionId, updatedAt: timestamp };
    const opportunity = { ...assessment.opportunity, financialRecordId: assessment.opportunity.financialRecordId || assessment.ids.financialRecordId, preparedCoinPositionId: assessment.ids.coinPositionId, onChainStatus: assessment.opportunity.onChainStatus || 'COIN_POSITION_PREPARED', updatedAt: timestamp };
    await this.domain.atomicPut([
      { type: RECORD_TYPES.FINANCIAL_RECORD_ACCOUNT, id: assessment.ids.financialAccountId, payload: records.financialAccount, actorId, eventType: 'OPPORTUNITY_FINANCIAL_ACCOUNT_OPENED' },
      { type: RECORD_TYPES.FINANCIAL_RECORD, id: assessment.ids.financialRecordId, payload: records.financialRecord, actorId, eventType: 'OPPORTUNITY_OBLIGATION_FINANCIAL_RECORD_CREATED' },
      { type: RECORD_TYPES.COIN_ACCOUNT, id: assessment.ids.coinAccountId, payload: records.coinAccount, actorId, eventType: 'OPPORTUNITY_COIN_ACCOUNT_OPENED' },
      { type: RECORD_TYPES.COIN_POSITION, id: assessment.ids.coinPositionId, payload: records.coinPosition, actorId, eventType: 'FUNDING_OPPORTUNITY_COIN_POSITION_PREPARED' },
      { type: RECORD_TYPES.SRA_INSTRUMENT, id: instrument.instrumentId, payload: instrument, actorId, eventType: 'FUNDING_OPPORTUNITY_COIN_POSITION_PREPARED' },
      { type: RECORD_TYPES.FUNDING_OPPORTUNITY, id: opportunity.opportunityId, payload: opportunity, actorId, eventType: 'FUNDING_OPPORTUNITY_COIN_POSITION_PREPARED' },
      { type: RECORD_TYPES.LIFECYCLE_EVENT, id: records.lifecycleEvent.id, payload: records.lifecycleEvent, actorId, eventType: records.lifecycleEvent.eventType },
    ]);
    return { created: true, assessment, ...records, instrument, opportunity };
  }

  async reconcile(actorId = 'SRA_OPPORTUNITY_REPRESENTATION_SYSTEM') {
    const issued = this.domain.list(RECORD_TYPES.SRA_INSTRUMENT)
      .filter((instrument) => instrument.opportunityId)
      .filter((instrument) => APPROVED_INSTRUMENT_STATES.has(String(instrument.state || instrument.status).toUpperCase()))
      .filter((instrument) => !instrument.issuanceStatus || instrument.issuanceStatus === 'ISSUED');
    const results = [];
    for (const instrument of issued) results.push(await this.ensureForInstrument(instrument.instrumentId, actorId));
    return { inspected: issued.length, created: results.filter((result) => result.created).length, results };
  }
}

export { idsFor as opportunityInstrumentRepresentationIds };
