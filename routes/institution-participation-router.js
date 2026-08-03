import express from 'express';

function readCookie(req, name) {
  const cookie = req.headers.cookie || '';
  const entry = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

function actorId(req, session) {
  return req.headers['x-sra-actor-id'] || session?.id || req.body?.actorId || null;
}

function handleError(res, error) {
  const message = error?.message || 'Unexpected institution participation error.';
  return res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
}

async function requireInstitution(req, res, accessService) {
  const session = await accessService.getSession(readCookie(req, 'sra_session'));
  if (!session) {
    res.status(401).json({ error: 'Sign in to access the Institution Workspace.' });
    return null;
  }
  if (session.activeCapacity !== 'INSTITUTIONAL_OPERATOR') {
    res.status(403).json({ error: 'Institutional Operator capacity is required.' });
    return null;
  }
  return session;
}

export function createInstitutionParticipationRouter(service, accessService) {
  const router = express.Router();

  router.get('/plans', (req, res) => {
    return res.json({ plans: service.listPlans({ homeProjectId: req.query.homeProjectId || null, state: req.query.state || null }) });
  });

  router.post('/plans', async (req, res) => {
    try { return res.status(201).json(await service.createPlan(req.body || {}, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  router.get('/plans/:planId', (req, res) => {
    const plan = service.getPlan(req.params.planId);
    return plan ? res.json(service.summary(req.params.planId)) : res.status(404).json({ error: 'Participation Plan not found.' });
  });

  router.post('/plans/:planId/open', async (req, res) => {
    try { return res.json(await service.openPlan(req.params.planId, actorId(req))); }
    catch (error) { return handleError(res, error); }
  });

  router.get('/workspace', async (req, res) => {
    const session = await requireInstitution(req, res, accessService);
    if (!session) return;
    return res.json(service.institutionWorkspace(session.id));
  });

  router.get('/opportunities', async (req, res) => {
    const session = await requireInstitution(req, res, accessService);
    if (!session) return;
    return res.json({ opportunities: service.opportunities(session.id) });
  });

  router.get('/commitments', async (req, res) => {
    const session = await requireInstitution(req, res, accessService);
    if (!session) return;
    return res.json({ commitments: service.listCommitments({ institutionId: session.id, state: req.query.state || null }) });
  });

  router.post('/commitments', async (req, res) => {
    const session = await requireInstitution(req, res, accessService);
    if (!session) return;
    try {
      return res.status(201).json(await service.createCommitment({
        ...(req.body || {}),
        institutionId: session.id,
        institutionName: session.displayName
      }, actorId(req, session)));
    } catch (error) { return handleError(res, error); }
  });

  router.get('/commitments/:commitmentId', async (req, res) => {
    const session = await requireInstitution(req, res, accessService);
    if (!session) return;
    const record = service.getCommitment(req.params.commitmentId);
    if (!record || record.institutionId !== session.id) return res.status(404).json({ error: 'Participation Commitment not found.' });
    return res.json(record);
  });

  router.post('/commitments/:commitmentId/transition', async (req, res) => {
    const session = await requireInstitution(req, res, accessService);
    if (!session) return;
    const current = service.getCommitment(req.params.commitmentId);
    if (!current || current.institutionId !== session.id) return res.status(404).json({ error: 'Participation Commitment not found.' });
    try { return res.json(await service.transitionCommitment(req.params.commitmentId, req.body?.state, req.body || {}, actorId(req, session))); }
    catch (error) { return handleError(res, error); }
  });

  return router;
}
