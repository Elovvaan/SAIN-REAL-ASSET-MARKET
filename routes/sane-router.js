import { Router } from 'express';
import { SaneSkillService } from '../services/sane-skill-service.js';
import { HybridLiquidityMarketService } from '../services/hybrid-liquidity-market-service.js';
import { SraCoreEventBus } from '../services/sra-core-event-bus.js';
import { SraCoreServicesHeartbeat } from '../services/sra-core-services-heartbeat.js';
import { createSraCoreEngineRegistry } from '../services/sra-core-engine-registry.js';
import { buildSraCoreOperationalBrief } from '../services/sra-core-operational-brief-service.js';
import { ListingReadinessPolicyService } from '../services/listing-readiness-policy-service.js';
import { PublicationDecisionQueueService } from '../services/publication-decision-queue-service.js';
import { ParticipantOrderIntentService } from '../services/participant-order-intent-service.js';
import { OrderReviewMatchingService } from '../services/order-review-matching-service.js';
import { UnifiedMarketOperationsQueueService } from '../services/unified-market-operations-queue-service.js';
import { SraCoinAgentService } from '../services/sra-coin-agent-service.js';
import { SraCoinAgentInspectionService } from '../services/sra-coin-agent-inspection-service.js';
import { SraAgentOperatingSystemService } from '../services/sra-agent-operating-system-service.js';
import { SraCoinPositionSegmentationService } from '../services/sra-coin-position-segmentation-service.js';

function actorId(req) {
  return req.sraIdentity?.actorId || req.headers['x-sra-actor-id'] || req.body?.actorId || null;
}

export function createSaneRouter(service = new SaneSkillService(), edxOperationsService = null, sraAgentService = null) {
  const router = Router();
  const domain = edxOperationsService?.domain || null;
  const hybridLiquidity = domain ? new HybridLiquidityMarketService(domain) : null;
  const listingReadinessPolicy = domain ? new ListingReadinessPolicyService(domain) : null;
  const publicationDecisionQueue = domain ? new PublicationDecisionQueueService(domain) : null;
  const participantOrderIntents = domain ? new ParticipantOrderIntentService(domain) : null;
  const orderReviewMatching = domain ? new OrderReviewMatchingService(domain) : null;
  const coinAgentInspection = domain ? new SraCoinAgentInspectionService(new SraCoinAgentService(domain)) : null;
  const coinSegmentation = domain ? new SraCoinPositionSegmentationService(domain) : null;
  const coreHeartbeat = domain ? new SraCoreServicesHeartbeat({
    domain,
    eventBus: new SraCoreEventBus({ onDeliveryError: ({ eventType, error }) => console.error(JSON.stringify({ level: 'error', event: 'SRA_CORE_EVENT_SUBSCRIBER_FAILED', eventType, error: error?.message || String(error) })) }),
    intervalMs: Number(process.env.SRA_CORE_HEARTBEAT_INTERVAL_MS) || 15000,
    engines: createSraCoreEngineRegistry(),
  }) : null;
  const unifiedOperationsQueue = domain ? new UnifiedMarketOperationsQueueService(domain, orderReviewMatching, coreHeartbeat) : null;
  const agentOperatingSystem = domain ? new SraAgentOperatingSystemService(domain, { operationsQueue: unifiedOperationsQueue, coreHeartbeat }) : null;

  if (coreHeartbeat) void coreHeartbeat.start().catch((error) => console.error(JSON.stringify({ level: 'error', event: 'SRA_CORE_START_FAILED', error: error?.message || String(error) })));

  router.get('/skills', (req, res) => res.json({ architectureVersion: 'V14', operatingTier: typeof req.query?.operatingTier === 'string' ? req.query.operatingTier : 'UNIVERSAL', skills: service.listSkills(typeof req.query?.operatingTier === 'string' ? req.query.operatingTier : 'UNIVERSAL') }));
  router.post('/message', (req, res) => { try { res.json(service.dispatch(req.body)); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.get('/agent/status', (_req, res) => res.json({ agent: 'SANE', available: Boolean(sraAgentService?.available()), model: sraAgentService?.model || null, writeAccess: 'DISABLED', approvalRequiredForStateChanges: true }));
  router.post('/agent/chat', async (req, res) => { if (!sraAgentService) return res.status(503).json({ error: 'SRA agent service is unavailable.' }); try { return res.json(await sraAgentService.chat(req.body || {})); } catch (error) { return res.status(error.statusCode || 400).json({ error: error.message }); } });

  router.get('/agent-os', (_req, res) => agentOperatingSystem ? res.json(agentOperatingSystem.brief()) : res.status(503).json({ error: 'SAIN Agent OS is unavailable.' }));
  router.get('/agent-os/registry', (_req, res) => agentOperatingSystem ? res.json({ operatingSystem: 'SAIN_AGENT_OS', agents: agentOperatingSystem.registry(), authorityBoundary: agentOperatingSystem.brief().authorityBoundary }) : res.status(503).json({ error: 'SAIN Agent OS is unavailable.' }));

  router.get('/coin-agents', (req, res) => {
    if (!coinAgentInspection) return res.status(503).json({ error: 'SRA Coin Agent inspection is unavailable.' });
    try { return res.json(coinAgentInspection.list({ participantId: typeof req.query.participantId === 'string' ? req.query.participantId : null, limit: req.query.limit })); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_COIN_AGENT_LIST_FAILED' }); }
  });
  router.get('/coin-agents/:coinPositionId', (req, res) => {
    if (!coinAgentInspection) return res.status(503).json({ error: 'SRA Coin Agent inspection is unavailable.' });
    try { return res.json(coinAgentInspection.inspect(req.params.coinPositionId)); }
    catch (error) { const notFound = /not found/i.test(error.message); return res.status(notFound ? 404 : 422).json({ error: error.message, code: 'SRA_COIN_AGENT_INSPECTION_FAILED' }); }
  });
  router.post('/coin-agents/:coinPositionId/segment/preview', (req, res) => {
    if (!coinSegmentation) return res.status(503).json({ error: 'SRA Coin segmentation is unavailable.' });
    try { return res.json(coinSegmentation.preview({ ...(req.body || {}), positionId: req.params.coinPositionId })); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_COIN_SEGMENTATION_PREVIEW_FAILED' }); }
  });
  router.post('/coin-agents/:coinPositionId/segment/approve', async (req, res) => {
    if (!coinSegmentation) return res.status(503).json({ error: 'SRA Coin segmentation is unavailable.' });
    const administrator = actorId(req);
    if (!administrator) return res.status(401).json({ error: 'An authenticated administrator identity is required.' });
    try { return res.status(201).json(await coinSegmentation.approve({ ...(req.body || {}), positionId: req.params.coinPositionId }, administrator)); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_COIN_SEGMENTATION_APPROVAL_FAILED' }); }
  });

  router.post('/order-intents/preview', (req, res) => {
    if (!participantOrderIntents) return res.status(503).json({ error: 'Participant order-intent service is unavailable.' });
    try { return res.json(participantOrderIntents.preview(req.body || {}, actorId(req))); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_ORDER_INTENT_PREVIEW_FAILED' }); }
  });
  router.post('/order-intents/confirm', async (req, res) => {
    if (!participantOrderIntents) return res.status(503).json({ error: 'Participant order-intent service is unavailable.' });
    const participant = actorId(req);
    if (!participant) return res.status(401).json({ error: 'An authenticated participant identity is required.' });
    try { return res.status(201).json(await participantOrderIntents.confirm(req.body || {}, participant)); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_ORDER_INTENT_CONFIRMATION_FAILED' }); }
  });
  router.get('/order-intents', (req, res) => {
    if (!participantOrderIntents) return res.status(503).json({ error: 'Participant order-intent service is unavailable.' });
    const participant = actorId(req);
    if (!participant) return res.status(401).json({ error: 'An authenticated participant identity is required.' });
    return res.json({ orderIntents: participantOrderIntents.listForParticipant(participant), status: participantOrderIntents.status() });
  });

  router.get('/order-review/queue', (_req, res) => orderReviewMatching ? res.json(orderReviewMatching.status()) : res.status(503).json({ error: 'Order review and matching service is unavailable.' }));
  router.get('/operations-queue', async (_req, res) => unifiedOperationsQueue ? res.json(await unifiedOperationsQueue.explainPersisted()) : res.status(503).json({ error: 'Unified market operations queue is unavailable.' }));
  router.post('/order-review/preview', (req, res) => {
    if (!orderReviewMatching) return res.status(503).json({ error: 'Order review and matching service is unavailable.' });
    try { return res.json(orderReviewMatching.preview(req.body || {})); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_ORDER_MATCH_PREVIEW_FAILED' }); }
  });
  router.post('/order-review/approve', async (req, res) => {
    if (!orderReviewMatching) return res.status(503).json({ error: 'Order review and matching service is unavailable.' });
    const administrator = actorId(req);
    if (!administrator) return res.status(401).json({ error: 'An authenticated administrator identity is required.' });
    try { return res.status(201).json(await orderReviewMatching.approve(req.body || {}, administrator)); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_ORDER_MATCH_APPROVAL_FAILED' }); }
  });
  router.get('/order-review/reviews', (_req, res) => orderReviewMatching ? res.json({ reviews: orderReviewMatching.reviews(), status: orderReviewMatching.status() }) : res.status(503).json({ error: 'Order review and matching service is unavailable.' }));

  router.get('/core-services/status', (_req, res) => coreHeartbeat ? res.json(coreHeartbeat.status()) : res.status(503).json({ error: 'SRA Core Services are unavailable.' }));
  router.get('/core-services/brief', (_req, res) => coreHeartbeat ? res.json(buildSraCoreOperationalBrief(coreHeartbeat.status())) : res.status(503).json({ error: 'SRA Core Services are unavailable.' }));
  router.get('/core-services/cycles', (_req, res) => coreHeartbeat ? res.json({ cycles: coreHeartbeat.domain.list('SRA_CORE_HEARTBEAT_CYCLE').sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))).slice(0, 100), status: coreHeartbeat.status() }) : res.status(503).json({ error: 'SRA Core Services are unavailable.' }));
  router.post('/core-services/run', async (req, res) => { if (!coreHeartbeat) return res.status(503).json({ error: 'SRA Core Services are unavailable.' }); try { return res.json(await coreHeartbeat.runCycle(req.body?.trigger || 'ADMIN_REQUEST')); } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_CORE_CYCLE_FAILED' }); } });
  router.get('/core-services/publication-queue', (_req, res) => publicationDecisionQueue ? res.json(publicationDecisionQueue.explain()) : res.status(503).json({ error: 'Publication decision queue is unavailable.' }));
  router.get('/core-services/readiness-policy', (_req, res) => listingReadinessPolicy ? res.json({ status: listingReadinessPolicy.status(), preview: listingReadinessPolicy.preview() }) : res.status(503).json({ error: 'Listing readiness policy service is unavailable.' }));
  router.post('/core-services/readiness-policy/preview', (req, res) => { if (!listingReadinessPolicy) return res.status(503).json({ error: 'Listing readiness policy service is unavailable.' }); try { return res.json(listingReadinessPolicy.preview(req.body || {})); } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_READINESS_POLICY_PREVIEW_FAILED' }); } });
  router.post('/core-services/readiness-policy/approve', async (req, res) => { if (!listingReadinessPolicy) return res.status(503).json({ error: 'Listing readiness policy service is unavailable.' }); if (String(req.body?.approval || '').toUpperCase() !== 'APPROVE') return res.status(409).json({ error: 'Explicit administrator approval is required.', requiredApproval: 'APPROVE' }); try { const policy = await listingReadinessPolicy.approve(req.body || {}, actorId(req) || 'SRA_PLATFORM_ADMIN'); const cycle = coreHeartbeat ? await coreHeartbeat.runCycle('READINESS_POLICY_APPROVED') : null; return res.status(201).json({ policy, cycle, status: listingReadinessPolicy.status() }); } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_READINESS_POLICY_APPROVAL_FAILED' }); } });
  router.post('/core-services/readiness-policy/disable', async (req, res) => { if (!listingReadinessPolicy) return res.status(503).json({ error: 'Listing readiness policy service is unavailable.' }); if (String(req.body?.approval || '').toUpperCase() !== 'DISABLE') return res.status(409).json({ error: 'Explicit administrator disable instruction is required.', requiredApproval: 'DISABLE' }); try { return res.json({ policy: await listingReadinessPolicy.disable(actorId(req) || 'SRA_PLATFORM_ADMIN'), status: listingReadinessPolicy.status() }); } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_READINESS_POLICY_DISABLE_FAILED' }); } });

  router.get('/hybrid-liquidity/status', (_req, res) => hybridLiquidity ? res.json(hybridLiquidity.status()) : res.status(503).json({ error: 'Hybrid Liquidity Market is unavailable.' }));
  router.get('/hybrid-liquidity/markets', (_req, res) => hybridLiquidity ? res.json({ markets: hybridLiquidity.list(), status: hybridLiquidity.status() }) : res.status(503).json({ error: 'Hybrid Liquidity Market is unavailable.' }));
  router.get('/hybrid-liquidity/markets/:marketId', (req, res) => { if (!hybridLiquidity) return res.status(503).json({ error: 'Hybrid Liquidity Market is unavailable.' }); const market = hybridLiquidity.get(req.params.marketId); return market ? res.json(market) : res.status(404).json({ error: 'Hybrid market definition was not found.' }); });
  router.post('/hybrid-liquidity/preview', (req, res) => { if (!hybridLiquidity) return res.status(503).json({ error: 'Hybrid Liquidity Market is unavailable.' }); try { return res.json(hybridLiquidity.preview(req.body || {})); } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_HYBRID_MARKET_PREVIEW_FAILED' }); } });
  router.post('/hybrid-liquidity/approve', async (req, res) => { if (!hybridLiquidity) return res.status(503).json({ error: 'Hybrid Liquidity Market is unavailable.' }); try { return res.status(201).json(await hybridLiquidity.approveDefinition(req.body || {}, actorId(req) || 'SRA_PLATFORM_ADMIN')); } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_HYBRID_MARKET_APPROVAL_FAILED' }); } });
  router.post('/hybrid-liquidity/references', async (req, res) => { if (!hybridLiquidity) return res.status(503).json({ error: 'Hybrid Liquidity Market is unavailable.' }); try { return res.status(201).json(await hybridLiquidity.recordReference(req.body || {}, actorId(req) || 'SRA_REFERENCE_ENGINE')); } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_HYBRID_MARKET_REFERENCE_FAILED' }); } });

  router.get('/edx/enterprises/:enterpriseId/publication-review', (req, res) => { if (!edxOperationsService) return res.status(503).json({ error: 'Sane EDX operations are unavailable.' }); try { return res.json(edxOperationsService.preparePublicationPrompt(req.params.enterpriseId)); } catch (error) { return res.status(400).json({ error: error.message }); } });
  router.post('/edx/publication-choice', async (req, res) => { if (!edxOperationsService) return res.status(503).json({ error: 'Sane EDX operations are unavailable.' }); try { return res.json(await edxOperationsService.recordChoice(req.body || {}, actorId(req))); } catch (error) { return res.status(400).json({ error: error.message }); } });
  return router;
}
