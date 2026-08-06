import { TreasuryLedgerService } from '../services/treasury-ledger-service.js';
import { RecordedValueRepresentationService } from '../services/recorded-value-representation-service.js';

export async function installTreasuryAdminRoutes({ router, domain, requireAdmin, database = null }) {
  const treasury = new TreasuryLedgerService(domain);
  const recordedValue = new RecordedValueRepresentationService(domain);
  await treasury.initialize();

  router.get('/api/admin/treasury', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json(treasury.summary());
  });
  router.post('/api/admin/treasury/journals/preview', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(treasury.preview(req.body || {})); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_TREASURY_JOURNAL_PREVIEW_FAILED' }); }
  });
  router.post('/api/admin/treasury/journals/approve', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const result = await treasury.approve(req.body || {}, session.id);
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'SRA_TREASURY_BALANCED_JOURNAL_APPROVED', objectType: 'LEDGER_ENTRY', objectId: result.journal.entryId, payload: { totalDebits: result.journal.totalDebits, totalCredits: result.journal.totalCredits, currency: result.journal.currency } });
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_TREASURY_JOURNAL_APPROVAL_FAILED' }); }
  });

  router.get('/api/admin/recorded-value-representation', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json(recordedValue.preview());
  });
  router.post('/api/admin/recorded-value-representation/approve', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const result = await recordedValue.approve(req.body || {}, session.id);
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'SRA_RECORDED_VALUE_REPRESENTATION_CORRECTION_APPROVED', objectType: 'COIN_POSITION', objectId: 'BATCH', payload: { correctedPositionCount: result.correctedPositionCount, failedPositionCount: result.failedPositionCount } });
      return res.json(result);
    } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_RECORDED_VALUE_REPRESENTATION_CORRECTION_FAILED' }); }
  });

  return { treasury, recordedValue };
}
