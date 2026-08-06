import { TreasuryTransferReadinessService } from '../services/treasury-transfer-readiness-service.js';
import { TreasuryLedgerService } from '../services/treasury-ledger-service.js';

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
