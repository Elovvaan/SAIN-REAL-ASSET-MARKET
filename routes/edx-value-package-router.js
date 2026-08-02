import express from 'express';

function actorId(req) {
  return req.headers['x-sra-actor-id'] || req.body?.actorId || null;
}

function handleError(res, error) {
  const message = error?.message || 'Unexpected EDX value package error.';
  const status = /not found/i.test(message) ? 404 : 400;
  return res.status(status).json({ error: message });
}

export function createEdxValuePackageRouter(service) {
  const router = express.Router();

  router.get('/value-packages', (req, res) => {
    const records = service.listPackages({
      enterpriseId: req.query.enterpriseId || null,
      state: req.query.state || null,
      visibility: req.query.visibility || null,
      snapshotId: req.query.snapshotId || null
    });
    return res.json({ valuePackages: records });
  });

  router.get('/value-packages/latest', (req, res) => {
    try {
      if (!req.query.enterpriseId) return res.status(400).json({ error: 'enterpriseId is required.' });
      const record = service.getLatestPackage(req.query.enterpriseId);
      if (!record) return res.status(404).json({ error: 'Verified Value Package not found.' });
      return res.json(record);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get('/value-packages/:valuePackageId', (req, res) => {
    const record = service.getPackage(req.params.valuePackageId);
    if (!record) return res.status(404).json({ error: 'Verified Value Package not found.' });
    return res.json(record);
  });

  router.get('/value-packages/:valuePackageId/lineage', (req, res) => {
    try {
      return res.json(service.lineage(req.params.valuePackageId));
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/value-packages/generate', async (req, res) => {
    try {
      const record = await service.generatePackage(req.body || {}, actorId(req));
      return res.status(201).json(record);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/value-packages/:valuePackageId/publish', async (req, res) => {
    try {
      const record = await service.publishPackage(req.params.valuePackageId, req.body || {}, actorId(req));
      return res.json(record);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/value-packages/:valuePackageId/archive', async (req, res) => {
    try {
      const record = await service.archivePackage(req.params.valuePackageId, actorId(req));
      return res.json(record);
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
