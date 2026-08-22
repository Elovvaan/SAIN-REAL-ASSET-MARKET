import { PlatformEconomicsService } from './platform-economics-service.js';
import { AssetServicingService } from './asset-servicing-service.js';
import { RECORD_TYPES } from './persistent-domain-service.js';
import { AgentServiceFeeService } from './agent-service-fee-service.js';
import { SRA_AGENT_SERVICE_FEE_SCHEDULE } from '../config/agent-service-fee-schedule.js';

const TRIGGER = 'AGENT_WORK_ACCEPTED';
const SUBJECT_TYPE = 'SRA_AGENT_WORK_ORDER';
const SERVICING_ELIGIBLE_CHARGE_STATES = new Set(['ASSESSED', 'INVOICED']);

function now() { return new Date().toISOString(); }
function required(value, field) {
  const v = String(value || '').trim();
  if (!v) throw new Error(`${field} is required.`);
  return v;
}

export class AgentServiceFeeBillingService {
  constructor(domain) {
    this.domain = domain;
    this.economics = new PlatformEconomicsService(domain);
    this.servicing = new AssetServicingService(domain);
    this.serviceFees = new AgentServiceFeeService();
  }

  async initialize(actorId = 'SRA_AGENT_OS') {
    for (const service of Object.values(SRA_AGENT_SERVICE_FEE_SCHEDULE.services)) {
      if (!this.economics.getCatalogItem(service.feeCode)) {
        await this.economics.createCatalogItem({
          feeCode: service.feeCode,
          name: service.serviceName,
          description: `SRA service fee for accepted ${service.humanEquivalentRole || 'agent'} work.`,
          category: 'SRA_SERVICE',
          defaultPayerType: 'PARTICIPANT',
          currency: service.currency,
        }, actorId);
      }
    }

    if (!this.economics.getSchedule(SRA_AGENT_SERVICE_FEE_SCHEDULE.scheduleId)) {
      await this.economics.createSchedule({
        scheduleId: SRA_AGENT_SERVICE_FEE_SCHEDULE.scheduleId,
        name: 'SRA Agent Service Fee Schedule',
        version: SRA_AGENT_SERVICE_FEE_SCHEDULE.version,
        effectiveFrom: `${SRA_AGENT_SERVICE_FEE_SCHEDULE.effectiveDate}T00:00:00.000Z`,
        state: 'ACTIVE_FOR_EXPLICIT_USE',
        rules: Object.values(SRA_AGENT_SERVICE_FEE_SCHEDULE.services).map((service) => ({
          feeCode: service.feeCode,
          method: 'FIXED',
          amount: service.amount,
          payerType: 'PARTICIPANT',
          trigger: TRIGGER,
          conditions: { agentId: service.agentId },
        })),
      }, actorId);
    }

    return this.status();
  }

  status() {
    const schedule = this.economics.getSchedule(SRA_AGENT_SERVICE_FEE_SCHEDULE.scheduleId);
    const charges = this.domain.list(RECORD_TYPES.FEE_CHARGE).filter((charge) => charge.scheduleId === SRA_AGENT_SERVICE_FEE_SCHEDULE.scheduleId);
    return {
      scheduleId: SRA_AGENT_SERVICE_FEE_SCHEDULE.scheduleId,
      scheduleVersion: SRA_AGENT_SERVICE_FEE_SCHEDULE.version,
      schedulePresent: Boolean(schedule),
      serviceFeeChargeCount: charges.length,
      servicingObligationCount: charges.filter((charge) => charge.servicingObligationId).length,
      trigger: TRIGGER,
    };
  }

  listCharges(filters = {}) {
    return this.domain.list(RECORD_TYPES.FEE_CHARGE).filter((charge) => {
      if (charge.scheduleId !== SRA_AGENT_SERVICE_FEE_SCHEDULE.scheduleId) return false;
      if (filters.payerId && charge.payerId !== filters.payerId) return false;
      if (filters.subjectId && charge.subjectId !== filters.subjectId) return false;
      if (filters.state && charge.state !== filters.state) return false;
      return true;
    });
  }

  getCharge(chargeId) {
    const charge = this.economics.getCharge(chargeId);
    return charge?.scheduleId === SRA_AGENT_SERVICE_FEE_SCHEDULE.scheduleId ? charge : null;
  }

  existingChargeForWork(workOrderId) {
    return this.listCharges({ subjectId: workOrderId })[0] || null;
  }

  validateServicingTarget({ payerId, servicingAccountId, dueDate } = {}) {
    if (!servicingAccountId && !dueDate) return { requested: false };
    const accountId = required(servicingAccountId, 'servicingAccountId');
    required(dueDate, 'dueDate');
    const account = this.servicing.getAccount(accountId);
    if (!account) throw new Error('Asset Servicing Account not found.');
    const resolvedPayerId = String(payerId || '').trim();
    if (resolvedPayerId && account.ownerId && resolvedPayerId !== account.ownerId) {
      throw new Error('Service fee payer does not match the servicing account owner.');
    }
    return { requested: true, account };
  }

  async assessAcceptedWork(work, input = {}, actorId = null) {
    if (!work || work.state !== 'ACCEPTED') throw new Error('Accepted agent work is required before assessing a service fee.');
    const quote = this.serviceFees.quoteWorkOrder(work);
    if (!quote) return { assessed: false, reason: 'NO_SERVICE_FEE_QUOTE', charge: null };

    const existing = this.existingChargeForWork(work.workOrderId);
    if (existing) return { assessed: true, existing: true, charge: existing, quote };

    const payerId = String(input.payerId || work.serviceFeePayerId || '').trim();
    if (!payerId) return { assessed: false, reason: 'PAYER_NOT_LINKED', charge: null, quote };

    const payerType = String(input.payerType || work.serviceFeePayerType || 'PARTICIPANT').trim().toUpperCase();
    const charge = await this.economics.assess({
      scheduleId: SRA_AGENT_SERVICE_FEE_SCHEDULE.scheduleId,
      trigger: TRIGGER,
      subjectType: SUBJECT_TYPE,
      subjectId: work.workOrderId,
      payerId,
      payerType,
      currency: quote.currency,
      context: {
        agentId: quote.agentId,
        sourceStage: work.sourceStage || null,
        sourceRecordId: work.sourceRecordId || null,
      },
    }, actorId);

    if (charge.total !== quote.amount) {
      throw new Error('Assessed service fee does not match the authoritative agent service-fee quote.');
    }

    return { assessed: true, existing: false, charge, quote };
  }

  async attachChargeToServicing(chargeId, input = {}, actorId = null) {
    const charge = this.getCharge(required(chargeId, 'chargeId'));
    if (!charge) throw new Error('SRA agent service fee charge not found.');
    if (charge.servicingObligationId) {
      const existing = this.servicing.getObligation(charge.servicingObligationId);
      return { attached: true, existing: true, charge, obligation: existing };
    }
    if (!SERVICING_ELIGIBLE_CHARGE_STATES.has(String(charge.state || '').toUpperCase())) {
      throw new Error(`Service fee charge in ${charge.state || 'UNKNOWN'} state cannot be added to repayment servicing.`);
    }

    const servicingAccountId = required(input.servicingAccountId, 'servicingAccountId');
    const dueDate = required(input.dueDate, 'dueDate');
    const validation = this.validateServicingTarget({ payerId: charge.payerId, servicingAccountId, dueDate });
    const account = validation.account;

    const names = (charge.lines || []).map((line) => line.name || line.feeCode).filter(Boolean);
    const obligation = await this.servicing.createObligation({
      servicingAccountId,
      type: 'SERVICE_FEE',
      description: names.length ? names.join(' + ') : 'SRA Service Fee',
      amount: charge.total,
      currency: charge.currency,
      dueDate,
      recurrence: input.recurrence || null,
      evidenceReference: `FEE_CHARGE:${charge.chargeId}`,
    }, actorId);

    const updatedCharge = {
      ...charge,
      servicingAccountId,
      servicingObligationId: obligation.obligationId,
      repaymentDueDate: dueDate,
      servicingLinkedAt: now(),
      updatedAt: now(),
    };
    await this.domain.put(RECORD_TYPES.FEE_CHARGE, charge.chargeId, updatedCharge, {
      actorId,
      eventType: 'SRA_AGENT_SERVICE_FEE_LINKED_TO_SERVICING',
    });

    return { attached: true, existing: false, charge: updatedCharge, obligation, servicingAccount: account };
  }
}
