import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSeededDomainStore } from './services/domain-store.js';
import { createOnboardingRouter } from './routes/onboarding-router.js';
import { createCustodyRouter } from './routes/custody-router.js';
import { createAccessRouter } from './routes/access-router.js';
import { createParticipationRouter } from './routes/participation-router.js';
import { AccessService } from './services/access-service.js';

const app = express();
const port = Number(process.env.PORT) || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const domainStore = createSeededDomainStore();
const accessService = new AccessService();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const marketplace = {
  marketStatus: 'LIVE', verifiedValue: 12840000, projectedMarketplaceGain: 684000, activeProjects: 18,
  participatingAssets: 42, openPositions: 27, completionCandidates: 3, instrumentsActive: 9,
  completionNeed: 240000, completionReturn: 26000,
  assets: [
    { id: 'A-1042', name: 'North District Market', type: 'OPERATING_BUSINESS', region: 'Ogden, Utah', state: 'ACTIVE', lifecycleEvents: 418, verifiedCycles: 392, verifiedValue: 735000, verifiedScore: 88, valueSignal: 'STABLE', projectId: 'SRA-RE-0021', dimensions: { production: 91, condition: 84, reliability: 93, capacity: 79 } },
    { id: 'A-2088', name: 'Weber Residential Portfolio', type: 'REAL_ESTATE', region: 'Northern Utah', state: 'UNDER_PROJECT', lifecycleEvents: 96, verifiedCycles: 81, verifiedValue: 1860000, verifiedScore: 76, valueSignal: 'GROWING', projectId: 'SRA-RE-0014', dimensions: { production: 72, condition: 68, reliability: 82, capacity: 81 } },
    { id: 'A-3104', name: 'Weber Mixed-Use Block', type: 'MIXED_USE_REAL_ESTATE', region: 'Weber County, Utah', state: 'UNDER_PROJECT', lifecycleEvents: 147, verifiedCycles: 126, verifiedValue: 2480000, verifiedScore: 92, valueSignal: 'ACCELERATING', projectId: 'SRA-RE-0033', dimensions: { production: 89, condition: 90, reliability: 94, capacity: 95 } }
  ],
  projects: [
    { id: 'SRA-RE-0014', assetId: 'A-2088', assetName: 'Weber Residential Portfolio', title: '14-Unit Residential Recovery', region: 'Northern Utah', stage: 'SERVICES_SCHEDULED', progress: 62, verifiedValue: 1860000, fundingTarget: 420000, fundingProgress: 74, signal: '+4.8%', status: 'OPEN', completionState: 'WATCH', projectedCompletedValue: 2240000, projectedGain: 380000, projectedGainRate: 20.4, participationWindow: '8–14 months', trueBill: { id: 'TB-0014', state: 'ACTIVE', purpose: 'CAPITAL_FORMATION', value: 310000 } },
    { id: 'SRA-RE-0021', assetId: 'A-1042', assetName: 'North District Market', title: 'Neighborhood Grocery Expansion', region: 'Ogden, Utah', stage: 'PRODUCTION_BEGINS', progress: 39, verifiedValue: 735000, fundingTarget: 185000, fundingProgress: 91, signal: '+2.1%', status: 'OPEN', completionState: 'NORMAL', projectedCompletedValue: 842000, projectedGain: 107000, projectedGainRate: 14.6, participationWindow: '10–16 months', trueBill: { id: 'TB-0021', state: 'ISSUED', purpose: 'ASSET_EXPANSION', value: 168000 } },
    { id: 'SRA-RE-0033', assetId: 'A-3104', assetName: 'Weber Mixed-Use Block', title: 'Mixed-Use Rehabilitation', region: 'Weber County, Utah', stage: 'VERIFIED_VALUE', progress: 78, verifiedValue: 2480000, fundingTarget: 610000, fundingProgress: 83, signal: '+6.3%', status: 'OPEN', completionState: 'ELIGIBLE', projectedCompletedValue: 2677000, projectedGain: 197000, projectedGainRate: 7.9, participationWindow: '5–9 months', trueBill: { id: 'TB-0033', state: 'PLEDGED', purpose: 'COMPLETION_CAPACITY', value: 505000 } }
  ],
  completionWatch: [
    { projectId: 'SRA-RE-0014', title: '14-Unit Residential Recovery', gap: 109000, verifiedCoverage: 82, potentialGain: 380000, platformReturn: 12000, state: 'WATCH', action: 'Wait for market participation' },
    { projectId: 'SRA-RE-0033', title: 'Mixed-Use Rehabilitation', gap: 88000, verifiedCoverage: 94, potentialGain: 197000, platformReturn: 10000, state: 'ELIGIBLE', action: 'Prepare Completion Participant path' },
    { projectId: 'SRA-RE-0041', title: 'Community Equipment Hub', gap: 43000, verifiedCoverage: 71, potentialGain: 107000, platformReturn: 4000, state: 'PENDING', action: 'Verify remaining lifecycle events' }
  ],
  activity: [
    { time: '10:42', kind: 'VERIFIED', label: 'Inspection milestone verified', project: 'SRA-RE-0014', amount: 45000 },
    { time: '10:36', kind: 'PARTICIPANT', label: 'Capital participant joined pool', project: 'SRA-RE-0033' },
    { time: '10:21', kind: 'ASSIGNED', label: 'Material supply position assigned', project: 'SRA-RE-0021' },
    { time: '09:58', kind: 'VVP', label: 'Verified Value package frozen', project: 'SRA-RE-0033', amount: 2480000 },
    { time: '09:41', kind: 'TRUE_BILL', label: 'True Bill activated for expansion', project: 'SRA-RE-0021', amount: 168000 }
  ]
};

app.use('/api/access', createAccessRouter(marketplace, accessService));
app.use('/api/participation', createParticipationRouter(marketplace, accessService));
app.use('/api/onboarding', createOnboardingRouter(domainStore));
app.use('/api/custody', createCustodyRouter());

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'SAIN Real Asset Market', version: '1.3.0', productExperience: 'ACTIVE', operatingTierEngine: 'ACTIVE', tierAwareSane: 'ACTIVE', universalAccount: 'FREE', capabilityTiers: 'ACTIVE', marketplaceParticipation: 'ACTIVE', institutionalCustody: 'ACTIVE', timestamp: new Date().toISOString() }));
app.get('/api/marketplace', (_req, res) => res.json(marketplace));
app.get('/api/domain', (_req, res) => res.json(domainStore.snapshot()));
app.get('/api/assets/:assetId/studio', (req, res) => {
  const studio = domainStore.getAssetStudio(req.params.assetId);
  if (!studio) return res.status(404).json({ error: 'Asset Account not found.' });
  return res.json(studio);
});

app.post('/api/sane/message', (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'A message is required.' });
  const tier = typeof req.body?.operatingTier === 'string' ? req.body.operatingTier : 'UNIVERSAL';
  const lower = message.toLowerCase();
  const defaults = {
    UNIVERSAL: 'You are operating in the Universal tier. I can help you browse, compare opportunities, participate, and track positions.',
    ASSET_PROVIDER: 'You are operating in the Asset Provider tier. I can help you present an asset, start V4V, manage projects, publish opportunities, and track completion.',
    MARKET_PROFESSIONAL: 'You are operating in the Market Professional tier. I can help you find openings, offer capacity, review assignments, manage positions, and track settlement.',
    INSTITUTIONAL_OPERATOR: 'You are operating in the Institutional tier. I can route verification, custody, settlement, discharge, filing, and audit workflows.',
    PLATFORM_ADMIN: 'You are operating in Platform Administration. I can route the SRA platform account, parent-platform connection, treasury, platform funding, and cross-platform reporting.'
  };
  let reply = defaults[tier] || defaults.UNIVERSAL;
  if (lower.includes('tier') || lower.includes('workspace') || lower.includes('switch')) {
    reply = `Your current operating tier is ${tier.replaceAll('_',' ')}. The navigation, workspace, permissions, and my working context all derive from that tier.`;
  } else if (tier === 'UNIVERSAL' && (lower.includes('participate') || lower.includes('position') || lower.includes('opportunit'))) {
    reply = 'Open an opportunity, review the Verified Value summary and terms, choose your contribution medium, authorize the participation ticket, and track the resulting position in My Positions.';
  } else if (tier === 'ASSET_PROVIDER' && (lower.includes('asset') || lower.includes('v4v') || lower.includes('project') || lower.includes('publish'))) {
    reply = 'I can start the Asset Provider path: present the asset, collect private evidence, move it through V4V, establish the Asset Account, open a project, and prepare a marketplace opportunity.';
  } else if (tier === 'MARKET_PROFESSIONAL' && (lower.includes('service') || lower.includes('equipment') || lower.includes('material') || lower.includes('contract') || lower.includes('capital'))) {
    reply = 'I can match your professional capacity to open project positions, organize the proposal or participation ticket, and track deployment, milestones, and settlement.';
  } else if (tier === 'INSTITUTIONAL_OPERATOR' && (lower.includes('custody') || lower.includes('collateral') || lower.includes('settlement') || lower.includes('discharge') || lower.includes('filing'))) {
    reply = 'I can route the institutional record through custody, collateral scheduling, settlement, setoff, discharge, filing, and lifecycle updates without exposing those records to ordinary participants.';
  } else if (tier === 'PLATFORM_ADMIN' && (lower.includes('platform') || lower.includes('treasury') || lower.includes('parent') || lower.includes('funding'))) {
    reply = 'I can open the SRA Platform Account and route parent-platform connection status, treasury position, platform funding, internal returns, and cross-platform administration.';
  }
  return res.json({ reply, operatingTier: tier });
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(port, '0.0.0.0', () => console.log(`SRA V13 Product Experience & Operating Tier Architecture is running on port ${port}`));
