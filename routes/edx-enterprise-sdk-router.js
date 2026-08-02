import express from 'express';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

function actorId(req) {
  return req.headers['x-sra-actor-id'] || req.body?.actorId || null;
}

function handleError(res, error) {
  const message = error?.message || 'Unexpected Enterprise SDK error.';
  const status = /not found/i.test(message) ? 404 : 400;
  return res.status(status).json({ error: message });
}

export function createEdxEnterpriseSdkRouter(service) {
  const router = express.Router();

  router.get('/sdk/schemas', (_req, res) => res.json(service.schemas()));
  router.get('/sdk/milestones', (_req, res) => res.json(service.milestones()));

  router.get('/sdk/clients', (req, res) => res.json({ clients: service.listClients({ enterpriseId: req.query.enterpriseId || null, state: req.query.state || null }) }));
  router.post('/sdk/clients', async (req, res) => {
    try { return res.status(201).json(await service.createClient(req.body || {}, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });
  router.post('/sdk/clients/authenticate', (req, res) => {
    try { return res.json(service.authenticate(req.body || {})); }
    catch (error) { return handleError(res, error); }
  });
  router.post('/sdk/clients/:sdkClientId/transition', async (req, res) => {
    try { return res.json(await service.transitionClient(req.params.sdkClientId, req.body?.state, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  router.get('/sdk/webhooks', (req, res) => res.json({ webhooks: service.listWebhooks({ enterpriseId: req.query.enterpriseId || null, state: req.query.state || null }) }));
  router.post('/sdk/webhooks', async (req, res) => {
    try { return res.status(201).json(await service.createWebhook(req.body || {}, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });
  router.post('/sdk/webhooks/:webhookSubscriptionId/transition', async (req, res) => {
    try { return res.json(await service.transitionSubscription(RECORD_TYPES.EDX_WEBHOOK_SUBSCRIPTION, req.params.webhookSubscriptionId, req.body?.state, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  router.post('/sdk/event-streams', async (req, res) => {
    try { return res.status(201).json(await service.createEventStream(req.body || {}, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });
  router.post('/sdk/event-streams/:eventStreamSubscriptionId/transition', async (req, res) => {
    try { return res.json(await service.transitionSubscription(RECORD_TYPES.EDX_EVENT_STREAM_SUBSCRIPTION, req.params.eventStreamSubscriptionId, req.body?.state, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  router.get('/sdk/events', (req, res) => res.json({ events: service.listEvents({ enterpriseId: req.query.enterpriseId || null, eventType: req.query.eventType || null, after: req.query.after || null }) }));
  router.post('/sdk/events', async (req, res) => {
    try { return res.status(201).json(await service.emitEvent(req.body || {}, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  return router;
}
