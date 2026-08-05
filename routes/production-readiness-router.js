import express from 'express';

function staff(req) {
  const roles = String(req.get('x-sra-roles') || req.get('x-sra-role') || '')
    .split(',')
    .map((role) => role.trim().toUpperCase())
    .filter(Boolean);
  return roles.some((role) => ['PLATFORM_ADMIN', 'OPERATIONS_ADMIN', 'AUDITOR'].includes(role));
}

export function createProductionReadinessRouter({ readinessService, database }) {
  const router = express.Router();

  router.get('/readiness', async (_req, res) => {
    try { return res.json(await readinessService.assess()); }
    catch (error) { return res.status(500).json({ error: error.message, code: 'PRODUCTION_READINESS_FAILED' }); }
  });

  router.get('/audit/events', async (req, res) => {
    if (!staff(req)) return res.status(403).json({ error: 'Audit access requires Platform Admin, Operations Admin, or Auditor role.', code: 'SRA_AUDIT_ROLE_REQUIRED' });
    try {
      return res.json({
        records: await database.listAuditEvents({
          actorId: req.query.actorId || null,
          eventType: req.query.eventType || null,
          objectType: req.query.objectType || null,
          objectId: req.query.objectId || null,
          since: req.query.since || null,
          limit: req.query.limit || 100,
        }),
      });
    } catch (error) {
      return res.status(500).json({ error: error.message, code: 'SRA_AUDIT_QUERY_FAILED' });
    }
  });

  router.get('/audit/summary', async (req, res) => {
    if (!staff(req)) return res.status(403).json({ error: 'Audit access requires Platform Admin, Operations Admin, or Auditor role.', code: 'SRA_AUDIT_ROLE_REQUIRED' });
    try { return res.json(await database.auditSummary({ since: req.query.since || null })); }
    catch (error) { return res.status(500).json({ error: error.message, code: 'SRA_AUDIT_SUMMARY_FAILED' }); }
  });

  return router;
}
