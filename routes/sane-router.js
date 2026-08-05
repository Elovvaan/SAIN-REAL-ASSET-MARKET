import { Router } from 'express';
import { SaneSkillService } from '../services/sane-skill-service.js';
import { HybridLiquidityMarketService } from '../services/hybrid-liquidity-market-service.js';
import { SraCoreEventBus } from '../services/sra-core-event-bus.js';
import { SraCoreServicesHeartbeat } from '../services/sra-core-services-heartbeat.js';
import { createSraCoreEngineRegistry } from '../services/sra-core-engine-registry.js';
import { buildSraCoreOperationalBrief } from '../services/sra-core-operational-brief-service.js';

function actorId(req) {
  return req.sraIdentity?.actorId || req.headers['x-sra-actor-id'] || req.body?.actorId || null;
}

export function createSaneRouter(service = new SaneSkillService(), edxOperationsService = null, sraAgentService = null) {
  const router = Router();
  const domain = edxOperationsService?.domain || null;
  const hybridLiquidity = domain ? new HybridLiquidityMarketService(domain) : null;
  const coreHeartbeat = domain ? new SraCoreServicesHeartbeat({
    domain,
    eventBus: new SraCoreEventBus({
      onDeliveryError: ({ eventType, error }) => console.error(JSON.stringify({ level: 'error', event: 'SRA_CORE_EVENT_SUBSCRIBER_FAILED', eventType, error: error?.message || String(error) })),
    }),
    intervalMs: Number(process.env.SRA_CORE_HEARTBEAT_INTERVAL_MS) || 15000,
    engines: createSraCoreEngineRegistry(),
  }) : null;

  if (coreHeartbeat) void coreHeartbeat.start().catch((error) => {
    console.error(JSON.stringify({ level: 'error', event: 'SRA_CORE_START_FAILED', error: error?.message || String(error) }));
  });

  router.get('/skills', (req, res) => {
    const tier = typeof req.query?.operatingTier === 'string' ? req.query.operatingTier : 'UNIVERSAL';
    res.json({ architectureVersion: 'V14', operatingTier: tier, skills: service.listSkills(tier) });
  });

  router.post('/message', (req, res) => {
    try { res.json(service.dispatch(req.body)); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });

  router.get('/agent/status', (_req, res) => {
    res.json({ agent: 'SANE', available: Boolean(sraAgentService?.available()), model: sraAgentService?.model || null, writeAccess: 'DISABLED', approvalRequiredForStateChanges: true });
  });

  router.post('/agent/chat', async (req, res) => {
    if (!sraAgentService) return res.status(503).json({ error: 'SRA agent service is unavailable.' });
    try { return res.json(await sraAgentService.chat(req.body || {})); }
    catch (error) { return res.status(error.statusCode || 400).json({ error: error.message }); }
  });

  router.get('/core-services/status', (_req, res) => {
    if (!coreHeartbeat) return res.status(503).json({ error: 'SRA Core Services are unavailable.' });
    return res.json(coreHeartbeat.status());
  });

  router.get('/core-services/brief', (_req, res) => {
    if (!coreHeartbeat) return res.status(503).json({ error: 'SRA Core Services are unavailable.' });
    return res.json(buildSraCoreOperationalBrief(coreHeartbeat.status()));
  });

  router.get('/core-services/cycles', (_req, res) => {
    if (!coreHeartbeat) return res.status(503).json({ error: 'SRA Core Services are unavailable.' });
    const cycles = coreHeartbeat.domain.list('SRA_CORE_HEARTBEAT_CYCLE')
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
      .slice(0, 100);
    return res.json({ cycles, status: coreHeartbeat.status() });
  });

  router.post('/core-services/run', async (req, res) => {
    if (!coreHeartbeat) return res.status(503).json({ error: 'SRA Core Services are unavailable.' });
    try { return res.json(await coreHeartbeat.runCycle(req.body?.trigger || 'ADMIN_REQUEST')); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_CORE_CYCLE_FAILED' }); }
  });

  router.get('/hybrid-liquidity/status', (_req, res) => {
    if (!hybridLiquidity) return res.status(503).json({ error: 'Hybrid Liquidity Market is unavailable.' });
    return res.json(hybridLiquidity.status());
  });

  router.get('/hybrid-liquidity/markets', (_req, res) => {
    if (!hybridLiquidity) return res.status(503).json({ error: 'Hybrid Liquidity Market is unavailable.' });
    return res.json({ markets: hybridLiquidity.list(), status: hybridLiquidity.status() });
  });

  router.get('/hybrid-liquidity/markets/:marketId', (req, res) => {
    if (!hybridLiquidity) return res.status(503).json({ error: 'Hybrid Liquidity Market is unavailable.' });
    const market = hybridLiquidity.get(req.params.marketId);
    return market ? res.json(market) : res.status(404).json({ error: 'Hybrid market definition was not found.' });
  });

  router.post('/hybrid-liquidity/preview', (req, res) => {
    if (!hybridLiquidity) return res.status(503).json({ error: 'Hybrid Liquidity Market is unavailable.' });
    try { return res.json(hybridLiquidity.preview(req.body || {})); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_HYBRID_MARKET_PREVIEW_FAILED' }); }
  });

  router.post('/hybrid-liquidity/approve', async (req, res) => {
    if (!hybridLiquidity) return res.status(503).json({ error: 'Hybrid Liquidity Market is unavailable.' });
    try { return res.status(201).json(await hybridLiquidity.approveDefinition(req.body || {}, actorId(req) || 'SRA_PLATFORM_ADMIN')); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_HYBRID_MARKET_APPROVAL_FAILED' }); }
  });

  router.post('/hybrid-liquidity/references', async (req, res) => {
    if (!hybridLiquidity) return res.status(503).json({ error: 'Hybrid Liquidity Market is unavailable.' });
    try { return res.status(201).json(await hybridLiquidity.recordReference(req.body || {}, actorId(req) || 'SRA_REFERENCE_ENGINE')); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_HYBRID_MARKET_REFERENCE_FAILED' }); }
  });

  router.get('/edx/enterprises/:enterpriseId/publication-review', (req, res) => {
    if (!edxOperationsService) return res.status(503).json({ error: 'Sane EDX operations are unavailable.' });
    try { return res.json(edxOperationsService.preparePublicationPrompt(req.params.enterpriseId)); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  router.post('/edx/publication-choice', async (req, res) => {
    if (!edxOperationsService) return res.status(503).json({ error: 'Sane EDX operations are unavailable.' });
    try { return res.json(await edxOperationsService.recordChoice(req.body || {}, actorId(req))); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  return router;
}
