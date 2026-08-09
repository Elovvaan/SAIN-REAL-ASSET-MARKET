import { InstrumentApprovalService } from '../services/instrument-approval-service.js';
import { InstrumentRepresentationApprovalService } from '../services/instrument-representation-approval-service.js';

const PENDING_STATES = new Set(['DRAFT', 'PENDING', 'PENDING_REVIEW', 'IN_REVIEW', 'REVIEW_REQUIRED', 'AWAITING_APPROVAL']);
const REPRESENTATION_STATES = new Set(['APPROVED', 'ISSUED', 'ACTIVE', 'RECORDED']);

function stateOf(record) { return String(record?.state || record?.status || '').toUpperCase(); }
function idOf(record) { return record?.instrumentId || record?.id || null; }

export async function installInstrumentAdminRoutes({ router, domain, requireAdmin, database = null }) {
  const approvals = new InstrumentApprovalService(domain);
  const representations = new InstrumentRepresentationApprovalService(domain);

  router.get('/api/admin/instruments/approval-status', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    const instruments = domain.list('SRA_INSTRUMENT');
    const pending = instruments.filter((instrument) => PENDING_STATES.has(stateOf(instrument)));
    const representationReady = instruments.filter((instrument) => REPRESENTATION_STATES.has(stateOf(instrument)));
      const representationApprovals = representations.list();
    const approvedIds = new Set(representationApprovals.filter((item) => item.state === 'APPROVED').map((item) => item.instrumentId));
    return res.json({
      pending,
      pendingCount: pending.length,
      representationReady: representationReady.map((instrument) => ({
        instrument,
        assessment: representations.evaluate(idOf(instrument)),
        representationApproved: approvedIds.has(idOf(instrument)),
      })),
      representationApprovalCount: approvedIds.size,
      representationApprovals,
    });
  });

  router.post('/api/admin/instruments/:instrumentId/approve', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    if (String(req.body?.approval || '').toUpperCase() !== 'APPROVE') {
      return res.status(409).json({ error: 'Explicit administrator instrument approval is required.', requiredApproval: 'APPROVE' });
    }
    try {
      const result = await approvals.approve(req.params.instrumentId, session.id);
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'SRA_INSTRUMENT_APPROVED', objectType: 'SRA_INSTRUMENT', objectId: req.params.instrumentId, payload: { changed: result.changed } });
      return res.status(result.changed ? 201 : 200).json(result);
    } catch (error) {
      return res.status(422).json({ error: error.message, code: error.code || 'SRA_INSTRUMENT_APPROVAL_FAILED' });
    }
  });

  router.post('/api/admin/instruments/:instrumentId/representation/approve', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    if (String(req.body?.approval || '').toUpperCase() !== 'APPROVE') {
      return res.status(409).json({ error: 'Explicit administrator representation approval is required.', requiredApproval: 'APPROVE' });
    }
    try {
      const result = await representations.approve(req.params.instrumentId, session.id);
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'INSTRUMENT_REPRESENTATION_APPROVED', objectType: 'SRA_INSTRUMENT', objectId: req.params.instrumentId, payload: { changed: result.changed, approvalId: result.approval.approvalId } });
      return res.status(result.changed ? 201 : 200).json(result);
    } catch (error) {
      return res.status(422).json({ error: error.message, code: error.code || 'INSTRUMENT_REPRESENTATION_APPROVAL_FAILED', assessment: error.assessment || null });
    }
  });

  return { approvals, representations };
}
