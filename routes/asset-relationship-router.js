import { Router } from 'express';

export function createAssetRelationshipRouter(service, accessService) {
  const router = Router();

  async function requireSession(req, res) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-sra-session-token'] || '';
    const session = await accessService.getSession(token);
    if (!session) res.status(401).json({ error: 'Authentication is required.' });
    return session;
  }

  function isAdmin(session) { return session?.activeCapacity === 'PLATFORM_ADMIN'; }
  function isRelatedParty(relationships, session) { return relationships.some((record) => record.partyId === session?.id); }

  router.get('/instruments/:instrumentId', async (req, res) => {
    const session = await requireSession(req, res); if (!session) return;
    if (!isAdmin(session)) {
      return res.status(403).json({
        error: 'Platform Administration authority is required to read the full internal relationship ledger.',
        code: 'SRA_INTERNAL_RELATIONSHIP_LEDGER_ADMIN_REQUIRED',
      });
    }
    const relationships = service.list(req.params.instrumentId);
    return res.json({ instrumentId: req.params.instrumentId, internal: true, relationshipCount: relationships.length, relationships });
  });

  router.get('/instruments/:instrumentId/my-relationships', async (req, res) => {
    const session = await requireSession(req, res); if (!session) return;
    const relationships = service.list(req.params.instrumentId, { partyId: session.id });
    if (!relationships.length && !isAdmin(session)) return res.status(403).json({ error: 'This asset relationship ledger is outside the active account authority.' });
    return res.json({ instrumentId: req.params.instrumentId, internal: false, partyId: session.id, relationshipCount: relationships.length, relationships });
  });

  router.get('/instruments/:instrumentId/export-view', async (req, res) => {
    const session = await requireSession(req, res); if (!session) return;
    const relationships = service.list(req.params.instrumentId);
    if (!isAdmin(session) && !isRelatedParty(relationships, session)) return res.status(403).json({ error: 'This asset relationship view is outside the active account authority.' });
    return res.json(service.publicView(req.params.instrumentId));
  });

  router.post('/instruments/:instrumentId/synchronize', async (req, res) => {
    const session = await requireSession(req, res); if (!session) return;
    if (!isAdmin(session)) return res.status(403).json({ error: 'Platform Administration authority is required to synchronize the internal relationship ledger.' });
    try { return res.json(await service.synchronizeInstrument(req.params.instrumentId, session.id)); }
    catch (error) { return res.status(400).json({ error: error.message, code: 'SRA_RELATIONSHIP_LEDGER_SYNC_FAILED' }); }
  });

  return router;
}
