import express from 'express';

function actorId(req) { return req.sraOperationsAuth?.actorId || req.sraIdentity?.actorId || null; }
function fail(res, error) { const message = error?.message || 'Unexpected financing closing error.'; return res.status(/not found/i.test(message) ? 404 : 422).json({ error: message, code: error?.code || 'FINANCING_CLOSING_ERROR' }); }

export function createFinancingClosingRouter(service) {
  const router = express.Router();
  router.get('/status', (_req, res) => res.json(service.status()));
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
  return router;
}