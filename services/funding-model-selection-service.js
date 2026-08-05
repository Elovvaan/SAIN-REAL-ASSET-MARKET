import crypto from 'node:crypto';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  PREPARATION: 'FUNDING_OPPORTUNITY_VALUE_PREPARATION',
  ASSESSMENT: 'FUNDING_MODEL_ASSESSMENT',
  SELECTION: 'FUNDING_MODEL_SELECTION',
  INSTRUMENT_REQUEST: 'FUNDING_INSTRUMENT_SELECTION_REQUEST',
});

const ALLOWED_MODELS = new Set([
  'PROJECT_FUNDING',
  'PLATFORM_FUNDING',
  'CONSTRUCTION_FUNDING',
  'REVENUE_PARTICIPATION',
  'ASSET_BACKED_FUNDING',
  'PURCHASE_ORDER_FUNDING',
  'INVOICE_FUNDING',
  'WORKING_CAPITAL',
  'EQUIPMENT_FUNDING',
]);

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function now() {
  return new Date().toISOString();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export class FundingModelSelectionService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  async initialize() {
    await this.domain.hydrate(Object.values(TYPES));
    return this.status();
  }

  status() {
    return {
      service: 'SRA Funding Engine Phase 4',
      purpose: 'FUNDING_MODEL_SELECTION_AND_INSTRUMENT_HANDOFF',
      selections: this.domain.list(TYPES.SELECTION).length,
      instrumentSelectionRequests: this.domain.list(TYPES.INSTRUMENT_REQUEST).length,
    };
  }

  listSelections(filters = {}) {
    return this.domain.list(TYPES.SELECTION).filter((record) => {
      if (filters.opportunityId && record.opportunityId !== filters.opportunityId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  getSelection(selectionId) {
    return this.domain.get(TYPES.SELECTION, selectionId);
  }

  listInstrumentRequests(selectionId = null) {
    return this.domain.list(TYPES.INSTRUMENT_REQUEST).filter((record) => !selectionId || record.selectionId === selectionId);
  }

  async selectModel(opportunityId, input, actorId = null) {
    const opportunity = this.domain.get(TYPES.OPPORTUNITY, opportunityId);
    if (!opportunity) throw new Error('Funding opportunity was not found.');
    if (opportunity.status !== 'VALUE_PREPARED' || !opportunity.modelAssessmentId) {
      throw new Error('Funding opportunity must complete value preparation before model selection.');
    }

    const assessment = this.domain.get(TYPES.ASSESSMENT, opportunity.modelAssessmentId);
    if (!assessment) throw new Error('Funding model assessment was not found.');

    const selectedModel = input?.selectedModel;
    if (!ALLOWED_MODELS.has(selectedModel)) throw new Error(`Unsupported funding model: ${selectedModel}`);

    const assessedModel = (assessment.assessments || []).find((entry) => entry.model === selectedModel) || null;
    if (!assessedModel) throw new Error('Selected funding model was not included in the assessment.');

    const existing = this.domain.list(TYPES.SELECTION).find((record) => record.opportunityId === opportunityId && record.status === 'SELECTED');
    if (existing) throw new Error('A funding model has already been selected for this opportunity.');

    const selection = {
      selectionId: input.selectionId || id('FMS'),
      opportunityId,
      preparationId: opportunity.valuePreparationId || assessment.preparationId,
      assessmentId: assessment.assessmentId,
      selectedModel,
      assessedScore: assessedModel.score,
      assessedReasons: assessedModel.reasons || [],
      recommendedModel: assessment.recommendedModel || null,
      selectionRationale: input.selectionRationale || null,
      conditions: input.conditions || [],
      constraints: input.constraints || [],
      requestedAmount: opportunity.requestedAmount,
      currency: opportunity.currency,
      status: 'SELECTED',
      selectedBy: actorId,
      selectedAt: now(),
      supersededAt: null,
      instrumentSelectionRequestId: null,
    };

    await this.domain.put(TYPES.SELECTION, selection.selectionId, selection, { actorId, eventType: 'FUNDING_MODEL_SELECTED' });
    await this.domain.put(TYPES.OPPORTUNITY, opportunityId, {
      ...opportunity,
      status: 'FUNDING_MODEL_SELECTED',
      fundingPhase: 'INSTRUMENT_SELECTION_READY',
      fundingModelSelectionId: selection.selectionId,
      selectedFundingModel: selectedModel,
      updatedAt: now(),
      history: [
        ...(opportunity.history || []),
        { from: opportunity.status, to: 'FUNDING_MODEL_SELECTED', at: now(), actorId, note: input.selectionRationale || selectedModel },
      ],
    }, { actorId, eventType: 'FUNDING_OPPORTUNITY_MODEL_SELECTED' });

    await this.domain.lifecycle({
      objectType: TYPES.OPPORTUNITY,
      objectId: opportunityId,
      eventType: 'FUNDING_MODEL_SELECTION_COMPLETED',
      actorId,
      payload: { selectionId: selection.selectionId, selectedModel, assessedScore: selection.assessedScore },
    });

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
      instrumentSelectionRequestId: input.instrumentSelectionRequestId || id('FISR'),
      selectionId,
      opportunityId: selection.opportunityId,
      fundingModel: selection.selectedModel,
      requestedAmount: selection.requestedAmount,
      currency: selection.currency,
      purpose: opportunity.purpose,
      opportunityType: opportunity.opportunityType,
      verifiedRecordId: opportunity.verifiedRecordId || null,
      valuePreparationId: opportunity.valuePreparationId || null,
      modelAssessmentId: selection.assessmentId,
      candidateInstrumentFamilies: unique(input.candidateInstrumentFamilies || []),
      requiredCharacteristics: input.requiredCharacteristics || {
        purposeBound: true,
        amountBound: true,
        lifecycleRequired: true,
        settlementRuleRequired: true,
        transferabilityRuleRequired: true,
      },
      conditions: selection.conditions || [],
      constraints: selection.constraints || [],
      status: 'PENDING_INSTRUMENT_SELECTION',
      requestedBy: actorId,
      requestedAt: now(),
      completedAt: null,
      selectedInstrumentType: null,
      selectedInstrumentId: null,
    };

    await this.domain.put(TYPES.INSTRUMENT_REQUEST, request.instrumentSelectionRequestId, request, { actorId, eventType: 'FUNDING_INSTRUMENT_SELECTION_REQUESTED' });
    await this.domain.put(TYPES.SELECTION, selectionId, { ...selection, instrumentSelectionRequestId: request.instrumentSelectionRequestId }, { actorId, eventType: 'FUNDING_MODEL_SELECTION_HANDOFF_CREATED' });
    await this.domain.put(TYPES.OPPORTUNITY, opportunity.opportunityId, {
      ...opportunity,
      fundingPhase: 'INSTRUMENT_SELECTION',
      instrumentSelectionRequestId: request.instrumentSelectionRequestId,
      updatedAt: now(),
    }, { actorId, eventType: 'FUNDING_OPPORTUNITY_HANDED_TO_INSTRUMENT_SELECTION' });

    await this.domain.lifecycle({
      objectType: TYPES.OPPORTUNITY,
      objectId: opportunity.opportunityId,
      eventType: 'FUNDING_OPPORTUNITY_INSTRUMENT_SELECTION_REQUESTED',
      actorId,
      payload: {
        selectionId,
        instrumentSelectionRequestId: request.instrumentSelectionRequestId,
        fundingModel: selection.selectedModel,
      },
    });

    return request;
  }
}

export { TYPES as FUNDING_MODEL_SELECTION_RECORD_TYPES };
