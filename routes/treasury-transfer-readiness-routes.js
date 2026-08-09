import crypto from 'node:crypto';
import { TreasuryTransferReadinessService } from '../services/treasury-transfer-readiness-service.js';
import { TreasuryLedgerService } from '../services/treasury-ledger-service.js';
import { TreasuryLiveExecutionService } from '../services/treasury-live-execution-service.js';

function digits(value) { return String(value || '').replace(/\D/g, ''); }
function validAchRoutingNumber(value) {
  const routing = digits(value);
  if (routing.length !== 9) return false;
  const n = [...routing].map(Number);
  return (3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8])) % 10 === 0;
}

function prepareManualAchDestination(input = {}) {
  const routingNumber = digits(input.routingNumber);
  if (!validAchRoutingNumber(routingNumber)) throw new Error('A valid 9-digit ACH routing number is required.');
  const accountNumber = digits(input.accountNumber);
  if (accountNumber.length < 4 || accountNumber.length > 17) throw new Error('ACH account number must contain 4 to 17 digits.');
  const accountType = String(input.accountType || '').trim().toUpperCase();
  if (!['CHECKING','SAVINGS'].includes(accountType)) throw new Error('ACH account type must be CHECKING or SAVINGS.');
  const bankName = String(input.bankName || 'ACH destination').trim() || 'ACH destination';
  const ownerId = String(input.ownerId || 'SRA_PLATFORM_TREASURY').trim() || 'SRA_PLATFORM_TREASURY';
  return {
    ownerId, label:`${bankName} ••••${accountNumber.slice(-4)}`, bankName, accountType,
    accountLast4:accountNumber.slice(-4), routingLast4:routingNumber.slice(-4),
    destinationId:`DST-ACH-${crypto.randomUUID().toUpperCase()}`,
    destinationReference:`ACH-DEST-${crypto.randomUUID().toUpperCase()}`,
  };
}

function prepareManualWireDestination(input = {}) {
  const routingNumber = digits(input.routingNumber);
  if (routingNumber.length !== 9) throw new Error('Wire routing number must contain 9 digits.');
  const accountNumber = String(input.accountNumber || '').trim();
  if (!accountNumber) throw new Error('Beneficiary account number is required.');
  const beneficiaryName = String(input.beneficiaryName || '').trim();
  if (!beneficiaryName) throw new Error('Beneficiary name is required.');
  const bankName = String(input.bankName || '').trim();
  if (!bankName) throw new Error('Receiving bank is required.');
  const ownerId = String(input.ownerId || 'SRA_PLATFORM_TREASURY').trim() || 'SRA_PLATFORM_TREASURY';
  return {
    ownerId, label:`${beneficiaryName} · ${bankName} · ••••${accountNumber.slice(-4)}`,
    bankName, beneficiaryName, accountLast4:accountNumber.slice(-4), routingLast4:routingNumber.slice(-4),
    destinationId:`DST-WIRE-${crypto.randomUUID().toUpperCase()}`,
    destinationReference:`WIRE-DEST-${crypto.randomUUID().toUpperCase()}`,
  };
}

export async function installTreasuryTransferReadinessRoutes({ router, domain, requireAdmin, database = null }) {
  const treasury = new TreasuryLedgerService(domain);
  await treasury.initialize();
  const transfers = new TreasuryTransferReadinessService(domain, treasury);
  const liveExecution = new TreasuryLiveExecutionService(domain);

  router.get('/api/admin/treasury-transfer-readiness', async (req,res) => {
    const session = await requireAdmin(req,res); if (!session) return;
    return res.json({
      status:transfers.status(), destinations:transfers.destinations(), treasury:treasury.summary(), execution:liveExecution.status(),
      boundaries:{ preparationReservesCash:false, cashReservationOccursAtExecution:true, authoritativePaymentRecord:'EXTERNAL_TRANSFER_INSTRUCTION', receivingConfirmationRequiredForReconciliation:true, accountingClassificationAfterReconciliation:true, onChainExecutionSeparate:true },
    });
  });

  router.get('/api/admin/treasury-transfer-readiness/execution/status', async (req,res) => {
    const session = await requireAdmin(req,res); if (!session) return;
    return res.json(liveExecution.status());
  });

  router.post('/api/admin/treasury-transfer-readiness/destinations/preview', async (req,res) => {
    const session = await requireAdmin(req,res); if (!session) return;
    try { return res.json(transfers.previewDestination(req.body || {})); }
    catch (error) { return res.status(422).json({ error:error.message, code:'SRA_TREASURY_DESTINATION_PREVIEW_FAILED' }); }
  });

  router.post('/api/admin/treasury-transfer-readiness/destinations/approve', async (req,res) => {
    const session = await requireAdmin(req,res); if (!session) return;
    try {
      const result = await transfers.approveDestination(req.body || {}, session.id);
      if (database?.audit) await database.audit({ actorId:session.id, eventType:'SRA_TREASURY_TRANSFER_DESTINATION_APPROVED', objectType:'TRANSFER_DESTINATION', objectId:result.destination.destinationId, payload:{ route:result.destination.route, verificationState:result.destination.verificationState } });
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) { return res.status(422).json({ error:error.message, code:'SRA_TREASURY_DESTINATION_APPROVAL_FAILED' }); }
  });

  async function prepareBankPayment(req, res, session, selectedRail) {
    const prepared = selectedRail === 'ACH' ? prepareManualAchDestination(req.body || {}) : prepareManualWireDestination(req.body || {});
    const destinationResult = await transfers.approveDestination({
      approval:'APPROVE', ownerId:prepared.ownerId, label:prepared.label, rail:selectedRail,
      destinationId:prepared.destinationId, destinationReference:prepared.destinationReference, verificationState:'VERIFIED',
    }, session.id);
    const amountUsd = Number(req.body?.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('amountUsd must be greater than zero.');
    const transferResult = await transfers.prepare({
      destinationId:destinationResult.destination.destinationId, amountUsd,
      idempotencyKey:req.body?.idempotencyKey || `${selectedRail}-${crypto.randomUUID().toUpperCase()}`,
    }, session.id);
    if (database?.audit) await database.audit({
      actorId:session.id, eventType:`SRA_TREASURY_${selectedRail}_PAYMENT_PREPARED`, objectType:'EXTERNAL_TRANSFER_INSTRUCTION',
      objectId:transferResult.transferInstruction.transferInstructionId,
      payload:{ route:selectedRail, accountLast4:prepared.accountLast4, routingLast4:prepared.routingLast4, amountUsd:transferResult.transferInstruction.amountUsd, fundsState:transferResult.transferInstruction.fundsState, rawBankDetailsStored:false },
    });
    return res.status(201).json({ destination:{ ...destinationResult.destination, ...prepared, rawBankDetailsStored:false }, transferInstruction:transferResult.transferInstruction, paymentInstruction:transferResult.paymentInstruction, exportPackage:transferResult.exportPackage, externalSubmissionExecuted:false, cashReservationExecuted:false });
  }

  router.post('/api/admin/treasury-transfer-readiness/ach/prepare', async (req,res) => {
    const session = await requireAdmin(req,res); if (!session) return;
    try { return await prepareBankPayment(req,res,session,'ACH'); }
    catch (error) { return res.status(422).json({ error:error.message, code:'SRA_ACH_PREPARATION_FAILED' }); }
  });

  router.post('/api/admin/treasury-transfer-readiness/wire/prepare', async (req,res) => {
    const session = await requireAdmin(req,res); if (!session) return;
    try { return await prepareBankPayment(req,res,session,'WIRE'); }
    catch (error) { return res.status(422).json({ error:error.message, code:'SRA_WIRE_PREPARATION_FAILED' }); }
  });

  async function executeBankPayment(req,res,session,selectedRail) {
    const transferInstructionId = String(req.body?.transferInstructionId || '').trim();
    if (!transferInstructionId) throw new Error('transferInstructionId is required.');
    const authorization = await transfers.authorizeForExecution(transferInstructionId, session.id);
    const result = selectedRail === 'ACH' ? await liveExecution.executeAch(req.body || {}, session.id) : await liveExecution.executeWire(req.body || {}, session.id);
    if (database?.audit) await database.audit({
      actorId:session.id, eventType:`SRA_TREASURY_${selectedRail}_PAYMENT_SUBMITTED`, objectType:'EXTERNAL_TRANSFER_INSTRUCTION', objectId:result.instruction.transferInstructionId,
      payload:{ amountUsd:result.instruction.amountUsd ?? result.instruction.quantity, rail:selectedRail, treasuryCashBalanceUsd:authorization.preview?.treasuryCashBalanceUsd ?? null, treasuryReservedUsd:authorization.preview?.treasuryReservedUsd ?? null, treasuryAvailableUsd:authorization.preview?.treasuryAvailableUsd ?? null, providerReference:result.executionEvidence.providerReference, providerStatus:result.executionEvidence.providerStatus, receivingConfirmationRequired:true, rawBankDetailsStored:false },
    });
    return res.status(202).json({ ...result, treasuryAuthorization:authorization.preview || null });
  }

  router.post('/api/admin/treasury-transfer-readiness/ach/execute', async (req,res) => {
    const session = await requireAdmin(req,res); if (!session) return;
    try { return await executeBankPayment(req,res,session,'ACH'); }
    catch (error) { return res.status(422).json({ error:error.message, code:error.code || 'SRA_ACH_EXECUTION_FAILED', executionEvidence:error.executionEvidence || null }); }
  });

  router.post('/api/admin/treasury-transfer-readiness/wire/execute', async (req,res) => {
    const session = await requireAdmin(req,res); if (!session) return;
    try { return await executeBankPayment(req,res,session,'WIRE'); }
    catch (error) { return res.status(422).json({ error:error.message, code:error.code || 'SRA_WIRE_EXECUTION_FAILED', executionEvidence:error.executionEvidence || null }); }
  });

  router.post('/api/admin/treasury-transfer-readiness/reconcile', async (req,res) => {
    const session = await requireAdmin(req,res); if (!session) return;
    try {
      const result = await liveExecution.reconcile(req.body || {}, session.id);
      if (database?.audit) await database.audit({ actorId:session.id, eventType:'SRA_TREASURY_PAYMENT_RECONCILED', objectType:'EXTERNAL_TRANSFER_INSTRUCTION', objectId:result.instruction.transferInstructionId, payload:{ route:result.instruction.route, amountUsd:result.instruction.confirmedAmount, providerReference:result.instruction.providerReference, receivingConfirmationReference:result.instruction.receivingConfirmationReference, accountingState:result.instruction.accountingState } });
      return res.json(result);
    } catch (error) { return res.status(422).json({ error:error.message, code:'SRA_TREASURY_RECONCILIATION_FAILED' }); }
  });

  router.post('/api/admin/treasury-transfer-readiness/ach/reconcile', async (req,res) => {
    const session = await requireAdmin(req,res); if (!session) return;
    try { return res.json(await liveExecution.reconcile(req.body || {}, session.id)); }
    catch (error) { return res.status(422).json({ error:error.message, code:'SRA_TREASURY_ACH_RECONCILIATION_FAILED' }); }
  });

  router.post('/api/admin/treasury-transfer-readiness/preview', async (req,res) => {
    const session = await requireAdmin(req,res); if (!session) return;
    try { return res.json(transfers.preview(req.body || {})); }
    catch (error) { return res.status(422).json({ error:error.message, code:'SRA_TREASURY_TRANSFER_PREVIEW_FAILED' }); }
  });

  router.post('/api/admin/treasury-transfer-readiness/approve', async (req,res) => {
    const session = await requireAdmin(req,res); if (!session) return;
    try {
      const result = await transfers.approve(req.body || {}, session.id);
      if (database?.audit) await database.audit({ actorId:session.id, eventType:'SRA_TREASURY_PAYMENT_AUTHORIZED', objectType:'EXTERNAL_TRANSFER_INSTRUCTION', objectId:result.transferInstruction.transferInstructionId, payload:{ amountUsd:result.transferInstruction.amountUsd, route:result.transferInstruction.route, destinationId:result.transferInstruction.destinationId, fundsState:result.transferInstruction.fundsState } });
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) { return res.status(422).json({ error:error.message, code:'SRA_TREASURY_TRANSFER_APPROVAL_FAILED' }); }
  });

  return transfers;
}

export { prepareManualAchDestination, prepareManualWireDestination, validAchRoutingNumber };
