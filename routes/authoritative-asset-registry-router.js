import { Router } from 'express';

export function createAuthoritativeAssetRegistryRouter(service, accessService) {
  const router = Router();

  async function requireAdmin(req, res) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-sra-session-token'] || '';
    const session = await accessService.getSession(token);
    if (!session) {
      res.status(401).json({ error: 'Authentication is required.' });
      return null;
    }
    if (session.activeCapacity !== 'PLATFORM_ADMIN') {
      res.status(403).json({
        error: 'Platform Administration authority is required.',
        code: 'SRA_AUTHORITATIVE_REGISTRY_ADMIN_REQUIRED',
      });
      return null;
    }
    return session;
  }

  function fail(res, error) {
    const conflict = service.explainError(error);
    if (conflict) return res.status(409).json(conflict);
    return res.status(400).json({
      code: 'SRA_AUTHORITATIVE_REGISTRY_REQUEST_FAILED',
      error: error.message,
    });
  }

  router.get('/assets/:assetId/relationships', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json({
      assetId: req.params.assetId,
      relationships: service.listRelationships(req.params.assetId),
    });
  });

  router.post('/assets/:assetId/relationships', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const relationship = await service.registerRelationship({
        ...req.body,
        assetId: req.params.assetId,
      }, session.id);
      return res.status(201).json({ relationship });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.get('/assets/:assetId/state', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      return res.json({ snapshot: await service.snapshot(req.params.assetId) });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.get('/positions/:positionId/reservations', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json({
      positionId: req.params.positionId,
      reservations: service.listReservations({
        positionId: req.params.positionId,
        activeOnly: String(req.query.activeOnly || '').toLowerCase() === 'true',
      }),
    });
  });

  router.post('/positions/:positionId/reservations', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const reservation = await service.reservePosition({
        ...req.body,
        positionId: req.params.positionId,
      }, session.id);
      return res.status(201).json({ reservation });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/reservations/:reservationId/release', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const reservation = await service.releaseReservation(
        req.params.reservationId,
        req.body,
        session.id,
      );
      return res.json({ reservation });
    } catch (error) {
      return fail(res, error);
    }
  });

  return router;
}
