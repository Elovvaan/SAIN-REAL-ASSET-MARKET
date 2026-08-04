import crypto from 'node:crypto';
import { Router } from 'express';
import { AccessService } from '../services/access-service.js';
import { PlatformLedgerService } from '../services/platform-ledger-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

function readCookie(req, name) {
  const cookie = req.headers.cookie || '';
  const entry = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sra_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure}`);
}
function clearSessionCookie(res) { res.setHeader('Set-Cookie', 'sra_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); }
function amount(value) { const parsed = Number(value); return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0; }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function now() { return new Date().toISOString(); }
function isCompleted(transaction) {
  return ['COMPLETED', 'SETTLED', 'POSTED', 'EXECUTED', 'EVIDENCED', 'VERIFIED', 'CLOSED']
    .some((state) => String(transaction.state || '').toUpperCase().includes(state));
}
function isPending(transaction) {
  return ['PENDING', 'QUEUED', 'AUTHORIZED', 'SUBMITTED', 'PROCESSING', 'AVAILABLE']
    .some((state) => String(transaction.state || '').toUpperCase().includes(state));
}
function participantVault(session, transactions = []) {
  const identityKeys = new Set([session.id, session.universalAccountId].filter(Boolean));
  const linked = transactions.filter((transaction) => [transaction.participantId, transaction.fromAccountId, transaction.toAccountId]
    .some((value) => value && identityKeys.has(value)));
  let incoming = 0;
  let outgoing = 0;
  const activity = linked.map((transaction) => {
    const completed = isCompleted(transaction);
    const incomingMatch = transaction.toAccountId && identityKeys.has(transaction.toAccountId);
    const outgoingMatch = transaction.fromAccountId && identityKeys.has(transaction.fromAccountId);
    let direction = 'RECORDED';
    if (incomingMatch && !outgoingMatch) direction = 'INCOMING';
    if (outgoingMatch && !incomingMatch) direction = 'OUTGOING';
    if (incomingMatch && outgoingMatch) direction = 'INTERNAL';
    if (completed && direction === 'INCOMING') incoming += amount(transaction.amount);
    if (completed && direction === 'OUTGOING') outgoing += amount(transaction.amount);
    return { ...transaction, direction, completed };
  });
  const completed = activity.filter((transaction) => transaction.completed);
  const pending = activity.filter(isPending);
  const verified = activity.filter((transaction) => transaction.verified);
  return {
    accountId: session.universalAccountId,
    participantId: session.id,
    displayName: session.displayName,
    activeCapacity: session.activeCapacity,
    ownership: 'PARTICIPANT',
    platformRole: 'INFRASTRUCTURE',
    custodyState: 'NOT_INFERRED',
    currency: 'USD',
    recordedBalance: amount(incoming - outgoing),
    incomingTotal: amount(incoming),
    outgoingTotal: amount(outgoing),
    transactionCount: activity.length,
    completedTransactionCount: completed.length,
    pendingTransactionCount: pending.length,
    verifiedTransactionCount: verified.length,
    transactions: activity.slice(0, 50)
  };
}

async function ensureFundingLedgerAccounts(domain, ledger) {
  const definitions = [
    { accountId: 'GL-CASH-PARTICIPANT-FUNDS', code: '1010-PARTICIPANT-FUNDS-CASH', name: 'Participant Funds Cash', type: 'ASSET', normalBalance: 'DEBIT' },
    { accountId: 'GL-PARTICIPANT-FUNDS-LIABILITY', code: '2100-PARTICIPANT-FUNDS-LIABILITY', name: 'Participant Funds Payable', type: 'LIABILITY', normalBalance: 'CREDIT' }
  ];
  for (const definition of definitions) {
    if (!ledger.getAccount(definition.accountId)) await ledger.createAccount({ ...definition, currency: 'USD' }, 'SYSTEM');
  }
}

function fundingProjection(record) {
  return {
    fundingInstructionId: record.fundingInstructionId,
    purpose: record.purpose,
    amount: record.amount,
    currency: record.currency,
    rail: record.rail,
    state: record.state,
    invoiceId: record.invoiceId || null,
    externalReference: record.externalReference || null,
    createdAt: record.createdAt,
    confirmedAt: record.confirmedAt || null
  };
}

export function createAccessRouter(marketplace, service = new AccessService()) {
  const router = Router();
  const domain = marketplace.persistentDomain;
  const ledger = domain ? new PlatformLedgerService(domain) : null;

  async function sessionFor(req) { return service.getSession(readCookie(req, 'sra_session')); }
  async function requireSession(req, res) {
    const session = await sessionFor(req);
    if (!session) res.status(401).json({ error: 'Authentication required.' });
    return session;
  }

  router.get('/public', (_req, res) => res.json({
    marketStatus: marketplace.marketStatus,
    verifiedValue: marketplace.verifiedValue,
    activeProjects: marketplace.activeProjects,
    participatingAssets: marketplace.participatingAssets,
    opportunities: marketplace.projects.map((project) => ({
      id: project.id, title: project.title, assetName: project.assetName, region: project.region,
      stage: project.stage, signal: project.signal, verifiedValue: project.verifiedValue,
      projectedGainRate: project.projectedGainRate, participationWindow: project.participationWindow,
      completionState: project.completionState
    }))
  }));
  router.get('/session', async (req, res) => {
    try { const session = await sessionFor(req); res.json({ authenticated: Boolean(session), session }); }
    catch { res.status(500).json({ error: 'Session lookup failed.' }); }
  });
  router.get('/vault', async (req, res) => {
    try {
      const session = await requireSession(req, res); if (!session) return;
      return res.json({ vault: participantVault(session, marketplace.transactions || []) });
    } catch { return res.status(500).json({ error: 'Asset Vault lookup failed.' }); }
  });

  router.get('/funding/instructions', async (req, res) => {
    try {
      const session = await requireSession(req, res); if (!session) return;
      const instructions = domain.list(RECORD_TYPES.FUNDING_INSTRUCTION)
        .filter((record) => record.participantId === session.id || record.accountId === session.universalAccountId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      res.json({ instructions: instructions.map(fundingProjection) });
    } catch { res.status(500).json({ error: 'Funding instructions could not be loaded.' }); }
  });

  router.post('/funding/vault-instructions', async (req, res) => {
    try {
      const session = await requireSession(req, res); if (!session) return;
      const requestedAmount = amount(req.body?.amount);
      if (requestedAmount <= 0) return res.status(400).json({ error: 'Funding amount must be greater than zero.' });
      const rail = String(req.body?.rail || 'ACH').toUpperCase();
      if (!['ACH', 'WIRE', 'EXTERNAL_TRANSFER'].includes(rail)) return res.status(400).json({ error: 'Supported funding rails are ACH, wire, or external transfer.' });
      const record = {
        fundingInstructionId: id('FUND'), purpose: 'ASSET_VAULT_FUNDING', participantId: session.id,
        accountId: session.universalAccountId, amount: requestedAmount, currency: 'USD', rail,
        destinationType: 'SEGREGATED_PARTICIPANT_FUNDS', state: 'AWAITING_EXTERNAL_TRANSFER',
        createdBy: session.id, createdAt: now(), updatedAt: now()
      };
      await domain.put(RECORD_TYPES.FUNDING_INSTRUCTION, record.fundingInstructionId, record, { actorId: session.id, eventType: 'VAULT_FUNDING_INSTRUCTION_CREATED' });
      res.status(201).json({ instruction: fundingProjection(record), balanceCredited: false });
    } catch (error) { res.status(400).json({ error: error.message || 'Funding instruction could not be created.' }); }
  });

  router.post('/funding/fee-instructions', async (req, res) => {
    try {
      const session = await requireSession(req, res); if (!session) return;
      const invoiceId = String(req.body?.invoiceId || '').trim();
      const invoice = domain.get(RECORD_TYPES.FEE_INVOICE, invoiceId);
      if (!invoice) return res.status(404).json({ error: 'Fee invoice not found.' });
      if (![session.id, session.universalAccountId].includes(invoice.payerId)) return res.status(403).json({ error: 'That invoice does not belong to this account.' });
      if (invoice.state === 'PAID') return res.status(409).json({ error: 'That invoice is already paid.' });
      const rail = String(req.body?.rail || 'ACH').toUpperCase();
      if (!['ACH', 'WIRE', 'CARD', 'EXTERNAL_TRANSFER'].includes(rail)) return res.status(400).json({ error: 'Unsupported fee payment rail.' });
      const record = {
        fundingInstructionId: id('PAY'), purpose: 'PLATFORM_FEE_PAYMENT', participantId: session.id,
        accountId: session.universalAccountId, invoiceId, amount: amount(invoice.total), currency: invoice.currency || 'USD', rail,
        destinationType: 'SRA_OPERATING_ACCOUNT', state: 'AWAITING_EXTERNAL_TRANSFER',
        createdBy: session.id, createdAt: now(), updatedAt: now()
      };
      await domain.put(RECORD_TYPES.FUNDING_INSTRUCTION, record.fundingInstructionId, record, { actorId: session.id, eventType: 'FEE_PAYMENT_INSTRUCTION_CREATED' });
      res.status(201).json({ instruction: fundingProjection(record), invoicePaid: false });
    } catch (error) { res.status(400).json({ error: error.message || 'Fee payment instruction could not be created.' }); }
  });

  router.post('/funding/instructions/:instructionId/confirm', async (req, res) => {
    try {
      const session = await requireSession(req, res); if (!session) return;
      if (session.activeCapacity !== 'PLATFORM_ADMIN') return res.status(403).json({ error: 'Platform Administration authorization is required to confirm outside funds.' });
      const record = domain.get(RECORD_TYPES.FUNDING_INSTRUCTION, req.params.instructionId);
      if (!record) return res.status(404).json({ error: 'Funding instruction not found.' });
      if (record.state === 'CONFIRMED') return res.status(409).json({ error: 'Funding instruction is already confirmed.' });
      const externalReference = String(req.body?.externalReference || '').trim();
      if (!externalReference) return res.status(400).json({ error: 'An external transfer reference is required.' });
      await ensureFundingLedgerAccounts(domain, ledger);
      let ledgerEntry;
      if (record.purpose === 'ASSET_VAULT_FUNDING') {
        ledgerEntry = await ledger.post({
          referenceType: 'FUNDING_INSTRUCTION', referenceId: record.fundingInstructionId,
          eventType: 'PARTICIPANT_FUNDS_RECEIVED', description: `Participant funds received for ${record.accountId}`,
          currency: record.currency,
          lines: [
            { accountId: 'GL-CASH-PARTICIPANT-FUNDS', debit: record.amount },
            { accountId: 'GL-PARTICIPANT-FUNDS-LIABILITY', credit: record.amount }
          ]
        }, session.id);
      } else {
        const invoice = domain.get(RECORD_TYPES.FEE_INVOICE, record.invoiceId);
        if (!invoice) return res.status(404).json({ error: 'Linked fee invoice not found.' });
        ledgerEntry = await ledger.recordInvoicePayment({ invoiceId: invoice.invoiceId, amount: record.amount, cashAccountId: 'GL-CASH-OPERATING', currency: record.currency }, session.id);
        await domain.put(RECORD_TYPES.FEE_INVOICE, invoice.invoiceId, { ...invoice, state: 'PAID', paidAt: now(), paymentReference: externalReference, updatedAt: now() }, { actorId: session.id, eventType: 'FEE_INVOICE_PAID' });
        for (const chargeId of invoice.chargeIds || []) {
          const charge = domain.get(RECORD_TYPES.FEE_CHARGE, chargeId);
          if (charge) await domain.put(RECORD_TYPES.FEE_CHARGE, chargeId, { ...charge, state: 'PAID', paidAt: now(), updatedAt: now() }, { actorId: session.id, eventType: 'FEE_CHARGE_PAID' });
        }
      }
      const confirmedAt = now();
      const updated = { ...record, state: 'CONFIRMED', externalReference, ledgerEntryId: ledgerEntry.entryId, confirmedBy: session.id, confirmedAt, updatedAt: confirmedAt };
      await domain.put(RECORD_TYPES.FUNDING_INSTRUCTION, record.fundingInstructionId, updated, { actorId: session.id, eventType: 'EXTERNAL_FUNDS_CONFIRMED' });
      const receipt = {
        paymentReceiptId: id('RCPT'), fundingInstructionId: record.fundingInstructionId, purpose: record.purpose,
        participantId: record.participantId, accountId: record.accountId, amount: record.amount, currency: record.currency,
        externalReference, ledgerEntryId: ledgerEntry.entryId, state: 'RECORDED', recordedAt: confirmedAt, createdAt: confirmedAt
      };
      await domain.put(RECORD_TYPES.PAYMENT_RECEIPT, receipt.paymentReceiptId, receipt, { actorId: session.id, eventType: 'PAYMENT_RECEIPT_RECORDED' });
      const eventId = id('VME');
      await domain.put(RECORD_TYPES.VERIFIED_MARKET_EVENT, eventId, {
        eventId,
        eventType: record.purpose === 'ASSET_VAULT_FUNDING' ? 'PARTICIPANT_FUNDS_CONFIRMED' : 'PLATFORM_FEE_PAYMENT_CONFIRMED',
        participantId: record.participantId,
        fromAccountId: record.purpose === 'PLATFORM_FEE_PAYMENT' ? record.accountId : 'EXTERNAL_SOURCE',
        toAccountId: record.purpose === 'ASSET_VAULT_FUNDING' ? record.accountId : 'GL-CASH-OPERATING',
        amount: record.amount, currency: record.currency, state: 'VERIFIED', referenceId: record.fundingInstructionId,
        evidenceId: receipt.paymentReceiptId, verifiedAt: confirmedAt, occurredAt: confirmedAt, createdAt: confirmedAt
      }, { actorId: session.id, eventType: 'VERIFIED_FUNDS_EVENT_RECORDED' });
      res.json({ instruction: fundingProjection(updated), receipt, balanceCredited: record.purpose === 'ASSET_VAULT_FUNDING' });
    } catch (error) { res.status(400).json({ error: error.message || 'External funds could not be confirmed.' }); }
  });

  router.post('/signup', async (req, res) => {
    try { const result = await service.signup(req.body); setSessionCookie(res, result.token); res.status(201).json({ authenticated: true, session: result.session }); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.post('/signin', async (req, res) => {
    try { const result = await service.signin(req.body); setSessionCookie(res, result.token); res.json({ authenticated: true, session: result.session }); }
    catch (error) { res.status(401).json({ error: error.message }); }
  });
  router.post('/signout', async (req, res) => {
    await service.signout(readCookie(req, 'sra_session'));
    clearSessionCookie(res);
    res.json({ authenticated: false });
  });
  router.post('/role', async (req, res) => {
    try { const session = await service.switchRole(readCookie(req, 'sra_session'), req.body?.role); res.json({ authenticated: true, session }); }
    catch (error) { res.status(403).json({ error: error.message }); }
  });
  router.post('/capacity/apply', async (req, res) => {
    try { const session = await service.applyForCapacity(readCookie(req, 'sra_session'), req.body?.capacity); res.status(202).json({ authenticated: true, session }); }
    catch (error) { res.status(403).json({ error: error.message }); }
  });
  router.post('/capacity/activate', async (req, res) => {
    try { const session = await service.activateCapacity(readCookie(req, 'sra_session'), req.body?.capacity); res.status(201).json({ authenticated: true, session }); }
    catch (error) { res.status(403).json({ error: error.message }); }
  });
  return router;
}
export { readCookie, participantVault, fundingProjection };
