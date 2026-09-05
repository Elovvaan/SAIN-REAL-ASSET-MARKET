import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const POSITION_TYPE = 'FINANCED_POSITION';
const now = () => new Date().toISOString();
const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const nonnegative = (value, field) => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field} must be zero or greater.`);
  return Number(parsed.toFixed(8));
};
const rate = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) throw new Error('cashFlowAllocationRate must be greater than zero and no greater than 1.');
  return Number(parsed.toFixed(8));
};
const canonicalId = (positionId) => `FINANCED-${upper(positionId)}`;
const performanceId = (servicingEventId, basketId) => `BPE-${crypto.createHash('sha256').update(`${servicingEventId}|${basketId}`).digest('hex').slice(0, 16).toUpperCase()}`;

function financedPosition(domain, positionId) {
  return domain.get(POSITION_TYPE, text(positionId));
}

function instrumentForPosition(domain, position) {
  return position ? domain.get(RECORD_TYPES.SRA_INSTRUMENT, position.instrumentId) : null;
}

function assetAccountForInstrument(domain, instrument) {
  return instrument?.assetId ? domain.get(RECORD_TYPES.ASSET_ACCOUNT, instrument.assetId) : null;
}

export async function submitFinancedPositionAdmission(service, basketId, input = {}, actor = {}) {
  const domain = service.domain;
  const position = financedPosition(domain, input.financedPositionId);
  if (!position) throw new Error('Financed position not found.');
  const instrument = instrumentForPosition(domain, position);
  if (!instrument) throw new Error('SRA instrument for financed position not found.');
  const assetAccount = assetAccountForInstrument(domain, instrument);
  if (!assetAccount) throw new Error('Asset Account for financed instrument not found.');

  const id = canonicalId(position.positionId);
  let canonical = domain.get(RECORD_TYPES.CANONICAL_ASSET, id);
  if (!canonical) {
    const createdAt = now();
    canonical = {
      id,
      canonicalAssetId: id,
      displayName: instrument.name || instrument.title || assetAccount.name || position.positionId,
      symbol: upper(input.assetSymbol || `FP${crypto.createHash('sha256').update(position.positionId).digest('hex').slice(0, 8)}`).slice(0, 12),
      assetClass: 'FINANCED_OBLIGATION_POSITION',
      native: true,
      originNetwork: 'SRA',
      denomination: position.currency || 'USD',
      decimals: 8,
      assetAccountId: assetAccount.assetId || instrument.assetId,
      instrumentId: position.instrumentId,
      financedPositionId: position.positionId,
      financingTransactionId: position.financingTransactionId,
      opportunityId: position.opportunityId || null,
      state: 'ACTIVE',
      createdAt,
      updatedAt: createdAt,
    };
    await domain.put(RECORD_TYPES.CANONICAL_ASSET, id, canonical, { actorId: actor.participantId, eventType: 'FINANCED_POSITION_CANONICAL_ASSET_LINKED' });
  }

  const admission = await service.submitAsset(basketId, { ...input, canonicalAssetId: id, network: 'SRA' }, actor);
  const allocationRate = input.cashFlowAllocationRate == null ? null : rate(input.cashFlowAllocationRate);
  const linked = {
    ...admission,
    assetAccountId: assetAccount.assetId || instrument.assetId,
    instrumentId: position.instrumentId,
    financedPositionId: position.positionId,
    financingTransactionId: position.financingTransactionId,
    opportunityId: position.opportunityId || null,
    cashFlowAllocationRate: admission.cashFlowAllocationRate ?? allocationRate,
    linkageType: 'FINANCED_POSITION',
    updatedAt: now(),
  };
  await domain.put(RECORD_TYPES.BASKET_ASSET_ADMISSION, linked.admissionId, linked, { actorId: actor.participantId, eventType: 'FINANCED_POSITION_LINKED_TO_BASKET_ADMISSION' });
  return linked;
}

export async function decideFinancedPositionAdmission(service, admissionId, input = {}, actor = {}) {
  const current = service.domain.get(RECORD_TYPES.BASKET_ASSET_ADMISSION, admissionId);
  const decided = await service.decideAdmission(admissionId, input, actor);
  if (decided.state !== 'APPROVED' || current?.linkageType !== 'FINANCED_POSITION') return decided;
  const allocationRate = rate(input.cashFlowAllocationRate ?? current.cashFlowAllocationRate);
  const otherApproved = service.domain.list(RECORD_TYPES.BASKET_ASSET_ADMISSION)
    .filter((item) => item.admissionId !== admissionId && item.financedPositionId === current.financedPositionId && item.state === 'APPROVED')
    .reduce((sum, item) => sum + Number(item.cashFlowAllocationRate || 0), 0);
  if (otherApproved + allocationRate > 1.00000001) throw new Error('Approved basket cash-flow allocations for this financed position cannot exceed 100%.');
  const linked = { ...decided, cashFlowAllocationRate: allocationRate, updatedAt: now() };
  await service.domain.put(RECORD_TYPES.BASKET_ASSET_ADMISSION, admissionId, linked, { actorId: actor.participantId, eventType: 'FINANCED_POSITION_BASKET_ALLOCATION_APPROVED' });
  return linked;
}

export async function routeServicingPaymentToBaskets(servicingService, servicingEvent, actorId = null) {
  if (!servicingEvent || servicingEvent.type !== 'PAYMENT') return { routed: false, allocations: [] };
  const domain = servicingService.domain;
  const account = servicingService.getAccount(servicingEvent.servicingAccountId);
  if (!account) throw new Error('Asset Servicing Account not found for payment routing.');
  const instruments = domain.list(RECORD_TYPES.SRA_INSTRUMENT).filter((item) => item.assetId === account.assetAccountId);
  const instrumentIds = new Set(instruments.map((item) => item.instrumentId));
  const positions = domain.list(POSITION_TYPE).filter((item) => instrumentIds.has(item.instrumentId) && item.servicingAccountId === account.servicingAccountId);
  const positionIds = new Set(positions.map((item) => item.positionId));
  const admissions = domain.list(RECORD_TYPES.BASKET_ASSET_ADMISSION).filter((item) => item.state === 'APPROVED' && item.linkageType === 'FINANCED_POSITION' && positionIds.has(item.financedPositionId));
  if (!admissions.length) return { routed: false, allocations: [] };

  const paymentAmount = nonnegative(servicingEvent.amount, 'payment amount');
  const details = servicingEvent.details || {};
  const allocations = [];
  for (const admission of admissions) {
    const basket = domain.get(RECORD_TYPES.PRODUCTIVE_BASKET, admission.basketId);
    if (!basket || basket.state !== 'ACTIVE') continue;
    const allocationRate = rate(admission.cashFlowAllocationRate);
    const grossValueReceived = Number((paymentAmount * allocationRate).toFixed(8));
    const id = performanceId(servicingEvent.servicingEventId, admission.basketId);
    const existing = domain.get(RECORD_TYPES.BASKET_PERFORMANCE_EVENT, id);
    if (existing) { allocations.push(existing); continue; }
    const currentVerifiedValue = Number(details.currentVerifiedValue ?? basket.openingRecognizedValue ?? 0);
    if (!Number.isFinite(currentVerifiedValue) || currentVerifiedValue <= 0) throw new Error('A positive currentVerifiedValue is required to route a servicing payment into basket performance.');
    const deductions = details.basketDeductions?.[admission.basketId] || {};
    const operatingExpenses = nonnegative(deductions.operatingExpenses, 'operatingExpenses');
    const requiredCommitments = nonnegative(deductions.requiredCommitments, 'requiredCommitments');
    const administrationAmount = nonnegative(deductions.administrationAmount, 'administrationAmount');
    const distributableValue = Number((grossValueReceived - operatingExpenses - requiredCommitments - administrationAmount).toFixed(8));
    if (distributableValue < 0) throw new Error('Basket deductions cannot exceed the allocated servicing payment.');
    const recordedAt = now();
    const performance = {
      id,
      performanceEventId: id,
      basketId: admission.basketId,
      periodStart: text(details.periodStart) || null,
      periodEnd: text(details.periodEnd) || null,
      currentVerifiedValue,
      grossValueReceived,
      operatingExpenses,
      requiredCommitments,
      administrationAmount,
      distributableValue,
      valueChangeFromOpening: Number((currentVerifiedValue - Number(basket.openingRecognizedValue || 0)).toFixed(8)),
      evidenceReference: servicingEvent.evidenceReference || servicingEvent.referenceId || servicingEvent.servicingEventId,
      sourceType: 'ASSET_SERVICING_PAYMENT',
      sourceServicingEventId: servicingEvent.servicingEventId,
      sourceServicingAccountId: servicingEvent.servicingAccountId,
      financedPositionId: admission.financedPositionId,
      instrumentId: admission.instrumentId,
      assetAccountId: admission.assetAccountId,
      admissionId: admission.admissionId,
      cashFlowAllocationRate: allocationRate,
      state: 'RECORDED',
      recordedBy: actorId,
      recordedAt,
      createdAt: recordedAt,
    };
    await domain.put(RECORD_TYPES.BASKET_PERFORMANCE_EVENT, id, performance, { actorId, eventType: 'SERVICING_PAYMENT_ALLOCATED_TO_PRODUCTIVE_BASKET' });
    allocations.push(performance);
  }
  return { routed: allocations.length > 0, allocations };
}
