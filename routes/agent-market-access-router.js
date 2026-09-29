import { Router } from 'express';
import { AgentMarketAccessService } from '../services/agent-market-access-service.js';
import { AgentMarketProposalService, AGENT_MARKET_PROPOSAL_TYPE } from '../services/agent-market-proposal-service.js';
import { AgentWorkforceService, SRA_AGENT_WORKFORCE_TYPES } from '../services/agent-workforce-service.js';
import { AGENT_MARKET_GRANT_TYPE } from '../services/agent-market-access-service.js';

export async function createAgentMarketAccessRouter(domain) {
  await domain.hydrate([AGENT_MARKET_GRANT_TYPE, AGENT_MARKET_PROPOSAL_TYPE, SRA_AGENT_WORKFORCE_TYPES.AGENT, 'MARKETPLACE_LISTING']);
  const workforce = new AgentWorkforceService({ domain });
  const access = new AgentMarketAccessService(domain, workforce);
  const market = new AgentMarketProposalService(domain, workforce);
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Vary', 'Authorization'); next(); });
  function authenticate(scope) {
    return (req, res, next) => {
      const grant = access.authenticate(req.headers.authorization, scope);
      if (!grant) return res.status(401).json({ error:'Agent market access is unavailable for this request.', code:'SRA_AGENT_MARKET_ACCESS_REQUIRED' });
      req.agentMarketGrant = grant;
      return next();
    };
  }
  router.get('/catalog', authenticate('MARKET_READ'), (_req, res) => res.json({ records:market.catalog(), execution:'READ_ONLY' }));
  router.get('/capabilities', authenticate('MARKET_READ'), (_req, res) => res.json({
    version:'1.0',
    catalog:{ method:'GET', path:'/api/agent-market/catalog', scope:'MARKET_READ' },
    proposal:{ method:'POST', path:'/api/agent-market/proposals', scope:'PROPOSAL_PREPARE', required:['listingId','quantity','recipientId','settlementRoute','considerationUnit','limitPrice','maximumFees','expiresAt'] },
    authorization:'Bearer token', execution:'ADMIN_REVIEW_HANDOFF_ONLY',
  }));
  router.post('/proposals', authenticate('PROPOSAL_PREPARE'), async (req, res) => {
    try {
      const grant = req.agentMarketGrant;
      const proposal = await market.prepare({ ...req.body, agentId:grant.agentId }, `AGENT_GRANT:${grant.grantId}`);
      return res.status(201).json(proposal);
    } catch (error) { return res.status(422).json({ error:error.message, code:'SRA_AGENT_MARKET_PROPOSAL_FAILED' }); }
  });
  router.use((_req, res) => res.status(404).json({ error:'Agent market operation was not found.', code:'SRA_AGENT_MARKET_OPERATION_NOT_FOUND' }));
  return router;
}
