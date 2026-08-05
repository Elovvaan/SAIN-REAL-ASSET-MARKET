import express from 'express';

function actorId(req) {
  return req.get('x-sra-actor-id') || req.body?.actorId || 'SRA_PLATFORM';
}

export function createInternalLifecycleRouter(service) {
  const router = express.Router();

  router.post('/inspect', (req, res) => {
    try {
      res.json(service.inspect(req.body?.references || req.body || {}));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/ownership-recognitions', async (req, res) => {
    try {
      const result = await service.recognizeOwnership(req.body || {}, actorId(req));
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/export-packages', (req, res) => {
    const filters = {
      state: req.query.state ? String(req.query.state).toUpperCase() : null,
      destinationClass: req.query.destinationClass ? String(req.query.destinationClass).toUpperCase() : null
    };
    res.json(service.listExportPackages(filters));
  });

  router.get('/export-packages/:exportPackageId', (req, res) => {
    const record = service.getExportPackage(req.params.exportPackageId);
    if (!record) return res.status(404).json({ error: 'Export package not found.' });
    return res.json(record);
  });

  router.post('/export-packages', async (req, res) => {
    try {
      const result = await service.createExportPackage(req.body || {}, actorId(req));
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
