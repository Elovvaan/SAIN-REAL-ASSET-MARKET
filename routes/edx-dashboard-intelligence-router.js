import express from 'express';

function actorId(req) {
  return req.headers['x-sra-actor-id'] || req.body?.actorId || null;
}

function handleError(res, error) {
  const message = error?.message || 'Unexpected EDX dashboard or intelligence error.';
  const status = /not found/i.test(message) ? 404 : 400;
  return res.status(status).json({ error: message });
}

export function createEdxDashboardIntelligenceRouter(service) {
  const router = express.Router();

  router.get('/enterprise-dashboard/:enterpriseId', (req, res) => {
    try {
      return res.json(service.dashboard(req.params.enterpriseId));
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get('/marketplace-intelligence/:enterpriseId', (req, res) => {
    try {
      return res.json(service.analyze(req.params.enterpriseId));
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/marketplace-intelligence/:enterpriseId/reports', async (req, res) => {
    try {
      const report = await service.generateReport(req.params.enterpriseId, actorId(req));
      return res.status(201).json(report);
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.get('/marketplace-intelligence-reports', (req, res) => {
    const reports = service.listReports({ enterpriseId: req.query.enterpriseId || null });
    return res.json({ reports });
  });

  router.get('/marketplace-intelligence-reports/:intelligenceReportId', (req, res) => {
    const report = service.getReport(req.params.intelligenceReportId);
    if (!report) return res.status(404).json({ error: 'Marketplace Intelligence report not found.' });
    return res.json(report);
  });

  return router;
}
