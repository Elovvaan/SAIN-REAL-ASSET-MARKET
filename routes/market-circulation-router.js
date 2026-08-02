import express from 'express';

export function createMarketCirculationRouter(service) {
  const router = express.Router();
  const actor = (req) => req.headers['x-sra-actor-id'] || null;

  router.get('/events', (_req, res) => res.json({ events: service.listEvents() }));
  router.get('/instruments', (_req, res) => res.json({ instruments: service.listInstruments() }));

  router.post('/events', async (req, res) => {
    try {
      res.status(201).json({ event: await service.recordEvent(req.body, actor(req)) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/events/:eventId/activate', async (req, res) => {
    try {
      res.status(201).json({ instrument: await service.activateProtection(req.params.eventId, req.body, actor(req)) });
    } catch (error) {
      res.status(/not found/i.test(error.message) ? 404 : 400).json({ error: error.message });
    }
  });

  return router;
}
