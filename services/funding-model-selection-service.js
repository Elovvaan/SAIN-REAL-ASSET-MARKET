import crypto from 'node:crypto';
import { DETERMINATION_RECORD_TYPES } from './determination-engine-service.js';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  PREPARATION: 'FUNDING_OPPORTUNITY_VALUE_PREPARATION',
  ASSESSMENT: 'FUNDING_MODEL_ASSESSMENT',
  SELECTION: 'FUNDING_MODEL_SELECTION',
  INSTRUMENT_REQUEST: 'FUNDING_INSTRUMENT_SELECTION_REQUEST',
});

const ALLOWED_MODELS = new Set([
  'PROJECT_FUNDING','PLATFORM_FUNDING','CONSTRUCTION_FUNDING','REVENUE_PARTICIPATION','ASSET_BACKED_FUNDING',
  'PURCHASE_ORDER_FUNDING','INVOICE_FUNDING','WORKING_CAPITAL','EQUIPMENT_FUNDING',
]);

const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const now = () => new Date().toISOString();
const unique = (values = []) => [...new Set(values.filter(Boolean))];

function canonicalVvr(domain, recordId) {
  if (!recordId) return null;
  const record = domain.get(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE, recordId);
  if (!record) throw new Error('Canonical Verified Value Record was not found.');
  if (record.state !== 'CANONICAL' || record.immutable !== true) throw new Error('Canonical Verified Value Record must be canonical and immutable.');
  if (!Array.isArray(record.permittedUses) || !record.permittedUses.includes('CONTRACT_REFERENCE')) throw new Error('Canonical Verified Value Record is not permitted for contract reference.');
  return record;
}

function economicReference(domain, opportunity) {
  const requestedAmount = Number(opportunity.requestedAmount);
  const vvr = canonicalVvr(domain, opportunity.canonicalVerifiedValueRecordId || null);
  if (!vvr) return {
    architecture: 'LEGACY_REQUESTED_AMOUNT_REFERENCE',
    requestedAmount,
    recognizedValue: null,
    recognizedCurrency: null,
    canonicalVerifiedValueRecordId: null,
    determinationId: null,
    snapshotId: null,
    requestedToRecognizedRatio: null,
  };
  const recognizedValue = Number(vvr.value);
  return {
    architecture: 'CANONICAL_VVR_ECONOMIC_REFERENCE',
    requestedAmount,
    recognizedValue,
    recognizedCurrency: vvr.currency || opportunity.currency || null,
    canonicalVerifiedValueRecordId: vvr.verifiedValueRecordId,
    determinationId: vvr.determinationId || null,
    snapshotId: vvr.snapshotId || null,
    requestedToRecognizedRatio: Number.isFinite(requestedAmount) && Number.isFinite(recognizedValue) && recognizedValue > 0 ? Number((requestedAmount / recognizedValue).toFixed(6)) : null,
  };
}

export class FundingModelSelectionService {
  constructor(persistentDomain) { this.domain = persistentDomain; }
  async initialize() { await this.domain.hydrate([...Object.values(TYPES), DETERMINATION_RECORD_TYPES.VERIFIED_VALUE]); return this.status(); }
  status() { return { service: 'SRA Funding Engine Phase 4', purpose: 'FUNDING_MODEL_SELECTION_AND_INSTRUMENT_HANDOFF', selections: this.domain.list(TYPES.SELECTION).length, instrumentSelectionRequests: this.domain.list(TYPES.INSTRUMENT_REQUEST).length }; }
  listSelections(filters = {}) { return this.domain.list(TYPES.SELECTION).filter((r) => (!filters.opportunityId || r.opportunityId === filters.opportunityId) && (!filters.status || r.status === filters.status)); }
  getSelection(selectionId) { return this.domain.get(TYPES.SELECTION, selectionId); }
  listInstrumentRequests(selectionId = null) { return this.domain.list(TYPES.INSTRUMENT_REQUEST).filter((r) => !selectionId || r.selectionId === selectionId); }

  async selectModel(opportunityId, input, actorId = null) {
    const opportunity = this.domain.get(TYPES.OPPORTUNITY, opportunityId);
    if (!opportunity) throw new Error('Funding opportunity was not found.');
    if (opportunity.status !== 'VALUE_PREPARED' || !opportunity.modelAssessmentId) throw new Error('Funding opportunity must complete value preparation before model selection.');
    const assessment = this.domain.get(TYPES.ASSESSMENT, opportunity.modelAssessmentId);
    if (!assessment) throw new Error('Funding model assessment was not found.');
    const selectedModel = input?.selectedModel;
    if (!ALLOWED_MODELS.has(selectedModel)) throw new Error(`Unsupported funding model: ${selectedModel}`);
    const assessedModel = (assessment.assessments || []).find((entry) => entry.model === selectedModel) || null;
    if (!assessedModel) throw new Error('Selected funding model was not included in the assessment.');
    const existing = this.domain.list(TYPES.SELECTION).find((record) => record.opportunityId === opportunityId && record.status === 'SELECTED');
    if (existing) throw new Error('A funding model has already been selected for this opportunity.');

    const basis = economicReference(this.domain, opportunity);
    const selection = {
      selectionId: input.selectionId || id('FMS'), opportunityId,
      preparationId: opportunity.valuePreparationId || assessment.preparationId, assessmentId: assessment.assessmentId,
      selectedModel, assessedScore: assessedModel.score, assessedReasons: assessedModel.reasons || [], recommendedModel: assessment.recommendedModel || null,
      selectionRationale: input.selectionRationale || null, conditions: input.conditions || [], constraints: input.constraints || [],
      requestedAmount: opportunity.requestedAmount, currency: opportunity.currency,
      canonicalVerifiedValueRecordId: basis.canonicalVerifiedValueRecordId,
      recognizedReferenceValue: basis.recognizedValue,
      recognizedReferenceCurrency: basis.recognizedCurrency,
      referencedDeterminationId: basis.determinationId,
      referencedSnapshotId: basis.snapshotId,
      economicReferenceArchitecture: basis.architecture,
      requestedToRecognizedRatio: basis.requestedToRecognizedRatio,
      status: 'SELECTED', selectedBy: actorId, selectedAt: now(), supersededAt: null, instrumentSelectionRequestId: null,
    };

    await this.domain.put(TYPES.SELECTION, selection.selectionId, selection, { actorId, eventType: 'FUNDING_MODEL_SELECTED' });
    await this.domain.put(TYPES.OPPORTUNITY, opportunityId, { ...opportunity, status: 'FUNDING_MODEL_SELECTED', fundingPhase: 'INSTRUMENT_SELECTION_READY', fundingModelSelectionId: selection.selectionId, selectedFundingModel: selectedModel, updatedAt: now(), history: [...(opportunity.history || []), { from: opportunity.status, to: 'FUNDING_MODEL_SELECTED', at: now(), actorId, note: input.selectionRationale || selectedModel }] }, { actorId, eventType: 'FUNDING_OPPORTUNITY_MODEL_SELECTED' });
    await this.domain.lifecycle({ objectType: TYPES.OPPORTUNITY, objectId: opportunityId, eventType: 'FUNDING_MODEL_SELECTION_COMPLETED', actorId, payload: { selectionId: selection.selectionId, selectedModel, assessedScore: selection.assessedScore, canonicalVerifiedValueRecordId: selection.canonicalVerifiedValueRecordId, recognizedReferenceValue: selection.recognizedReferenceValue, requestedAmount: selection.requestedAmount, requestedToRecognizedRatio: selection.requestedToRecognizedRatio } });
    return selection;
  }

  async createInstrumentSelectionRequest(selectionId, input = {}, actorId = null) {
    const selection = this.getSelection(selectionId);
    if (!selection) throw new Error('Funding model selection was not found.');
    if (selection.status !== 'SELECTED') throw new Error(`Instrument selection request cannot be created from ${selection.status}.`);
    const opportunity = this.domain.get(TYPES.OPPORTUNITY, selection.opportunityId);
    if (!opportunity) throw new Error('Funding opportunity was not found.');
    const existing = this.domain.list(TYPES.INSTRUMENT_REQUEST).find((record) => record.selectionId === selectionId && !['CLOSED', 'CANCELLED'].includes(record.status));
    if (existing) return existing;

    const request = {
      instrumentSelectionRequestId: input.instrumentSelectionRequestId || id('FISR'), selectionId, opportunityId: selection.opportunityId,
      fundingModel: selection.selectedModel, requestedAmount: selection.requestedAmount, currency: selection.currency,
      canonicalVerifiedValueRecordId: selection.canonicalVerifiedValueRecordId || null,
      recognizedReferenceValue: selection.recognizedReferenceValue ?? null,
      recognizedReferenceCurrency: selection.recognizedReferenceCurrency || null,
      referencedDeterminationId: selection.referencedDeterminationId || null,
      referencedSnapshotId: selection.referencedSnapshotId || null,
      economicReferenceArchitecture: selection.economicReferenceArchitecture || 'LEGACY_REQUESTED_AMOUNT_REFERENCE',
      requestedToRecognizedRatio: selection.requestedToRecognizedRatio ?? null,
      purpose: opportunity.purpose, opportunityType: opportunity.opportunityType,
      verifiedRecordId: opportunity.verifiedRecordId || null, valuePreparationId: opportunity.valuePreparationId || null, modelAssessmentId: selection.assessmentId,
      candidateInstrumentFamilies: unique(input.candidateInstrumentFamilies || []),
      requiredCharacteristics: input.requiredCharacteristics || { purposeBound: true, amountBound: true, lifecycleRequired: true, settlementRuleRequired: true, transferabilityRuleRequired: true },
      conditions: selection.conditions || [], constraints: selection.constraints || [], status: 'PENDING_INSTRUMENT_SELECTION', requestedBy: actorId, requestedAt: now(), completedAt: null, selectedInstrumentType: null, selectedInstrumentId: null,
    };

    await this.domain.put(TYPES.INSTRUMENT_REQUEST, request.instrumentSelectionRequestId, request, { actorId, eventType: 'FUNDING_INSTRUMENT_SELECTION_REQUESTED' });
    await this.domain.put(TYPES.SELECTION, selectionId, { ...selection, instrumentSelectionRequestId: request.instrumentSelectionRequestId }, { actorId, eventType: 'FUNDING_MODEL_SELECTION_HANDOFF_CREATED' });
    await this.domain.put(TYPES.OPPORTUNITY, opportunity.opportunityId, { ...opportunity, fundingPhase: 'INSTRUMENT_SELECTION', instrumentSelectionRequestId: request.instrumentSelectionRequestId, updatedAt: now() }, { actorId, eventType: 'FUNDING_OPPORTUNITY_HANDED_TO_INSTRUMENT_SELECTION' });
    await this.domain.lifecycle({ objectType: TYPES.OPPORTUNITY, objectId: opportunity.opportunityId, eventType: 'FUNDING_OPPORTUNITY_INSTRUMENT_SELECTION_REQUESTED', actorId, payload: { selectionId, instrumentSelectionRequestId: request.instrumentSelectionRequestId, fundingModel: selection.selectedModel, canonicalVerifiedValueRecordId: request.canonicalVerifiedValueRecordId, recognizedReferenceValue: request.recognizedReferenceValue, requestedAmount: request.requestedAmount } });
    return request;
  }
}

export { TYPES as FUNDING_MODEL_SELECTION_RECORD_TYPES };
