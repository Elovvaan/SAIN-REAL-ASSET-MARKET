import express from 'express';
import { FinancedPositionDistributionService } from '../services/financed-position-distribution-service.js';

function actorId(req) { return req.sraOperationsAuth?.actorId || req.sraIdentity?.actorId || null; }
function fail(res, error) { const message = error?.message || 'Unexpected financing closing error.'; return res.status(/not found/i.test(message) ? 404 : 422).json({ error: message, code: error?.code || 'FINANCING_CLOSING_ERROR', assessment: error?.assessment || null }); }

export function createFinancingClosingRouter(service) {
  const router = express.Router();
  const positionDistribution = new FinancedPositionDistributionService(service.domain);
  const distributionReady = positionDistribution.initialize();

  router.get('/status', (_req, res) => res.json({ ...service.status(), positionDistribution: positionDistribution.status() }));
  router.get('/closings', (req, res) => res.json({ records: service.list({ status: req.query.status, opportunityId: req.query.opportunityId }) }));
  router.get('/closings/:closingId', (req, res) => { const detail = service.detail(req.params.closingId); return detail ? res.json(detail) : res.status(404).json({ error: 'Financing closing was not found.' }); });
  router.post('/closings', async (req, res) => { try { return res.status(201).json(await service.open(req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.post('/closings/:closingId/conditions', async (req, res) => { try { return res.status(201).json(await service.addCondition(req.params.closingId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.post('/closings/:closingId/conditions/:conditionId/satisfy', async (req, res) => { try { return res.json(await service.satisfyCondition(req.params.closingId, req.params.conditionId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.post('/closings/:closingId/ready', async (req, res) => { try { return res.json(await service.markReady(req.params.closingId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.post('/closings/:closingId/authorize', async (req, res) => { try { return res.status(201).json(await service.authorize(req.params.closingId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.post('/closings/:closingId/disbursements/:disbursementId/submit', async (req, res) => { try { return res.json(await service.submitDisbursement(req.params.closingId, req.params.disbursementId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.post('/closings/:closingId/disbursements/:disbursementId/settlement', async (req, res) => { try { return res.json(await service.recordSettlement(req.params.closingId, req.params.disbursementId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.post('/closings/:closingId/board-servicing', async (req, res) => { try { return res.status(201).json(await service.boardToServicing(req.params.closingId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });

  router.get('/positions', async (req, res) => {
    try { await distributionReady; return res.json({ records: positionDistribution.listPositions({ status: req.query.status, distributionStatus: req.query.distributionStatus, opportunityId: req.query.opportunityId }) }); }
    catch (error) { return fail(res, error); }
  });
  router.get('/positions/:positionId', async (req, res) => {
    try { await distributionReady; const detail = positionDistribution.detail(req.params.positionId); return detail ? res.json(detail) : res.status(404).json({ error: 'Financed position was not found.' }); }
    catch (error) { return fail(res, error); }
  });
  router.get('/positions/:positionId/distribution-assessment', async (req, res) => {
    try { await distributionReady; return res.json(positionDistribution.assessDistributionEligibility(req.params.positionId)); }
    catch (error) { return fail(res, error); }
  });
  router.post('/positions/:positionId/make-available', async (req, res) => {
    try { await distributionReady; return res.status(201).json(await positionDistribution.makeAvailable(req.params.positionId, req.body || {}, actorId(req))); }
    catch (error) { return fail(res, error); }
  });

  return router;
}