import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';
import { SRA_USD_CANONICAL_ASSET_ID } from './direct-value-account-service.js';

const CREATE_TIERS = new Set(['MARKET_PROFESSIONAL', 'INSTITUTIONAL_OPERATOR', 'PLATFORM_ADMIN']);
const ADMISSION_TIERS = new Set(['ASSET_PROVIDER', 'MARKET_PROFESSIONAL', 'INSTITUTIONAL_OPERATOR', 'PLATFORM_ADMIN']);
const OPERATE_TIERS = new Set(['INSTITUTIONAL_OPERATOR', 'PLATFORM_ADMIN']);
const ADMIN_TIERS = new Set(['PLATFORM_ADMIN']);
const MODELS = new Set(['FIXED_BUNDLE', 'BENCHMARK_BASKET', 'GOVERNED_BASKET']);
const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const positive = (value, field = 'amount') => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be greater than zero.`);
  return Number(parsed.toFixed(8));
};
const nonnegative = (value, field) => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field} must be zero or greater.`);
  return Number(parsed.toFixed(8));
};
function requireTier(tier, allowed, action) { if (!allowed.has(upper(tier))) throw new Error(`${action} is not available to the active operating tier.`); }

export class ProductiveBasketService {
  constructor(domain, directAccounts) { this.domain = domain; this.directAccounts = directAccounts; }

  list(filters = {}) {
    return this.domain.list(RECORD_TYPES.PRODUCTIVE_BASKET)
      .filter((item) => !filters.state || item.state === upper(filters.state))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((item) => this.summary(item.basketId));
  }
  get(basketId) { return this.domain.get(RECORD_TYPES.PRODUCTIVE_BASKET, basketId); }
  admissions(basketId) { return this.domain.list(RECORD_TYPES.BASKET_ASSET_ADMISSION).filter((item) => item.basketId === basketId); }
  contributions(basketId) { return this.domain.list(RECORD_TYPES.BASKET_CONTRIBUTION).filter((item) => item.basketId === basketId); }
  positions(basketId) { return this.domain.list(RECORD_TYPES.BASKET_PARTICIPATION_POSITION).filter((item) => item.basketId === basketId); }
  performance(basketId) { return this.domain.list(RECORD_TYPES.BASKET_PERFORMANCE_EVENT).filter((item) => item.basketId === basketId).sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt))); }
  distributions(basketId) { return this.domain.list(RECORD_TYPES.BASKET_DISTRIBUTION).filter((item) => item.basketId === basketId).sort((a, b) => String(a.distributedAt).localeCompare(String(b.distributedAt))); }

  summary(basketId) {
    const basket = this.get(basketId);
    if (!basket) return null;
    const admissions = this.admissions(basketId);
    const contributions = this.contributions(basketId).filter((item) => item.state === 'ACCEPTED');
    const positions = this.positions(basketId).filter((item) => item.state === 'ACTIVE');
    const performance = this.performance(basketId);
    const distributions = this.distributions(basketId).filter((item) => item.state === 'COMPLETED');
    const recognizedValue = Number(contributions.reduce((sum, item) => sum + Number(item.recognizedValue || 0), 0).toFixed(8));
    const participationUnits = Number(positions.reduce((sum, item) => sum + Number(item.units || 0), 0).toFixed(8));
    const totalDistributed = Number(distributions.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(8));
    const distributableProduced = Number(performance.reduce((sum, item) => sum + Number(item.distributableValue || 0), 0).toFixed(8));
    const latest = performance.at(-1) || null;
    return {
      ...basket,
      composition: { approvedAssets: admissions.filter((item) => item.state === 'APPROVED').length, pendingAssets: admissions.filter((item) => item.state === 'SUBMITTED').length, acceptedContributions: contributions.length },
      recognizedValue,
      targetProgress: basket.targetRecognizedValue ? Number(Math.min(100, (recognizedValue / basket.targetRecognizedValue) * 100).toFixed(2)) : 0,
      participationUnits,
      participantCount: new Set(positions.map((item) => item.participantId)).size,
      currentVerifiedValue: latest?.currentVerifiedValue ?? basket.openingRecognizedValue ?? recognizedValue,
      distributableProduced,
      totalDistributed,
      undistributedValue: Number(Math.max(0, distributableProduced - totalDistributed).toFixed(8)),
      latestPerformance: latest,
    };
  }

  detail(basketId) {
    const basket = this.summary(basketId);
    if (!basket) return null;
    return { basket, admissions: this.admissions(basketId), contributions: this.contributions(basketId), positions: this.positions(basketId), performance: this.performance(basketId), distributions: this.distributions(basketId), reconstitutions: this.domain.list(RECORD_TYPES.BASKET_RECONSTITUTION).filter((item) => item.basketId === basketId) };
  }

  async create(input = {}, actor = {}) {
    requireTier(actor.capacity, CREATE_TIERS, 'Productive basket creation');
    const model = upper(input.model || 'FIXED_BUNDLE');
    if (!MODELS.has(model)) throw new Error('Unsupported productive basket model.');
    const name = text(input.name);
    if (!name) throw new Error('name is required.');
    const targetRecognizedValue = positive(input.targetRecognizedValue, 'targetRecognizedValue');
    const unitSymbol = upper(input.unitSymbol);
    if (!/^[A-Z0-9]{2,12}$/.test(unitSymbol)) throw new Error('unitSymbol must contain 2-12 letters or numbers.');
    const basketId = text(input.basketId) || uid('PAB');
    if (this.get(basketId)) throw new Error('Productive basket already exists.');
    const createdAt = now();
    const record = {
      id: basketId, basketId, name, description: text(input.description) || null, model, category: upper(input.category || 'BLENDED_PRODUCTIVE_ASSETS'),
      targetRecognizedValue, minimumCloseValue: positive(input.minimumCloseValue ?? targetRecognizedValue, 'minimumCloseValue'),
      unitSymbol, unitReferenceValue: 1, denomination: 'SRA/USD', contributionPolicy: 'APPROVED_ASSETS_ONLY', conversionPolicy: 'NO_SILENT_CONVERSION',
      assetTreatmentPolicy: upper(input.assetTreatmentPolicy || 'HOLD_ORIGINAL_FORM'), distributionAssetId: SRA_USD_CANONICAL_ASSET_ID,
      reconstitutionPolicy: model === 'GOVERNED_BASKET' ? 'AUTHORIZED_RECONSTITUTION' : 'COMPOSITION_FIXED_AT_CLOSE',
      state: 'FORMATION', createdBy: actor.participantId, createdByCapacity: upper(actor.capacity), createdAt, updatedAt: createdAt,
    };
    if (record.minimumCloseValue > targetRecognizedValue) throw new Error('minimumCloseValue cannot exceed targetRecognizedValue.');
    await this.domain.put(RECORD_TYPES.PRODUCTIVE_BASKET, basketId, record, { actorId: actor.participantId, eventType: 'PRODUCTIVE_BASKET_FORMATION_OPENED' });
    return this.summary(basketId);
  }

  async submitAsset(basketId, input = {}, actor = {}) {
    requireTier(actor.capacity, ADMISSION_TIERS, 'Asset admission submission');
    const basket = this.get(basketId);
    if (!basket || basket.state !== 'FORMATION') throw new Error('A forming productive basket was not found.');
    const canonicalAssetId = upper(input.canonicalAssetId);
    const asset = this.domain.get(RECORD_TYPES.CANONICAL_ASSET, canonicalAssetId);
    if (!asset) throw new Error('Canonical asset not found.');
    const network = upper(input.network || (asset.native ? 'NATIVE' : asset.originNetwork));
    const duplicate = this.admissions(basketId).find((item) => item.canonicalAssetId === canonicalAssetId && item.network === network && item.state !== 'REJECTED');
    if (duplicate) return duplicate;
    const admissionId = uid('BAA');
    const submittedAt = now();
    const record = {
      id: admissionId, admissionId, basketId, canonicalAssetId, network, assetSymbol: asset.symbol, assetClass: asset.assetClass,
      submittedBy: actor.participantId, submittedByCapacity: upper(actor.capacity), evidenceReference: text(input.evidenceReference) || null,
      proposedTreatment: upper(input.proposedTreatment || basket.assetTreatmentPolicy), state: 'SUBMITTED', submittedAt, createdAt: submittedAt, updatedAt: submittedAt,
    };
    await this.domain.put(RECORD_TYPES.BASKET_ASSET_ADMISSION, admissionId, record, { actorId: actor.participantId, eventType: 'BASKET_ASSET_ADMISSION_SUBMITTED' });
    return record;
  }

  async decideAdmission(admissionId, input = {}, actor = {}) {
    requireTier(actor.capacity, OPERATE_TIERS, 'Asset admission decision');
    const current = this.domain.get(RECORD_TYPES.BASKET_ASSET_ADMISSION, admissionId);
    if (!current) throw new Error('Basket asset admission not found.');
    const decision = upper(input.decision);
    if (!['APPROVE', 'REJECT'].includes(decision)) throw new Error('decision must be APPROVE or REJECT.');
    const decidedAt = now();
    const updated = {
      ...current, state: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decisionRationale: text(input.decisionRationale) || null,
      recognitionRate: decision === 'APPROVE' ? positive(input.recognitionRate, 'recognitionRate') : null,
      recognitionCurrency: 'SRA/USD', recognitionMethod: decision === 'APPROVE' ? upper(input.recognitionMethod || 'RECORDED_VERIFIED_VALUE') : null,
      recognitionEvidenceReference: decision === 'APPROVE' ? text(input.recognitionEvidenceReference || current.evidenceReference) || null : null,
      approvedTreatment: decision === 'APPROVE' ? upper(input.approvedTreatment || current.proposedTreatment) : null,
      decidedBy: actor.participantId, decidedAt, updatedAt: decidedAt,
    };
    if (decision === 'APPROVE' && !updated.recognitionEvidenceReference) throw new Error('recognitionEvidenceReference is required for approval.');
    await this.domain.put(RECORD_TYPES.BASKET_ASSET_ADMISSION, admissionId, updated, { actorId: actor.participantId, eventType: `BASKET_ASSET_ADMISSION_${decision}D` });
    return updated;
  }

  async contribute(basketId, input = {}, actor = {}) {
    const basket = this.get(basketId);
    if (!basket || basket.state !== 'FORMATION') throw new Error('A forming productive basket was not found.');
    const directValueAccountId = text(input.directValueAccountId);
    const account = this.domain.get(RECORD_TYPES.DIRECT_VALUE_ACCOUNT, directValueAccountId);
    if (!account || account.participantId !== actor.participantId) throw new Error('Participant Direct Value Account not found.');
    const canonicalAssetId = upper(input.canonicalAssetId);
    const network = upper(input.network || 'NATIVE');
    const admission = this.admissions(basketId).find((item) => item.canonicalAssetId === canonicalAssetId && item.network === network && item.state === 'APPROVED');
    if (!admission) throw new Error('That asset is not approved for this basket.');
    const amount = positive(input.amount);
    const source = this.directAccounts.getPosition(directValueAccountId, canonicalAssetId, network);
    if (!source || Number(source.available) < amount) throw new Error('Available account balance is insufficient for this participation.');
    const recognizedValue = Number((amount * Number(admission.recognitionRate)).toFixed(8));
    const currentValue = this.summary(basketId).recognizedValue;
    if (currentValue + recognizedValue > basket.targetRecognizedValue) throw new Error('Contribution exceeds the remaining basket formation capacity.');
    const units = Number((recognizedValue / basket.unitReferenceValue).toFixed(8));
    const contributionId = uid('BAC');
    const participationPositionId = uid('BPP');
    const acceptedAt = now();
    const updatedSource = { ...source, available: Number((Number(source.available) - amount).toFixed(8)), restricted: Number((Number(source.restricted || 0) + amount).toFixed(8)), total: Number(source.total), updatedAt: acceptedAt };
    const contribution = {
      id: contributionId, contributionId, basketId, admissionId: admission.admissionId, directValueAccountId, participantId: actor.participantId,
      canonicalAssetId, network, amount, assetTreatment: admission.approvedTreatment, recognitionRate: admission.recognitionRate,
      recognitionEvidenceReference: admission.recognitionEvidenceReference, recognizedValue, units, positionId: participationPositionId,
      conversionAuthorized: false, state: 'ACCEPTED', acceptedAt, createdAt: acceptedAt,
    };
    const position = {
      id: participationPositionId, positionId: participationPositionId, basketId, participantId: actor.participantId, directValueAccountId,
      unitSymbol: basket.unitSymbol, units, originalRecognizedValue: recognizedValue, distributionAssetId: basket.distributionAssetId,
      ownershipStatus: 'PARTICIPANT', transferStatus: 'RETAINED', state: 'ACTIVE', createdAt: acceptedAt, updatedAt: acceptedAt,
    };
    await this.domain.atomicPut([
      { type: RECORD_TYPES.ACCOUNT_ASSET_POSITION, id: source.positionId, payload: updatedSource, actorId: actor.participantId, eventType: 'BASKET_CONTRIBUTION_ASSET_RESTRICTED' },
      { type: RECORD_TYPES.BASKET_CONTRIBUTION, id: contributionId, payload: contribution, actorId: actor.participantId, eventType: 'BASKET_CONTRIBUTION_ACCEPTED' },
      { type: RECORD_TYPES.BASKET_PARTICIPATION_POSITION, id: participationPositionId, payload: position, actorId: actor.participantId, eventType: 'BASKET_PARTICIPATION_POSITION_CREATED' },
    ]);
    return { contribution, position, basket: this.summary(basketId), accountPosition: updatedSource };
  }

  async closeFormation(basketId, input = {}, actor = {}) {
    requireTier(actor.capacity, OPERATE_TIERS, 'Basket formation close');
    const basket = this.get(basketId);
    if (!basket || basket.state !== 'FORMATION') throw new Error('A forming productive basket was not found.');
    const summary = this.summary(basketId);
    if (summary.recognizedValue < basket.minimumCloseValue) throw new Error('Basket minimum close value has not been reached.');
    if (!text(input.closingEvidenceReference)) throw new Error('closingEvidenceReference is required.');
    const closedAt = now();
    const updated = { ...basket, state: 'ACTIVE', openingRecognizedValue: summary.recognizedValue, issuedParticipationUnits: summary.participationUnits, closingEvidenceReference: text(input.closingEvidenceReference), closedBy: actor.participantId, closedAt, activatedAt: closedAt, updatedAt: closedAt };
    await this.domain.put(RECORD_TYPES.PRODUCTIVE_BASKET, basketId, updated, { actorId: actor.participantId, eventType: 'PRODUCTIVE_BASKET_ACTIVATED' });
    return this.summary(basketId);
  }

  async recordPerformance(basketId, input = {}, actor = {}) {
    requireTier(actor.capacity, OPERATE_TIERS, 'Basket performance recording');
    const basket = this.get(basketId);
    if (!basket || basket.state !== 'ACTIVE') throw new Error('An active productive basket was not found.');
    const currentVerifiedValue = positive(input.currentVerifiedValue, 'currentVerifiedValue');
    const grossValueReceived = nonnegative(input.grossValueReceived, 'grossValueReceived');
    const operatingExpenses = nonnegative(input.operatingExpenses, 'operatingExpenses');
    const requiredCommitments = nonnegative(input.requiredCommitments, 'requiredCommitments');
    const administrationAmount = nonnegative(input.administrationAmount, 'administrationAmount');
    const distributableValue = Number((grossValueReceived - operatingExpenses - requiredCommitments - administrationAmount).toFixed(8));
    if (distributableValue < 0) throw new Error('Recorded deductions cannot exceed gross value received.');
    if (!text(input.evidenceReference)) throw new Error('evidenceReference is required.');
    const performanceEventId = uid('BPE');
    const recordedAt = now();
    const record = {
      id: performanceEventId, performanceEventId, basketId, periodStart: text(input.periodStart) || null, periodEnd: text(input.periodEnd) || null,
      currentVerifiedValue, grossValueReceived, operatingExpenses, requiredCommitments, administrationAmount, distributableValue,
      valueChangeFromOpening: Number((currentVerifiedValue - Number(basket.openingRecognizedValue || 0)).toFixed(8)),
      evidenceReference: text(input.evidenceReference), state: 'RECORDED', recordedBy: actor.participantId, recordedAt, createdAt: recordedAt,
    };
    await this.domain.put(RECORD_TYPES.BASKET_PERFORMANCE_EVENT, performanceEventId, record, { actorId: actor.participantId, eventType: 'PRODUCTIVE_BASKET_PERFORMANCE_RECORDED' });
    return { performance: record, basket: this.summary(basketId) };
  }

  async distribute(basketId, input = {}, actor = {}) {
    requireTier(actor.capacity, ADMIN_TIERS, 'Basket distribution');
    const basket = this.get(basketId);
    if (!basket || basket.state !== 'ACTIVE') throw new Error('An active productive basket was not found.');
    if (!text(input.settlementReference)) throw new Error('settlementReference is required.');
    const duplicate = this.distributions(basketId).find((item) => item.settlementReference === text(input.settlementReference));
    if (duplicate) return { created: false, distribution: duplicate, basket: this.summary(basketId) };
    const amount = positive(input.amount);
    const available = this.summary(basketId).undistributedValue;
    if (amount > available) throw new Error('Distribution exceeds recorded undistributed value.');
    const positions = this.positions(basketId).filter((item) => item.state === 'ACTIVE');
    const totalUnits = positions.reduce((sum, item) => sum + Number(item.units || 0), 0);
    if (totalUnits <= 0) throw new Error('No active participation units are available for distribution.');
    const distributionId = uid('BDI');
    const distributedAt = now();
    let allocated = 0;
    const allocations = positions.map((position, index) => {
      const share = index === positions.length - 1 ? Number((amount - allocated).toFixed(8)) : Number(((Number(position.units) / totalUnits) * amount).toFixed(8));
      allocated = Number((allocated + share).toFixed(8));
      return { positionId: position.positionId, participantId: position.participantId, directValueAccountId: position.directValueAccountId, units: position.units, ownershipPercentage: Number(((Number(position.units) / totalUnits) * 100).toFixed(8)), amount: share };
    });
    const changes = [];
    for (const allocation of allocations) {
      const current = this.directAccounts.getPosition(allocation.directValueAccountId, SRA_USD_CANONICAL_ASSET_ID, 'NATIVE');
      const positionId = current?.positionId || `AVP-${crypto.createHash('sha256').update(`${allocation.directValueAccountId}|${SRA_USD_CANONICAL_ASSET_ID}|NATIVE`).digest('hex').slice(0, 16).toUpperCase()}`;
      changes.push({ type: RECORD_TYPES.ACCOUNT_ASSET_POSITION, id: positionId, actorId: actor.participantId, eventType: 'BASKET_DISTRIBUTION_ACCOUNT_CREDITED', payload: {
        id: positionId, positionId, directValueAccountId: allocation.directValueAccountId, canonicalAssetId: SRA_USD_CANONICAL_ASSET_ID, network: 'NATIVE',
        available: Number((Number(current?.available || 0) + allocation.amount).toFixed(8)), restricted: Number(current?.restricted || 0), total: Number((Number(current?.total || 0) + allocation.amount).toFixed(8)),
        custodyModel: 'SRA_NATIVE_ACCOUNT_LEDGER', custodyReference: null, state: 'ACTIVE', createdAt: current?.createdAt || distributedAt, updatedAt: distributedAt,
      } });
    }
    const distribution = {
      id: distributionId, distributionId, basketId, amount, assetId: SRA_USD_CANONICAL_ASSET_ID, totalUnits, allocationCount: allocations.length,
      allocations, settlementReference: text(input.settlementReference), distributionRate: Number((amount / totalUnits).toFixed(8)),
      state: 'COMPLETED', distributedBy: actor.participantId, distributedAt, createdAt: distributedAt,
    };
    changes.push({ type: RECORD_TYPES.BASKET_DISTRIBUTION, id: distributionId, payload: distribution, actorId: actor.participantId, eventType: 'PRODUCTIVE_BASKET_DISTRIBUTION_COMPLETED' });
    await this.domain.atomicPut(changes);
    return { created: true, distribution, basket: this.summary(basketId) };
  }

  async reconstitute(basketId, input = {}, actor = {}) {
    requireTier(actor.capacity, OPERATE_TIERS, 'Basket reconstitution');
    const basket = this.get(basketId);
    if (!basket || basket.state !== 'ACTIVE') throw new Error('An active productive basket was not found.');
    if (basket.model !== 'GOVERNED_BASKET') throw new Error('This basket composition is fixed and cannot be reconstituted.');
    const action = upper(input.action);
    if (!['ADD', 'REMOVE'].includes(action)) throw new Error('action must be ADD or REMOVE.');
    const admission = this.domain.get(RECORD_TYPES.BASKET_ASSET_ADMISSION, text(input.admissionId));
    if (!admission || admission.basketId !== basketId || admission.state !== 'APPROVED') throw new Error('Approved basket admission not found.');
    if (!text(input.decisionRationale) || !text(input.evidenceReference)) throw new Error('decisionRationale and evidenceReference are required.');
    const reconstitutionId = uid('BRC');
    const effectiveAt = text(input.effectiveAt) || now();
    const record = { id: reconstitutionId, reconstitutionId, basketId, action, admissionId: admission.admissionId, canonicalAssetId: admission.canonicalAssetId, decisionRationale: text(input.decisionRationale), evidenceReference: text(input.evidenceReference), authorizedBy: actor.participantId, effectiveAt, state: 'RECORDED', createdAt: now() };
    await this.domain.put(RECORD_TYPES.BASKET_RECONSTITUTION, reconstitutionId, record, { actorId: actor.participantId, eventType: `PRODUCTIVE_BASKET_RECONSTITUTION_${action}` });
    return record;
  }

  participantPositions(participantId) {
    return this.domain.list(RECORD_TYPES.BASKET_PARTICIPATION_POSITION).filter((item) => item.participantId === participantId).map((position) => ({ ...position, basket: this.summary(position.basketId) }));
  }
}

export const PRODUCTIVE_BASKET_TIERS = Object.freeze({ create: [...CREATE_TIERS], submitAsset: [...ADMISSION_TIERS], operate: [...OPERATE_TIERS], distribute: [...ADMIN_TIERS] });
