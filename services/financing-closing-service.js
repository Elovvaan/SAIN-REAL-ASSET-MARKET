import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const CLOSING_TYPE = 'FINANCING_CLOSING';
const CONDITION_TYPE = 'FINANCING_CLOSING_CONDITION';
const DISBURSEMENT_TYPE = 'FINANCING_DISBURSEMENT';
const LOAN_FINANCING_TYPE = 'LOAN_FINANCING_AUTHORIZATION';
const id = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const now = () => new Date().toISOString();
const positiveAmount = (value) => { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new Error('Funding amount must be greater than zero.'); return Number(n.toFixed(8)); };
const required = (value, field) => { const text = String(value || '').trim(); if (!text) throw new Error(`${field} is required.`); return text; };

export class FinancingClosingService {
  constructor(domain, assetServicingService = null) { this.domain = domain; this.assetServicingService = assetServicingService; }

  async initialize() {
    await this.domain.hydrate([CLOSING_TYPE, CONDITION_TYPE, DISBURSEMENT_TYPE, RECORD_TYPES.SRA_TRANSACTION]);
    return this.status();
  }

  list(filters = {}) {
    return this.domain.list(CLOSING_TYPE).filter((r) => (!filters.status || r.status === filters.status) && (!filters.opportunityId || r.opportunityId === filters.opportunityId));
  }
  get(closingId) { return this.domain.get(CLOSING_TYPE, closingId); }
  conditions(closingId) { return this.domain.list(CONDITION_TYPE).filter((r) => r.closingId === closingId); }
  disbursements(closingId) { return this.domain.list(DISBURSEMENT_TYPE).filter((r) => r.closingId === closingId); }

  detail(closingId) {
    const closing = this.get(closingId);
    if (!closing) return null;
    return { closing, conditions: this.conditions(closingId), disbursements: this.disbursements(closingId) };
  }

  financing(financingTransactionId) {
    const record = this.domain.get(RECORD_TYPES.SRA_TRANSACTION, financingTransactionId);
    if (!record || record.transactionType !== LOAN_FINANCING_TYPE || record.state !== 'POSTED') throw new Error('Posted loan financing authorization was not found.');
    return record;
  }

  existingForFinancing(financingTransactionId) {
    return this.domain.list(CLOSING_TYPE).find((r) => r.financingTransactionId === financingTransactionId && r.status !== 'CANCELLED') || null;
  }

  async open(input = {}, actorId = null) {
    const financing = this.financing(required(input.financingTransactionId, 'financingTransactionId'));
    const existing = this.existingForFinancing(financing.transactionId);
    if (existing) return { closing: existing, created: false };
    if (financing.status !== 'FUNDING_CREDITED_PENDING_DISBURSEMENT') throw new Error(`Closing cannot open from financing status ${financing.status}.`);
    const timestamp = now();
    const closingId = id('FCL');
    const closing = {
      closingId,
      financingTransactionId: financing.transactionId,
      issuanceTransactionId: financing.issuanceTransactionId,
      instrumentId: financing.instrumentId,
      opportunityId: financing.opportunityId || null,
      borrowerParticipantId: financing.borrowerParticipantId,
      approvedAmount: financing.amount,
      finalFundingAmount: financing.amount,
      currency: financing.currency || 'USD',
      beneficiaryName: input.beneficiaryName || null,
      settlementMethod: input.settlementMethod || null,
      settlementInstructions: input.settlementInstructions || {},
      status: 'IN_PROGRESS',
      openedBy: actorId,
      openedAt: timestamp,
      updatedAt: timestamp,
      readyAt: null,
      authorizedAt: null,
      fundedAt: null,
      servicingAccountId: null,
    };
    await this.domain.put(CLOSING_TYPE, closingId, closing, { actorId, eventType: 'FINANCING_CLOSING_OPENED' });
    await this.domain.lifecycle({ objectType: CLOSING_TYPE, objectId: closingId, eventType: 'FINANCING_CLOSING_OPENED', actorId, payload: { financingTransactionId: financing.transactionId, opportunityId: financing.opportunityId || null, amount: financing.amount } });
    return { closing, created: true };
  }

  async addCondition(closingId, input = {}, actorId = null) {
    const closing = this.get(closingId); if (!closing) throw new Error('Financing closing was not found.');
    if (!['IN_PROGRESS','READY_TO_FUND'].includes(closing.status)) throw new Error(`Closing conditions cannot be added from ${closing.status}.`);
    const conditionId = id('FCC');
    const record = { conditionId, closingId, type: String(input.type || 'OTHER').toUpperCase(), title: required(input.title, 'title'), description: input.description || null, required: input.required !== false, status: 'OPEN', evidenceReference: input.evidenceReference || null, createdBy: actorId, createdAt: now(), updatedAt: now(), satisfiedAt: null, satisfiedBy: null };
    await this.domain.put(CONDITION_TYPE, conditionId, record, { actorId, eventType: 'FINANCING_CLOSING_CONDITION_ADDED' });
    return record;
  }

  async satisfyCondition(closingId, conditionId, input = {}, actorId = null) {
    const closing = this.get(closingId); if (!closing) throw new Error('Financing closing was not found.');
    const current = this.domain.get(CONDITION_TYPE, conditionId); if (!current || current.closingId !== closingId) throw new Error('Closing condition was not found.');
    const status = String(input.status || 'SATISFIED').toUpperCase();
    if (!['SATISFIED','WAIVED'].includes(status)) throw new Error('Condition status must be SATISFIED or WAIVED.');
    const timestamp = now();
    const updated = { ...current, status, evidenceReference: input.evidenceReference || current.evidenceReference || null, note: input.note || current.note || null, satisfiedAt: timestamp, satisfiedBy: actorId, updatedAt: timestamp };
    await this.domain.put(CONDITION_TYPE, conditionId, updated, { actorId, eventType: `FINANCING_CLOSING_CONDITION_${status}` });
    return updated;
  }

  async markReady(closingId, input = {}, actorId = null) {
    const current = this.get(closingId); if (!current) throw new Error('Financing closing was not found.');
    if (current.status !== 'IN_PROGRESS') throw new Error(`Closing cannot be marked ready from ${current.status}.`);
    const open = this.conditions(closingId).filter((c) => c.required && !['SATISFIED','WAIVED'].includes(c.status));
    if (open.length) throw new Error(`Required closing conditions remain open: ${open.map((c) => c.title).join(', ')}`);
    const finalFundingAmount = positiveAmount(input.finalFundingAmount ?? current.finalFundingAmount ?? current.approvedAmount);
    if (finalFundingAmount > Number(current.approvedAmount)) throw new Error('Final funding amount cannot exceed the approved financing amount.');
    const beneficiaryName = required(input.beneficiaryName || current.beneficiaryName, 'beneficiaryName');
    const settlementMethod = required(input.settlementMethod || current.settlementMethod, 'settlementMethod').toUpperCase();
    const timestamp = now();
    const updated = { ...current, finalFundingAmount, beneficiaryName, settlementMethod, settlementInstructions: input.settlementInstructions || current.settlementInstructions || {}, status: 'READY_TO_FUND', readyAt: timestamp, updatedAt: timestamp };
    await this.domain.put(CLOSING_TYPE, closingId, updated, { actorId, eventType: 'FINANCING_CLOSING_READY_TO_FUND' });
    return updated;
  }

  async authorize(closingId, input = {}, actorId = null) {
    const current = this.get(closingId); if (!current) throw new Error('Financing closing was not found.');
    if (current.status !== 'READY_TO_FUND') throw new Error('Financing must be READY_TO_FUND before disbursement authorization.');
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator funding approval is required.');
    const existing = this.disbursements(closingId).find((d) => !['FAILED','CANCELLED'].includes(d.status));
    if (existing) return { closing: current, disbursement: existing, created: false };
    const timestamp = now();
    const disbursementId = id('FDB');
    const disbursement = { disbursementId, closingId, financingTransactionId: current.financingTransactionId, opportunityId: current.opportunityId, instrumentId: current.instrumentId, amount: current.finalFundingAmount, currency: current.currency, beneficiaryName: current.beneficiaryName, settlementMethod: current.settlementMethod, settlementInstructions: current.settlementInstructions || {}, status: 'AUTHORIZED', externalReference: null, authorizedBy: actorId, authorizedAt: timestamp, submittedAt: null, settledAt: null, createdAt: timestamp, updatedAt: timestamp };
    const updated = { ...current, status: 'AUTHORIZED', authorizedBy: actorId, authorizedAt: timestamp, updatedAt: timestamp };
    await this.domain.atomicPut([
      { type: DISBURSEMENT_TYPE, id: disbursementId, payload: disbursement, actorId, eventType: 'FINANCING_DISBURSEMENT_AUTHORIZED' },
      { type: CLOSING_TYPE, id: closingId, payload: updated, actorId, eventType: 'FINANCING_CLOSING_AUTHORIZED' },
    ]);
    return { closing: updated, disbursement, created: true };
  }

  async submitDisbursement(closingId, disbursementId, input = {}, actorId = null) {
    const closing = this.get(closingId); if (!closing) throw new Error('Financing closing was not found.');
    const current = this.domain.get(DISBURSEMENT_TYPE, disbursementId); if (!current || current.closingId !== closingId) throw new Error('Financing disbursement was not found.');
    if (current.status !== 'AUTHORIZED') throw new Error('Only an authorized disbursement can be submitted.');
    const updated = { ...current, status: 'SUBMITTED', externalReference: input.externalReference || current.externalReference || null, submittedAt: now(), updatedAt: now(), submittedBy: actorId };
    await this.domain.put(DISBURSEMENT_TYPE, disbursementId, updated, { actorId, eventType: 'FINANCING_DISBURSEMENT_SUBMITTED' });
    return updated;
  }

  async recordSettlement(closingId, disbursementId, input = {}, actorId = null) {
    const closing = this.get(closingId); if (!closing) throw new Error('Financing closing was not found.');
    const disbursement = this.domain.get(DISBURSEMENT_TYPE, disbursementId); if (!disbursement || disbursement.closingId !== closingId) throw new Error('Financing disbursement was not found.');
    if (!['AUTHORIZED','SUBMITTED'].includes(disbursement.status)) throw new Error('Disbursement is not awaiting settlement.');
    const externalReference = required(input.externalReference, 'externalReference');
    const timestamp = now();
    const settled = { ...disbursement, status: 'SETTLED', externalReference, submittedAt: disbursement.submittedAt || timestamp, settledAt: timestamp, settledBy: actorId, updatedAt: timestamp };
    const funded = { ...closing, status: 'FUNDED', fundedAt: timestamp, updatedAt: timestamp };
    const financing = this.financing(closing.financingTransactionId);
    const financingUpdated = { ...financing, status: 'FUNDED', externalDisbursementAuthorized: true, externalSettlementReference: externalReference, fundedAt: timestamp, updatedAt: timestamp };
    await this.domain.atomicPut([
      { type: DISBURSEMENT_TYPE, id: disbursementId, payload: settled, actorId, eventType: 'FINANCING_DISBURSEMENT_SETTLED' },
      { type: CLOSING_TYPE, id: closingId, payload: funded, actorId, eventType: 'FINANCING_CLOSING_FUNDED' },
      { type: RECORD_TYPES.SRA_TRANSACTION, id: financing.transactionId, payload: financingUpdated, actorId, eventType: 'LOAN_FINANCING_FUNDED' },
    ]);
    await this.domain.lifecycle({ objectType: CLOSING_TYPE, objectId: closingId, eventType: 'FINANCING_EXTERNAL_SETTLEMENT_RECORDED', actorId, payload: { disbursementId, externalReference, amount: settled.amount, settlementMethod: settled.settlementMethod } });
    return { closing: funded, disbursement: settled, financing: financingUpdated };
  }

  async boardToServicing(closingId, input = {}, actorId = null) {
    const closing = this.get(closingId); if (!closing) throw new Error('Financing closing was not found.');
    if (closing.status !== 'FUNDED') throw new Error('Only funded financing can be boarded to servicing.');
    if (closing.servicingAccountId) return { closing, servicingAccount: this.assetServicingService?.getAccount(closing.servicingAccountId) || null, created: false };
    if (!this.assetServicingService) throw new Error('Asset servicing service is unavailable.');
    const assetAccountId = required(input.assetAccountId, 'assetAccountId');
    const ownerId = required(input.ownerId || closing.borrowerParticipantId, 'ownerId');
    const account = await this.assetServicingService.createAccount({ assetAccountId, ownerId, servicerId: input.servicerId || 'SRA', currency: closing.currency, settlementId: closing.disbursements?.settlementId || null, nextReviewDate: input.nextReviewDate || null, insuranceRequired: input.insuranceRequired, taxMonitoringRequired: input.taxMonitoringRequired, inspectionFrequencyMonths: input.inspectionFrequencyMonths }, actorId);
    const updated = { ...closing, status: 'SERVICING', servicingAccountId: account.servicingAccountId, boardedAt: now(), updatedAt: now() };
    await this.domain.put(CLOSING_TYPE, closingId, updated, { actorId, eventType: 'FINANCING_BOARDED_TO_SERVICING' });
    return { closing: updated, servicingAccount: account, created: true };
  }

  status() {
    const records = this.domain.list(CLOSING_TYPE);
    return { service: 'SRA_FINANCING_CLOSING', count: records.length, inProgress: records.filter((r) => r.status === 'IN_PROGRESS').length, readyToFund: records.filter((r) => r.status === 'READY_TO_FUND').length, authorized: records.filter((r) => r.status === 'AUTHORIZED').length, funded: records.filter((r) => r.status === 'FUNDED').length, servicing: records.filter((r) => r.status === 'SERVICING').length };
  }
}

export { CLOSING_TYPE as FINANCING_CLOSING_RECORD_TYPE, CONDITION_TYPE as FINANCING_CLOSING_CONDITION_RECORD_TYPE, DISBURSEMENT_TYPE as FINANCING_DISBURSEMENT_RECORD_TYPE };