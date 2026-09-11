import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';
import { DETERMINATION_RECORD_TYPES } from './determination-engine-service.js';

const UNIT_ID = 'SRA-RVU';
const PRODUCTIVE_VALUE_CLASSES = Object.freeze([
  'EXISTING_ASSET', 'AVAILABLE_PRODUCTION', 'COMMITTED_PRODUCTION', 'POTENTIAL_CAPACITY',
  'COMPLETED_WORK', 'RECEIVABLE', 'ESSENTIAL_RESOURCE', 'INFRASTRUCTURE_CAPACITY', 'MIXED', 'UNCLASSIFIED',
]);
const ECONOMIC_PURPOSE_CLASSES = Object.freeze([
  'PRODUCTIVE', 'ACQUISITION', 'INFRASTRUCTURE', 'WORKING_CAPITAL',
  'SETTLEMENT', 'PROTECTION', 'RECOVERY', 'CONSUMPTION', 'UNCLASSIFIED',
]);

const now = () => new Date().toISOString();
const clean = (value, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const upper = (value, max) => clean(value, max).toUpperCase();
const makeId = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;

function positive(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be a positive number.`);
  return Number(parsed.toFixed(8));
}

function choice(value, allowed, fallback = 'UNCLASSIFIED') {
  const selected = upper(value, 80) || fallback;
  if (!allowed.includes(selected)) throw new Error(`Unsupported classification: ${selected}.`);
  return selected;
}

export class RecognizedValueUnitService {
  constructor(domain) { this.domain = domain; }

  async initialize() {
    await this.domain.hydrate?.([
      RECORD_TYPES.SRA_RECOGNIZED_VALUE_UNIT,
      RECORD_TYPES.SRA_RVU_RECOGNITION,
      RECORD_TYPES.SRA_SETTLEMENT_EQUIVALENCE,
    ]);
    if (!this.domain.get(RECORD_TYPES.SRA_RECOGNIZED_VALUE_UNIT, UNIT_ID)) {
      const definition = {
        id: UNIT_ID,
        recognizedValueUnitId: UNIT_ID,
        code: 'SRA/RVU',
        name: 'SRA Recognized Value Unit',
        unitValue: 1,
        state: 'ACTIVE',
        purpose: 'NEUTRAL_INTERNAL_MEASUREMENT_OF_VERIFIED_PRODUCTIVE_VALUE',
        classification: 'ACCOUNTING_MEASUREMENT',
        isCurrency: false,
        isToken: false,
        isSettlementAsset: false,
        createsPaymentRights: false,
        governingRule: 'VALUE_IS_RECOGNIZED_BEFORE_THE_SETTLEMENT_MEDIUM_IS_SELECTED',
        createdAt: now(),
      };
      await this.domain.put(RECORD_TYPES.SRA_RECOGNIZED_VALUE_UNIT, UNIT_ID, definition, { audit: false });
    }
    return this.status();
  }

  definition() { return this.domain.get(RECORD_TYPES.SRA_RECOGNIZED_VALUE_UNIT, UNIT_ID); }
  recognitions(opportunityId = null) {
    return this.domain.list(RECORD_TYPES.SRA_RVU_RECOGNITION)
      .filter((item) => !opportunityId || item.opportunityId === opportunityId);
  }
  equivalences(opportunityId = null) {
    return this.domain.list(RECORD_TYPES.SRA_SETTLEMENT_EQUIVALENCE)
      .filter((item) => !opportunityId || item.opportunityId === opportunityId);
  }
  recognitionForOpportunity(opportunityId) {
    return this.recognitions(opportunityId).sort((a, b) => String(b.recognizedAt).localeCompare(String(a.recognizedAt)))[0] || null;
  }

  status() {
    const recognitions = this.recognitions();
    const equivalences = this.equivalences();
    return {
      definition: this.definition(),
      recognizedOpportunityCount: new Set(recognitions.map((item) => item.opportunityId)).size,
      totalRecognizedRvu: Number(recognitions.reduce((sum, item) => sum + Number(item.recognizedRvu || 0), 0).toFixed(8)),
      settlementEquivalenceCount: equivalences.length,
      productiveValueClasses: [...PRODUCTIVE_VALUE_CLASSES],
      economicPurposeClasses: [...ECONOMIC_PURPOSE_CLASSES],
    };
  }

  async recognizeFundingOpportunity(preparation, canonicalVerifiedValueRecord, actorId = null) {
    if (!preparation?.opportunityId) throw new Error('A funding value preparation is required.');
    if (!canonicalVerifiedValueRecord?.verifiedValueRecordId || canonicalVerifiedValueRecord.state !== 'CANONICAL') {
      throw new Error('A canonical Verified Value Record is required before SRA/RVU recognition.');
    }
    const existing = this.recognitionForOpportunity(preparation.opportunityId);
    if (existing) {
      if (existing.canonicalVerifiedValueRecordId !== canonicalVerifiedValueRecord.verifiedValueRecordId) {
        throw new Error('The opportunity already has an SRA/RVU recognition tied to a different canonical value record.');
      }
      return existing;
    }
    const recognizedRvu = positive(canonicalVerifiedValueRecord.value, 'canonical verified value');
    const rvuRecognitionId = `RVU-${preparation.opportunityId}`;
    const record = {
      id: rvuRecognitionId,
      rvuRecognitionId,
      recognizedValueUnitId: UNIT_ID,
      recognitionUnit: 'SRA/RVU',
      opportunityId: preparation.opportunityId,
      valuePreparationId: preparation.preparationId,
      verifiedRecordId: preparation.verifiedRecordId,
      canonicalVerifiedValueRecordId: canonicalVerifiedValueRecord.verifiedValueRecordId,
      determinationId: canonicalVerifiedValueRecord.determinationId,
      snapshotId: canonicalVerifiedValueRecord.snapshotId,
      recognizedRvu,
      sourceValue: positive(canonicalVerifiedValueRecord.value, 'canonical verified value'),
      sourceCurrency: upper(canonicalVerifiedValueRecord.currency, 16) || null,
      productiveValueClass: choice(preparation.productiveValueClass, PRODUCTIVE_VALUE_CLASSES),
      economicPurposeClass: choice(preparation.economicPurposeClass, ECONOMIC_PURPOSE_CLASSES),
      deliverability: preparation.deliverability && typeof preparation.deliverability === 'object'
        ? structuredClone(preparation.deliverability) : {},
      state: 'RECOGNIZED',
      immutableSourceReference: true,
      boundaries: {
        createsCurrency: false,
        createsToken: false,
        createsSettlement: false,
        changesInstrumentIdentity: false,
        changesOwnership: false,
      },
      recognizedBy: actorId,
      recognizedAt: now(),
    };
    await this.domain.put(RECORD_TYPES.SRA_RVU_RECOGNITION, rvuRecognitionId, record, { actorId, eventType: 'SRA_RVU_VALUE_RECOGNIZED' });
    await this.domain.lifecycle?.({
      actorId,
      objectType: RECORD_TYPES.SRA_RVU_RECOGNITION,
      objectId: rvuRecognitionId,
      eventType: 'FUNDING_VALUE_RECOGNIZED_IN_SRA_RVU',
      payload: { opportunityId: preparation.opportunityId, canonicalVerifiedValueRecordId: canonicalVerifiedValueRecord.verifiedValueRecordId, recognizedRvu },
    });
    return record;
  }

  async recordSettlementEquivalence(opportunityId, input = {}, actorId = null) {
    const recognition = this.recognitionForOpportunity(opportunityId);
    if (!recognition) throw new Error('SRA/RVU recognition was not found for this opportunity.');
    const executionReference = clean(input.executionReference, 240);
    if (!executionReference) throw new Error('executionReference is required after settlement execution.');
    const duplicate = this.equivalences(opportunityId).find((item) => item.executionReference === executionReference);
    if (duplicate) return duplicate;
    const recognizedRvu = positive(input.recognizedRvu, 'recognizedRvu');
    const alreadyRecorded = this.equivalences(opportunityId).reduce((sum, item) => sum + Number(item.recognizedRvu || 0), 0);
    if (alreadyRecorded + recognizedRvu > recognition.recognizedRvu + 0.00000001) {
      throw new Error('Settlement equivalence exceeds the recognized SRA/RVU amount.');
    }
    const settlementAssetCode = upper(input.settlementAssetCode, 80);
    if (!settlementAssetCode) throw new Error('settlementAssetCode is required.');
    const settlementAssetAmount = positive(input.settlementAssetAmount, 'settlementAssetAmount');
    const settledAt = clean(input.settledAt, 64);
    if (!settledAt || Number.isNaN(new Date(settledAt).getTime())) throw new Error('settledAt must be a valid date/time.');
    const confirmationReference = clean(input.confirmationReference, 240) || null;
    const settlementEquivalenceId = clean(input.settlementEquivalenceId, 100) || makeId('SEQ');
    const record = {
      id: settlementEquivalenceId,
      settlementEquivalenceId,
      opportunityId,
      rvuRecognitionId: recognition.rvuRecognitionId,
      recognizedRvu,
      recognitionUnit: 'SRA/RVU',
      settlementAssetCode,
      settlementAssetAmount,
      executedAssetPerRvu: Number((settlementAssetAmount / recognizedRvu).toFixed(12)),
      network: upper(input.network, 80) || null,
      executionReference,
      confirmationReference,
      transactionId: clean(input.transactionId, 240) || null,
      pricingSource: clean(input.pricingSource, 240) || null,
      destinationReference: clean(input.destinationReference, 240) || null,
      settledAt: new Date(settledAt).toISOString(),
      state: confirmationReference ? 'RECONCILED' : 'EXECUTION_RECORDED',
      changesUnderlyingRecognizedValue: false,
      recordedBy: actorId,
      recordedAt: now(),
    };
    await this.domain.put(RECORD_TYPES.SRA_SETTLEMENT_EQUIVALENCE, settlementEquivalenceId, record, { actorId, eventType: 'SRA_SETTLEMENT_EQUIVALENCE_RECORDED' });
    return record;
  }
}

export { UNIT_ID as SRA_RVU_UNIT_ID, PRODUCTIVE_VALUE_CLASSES, ECONOMIC_PURPOSE_CLASSES };
