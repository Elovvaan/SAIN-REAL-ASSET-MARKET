import crypto from 'node:crypto';
import { TreasuryTransferReadinessService } from '../services/treasury-transfer-readiness-service.js';
import { TreasuryLedgerService } from '../services/treasury-ledger-service.js';

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function validRoutingNumber(value) {
  const routing = digits(value);
  if (routing.length !== 9) return false;
  const numbers = [...routing].map(Number);
  const checksum = 3 * (numbers[0] + numbers[3] + numbers[6])
    + 7 * (numbers[1] + numbers[4] + numbers[7])
    + (numbers[2] + numbers[5] + numbers[8]);
  return checksum % 10 === 0;
}

function prepareManualAchDestination(input = {}) {
  const routingNumber = digits(input.routingNumber);
  if (!validRoutingNumber(routingNumber)) throw new Error('A valid 9-digit ACH routing number is required.');
  const accountNumber = digits(input.accountNumber);
  if (accountNumber.length < 4 || accountNumber.length > 17) throw new Error('ACH account number must contain 4 to 17 digits.');
  const accountType = String(input.accountType || '').trim().toUpperCase();
  if (!['CHECKING', 'SAVINGS'].includes(accountType)) throw new Error('ACH account type must be CHECKING or SAVINGS.');
  const bankName = String(input.bankName || 'ACH destination').trim() || 'ACH destination';
  const ownerId = String(input.ownerId || 'SRA_PLATFORM_TREASURY').trim() || 'SRA_PLATFORM_TREASURY';
  const last4 = accountNumber.slice(-4);
  const fingerprint = crypto.createHash('sha256').update(`${routingNumber}:${accountNumber}`).digest('hex').toUpperCase();
  return {
    ownerId,
    label: `${bankName} ••••${last4}`,
    bankName,
    accountType,
    accountLast4: last4,
    routingLast4: routingNumber.slice(-4),
    destinationId: `DST-ACH-${fingerprint.slice(0, 20)}`,
    destinationReference: `ACH-DEST-${fingerprint.slice(0, 24)}`,
    fingerprint,
  };
}

export async function installTreasuryTransferReadinessRoutes({ router, domain, requireAdmin, database = null }) {
  const treasury = new TreasuryLedgerService(domain);
  await treasury.initialize();
  const transfers = new TreasuryTransferReadinessService(domain, treasury);

  router.get('/api/admin/treasury-transfer-readiness', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json({
      status: transfers.status(),
      destinations: transfers.destinations(),
      treasury: treasury.summary(),
      boundaries: {
        externalSubmissionExecuted: false,
        providerConnectionRequiredForSend: true,
        finalCashReductionPosted: false,
      },
    });
  });

  router.post('/api/admin/treasury-transfer-readiness/destinations/preview', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(transfers.previewDestination(req.body || {})); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_TREASURY_DESTINATION_PREVIEW_FAILED' }); }
  });

  router.post('/api/admin/treasury-transfer-readiness/destinations/approve', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const result = await transfers.approveDestination(req.body || {}, session.id);
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'SRA_TREASURY_TRANSFER_DESTINATION_APPROVED', objectType: 'TRANSFER_DESTINATION', objectId: result.destination.destinationId, payload: { route: result.destination.route, verificationState: result.destination.verificationState } });
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_TREASURY_DESTINATION_APPROVAL_FAILED' }); }
  });

  router.post('/api/admin/treasury-transfer-readiness/ach/prepare', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const prepared = prepareManualAchDestination(req.body || {});
      const destinationResult = await transfers.approveDestination({
        approval: 'APPROVE',
        ownerId: prepared.ownerId,
        label: prepared.label,
        rail: 'ACH',
        destinationId: prepared.destinationId,
        destinationReference: prepared.destinationReference,
        verificationState: 'VERIFIED',
      }, session.id);
      const amountUsd = Number(req.body?.amountUsd || 1);
      const transferResult = await transfers.approve({
        approval: 'APPROVE',
        destinationId: destinationResult.destination.destinationId,
        amountUsd,
        idempotencyKey: req.body?.idempotencyKey || `MANUAL-ACH-${prepared.fingerprint.slice(0, 24)}-${amountUsd.toFixed(8)}`,
      }, session.id);
      if (database?.audit) await database.audit({
        actorId: session.id,
        eventType: 'SRA_MANUAL_ACH_DESTINATION_PREPARED',
        objectType: 'TRANSFER_DESTINATION',
        objectId: destinationResult.destination.destinationId,
        payload: {
          route: 'ACH',
          accountType: prepared.accountType,
          accountLast4: prepared.accountLast4,
          routingLast4: prepared.routingLast4,
          amountUsd: transferResult.transferInstruction.amountUsd,
          transferInstructionId: transferResult.transferInstruction.transferInstructionId,
          rawBankDetailsStored: false,
        },
      });
      return res.status(201).json({
        destination: {
          ...destinationResult.destination,
          bankName: prepared.bankName,
          accountType: prepared.accountType,
          accountLast4: prepared.accountLast4,
          routingLast4: prepared.routingLast4,
          rawBankDetailsStored: false,
        },
        exportPackage: transferResult.exportPackage,
        transferInstruction: transferResult.transferInstruction,
        executionAuthorization: transferResult.executionAuthorization,
        externalSubmissionExecuted: false,
      });
    } catch (error) {
      return res.status(422).json({ error: error.message, code: 'SRA_MANUAL_ACH_PREPARATION_FAILED' });
    }
  });

  router.post('/api/admin/treasury-transfer-readiness/preview', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(transfers.preview(req.body || {})); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_TREASURY_TRANSFER_PREVIEW_FAILED' }); }
  });

  router.post('/api/admin/treasury-transfer-readiness/approve', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const result = await transfers.approve(req.body || {}, session.id);
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'SRA_TREASURY_TRANSFER_READY_TO_SEND', objectType: 'EXPORT_PACKAGE', objectId: result.exportPackage.exportPackageId, payload: { amountUsd: result.exportPackage.amountUsd, route: result.exportPackage.route, destinationId: result.exportPackage.destinationId, treasuryReservationId: result.reservation.reservationId } });
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_TREASURY_TRANSFER_APPROVAL_FAILED' }); }
  });

  return transfers;
}

export { prepareManualAchDestination, validRoutingNumber };
