import express from 'express';

function actorId(req) {
  return req.headers['x-sra-actor-id'] || req.body?.actorId || null;
}

function handleError(res, error) {
  const message = error?.message || 'Unexpected EDX connection error.';
  const status = /not found/i.test(message) ? 404 : 400;
  return res.status(status).json({ error: message });
}

export function createEdxConnectionRouter(service) {
  const router = express.Router();

  router.get('/connector-definitions', (_req, res) => {
    res.json({ connectorDefinitions: service.listConnectorDefinitions() });
  });

  router.get('/connector-definitions/:connectorDefinitionId', (req, res) => {
    const record = service.getConnectorDefinition(req.params.connectorDefinitionId);
    if (!record) return res.status(404).json({ error: 'Connector definition not found.' });
    return res.json(record);
  });

  router.post('/connector-definitions', async (req, res) => {
    try {
      const record = await service.createConnectorDefinition(req.body || {}, actorId(req));
      return res.status(201).json(record);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get('/connections', (req, res) => {
    const connections = service.listConnections({
      enterpriseId: req.query.enterpriseId || null,
      state: req.query.state || null,
      connectorDefinitionId: req.query.connectorDefinitionId || null
    });
    res.json({ connections });
  });

  router.get('/connections/:connectionId', (req, res) => {
    const record = service.getConnection(req.params.connectionId);
    if (!record) return res.status(404).json({ error: 'Enterprise connection not found.' });
    return res.json(record);
  });

  router.post('/connections', async (req, res) => {
    try {
      const record = await service.createConnection(req.body || {}, actorId(req));
      return res.status(201).json(record);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.put('/connections/:connectionId', async (req, res) => {
    try {
      const record = await service.updateConnection(req.params.connectionId, req.body || {}, actorId(req));
      return res.json(record);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/connections/:connectionId/transition', async (req, res) => {
    try {
      const record = await service.transitionConnection(
        req.params.connectionId,
        req.body?.state,
        req.body || {},
        actorId(req)
      );
      return res.json(record);
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
