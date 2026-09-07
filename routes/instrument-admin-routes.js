import { InstrumentApprovalService } from '../services/instrument-approval-service.js';
import { InstrumentRepresentationApprovalService, INSTRUMENT_REPRESENTATION_APPROVAL_TYPE } from '../services/instrument-representation-approval-service.js';
import { InstrumentCoinPositionLinkageService } from '../services/instrument-coin-position-linkage-service.js';
import { CoinMarketPropagationService } from '../services/coin-market-propagation-service.js';

const PENDING_STATES = new Set(['DRAFT', 'PENDING', 'PENDING_REVIEW', 'IN_REVIEW', 'REVIEW_REQUIRED', 'AWAITING_APPROVAL', 'RECORDED']);
const REPRESENTATION_STATES = new Set(['APPROVED', 'ISSUED', 'ACTIVE']);

function stateOf(record) { return String(record?.state || record?.status || '').toUpperCase(); }
function idOf(record) { return record?.instrumentId || record?.id || null; }
function workflowFor(instrument, representationApproved, marketplaceState = 'NOT_PREPARED') {
  const state = stateOf(instrument);
  const instrumentApproved = REPRESENTATION_STATES.has(state);
  const internalMarketLive = marketplaceState === 'LIVE';
  return {
    instrumentApproval: instrumentApproved ? 'COMPLETE' : 'REQUIRED',
    representationApproval: instrumentApproved ? (representationApproved ? 'COMPLETE' : 'REQUIRED') : 'WAITING',
    internalMarketplace: internalMarketLive ? 'LIVE' : marketplaceState,
    onChainPreparation: representationApproved ? (internalMarketLive ? 'READY' : 'WAITING_FOR_INTERNAL_MARKET') : 'WAITING',
    currentStage: !instrumentApproved
      ? 'INSTRUMENT_APPROVAL'
      : !representationApproved
        ? 'REPRESENTATION_APPROVAL'
        : !internalMarketLive
          ? 'INTERNAL_MARKETPLACE'
          : 'ON_CHAIN_PREPARATION',
  };
}

export async function installInstrumentAdminRoutes({ router, domain, requireAdmin, database = null }) {
  await domain.hydrate?.([INSTRUMENT_REPRESENTATION_APPROVAL_TYPE]);
  const approvals = new InstrumentApprovalService(domain);
  const representations = new InstrumentRepresentationApprovalService(domain);
  const linkages = new InstrumentCoinPositionLinkageService(domain);
  const marketPropagation = new CoinMarketPropagationService(domain);

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
      const marketplace = await marketPropagation.propagate(req.params.instrumentId, 'SRA-COIN-AGENT');
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'INSTRUMENT_COIN_POSITION_LINKED', objectType: 'SRA_INSTRUMENT', objectId: req.params.instrumentId, payload: { changed: result.changed, coinPositionId: result.coinPosition?.coinPositionId, marketplaceState: marketplace.marketplaceState } });
      return res.status(result.changed ? 201 : 200).json({ ...result, marketplace });
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
        const marketplace = marketPropagation.statusFor(instrumentId);
        return {
          instrument,
          assessment: assessments.get(instrumentId),
          representationApproved,
          marketplace: {
            listingId: marketplace.listingId || null,
            state: marketplace.marketplaceState || 'NOT_PREPARED',
            blockers: marketplace.blockers || [],
          },
          workflow: workflowFor(instrument, representationApproved, marketplace.marketplaceState || 'NOT_PREPARED'),
        };
      }),
      representationApprovalCount: approvedIds.size,
      representationApprovals,
    });
  });

  router.get('/api/admin/instruments/:instrumentId/internal-market', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json(marketPropagation.statusFor(req.params.instrumentId));
  });

  router.post('/api/admin/instruments/internal-market/reconcile', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(await marketPropagation.reconcile({ limit: req.body?.limit || 500, actorId: 'SRA-COIN-AGENT' })); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'COIN_INTERNAL_MARKET_RECONCILIATION_FAILED' }); }
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
      const marketplace = await marketPropagation.propagate(req.params.instrumentId, 'SRA-COIN-AGENT');
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'INSTRUMENT_REPRESENTATION_APPROVED', objectType: 'SRA_INSTRUMENT', objectId: req.params.instrumentId, payload: { changed: result.changed, approvalId: result.approval.approvalId, marketplaceState: marketplace.marketplaceState } });
      return res.status(result.changed ? 201 : 200).json({ ...result, marketplace });
    } catch (error) {
      return res.status(422).json({ error: error.message, code: error.code || 'INSTRUMENT_REPRESENTATION_APPROVAL_FAILED', assessment: error.assessment || null });
    }
  });

  queueMicrotask(() => {
    void marketPropagation.reconcile({ limit: 1000, actorId: 'SRA-COIN-AGENT' }).catch((error) => {
      console.error('Coin internal marketplace reconciliation failed:', error?.message || error);
    });
  });

  return { approvals, representations, linkages, marketPropagation };
}
