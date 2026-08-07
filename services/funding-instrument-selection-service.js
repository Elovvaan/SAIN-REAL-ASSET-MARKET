import crypto from 'node:crypto';
import { DETERMINATION_RECORD_TYPES } from './determination-engine-service.js';

const TYPES = Object.freeze({
  OPPORTUNITY: 'FUNDING_OPPORTUNITY',
  MODEL_SELECTION: 'FUNDING_MODEL_SELECTION',
  INSTRUMENT_REQUEST: 'FUNDING_INSTRUMENT_SELECTION_REQUEST',
  INSTRUMENT_ASSESSMENT: 'FUNDING_INSTRUMENT_ASSESSMENT',
  INSTRUMENT_SELECTION: 'FUNDING_INSTRUMENT_SELECTION',
  SRA_INSTRUMENT: 'SRA_INSTRUMENT',
});

const INSTRUMENT_FAMILIES = Object.freeze([
  'TRUE_BILL','COMMERCIAL_PAPER','PARTICIPATION_POSITION','REVENUE_PARTICIPATION_INSTRUMENT','ASSET_BACKED_NOTE',
  'CONSTRUCTION_FUNDING_NOTE','PURCHASE_ORDER_INSTRUMENT','INVOICE_FINANCE_INSTRUMENT','WORKING_CAPITAL_NOTE','EQUIPMENT_FINANCE_INSTRUMENT',
]);

const MODEL_FAMILY_MAP = Object.freeze({
  PROJECT_FUNDING: ['TRUE_BILL','PARTICIPATION_POSITION','COMMERCIAL_PAPER'],
  PLATFORM_FUNDING: ['COMMERCIAL_PAPER','PARTICIPATION_POSITION','TRUE_BILL'],
  CONSTRUCTION_FUNDING: ['CONSTRUCTION_FUNDING_NOTE','TRUE_BILL','ASSET_BACKED_NOTE'],
  REVENUE_PARTICIPATION: ['REVENUE_PARTICIPATION_INSTRUMENT','PARTICIPATION_POSITION'],
  ASSET_BACKED_FUNDING: ['ASSET_BACKED_NOTE','TRUE_BILL'],
  PURCHASE_ORDER_FUNDING: ['PURCHASE_ORDER_INSTRUMENT','TRUE_BILL'],
  INVOICE_FUNDING: ['INVOICE_FINANCE_INSTRUMENT','TRUE_BILL'],
  WORKING_CAPITAL: ['WORKING_CAPITAL_NOTE','COMMERCIAL_PAPER'],
  EQUIPMENT_FUNDING: ['EQUIPMENT_FINANCE_INSTRUMENT','ASSET_BACKED_NOTE'],
});

const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const now = () => new Date().toISOString();
const unique = (values = []) => [...new Set(values.filter(Boolean))];

function canonicalVvr(domain, canonicalVerifiedValueRecordId) {
  if (!canonicalVerifiedValueRecordId) return null;
  const record = domain.get(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE, canonicalVerifiedValueRecordId);
  if (!record) throw new Error('Canonical Verified Value Record was not found.');
  if (record.state !== 'CANONICAL' || record.immutable !== true) throw new Error('Canonical Verified Value Record must be canonical and immutable.');
  if (!Array.isArray(record.permittedUses) || !record.permittedUses.includes('CONTRACT_REFERENCE')) throw new Error('Canonical Verified Value Record is not permitted for contract reference.');
  return record;
}

export class FundingInstrumentSelectionService {
  constructor(persistentDomain) { this.domain = persistentDomain; }
  async initialize() { await this.domain.hydrate([...Object.values(TYPES), DETERMINATION_RECORD_TYPES.VERIFIED_VALUE]); return this.status(); }
  status() { return { service: 'SRA Funding Engine Phase 5', purpose: 'INSTRUMENT_FAMILY_ASSESSMENT_AND_DRAFT_CREATION', assessments: this.domain.list(TYPES.INSTRUMENT_ASSESSMENT).length, selections: this.domain.list(TYPES.INSTRUMENT_SELECTION).length, draftInstruments: this.domain.list(TYPES.SRA_INSTRUMENT).filter((r) => r.state === 'DRAFT').length }; }
  getRequest(requestId) { return this.domain.get(TYPES.INSTRUMENT_REQUEST, requestId); }
  listAssessments(requestId = null) { return this.domain.list(TYPES.INSTRUMENT_ASSESSMENT).filter((r) => !requestId || r.instrumentSelectionRequestId === requestId); }
  getSelection(selectionId) { return this.domain.get(TYPES.INSTRUMENT_SELECTION, selectionId); }

  assess(requestId) {
    const request = this.getRequest(requestId); if (!request) throw new Error('Instrument selection request was not found.');
    const mapped = MODEL_FAMILY_MAP[request.fundingModel] || [];
    const candidates = unique([...(request.candidateInstrumentFamilies || []), ...mapped]);
    const assessments = candidates.map((family, index) => ({ instrumentFamily: family, score: Math.max(10, 100 - index * 15), reasons: [
      `Mapped to funding model ${request.fundingModel}.`,
      request.requiredCharacteristics?.purposeBound ? 'Supports purpose-bound structuring.' : null,
      request.requiredCharacteristics?.amountBound ? 'Supports amount-bound structuring.' : null,
      request.requiredCharacteristics?.lifecycleRequired ? 'Supports lifecycle tracking.' : null,
    ].filter(Boolean) }));
    return { instrumentSelectionRequestId: requestId, opportunityId: request.opportunityId, fundingModel: request.fundingModel, candidates: assessments, recommendedInstrumentFamily: assessments[0]?.instrumentFamily || null, note: 'Assessment identifies candidate instrument families. No instrument is issued in this phase.' };
  }

  async saveAssessment(requestId, actorId = null) {
    const summary = this.assess(requestId);
    const record = { instrumentAssessmentId: id('FIA'), instrumentSelectionRequestId: requestId, opportunityId: summary.opportunityId, fundingModel: summary.fundingModel, candidates: summary.candidates, recommendedInstrumentFamily: summary.recommendedInstrumentFamily, status: 'ASSESSMENT_COMPLETE', assessedBy: actorId, assessedAt: now() };
    await this.domain.put(TYPES.INSTRUMENT_ASSESSMENT, record.instrumentAssessmentId, record, { actorId, eventType: 'FUNDING_INSTRUMENT_ASSESSMENT_COMPLETED' });
    return record;
  }

  async selectInstrumentFamily(requestId, input, actorId = null) {
    const request = this.getRequest(requestId); if (!request) throw new Error('Instrument selection request was not found.');
    if (request.status !== 'PENDING_INSTRUMENT_SELECTION') throw new Error(`Instrument family cannot be selected from ${request.status}.`);
    const selectedInstrumentFamily = input?.selectedInstrumentFamily;
    if (!INSTRUMENT_FAMILIES.includes(selectedInstrumentFamily)) throw new Error(`Unsupported instrument family: ${selectedInstrumentFamily}`);
    const assessment = await this.saveAssessment(requestId, actorId), candidate = assessment.candidates.find((entry) => entry.instrumentFamily === selectedInstrumentFamily);
    if (!candidate) throw new Error('Selected instrument family was not included in the assessment.');
    const selection = { instrumentSelectionId: input.instrumentSelectionId || id('FIS'), instrumentSelectionRequestId: requestId, opportunityId: request.opportunityId, fundingModel: request.fundingModel, selectedInstrumentFamily, assessedScore: candidate.score, assessedReasons: candidate.reasons, recommendedInstrumentFamily: assessment.recommendedInstrumentFamily, selectionRationale: input.selectionRationale || null, terms: input.terms || {}, restrictions: input.restrictions || [], status: 'SELECTED', selectedBy: actorId, selectedAt: now(), draftInstrumentId: null };
    await this.domain.put(TYPES.INSTRUMENT_SELECTION, selection.instrumentSelectionId, selection, { actorId, eventType: 'FUNDING_INSTRUMENT_FAMILY_SELECTED' });
    await this.domain.put(TYPES.INSTRUMENT_REQUEST, requestId, { ...request, status: 'INSTRUMENT_FAMILY_SELECTED', selectedInstrumentType: selectedInstrumentFamily, instrumentAssessmentId: assessment.instrumentAssessmentId, instrumentSelectionId: selection.instrumentSelectionId, updatedAt: now() }, { actorId, eventType: 'FUNDING_INSTRUMENT_SELECTION_REQUEST_UPDATED' });
    return selection;
  }

  async createDraftInstrument(selectionId, input = {}, actorId = null) {
    const selection = this.getSelection(selectionId); if (!selection) throw new Error('Instrument selection was not found.');
    if (selection.status !== 'SELECTED') throw new Error(`Draft instrument cannot be created from ${selection.status}.`);
    const request = this.getRequest(selection.instrumentSelectionRequestId), opportunity = this.domain.get(TYPES.OPPORTUNITY, selection.opportunityId);
    if (!request || !opportunity) throw new Error('Required funding records were not found.');
    const existing = this.domain.list(TYPES.SRA_INSTRUMENT).find((r) => r.instrumentSelectionId === selectionId && r.state === 'DRAFT'); if (existing) return existing;

    const canonicalVerifiedValueRecordId = opportunity.canonicalVerifiedValueRecordId || request.canonicalVerifiedValueRecordId || input.canonicalVerifiedValueRecordId || null;
    const vvr = canonicalVvr(this.domain, canonicalVerifiedValueRecordId);
    const instrument = {
      instrumentId: input.instrumentId || id('SRAI'), instrumentFamily: selection.selectedInstrumentFamily, instrumentType: selection.selectedInstrumentFamily,
      fundingModel: selection.fundingModel, opportunityId: selection.opportunityId, instrumentSelectionRequestId: selection.instrumentSelectionRequestId, instrumentSelectionId: selectionId,
      issuerParticipantId: input.issuerParticipantId || opportunity.applicantParticipantId,
      verifiedRecordId: opportunity.verifiedRecordId || request.verifiedRecordId || null,
      canonicalVerifiedValueRecordId: vvr?.verifiedValueRecordId || null,
      valueReferenceArchitecture: vvr ? 'CANONICAL_VVR_REFERENCE' : 'LEGACY_VERIFIED_RECORD_REFERENCE',
      referencedDeterminationId: vvr?.determinationId || null,
      referencedSnapshotId: vvr?.snapshotId || null,
      verifiedValuePackageId: input.verifiedValuePackageId || null,
      purpose: opportunity.purpose, faceValue: Number(input.faceValue ?? request.requestedAmount), currency: input.currency || request.currency,
      denomination: input.denomination || null, maturityDate: input.maturityDate || null, transferabilityStatus: input.transferabilityStatus || 'RESTRICTED',
      settlementRule: input.settlementRule || null, governingDocumentId: input.governingDocumentId || null,
      terms: { ...(selection.terms || {}), ...(input.terms || {}) }, restrictions: unique([...(selection.restrictions || []), ...(input.restrictions || [])]),
      state: 'DRAFT', status: 'DRAFT', issuanceStatus: 'NOT_ISSUED', createdBy: actorId, createdAt: now(), updatedAt: now(),
    };
    if (!Number.isFinite(instrument.faceValue) || instrument.faceValue <= 0) throw new Error('Draft instrument face value must be greater than zero.');
    await this.domain.put(TYPES.SRA_INSTRUMENT, instrument.instrumentId, instrument, { actorId, eventType: 'SRA_INSTRUMENT_DRAFT_CREATED' });
    await this.domain.put(TYPES.INSTRUMENT_SELECTION, selectionId, { ...selection, status: 'DRAFT_CREATED', draftInstrumentId: instrument.instrumentId }, { actorId, eventType: 'FUNDING_INSTRUMENT_DRAFT_LINKED' });
    await this.domain.put(TYPES.INSTRUMENT_REQUEST, request.instrumentSelectionRequestId, { ...request, status: 'DRAFT_INSTRUMENT_CREATED', selectedInstrumentId: instrument.instrumentId, completedAt: now() }, { actorId, eventType: 'FUNDING_INSTRUMENT_SELECTION_COMPLETED' });
    await this.domain.put(TYPES.OPPORTUNITY, opportunity.opportunityId, { ...opportunity, status: 'INSTRUMENT_DRAFTED', fundingPhase: 'INSTRUMENT_DRAFT_REVIEW', selectedInstrumentId: instrument.instrumentId, canonicalVerifiedValueRecordId: instrument.canonicalVerifiedValueRecordId || opportunity.canonicalVerifiedValueRecordId || null, updatedAt: now(), history: [...(opportunity.history || []), { from: opportunity.status, to: 'INSTRUMENT_DRAFTED', at: now(), actorId, note: selection.selectedInstrumentFamily }] }, { actorId, eventType: 'FUNDING_OPPORTUNITY_INSTRUMENT_DRAFTED' });
    await this.domain.lifecycle({ objectType: TYPES.OPPORTUNITY, objectId: opportunity.opportunityId, eventType: 'FUNDING_INSTRUMENT_DRAFT_CREATED', actorId, payload: { instrumentId: instrument.instrumentId, instrumentFamily: instrument.instrumentFamily, issuanceStatus: instrument.issuanceStatus, canonicalVerifiedValueRecordId: instrument.canonicalVerifiedValueRecordId } });
    return instrument;
  }
}

export { TYPES as FUNDING_INSTRUMENT_SELECTION_RECORD_TYPES, INSTRUMENT_FAMILIES };
