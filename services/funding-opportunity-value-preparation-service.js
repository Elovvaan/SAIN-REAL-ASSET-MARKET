import crypto from 'node:crypto';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  VERIFIED_RECORD: 'FUNDING_OPPORTUNITY_VERIFIED_RECORD',
  VALUE_PREPARATION: 'FUNDING_OPPORTUNITY_VALUE_PREPARATION',
  MODEL_ASSESSMENT: 'FUNDING_MODEL_ASSESSMENT',
});

const MODELS = Object.freeze([
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

export class FundingOpportunityValuePreparationService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  async initialize() {
    await this.domain.hydrate(Object.values(TYPES));
    return this.status();
  }

  status() {
    return {
      service: 'SRA Funding Engine Phase 3',
      purpose: 'VERIFIED_VALUE_PREPARATION_AND_FUNDING_MODEL_ASSESSMENT',
      valuePreparations: this.domain.list(TYPES.VALUE_PREPARATION).length,
      modelAssessments: this.domain.list(TYPES.MODEL_ASSESSMENT).length,
    };
  }

  listPreparations(filters = {}) {
    return this.domain.list(TYPES.VALUE_PREPARATION).filter((record) => {
      if (filters.opportunityId && record.opportunityId !== filters.opportunityId) return false;
      if (filters.status && record.status !== filters.status) return false;
      return true;
    });
  }

  getPreparation(preparationId) {
    return this.domain.get(TYPES.VALUE_PREPARATION, preparationId);
  }

  listModelAssessments(preparationId) {
    return this.domain.list(TYPES.MODEL_ASSESSMENT).filter((record) => record.preparationId === preparationId);
  }

  async createPreparation(opportunityId, input = {}, actorId = null) {
    const opportunity = this.domain.get(TYPES.OPPORTUNITY, opportunityId);
    if (!opportunity) throw new Error('Funding opportunity was not found.');
    if (opportunity.status !== 'VERIFIED' || !opportunity.verifiedRecordId) {
      throw new Error('Funding opportunity must be verified before value preparation begins.');
    }
    const verifiedRecord = this.domain.get(TYPES.VERIFIED_RECORD, opportunity.verifiedRecordId);
    if (!verifiedRecord) throw new Error('Verified funding opportunity record was not found.');

    const existing = this.domain.list(TYPES.VALUE_PREPARATION).find((record) => record.opportunityId === opportunityId && !['CLOSED', 'CANCELLED'].includes(record.status));
    if (existing) return existing;

    const preparation = {
      preparationId: input.preparationId || id('FVP'),
      opportunityId,
      verifiedRecordId: verifiedRecord.verifiedRecordId,
      applicantParticipantId: opportunity.applicantParticipantId,
      opportunityType: opportunity.opportunityType,
      purpose: opportunity.purpose,
      requestedAmount: opportunity.requestedAmount,
      currency: opportunity.currency,
      evidenceIds: unique(verifiedRecord.evidenceIds || []),
      agreementIds: unique(verifiedRecord.agreementIds || []),
      transactionIds: unique(verifiedRecord.transactionIds || []),
      relatedAssetIds: unique(opportunity.relatedAssetIds || []),
      relatedProjectIds: unique(opportunity.relatedProjectIds || []),
      valueDimensions: input.valueDimensions || {
        existingVerifiedValue: null,
        productiveCapacity: null,
        revenueCapacity: null,
        completionCapacity: null,
        collateralOrAssetSupport: null,
        agreementSupport: null,
        transactionSupport: null,
      },
      assumptions: input.assumptions || [],
      exclusions: input.exclusions || [],
      status: 'PREPARATION_IN_PROGRESS',
      fundingPhase: 'VERIFIED_VALUE_PREPARATION',
      createdBy: actorId,
      createdAt: now(),
      updatedAt: now(),
      completedAt: null,
    };

    await this.domain.put(TYPES.VALUE_PREPARATION, preparation.preparationId, preparation, { actorId, eventType: 'FUNDING_VALUE_PREPARATION_CREATED' });
    await this.domain.put(TYPES.OPPORTUNITY, opportunityId, { ...opportunity, fundingPhase: 'VERIFIED_VALUE_PREPARATION', valuePreparationId: preparation.preparationId, updatedAt: now() }, { actorId, eventType: 'FUNDING_OPPORTUNITY_VALUE_PREPARATION_STARTED' });
    return preparation;
  }

  async updatePreparation(preparationId, input, actorId = null) {
    const current = this.getPreparation(preparationId);
    if (!current) throw new Error('Value preparation record was not found.');
    if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(current.status)) throw new Error(`Value preparation cannot be updated from ${current.status}.`);

    const updated = {
      ...current,
      valueDimensions: { ...current.valueDimensions, ...(input.valueDimensions || {}) },
      assumptions: input.assumptions ?? current.assumptions,
      exclusions: input.exclusions ?? current.exclusions,
      updatedAt: now(),
    };
    await this.domain.put(TYPES.VALUE_PREPARATION, preparationId, updated, { actorId, eventType: 'FUNDING_VALUE_PREPARATION_UPDATED' });
    return updated;
  }

  assessModels(preparationId) {
    const preparation = this.getPreparation(preparationId);
    if (!preparation) throw new Error('Value preparation record was not found.');

    const opportunityType = String(preparation.opportunityType || '').toUpperCase();
    const purpose = String(preparation.purpose || '').toUpperCase();
    const assetSupport = Number(preparation.valueDimensions?.collateralOrAssetSupport || 0) > 0 || preparation.relatedAssetIds.length > 0;
    const revenueSupport = Number(preparation.valueDimensions?.revenueCapacity || 0) > 0;
    const agreementSupport = preparation.agreementIds.length > 0;
    const transactionSupport = preparation.transactionIds.length > 0;

    const results = MODELS.map((model) => {
      let score = 0;
      const reasons = [];
      if (model === 'PLATFORM_FUNDING' && (opportunityType.includes('PLATFORM') || purpose.includes('PLATFORM'))) { score += 60; reasons.push('Platform purpose or type identified.'); }
      if (model === 'PROJECT_FUNDING' && preparation.relatedProjectIds.length > 0) { score += 50; reasons.push('Existing related project identified.'); }
      if (model === 'CONSTRUCTION_FUNDING' && (opportunityType.includes('CONSTRUCTION') || purpose.includes('BUILD'))) { score += 60; reasons.push('Construction or build purpose identified.'); }
      if (model === 'REVENUE_PARTICIPATION' && revenueSupport) { score += 55; reasons.push('Verified revenue capacity entered.'); }
      if (model === 'ASSET_BACKED_FUNDING' && assetSupport) { score += 55; reasons.push('Asset support identified.'); }
      if (model === 'PURCHASE_ORDER_FUNDING' && agreementSupport && purpose.includes('PURCHASE')) { score += 55; reasons.push('Purchase purpose and agreement support identified.'); }
      if (model === 'INVOICE_FUNDING' && transactionSupport && opportunityType.includes('INVOICE')) { score += 55; reasons.push('Invoice transaction support identified.'); }
      if (model === 'WORKING_CAPITAL' && purpose.includes('WORKING')) { score += 55; reasons.push('Working-capital purpose identified.'); }
      if (model === 'EQUIPMENT_FUNDING' && (opportunityType.includes('EQUIPMENT') || purpose.includes('EQUIPMENT'))) { score += 55; reasons.push('Equipment purpose identified.'); }
      if (agreementSupport) score += 10;
      if (transactionSupport) score += 10;
      return { model, score: Math.min(score, 100), reasons };
    }).sort((a, b) => b.score - a.score);

    return {
      preparationId,
      opportunityId: preparation.opportunityId,
      assessments: results,
      recommendedModel: results[0]?.score > 0 ? results[0].model : null,
      note: 'This assessment identifies candidate funding models. It does not select or issue an instrument.',
    };
  }

  async saveModelAssessment(preparationId, actorId = null) {
    const summary = this.assessModels(preparationId);
    const assessment = {
      assessmentId: id('FMA'),
      preparationId,
      opportunityId: summary.opportunityId,
      assessments: summary.assessments,
      recommendedModel: summary.recommendedModel,
      status: 'ASSESSMENT_COMPLETE',
      assessedBy: actorId,
      assessedAt: now(),
    };
    await this.domain.put(TYPES.MODEL_ASSESSMENT, assessment.assessmentId, assessment, { actorId, eventType: 'FUNDING_MODEL_ASSESSMENT_COMPLETED' });
    return assessment;
  }

  async completePreparation(preparationId, actorId = null) {
    const preparation = this.getPreparation(preparationId);
    if (!preparation) throw new Error('Value preparation record was not found.');
    const assessment = await this.saveModelAssessment(preparationId, actorId);
    const completedAt = now();
    const updated = { ...preparation, status: 'COMPLETED', fundingPhase: 'FUNDING_MODEL_SELECTION_READY', modelAssessmentId: assessment.assessmentId, completedAt, updatedAt: completedAt };
    await this.domain.put(TYPES.VALUE_PREPARATION, preparationId, updated, { actorId, eventType: 'FUNDING_VALUE_PREPARATION_COMPLETED' });

    const opportunity = this.domain.get(TYPES.OPPORTUNITY, preparation.opportunityId);
    if (opportunity) {
      await this.domain.put(TYPES.OPPORTUNITY, opportunity.opportunityId, {
        ...opportunity,
        status: 'VALUE_PREPARED',
        fundingPhase: 'FUNDING_MODEL_SELECTION_READY',
        modelAssessmentId: assessment.assessmentId,
        updatedAt: completedAt,
        history: [...(opportunity.history || []), { from: opportunity.status, to: 'VALUE_PREPARED', at: completedAt, actorId, note: 'Verified Value preparation completed.' }],
      }, { actorId, eventType: 'FUNDING_OPPORTUNITY_READY_FOR_MODEL_SELECTION' });
    }

    await this.domain.lifecycle({
      objectType: TYPES.OPPORTUNITY,
      objectId: preparation.opportunityId,
      eventType: 'FUNDING_OPPORTUNITY_VALUE_PREPARED',
      actorId,
      payload: { preparationId, assessmentId: assessment.assessmentId, recommendedModel: assessment.recommendedModel },
    });
    return { preparation: updated, assessment };
  }
}

export { TYPES as FUNDING_VALUE_PREPARATION_RECORD_TYPES, MODELS as FUNDING_MODELS };
