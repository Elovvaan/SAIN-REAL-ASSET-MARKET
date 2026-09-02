import { InstrumentApprovalService } from '../services/instrument-approval-service.js';
import { InstrumentRepresentationApprovalService, INSTRUMENT_REPRESENTATION_APPROVAL_TYPE } from '../services/instrument-representation-approval-service.js';
import { InstrumentCoinPositionLinkageService } from '../services/instrument-coin-position-linkage-service.js';

const PENDING_STATES = new Set(['DRAFT', 'PENDING', 'PENDING_REVIEW', 'IN_REVIEW', 'REVIEW_REQUIRED', 'AWAITING_APPROVAL']);
const REPRESENTATION_STATES = new Set(['APPROVED', 'ISSUED', 'ACTIVE', 'RECORDED']);

function stateOf(record) { return String(record?.state || record?.status || '').toUpperCase(); }
function idOf(record) { return record?.instrumentId || record?.id || null; }
function workflowFor(instrument, representationApproved) {
  const state = stateOf(instrument);
  const instrumentApproved = REPRESENTATION_STATES.has(state);
  return {
    instrumentApproval: instrumentApproved ? 'COMPLETE' : 'REQUIRED',
    representationApproval: instrumentApproved ? (representationApproved ? 'COMPLETE' : 'REQUIRED') : 'WAITING',
    onChainPreparation: representationApproved ? 'READY' : 'WAITING',
    currentStage: !instrumentApproved
      ? 'INSTRUMENT_APPROVAL'
      : (representationApproved ? 'ON_CHAIN_PREPARATION' : 'REPRESENTATION_APPROVAL'),
  };
}

export async function installInstrumentAdminRoutes({ router, domain, requireAdmin, database = null }) {
  await domain.hydrate?.([INSTRUMENT_REPRESENTATION_APPROVAL_TYPE]);
  const approvals = new InstrumentApprovalService(domain);
  const representations = new InstrumentRepresentationApprovalService(domain);
  const linkages = new InstrumentCoinPositionLinkageService(domain);

  router.get('/api/admin/instrument-coin-position-linkages', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json(linkages.read());
  });

  router.post('/api/admin/instruments/:instrumentId/coin-position-linkage', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    if (String(req.body?.approval || '').toUpperCase() !== 'LINK') {
      return res.status(409).json({ error: 'Explicit administrator Coin Position linkage approval is required.', requiredApproval: 'LINK' });
    }
    try {
      const result = await linkages.link(req.params.instrumentId, String(req.body?.coinPositionId || '').trim(), session.id);
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'INSTRUMENT_COIN_POSITION_LINKED', objectType: 'SRA_INSTRUMENT', objectId: req.params.instrumentId, payload: { changed: result.changed, coinPositionId: result.coinPosition?.coinPositionId } });
      return res.status(result.changed ? 201 : 200).json(result);
    } catch (error) {
      return res.status(422).json({ error: error.message, code: error.code || 'INSTRUMENT_COIN_POSITION_LINKAGE_FAILED', assessment: error.assessment || null });
    }
  });

  router.get('/api/admin/instruments/approval-status', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    const instruments = domain.list('SRA_INSTRUMENT');
    const pending = instruments.filter((instrument) => PENDING_STATES.has(stateOf(instrument)));
    const representationReady = instruments.filter((instrument) => REPRESENTATION_STATES.has(stateOf(instrument)));
    const representationApprovals = representations.list();
    const approvedIds = new Set(representationApprovals.filter((item) => item.state === 'APPROVED').map((item) => item.instrumentId));
    const assessments = new Map(representations.evaluateMany(representationReady).map((assessment) => [assessment.instrumentId, assessment]));
    return res.json({
      pending,
      pendingCount: pending.length,
      representationReady: representationReady.map((instrument) => {
        const instrumentId = idOf(instrument);
        const representationApproved = approvedIds.has(instrumentId);
        return {
          instrument,
          assessment: assessments.get(instrumentId),
          representationApproved,
          workflow: workflowFor(instrument, representationApproved),
        };
      }),
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

  return { approvals, representations, linkages };
}
