import crypto from 'node:crypto';

const ESCROW_TYPE = 'ESCROW_SETTLEMENT';
const ESCROW_EVENT_TYPE = 'ESCROW_SETTLEMENT_EVENT';
const EXPORT_PACKAGE_TYPE = 'EXPORT_PACKAGE';
const CLOSING_TYPE = 'FINANCING_CLOSING';
const DISBURSEMENT_TYPE = 'FINANCING_DISBURSEMENT';
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const required = (value, field) => { const text = String(value || '').trim(); if (!text) throw new Error(`${field} is required.`); return text; };
const normalize = (value) => String(value || '').trim().toUpperCase();
const allowedRoutes = new Set(['FIAT_ESCROW', 'DIGITAL_ASSET_ESCROW']);
const allowedStates = new Set(['INSTRUCTIONS_PREPARED', 'ACKNOWLEDGED', 'ASSET_IN_ESCROW', 'EXCEPTION_REPORTED', 'READY_FOR_RELEASE', 'RELEASED', 'RETURNED', 'CANCELLED']);

export class EscrowSettlementService {
  constructor(domain) { this.domain = domain; }

  async initialize() {
    await this.domain.hydrate([ESCROW_TYPE, ESCROW_EVENT_TYPE, EXPORT_PACKAGE_TYPE, CLOSING_TYPE, DISBURSEMENT_TYPE]);
    return this.status();
  }

  status() {
    const records = this.domain.list(ESCROW_TYPE);
    return {
      service: 'ESCROW_CUSTODIAL_SETTLEMENT',
      records: records.length,
      active: records.filter((record) => !['RELEASED', 'RETURNED', 'CANCELLED'].includes(record.status)).length,
      released: records.filter((record) => record.status === 'RELEASED').length,
    };
  }

  list(filters = {}) {
    return this.domain.list(ESCROW_TYPE).filter((record) =>
      (!filters.status || record.status === normalize(filters.status)) &&
      (!filters.exportPackageId || record.exportPackageId === filters.exportPackageId) &&
      (!filters.opportunityId || record.opportunityId === filters.opportunityId));
  }

  get(escrowSettlementId) { return this.domain.get(ESCROW_TYPE, escrowSettlementId); }
  events(escrowSettlementId) { return this.domain.list(ESCROW_EVENT_TYPE).filter((record) => record.escrowSettlementId === escrowSettlementId); }

  detail(escrowSettlementId) {
    const settlement = this.get(escrowSettlementId);
    if (!settlement) return null;
    return { settlement, events: this.events(escrowSettlementId) };
  }

  existingForPackage(exportPackageId) {
    return this.domain.list(ESCROW_TYPE).find((record) => record.exportPackageId === exportPackageId && record.status !== 'CANCELLED') || null;
  }

  async recordEvent(settlement, eventType, payload = {}, actorId = null) {
    const eventId = id('ESE');
    const event = {
      eventId,
      escrowSettlementId: settlement.escrowSettlementId,
      exportPackageId: settlement.exportPackageId,
      eventType,
      payload,
      actorId,
      occurredAt: now(),
    };
    await this.domain.put(ESCROW_EVENT_TYPE, eventId, event, { actorId, eventType });
    return event;
  }

  async prepare(input = {}, actorId = null) {
    const exportPackageId = required(input.exportPackageId, 'exportPackageId');
    const pkg = this.domain.get(EXPORT_PACKAGE_TYPE, exportPackageId);
    if (!pkg || normalize(pkg.exportKind) !== 'FINANCING_DISBURSEMENT') throw new Error('Financing disbursement export package was not found.');
    const closing = this.domain.get(CLOSING_TYPE, pkg.closingId);
    const disbursement = this.domain.get(DISBURSEMENT_TYPE, pkg.disbursementId);
    if (!closing || !disbursement) throw new Error('Authoritative financing closing and disbursement records are required.');
    if (!['AUTHORIZED', 'SUBMITTED'].includes(disbursement.status)) throw new Error(`Escrow settlement cannot be prepared from disbursement status ${disbursement.status}.`);
    const existing = this.existingForPackage(exportPackageId);
    if (existing) return { settlement: existing, created: false };

    const route = normalize(input.route);
    if (!allowedRoutes.has(route)) throw new Error('route must be FIAT_ESCROW or DIGITAL_ASSET_ESCROW.');
    const escrowAgentName = required(input.escrowAgentName, 'escrowAgentName');
    const releaseConditions = Array.isArray(input.releaseConditions) ? input.releaseConditions.map((condition) => String(condition || '').trim()).filter(Boolean) : [];
    if (!releaseConditions.length) throw new Error('At least one recorded release condition is required.');
    const returnConditions = Array.isArray(input.returnConditions) ? input.returnConditions.map((condition) => String(condition || '').trim()).filter(Boolean) : [];
    const timestamp = now();
    const escrowSettlementId = id('ESC');
    const settlement = {
      escrowSettlementId,
      exportPackageId,
      closingId: pkg.closingId,
      disbursementId: pkg.disbursementId,
      financingTransactionId: pkg.financingTransactionId,
      opportunityId: pkg.opportunityId || null,
      instrumentId: pkg.instrumentId || null,
      participantId: pkg.participantId || null,
      beneficiaryName: pkg.beneficiaryName || closing.beneficiaryName || null,
      amount: pkg.amount,
      currency: pkg.currency || 'USD',
      route,
      settlementAsset: input.settlementAsset ? normalize(input.settlementAsset) : (route === 'FIAT_ESCROW' ? normalize(pkg.currency || 'USD') : null),
      network: input.network ? normalize(input.network) : null,
      escrowAgentName,
      escrowAgentReference: input.escrowAgentReference || null,
      escrowInstructionsReference: input.escrowInstructionsReference || null,
      releaseConditions,
      returnConditions,
      status: 'INSTRUCTIONS_PREPARED',
      externalReference: null,
      custodyReference: null,
      releaseReference: null,
      exception: null,
      preparedBy: actorId,
      preparedAt: timestamp,
      acknowledgedAt: null,
      assetReceivedAt: null,
      readyForReleaseAt: null,
      releasedAt: null,
      returnedAt: null,
      updatedAt: timestamp,
    };
    if (route === 'DIGITAL_ASSET_ESCROW' && !settlement.settlementAsset) throw new Error('settlementAsset is required for DIGITAL_ASSET_ESCROW.');
    await this.domain.put(ESCROW_TYPE, escrowSettlementId, settlement, { actorId, eventType: 'ESCROW_SETTLEMENT_PREPARED' });
    await this.recordEvent(settlement, 'ESCROW_SETTLEMENT_PREPARED', { route, escrowAgentName, amount: settlement.amount, currency: settlement.currency }, actorId);
    return { settlement, created: true };
  }

  async transition(escrowSettlementId, input = {}, actorId = null) {
    const current = this.get(escrowSettlementId);
    if (!current) throw new Error('Escrow settlement was not found.');
    const status = normalize(input.status);
    if (!allowedStates.has(status) || status === 'INSTRUCTIONS_PREPARED') throw new Error('Unsupported escrow settlement transition.');
    const permitted = {
      INSTRUCTIONS_PREPARED: ['ACKNOWLEDGED', 'CANCELLED'],
      ACKNOWLEDGED: ['ASSET_IN_ESCROW', 'EXCEPTION_REPORTED', 'CANCELLED'],
      ASSET_IN_ESCROW: ['READY_FOR_RELEASE', 'EXCEPTION_REPORTED', 'RETURNED'],
      EXCEPTION_REPORTED: ['ACKNOWLEDGED', 'ASSET_IN_ESCROW', 'READY_FOR_RELEASE', 'RETURNED', 'CANCELLED'],
      READY_FOR_RELEASE: ['RELEASED', 'EXCEPTION_REPORTED', 'RETURNED'],
      RELEASED: [], RETURNED: [], CANCELLED: [],
    };
    if (!permitted[current.status]?.includes(status)) throw new Error(`Escrow settlement cannot transition from ${current.status} to ${status}.`);
    const timestamp = now();
    const evidenceReference = input.evidenceReference || input.externalReference || null;
    if (['ASSET_IN_ESCROW', 'READY_FOR_RELEASE', 'RELEASED', 'RETURNED'].includes(status) && !evidenceReference) throw new Error(`${status} requires an external evidence reference.`);
    if (status === 'EXCEPTION_REPORTED' && !String(input.exception || '').trim()) throw new Error('exception is required for EXCEPTION_REPORTED.');
    const updated = {
      ...current,
      status,
      externalReference: evidenceReference || current.externalReference || null,
      custodyReference: input.custodyReference || current.custodyReference || null,
      releaseReference: status === 'RELEASED' ? (input.releaseReference || evidenceReference) : current.releaseReference,
      exception: status === 'EXCEPTION_REPORTED' ? String(input.exception).trim() : (status === 'ACKNOWLEDGED' || status === 'ASSET_IN_ESCROW' || status === 'READY_FOR_RELEASE' ? null : current.exception),
      acknowledgedAt: status === 'ACKNOWLEDGED' ? timestamp : current.acknowledgedAt,
      assetReceivedAt: status === 'ASSET_IN_ESCROW' ? timestamp : current.assetReceivedAt,
      readyForReleaseAt: status === 'READY_FOR_RELEASE' ? timestamp : current.readyForReleaseAt,
      releasedAt: status === 'RELEASED' ? timestamp : current.releasedAt,
      returnedAt: status === 'RETURNED' ? timestamp : current.returnedAt,
      updatedAt: timestamp,
      updatedBy: actorId,
    };
    await this.domain.put(ESCROW_TYPE, escrowSettlementId, updated, { actorId, eventType: `ESCROW_SETTLEMENT_${status}` });
    await this.recordEvent(updated, `ESCROW_SETTLEMENT_${status}`, { evidenceReference, custodyReference: updated.custodyReference, releaseReference: updated.releaseReference, exception: updated.exception }, actorId);
    return updated;
  }
}
