import { Router } from 'express';
import { AccessService } from '../services/access-service.js';

function readCookie(req, name) {
  const cookie = req.headers.cookie || '';
  const entry = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `sra_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sra_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

export function createAccessRouter(marketplace, service = new AccessService()) {
  const router = Router();

  router.get('/public', (_req, res) => {
    res.json({
      marketStatus: marketplace.marketStatus,
      verifiedValue: marketplace.verifiedValue,
      activeProjects: marketplace.activeProjects,
      participatingAssets: marketplace.participatingAssets,
      opportunities: marketplace.projects.map((project) => ({
        id: project.id,
        title: project.title,
        assetName: project.assetName,
        region: project.region,
        stage: project.stage,
        signal: project.signal,
        verifiedValue: project.verifiedValue,
        projectedGainRate: project.projectedGainRate,
        participationWindow: project.participationWindow,
        completionState: project.completionState
      }))
    });
  });

  router.get('/session', (req, res) => {
    const session = service.getSession(readCookie(req, 'sra_session'));
    res.json({ authenticated: Boolean(session), session });
  });

  router.post('/signup', (req, res) => {
    try {
      const result = service.signup(req.body);
      setSessionCookie(res, result.token);
      res.status(201).json({ authenticated: true, session: result.session });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/signin', (req, res) => {
    try {
      const result = service.signin(req.body);
      setSessionCookie(res, result.token);
      res.json({ authenticated: true, session: result.session });
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  });

  router.post('/signout', (req, res) => {
    service.signout(readCookie(req, 'sra_session'));
    clearSessionCookie(res);
    res.json({ authenticated: false });
  });

  router.post('/role', (req, res) => {
    try {
      const session = service.switchRole(readCookie(req, 'sra_session'), req.body?.role);
      res.json({ authenticated: true, session });
    } catch (error) {
      res.status(403).json({ error: error.message });
    }
  });

  return router;
}

export { readCookie };
