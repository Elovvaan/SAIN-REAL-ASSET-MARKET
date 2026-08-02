import express from 'express';

function actorId(req) {
  return req.headers['x-sra-actor-id'] || req.body?.actorId || null;
}

function handleError(res, error) {
  const message = error?.message || 'Unexpected EDX snapshot error.';
  const status = /not found/i.test(message) ? 404 : 400;
  return res.status(status).json({ error: message });
}

export function createEdxSnapshotRouter(service) {
  const router = express.Router();

  router.get('/snapshots', (req, res) => {
    const snapshots = service.listSnapshots({
      enterpriseId: req.query.enterpriseId || null,
      state: req.query.state || null,
      snapshotDate: req.query.snapshotDate || null
    });
    return res.json({ snapshots });
  });

  router.get('/snapshots/latest', (req, res) => {
    try {
      const enterpriseId = req.query.enterpriseId;
      if (!enterpriseId) return res.status(400).json({ error: 'enterpriseId is required.' });
      const snapshot = service.getLatestSnapshot(enterpriseId);
      if (!snapshot) return res.status(404).json({ error: 'Verified Snapshot not found.' });
      return res.json(snapshot);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get('/snapshots/:snapshotId', (req, res) => {
    const snapshot = service.getSnapshot(req.params.snapshotId);
    if (!snapshot) return res.status(404).json({ error: 'Verified Snapshot not found.' });
    return res.json(snapshot);
  });

  router.get('/snapshots/:snapshotId/sources', (req, res) => {
    try {
      return res.json({ sourceRecords: service.sourceRecords(req.params.snapshotId) });
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get('/snapshots/:snapshotId/verification', (req, res) => {
    try {
      return res.json(service.verificationDetail(req.params.snapshotId));
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/snapshots/generate', async (req, res) => {
    try {
      const snapshot = await service.generateSnapshot(req.body || {}, actorId(req));
      return res.status(201).json(snapshot);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/snapshots/:snapshotId/archive', async (req, res) => {
    try {
      const snapshot = await service.archiveSnapshot(req.params.snapshotId, actorId(req));
      return res.json(snapshot);
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
