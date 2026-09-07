import crypto from 'node:crypto';
import { Router } from 'express';
import { CAPACITY_DEFINITIONS } from '../services/access-service.js';
import { PlatformLedgerService } from '../services/platform-ledger-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

function readCookie(req, name) {
  const cookie = req.headers.cookie || '';
  const entry = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}
function id(prefix) { return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function now() { return new Date().toISOString(); }
function money(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}
function capabilityOf(session, capacity) {
  return session?.capabilities?.find((item) => item.id === capacity) || null;
}
function instructionProjection(record) {
  if (!record) return null;
  return {
    fundingInstructionId: record.fundingInstructionId,
    purpose: record.purpose,
    invoiceId: record.invoiceId || null,
    participantId: record.participantId || null,
    accountId: record.accountId || null,
    amount: money(record.amount),
    currency: record.currency || 'USD',
    rail: record.rail || null,
    destinationType: record.destinationType || null,
    state: record.state || null,
    externalReference: record.externalReference || null,
    createdAt: record.createdAt || null,
    confirmedAt: record.confirmedAt || null
  };
}
function invoiceProjection(invoice) {
  if (!invoice) return null;
  return {
    invoiceId: invoice.invoiceId,
    total: money(invoice.total),
    currency: invoice.currency || 'USD',
    state: invoice.state,
    dueDate: invoice.dueDate || null,
    chargeIds: invoice.chargeIds || [],
    paidAt: invoice.paidAt || null,
    paymentReference: invoice.paymentReference || null
  };
}

export function createCapabilityUpgradeRouter({ accessService, economicsService, domain }) {
  const router = Router();
  const ledger = new PlatformLedgerService(domain);

  async function participantSession(req, res) {
    const session = await accessService.getSession(readCookie(req, 'sra_session'));
    if (!session) res.status(401).json({ error: 'Authentication required.' });
    return session;
  }
  async function administratorSession(req, res) {
    const session = await accessService.getSession(readCookie(req, 'sra_admin_session'));
    const admin = session?.activeCapacity === 'PLATFORM_ADMIN' && session?.capacities?.some((item) => item.id === 'PLATFORM_ADMIN');
    if (!admin) res.status(401).json({ error: 'Private Platform Administration authentication is required.' });
    return admin ? session : null;
  }
  function latestPaymentInstruction(invoiceId) {
    return domain.list(RECORD_TYPES.FUNDING_INSTRUCTION)
      .filter((record) => record.purpose === 'PLATFORM_FEE_PAYMENT' && record.invoiceId === invoiceId)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
  }
  async function findCapacityByInvoice(invoiceId) {
    const users = await accessService.listUsersCurrent();
    for (const user of users) {
      for (const [capacity, record] of Object.entries(user.capabilityRecords || {})) {
        if (record?.invoiceId === invoiceId) return { user, capacity, record };
      }
    }
    return null;
  }
  async function syncPaidState(session, capacity) {
    const user = await accessService.getUserById(session.id);
    const record = user?.capabilityRecords?.[capacity];
    if (!record?.invoiceId) return accessService.sanitizeUser(user, session.activeCapacity);
    const invoice = domain.get(RECORD_TYPES.FEE_INVOICE, record.invoiceId);
    if (invoice?.state === 'PAID' && record.state !== 'ACTIVE' && record.state !== 'UNDER_REVIEW') {
      await accessService.updateCapacityProgress(user.id, capacity, {
        state: 'UNDER_REVIEW',
        billingState: 'PAID',
        reviewState: 'PENDING',
        paymentSettledAt: invoice.paidAt || now()
      }, user.id, 'CAPACITY_PAYMENT_SETTLED');
    }
    const refreshed = await accessService.getUserById(user.id);
    return accessService.sanitizeUser(refreshed, session.activeCapacity);
  }
  async function billingFor(session, capacity) {
    const synced = await syncPaidState(session, capacity);
    const capability = capabilityOf(synced, capacity);
    const invoice = capability?.invoiceId ? domain.get(RECORD_TYPES.FEE_INVOICE, capability.invoiceId) : null;
    const instruction = capability?.invoiceId ? latestPaymentInstruction(capability.invoiceId) : null;
    return { session: synced, capability, invoice: invoiceProjection(invoice), paymentInstruction: instructionProjection(instruction) };
  }
  async function ensureInvoice(session, capacity) {
    const definition = CAPACITY_DEFINITIONS[capacity];
    if (!definition || !definition.selfService || definition.tier !== 'PAID') throw new Error('That capacity does not use the paid self-service upgrade flow.');
    const current = await billingFor(session, capacity);
    if (current.invoice) return current;
    const schedule = economicsService.activeSchedule();
    if (!schedule) {
      await accessService.updateCapacityProgress(session.id, capacity, { billingState: 'FEE_SCHEDULE_UNAVAILABLE' }, session.id, 'CAPACITY_FEE_SCHEDULE_UNAVAILABLE');
      const error = new Error('No active SRA fee schedule is available for this paid capability.');
      error.code = 'CAPACITY_FEE_SCHEDULE_UNAVAILABLE';
      throw error;
    }
    const context = {
      capacity,
      capacityId: capacity,
      participantId: session.id,
      universalAccountId: session.universalAccountId,
      participantType: 'PARTICIPANT',
      units: 1,
      baseAmount: 0
    };
    const calculation = economicsService.calculate({ scheduleId: schedule.scheduleId, trigger: definition.feeTrigger, context });
    if (!calculation.lines.length || calculation.total <= 0) {
      await accessService.updateCapacityProgress(session.id, capacity, { feeScheduleId: schedule.scheduleId, billingState: 'FEE_RULE_REQUIRED' }, session.id, 'CAPACITY_FEE_RULE_REQUIRED');
      const error = new Error(`The active SRA fee schedule does not contain a positive ${definition.label} activation charge.`);
      error.code = 'CAPACITY_FEE_RULE_REQUIRED';
      throw error;
    }
    const charge = await economicsService.assess({
      scheduleId: schedule.scheduleId,
      subjectType: 'CAPACITY_UPGRADE',
      subjectId: `${session.id}:${capacity}`,
      payerId: session.id,
      payerType: 'PARTICIPANT',
      trigger: definition.feeTrigger,
      context,
      currency: calculation.lines[0]?.currency || 'USD'
    }, session.id);
    const invoice = await economicsService.createInvoice({
      payerId: session.id,
      payerType: 'PARTICIPANT',
      chargeIds: [charge.chargeId],
      dueDate: new Date().toISOString().slice(0, 10),
      currency: charge.currency || 'USD'
    }, session.id);
    await accessService.updateCapacityProgress(session.id, capacity, {
      state: 'INFORMATION_REQUIRED',
      feeScheduleId: schedule.scheduleId,
      invoiceId: invoice.invoiceId,
      feeTotal: invoice.total,
      feeCurrency: invoice.currency,
      billingState: 'INVOICED',
      reviewState: 'NOT_STARTED'
    }, session.id, 'CAPACITY_FEE_INVOICE_CREATED');
    const user = await accessService.getUserById(session.id);
    const refreshed = accessService.sanitizeUser(user, session.activeCapacity);
    return {
      session: refreshed,
      capability: capabilityOf(refreshed, capacity),
      invoice: invoiceProjection(invoice),
      paymentInstruction: null
    };
  }

  router.post('/apply', async (req, res) => {
    try {
      const session = await participantSession(req, res); if (!session) return;
      const capacity = String(req.body?.capacity || '').toUpperCase();
      await accessService.applyForCapacity(readCookie(req, 'sra_session'), capacity);
      const refreshed = await accessService.getSession(readCookie(req, 'sra_session'));
      const result = await ensureInvoice(refreshed, capacity);
      return res.status(202).json({ authenticated: true, ...result });
    } catch (error) {
      const session = await accessService.getSession(readCookie(req, 'sra_session')).catch(() => null);
      return res.status(error.code ? 409 : 400).json({ error: error.message, code: error.code || 'CAPACITY_UPGRADE_APPLICATION_FAILED', session });
    }
  });

  router.post('/payment/:capacity', async (req, res) => {
    try {
      const session = await participantSession(req, res); if (!session) return;
      const capacity = String(req.params.capacity || '').toUpperCase();
      const current = await billingFor(session, capacity);
      if (!current.capability?.invoiceId || !current.invoice) return res.status(409).json({ error: 'A fee invoice must be created before payment instructions are available.' });
      if (current.invoice.state === 'PAID') return res.status(409).json({ error: 'That capability fee invoice is already paid.', ...current });
      const existing = latestPaymentInstruction(current.invoice.invoiceId);
      if (existing && existing.state !== 'CONFIRMED') {
        return res.json({ ...current, paymentInstruction: instructionProjection(existing), reused: true });
      }
      const createdAt = now();
      const record = {
        fundingInstructionId: id('PAY'),
        purpose: 'PLATFORM_FEE_PAYMENT',
        participantId: session.id,
        accountId: session.universalAccountId,
        invoiceId: current.invoice.invoiceId,
        amount: current.invoice.total,
        currency: current.invoice.currency || 'USD',
        rail: 'EXTERNAL_TRANSFER',
        destinationType: 'SRA_OPERATING_ACCOUNT',
        state: 'AWAITING_EXTERNAL_TRANSFER',
        createdBy: session.id,
        createdAt,
        updatedAt: createdAt
      };
      await domain.put(RECORD_TYPES.FUNDING_INSTRUCTION, record.fundingInstructionId, record, { actorId: session.id, eventType: 'FEE_PAYMENT_INSTRUCTION_CREATED' });
      return res.status(201).json({ ...current, paymentInstruction: instructionProjection(record), reused: false });
    } catch (error) { return res.status(400).json({ error: error.message || 'Fee payment instructions could not be created.' }); }
  });

  router.get('/status/:capacity', async (req, res) => {
    try {
      const session = await participantSession(req, res); if (!session) return;
      const capacity = String(req.params.capacity || '').toUpperCase();
      return res.json(await billingFor(session, capacity));
    } catch (error) { return res.status(400).json({ error: error.message || 'Capability upgrade status could not be loaded.' }); }
  });

  router.get('/admin-queue', async (req, res) => {
    try {
      const admin = await administratorSession(req, res); if (!admin) return;
      const users = await accessService.listUsersCurrent();
      const applications = [];
      for (const user of users) {
        for (const [capacity, record] of Object.entries(user.capabilityRecords || {})) {
          const definition = CAPACITY_DEFINITIONS[capacity];
          if (!definition || definition.tier !== 'PAID' || !record.invoiceId || record.state === 'ACTIVE') continue;
          const invoice = domain.get(RECORD_TYPES.FEE_INVOICE, record.invoiceId);
          const paymentInstruction = latestPaymentInstruction(record.invoiceId);
          applications.push({
            participantId: user.id,
            universalAccountId: user.universalAccountId,
            displayName: user.displayName,
            email: user.email,
            capacity,
            label: definition.label,
            state: record.state,
            billingState: record.billingState || invoice?.state || null,
            reviewState: record.reviewState || null,
            invoice: invoiceProjection(invoice),
            paymentInstruction: instructionProjection(paymentInstruction),
            appliedAt: record.appliedAt || null,
            updatedAt: record.updatedAt || null
          });
        }
      }
      applications.sort((a, b) => new Date(b.updatedAt || b.appliedAt || 0) - new Date(a.updatedAt || a.appliedAt || 0));
      return res.json({ generatedAt: now(), applications });
    } catch (error) { return res.status(400).json({ error: error.message || 'Capability review queue could not be loaded.' }); }
  });

  router.post('/admin-confirm-payment', async (req, res) => {
    try {
      const admin = await administratorSession(req, res); if (!admin) return;
      const instructionId = String(req.body?.fundingInstructionId || '').trim();
      const externalReference = String(req.body?.externalReference || '').trim();
      if (!externalReference) return res.status(400).json({ error: 'An external transfer reference is required.' });
      const record = domain.get(RECORD_TYPES.FUNDING_INSTRUCTION, instructionId);
      if (!record) return res.status(404).json({ error: 'Fee payment instruction not found.' });
      if (record.purpose !== 'PLATFORM_FEE_PAYMENT') return res.status(409).json({ error: 'That funding instruction is not a platform fee payment.' });
      if (record.state === 'CONFIRMED') return res.status(409).json({ error: 'That fee payment instruction is already confirmed.' });
      if (record.rail === 'CRYPTO') return res.status(409).json({ error: 'Crypto fee payments require blockchain verification.' });
      const invoice = domain.get(RECORD_TYPES.FEE_INVOICE, record.invoiceId);
      if (!invoice) return res.status(404).json({ error: 'Linked fee invoice not found.' });
      if (invoice.state === 'PAID') return res.status(409).json({ error: 'The linked fee invoice is already paid.' });
      const ledgerEntry = await ledger.recordInvoicePayment({ invoiceId: invoice.invoiceId, amount: record.amount, cashAccountId: 'GL-CASH-OPERATING', currency: record.currency }, admin.id);
      const paidAt = now();
      await domain.put(RECORD_TYPES.FEE_INVOICE, invoice.invoiceId, { ...invoice, state: 'PAID', paidAt, paymentReference: externalReference, updatedAt: paidAt }, { actorId: admin.id, eventType: 'FEE_INVOICE_PAID' });
      for (const chargeId of invoice.chargeIds || []) {
        const charge = domain.get(RECORD_TYPES.FEE_CHARGE, chargeId);
        if (charge) await domain.put(RECORD_TYPES.FEE_CHARGE, chargeId, { ...charge, state: 'PAID', paidAt, updatedAt: paidAt }, { actorId: admin.id, eventType: 'FEE_CHARGE_PAID' });
      }
      const updated = { ...record, state: 'CONFIRMED', externalReference, ledgerEntryId: ledgerEntry.entryId, confirmedBy: admin.id, confirmedAt: paidAt, updatedAt: paidAt };
      await domain.put(RECORD_TYPES.FUNDING_INSTRUCTION, record.fundingInstructionId, updated, { actorId: admin.id, eventType: 'EXTERNAL_FUNDS_CONFIRMED' });
      const receipt = {
        paymentReceiptId: id('RCPT'), fundingInstructionId: record.fundingInstructionId, purpose: record.purpose,
        participantId: record.participantId, accountId: record.accountId, amount: record.amount, currency: record.currency,
        externalReference, ledgerEntryId: ledgerEntry.entryId, state: 'RECORDED', recordedAt: paidAt, createdAt: paidAt
      };
      await domain.put(RECORD_TYPES.PAYMENT_RECEIPT, receipt.paymentReceiptId, receipt, { actorId: admin.id, eventType: 'PAYMENT_RECEIPT_RECORDED' });
      const eventId = id('VME');
      await domain.put(RECORD_TYPES.VERIFIED_MARKET_EVENT, eventId, {
        eventId, eventType: 'PLATFORM_FEE_PAYMENT_CONFIRMED', participantId: record.participantId,
        fromAccountId: record.accountId, toAccountId: 'GL-CASH-OPERATING', amount: record.amount,
        currency: record.currency, state: 'VERIFIED', verified: true, referenceId: record.fundingInstructionId,
        evidenceId: receipt.paymentReceiptId, verifiedAt: paidAt, occurredAt: paidAt, createdAt: paidAt
      }, { actorId: admin.id, eventType: 'VERIFIED_FUNDS_EVENT_RECORDED' });
      const linked = await findCapacityByInvoice(invoice.invoiceId);
      if (linked) {
        await accessService.updateCapacityProgress(linked.user.id, linked.capacity, {
          state: 'UNDER_REVIEW',
          billingState: 'PAID',
          reviewState: 'PENDING',
          paymentSettledAt: paidAt
        }, admin.id, 'CAPACITY_PAYMENT_SETTLED');
      }
      return res.json({ instruction: instructionProjection(updated), receipt, invoice: invoiceProjection({ ...invoice, state: 'PAID', paidAt, paymentReference: externalReference }) });
    } catch (error) { return res.status(400).json({ error: error.message || 'Fee payment could not be confirmed.' }); }
  });

  router.post('/admin-review', async (req, res) => {
    try {
      const admin = await administratorSession(req, res); if (!admin) return;
      const participantId = String(req.body?.participantId || '').trim();
      const capacity = String(req.body?.capacity || '').toUpperCase();
      const user = await accessService.getUserById(participantId);
      const record = user?.capabilityRecords?.[capacity];
      if (!user || !record) return res.status(404).json({ error: 'Capability application not found.' });
      const invoice = record.invoiceId ? domain.get(RECORD_TYPES.FEE_INVOICE, record.invoiceId) : null;
      if (String(req.body?.decision || '').toUpperCase() === 'APPROVE' && invoice?.state !== 'PAID') return res.status(409).json({ error: 'Fee settlement must be confirmed before the capability can be approved.' });
      if (invoice?.state === 'PAID' && record.billingState !== 'PAID') {
        await accessService.updateCapacityProgress(user.id, capacity, { state: 'UNDER_REVIEW', billingState: 'PAID', reviewState: 'PENDING', paymentSettledAt: invoice.paidAt || now() }, admin.id, 'CAPACITY_PAYMENT_SETTLED');
      }
      const session = await accessService.reviewCapacity(user.id, capacity, { decision: req.body?.decision, notes: req.body?.notes, invoiceId: record.invoiceId }, admin.id);
      return res.json({ participantId: user.id, capacity, session });
    } catch (error) { return res.status(400).json({ error: error.message || 'Capability review could not be completed.' }); }
  });

  return router;
}
