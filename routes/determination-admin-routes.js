export async function installDeterminationAdminRoutes({ router, service, requireAdmin }) {
  if (!router || !service || !requireAdmin) throw new Error('Determination admin routes require router, service, and requireAdmin.');

  const guarded = (handler) => async (req, res) => {
    const session = await requireAdmin(req, res);
    if (!session) return;
    try {
      return await handler(req, res, session);
    } catch (error) {
      return res.status(422).json({
        error: error.message || 'Determination request failed.',
        code: 'SRA_DETERMINATION_REQUEST_FAILED',
      });
    }
  };

  router.get('/api/admin/determinations/status', guarded(async (_req, res) => res.json(service.status())));

  router.post('/api/admin/determinations/subjects', guarded(async (req, res, session) => {
    const subject = await service.registerSubject(req.body || {}, session.id);
    return res.status(201).json({ subject });
  }));

  router.post('/api/admin/determinations/observations', guarded(async (req, res, session) => {
    const observation = await service.recordObservation(req.body || {}, session.id);
    return res.status(201).json({ observation });
  }));

  router.post('/api/admin/determinations/snapshots', guarded(async (req, res, session) => {
    const snapshot = await service.createSnapshot(req.body || {}, session.id);
    return res.status(201).json({ snapshot });
  }));

  router.post('/api/admin/determinations/determine', guarded(async (req, res, session) => {
    const result = await service.determine(req.body || {}, session.id);
    return res.status(201).json(result);
  }));

  router.get('/api/admin/determinations/subjects/:subjectId/history', guarded(async (req, res) => {
    return res.json(service.subjectHistory(req.params.subjectId));
  }));

  return {
    status: () => service.status(),
  };
}
