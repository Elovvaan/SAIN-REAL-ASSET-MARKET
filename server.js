import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSeededDomainStore } from './services/domain-store.js';
import { createOnboardingRouter } from './routes/onboarding-router.js';
import { createCustodyRouter } from './routes/custody-router.js';
import { createAccessRouter } from './routes/access-router.js';
import { createParticipationRouter } from './routes/participation-router.js';
import { createSaneRouter } from './routes/sane-router.js';
import { createCreativeFinanceRouter } from './routes/creative-finance-router.js';
import { createValueIntelligenceRouter } from './routes/value-intelligence-router.js';
import { createEdxConnectionRouter } from './routes/edx-connection-router.js';
import { createEdxPermissionRouter } from './routes/edx-permission-router.js';
import { createEdxExtractionRouter } from './routes/edx-extraction-router.js';
import { AccessService } from './services/access-service.js';
import { CreativeFinanceService } from './services/creative-finance-service.js';
import { ValueIntelligenceService } from './services/value-intelligence-service.js';
import { EdxConnectionService } from './services/edx-connection-service.js';
import { EdxPermissionService } from './services/edx-permission-service.js';
import { EdxExtractionService } from './services/edx-extraction-service.js';
import { DatabaseService } from './services/database-service.js';
import { PersistentDomainService, RECORD_TYPES } from './services/persistent-domain-service.js';
import { PersistentMarketplaceService } from './services/persistent-marketplace-service.js';

const app = express();
const port = Number(process.env.PORT) || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const domainStore = createSeededDomainStore();
const database = new DatabaseService();
await database.initialize();
const persistentDomain = new PersistentDomainService(database);
await persistentDomain.hydrate();
const accessService = new AccessService({ database });
await accessService.initialize();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const marketplaceSeed = {
  marketStatus: 'LIVE', verifiedValue: 12840000, projectedMarketplaceGain: 684000, activeProjects: 18,
  participatingAssets: 42, openPositions: 27, completionCandidates: 3, instrumentsActive: 9,
  completionNeed: 240000, completionReturn: 26000,
  assets: [
    { id: 'A-1042', assetId: 'A-1042', name: 'North District Market', type: 'OPERATING_BUSINESS', classification: 'OPERATING_BUSINESS', region: 'Ogden, Utah', state: 'ACTIVE', status: 'ACTIVE', lifecycleEvents: 418, verifiedCycles: 392, verifiedValue: 735000, verifiedScore: 88, valueSignal: 'STABLE', projectId: 'SRA-RE-0021', dimensions: { production: 91, condition: 84, reliability: 93, capacity: 79 } },
    { id: 'A-2088', assetId: 'A-2088', name: 'Weber Residential Portfolio', type: 'REAL_ESTATE', classification: 'REAL_ESTATE', region: 'Northern Utah', state: 'UNDER_PROJECT', status: 'UNDER_PROJECT', lifecycleEvents: 96, verifiedCycles: 81, verifiedValue: 1860000, verifiedScore: 76, valueSignal: 'GROWING', projectId: 'SRA-RE-0014', dimensions: { production: 72, condition: 68, reliability: 82, capacity: 81 } },
    { id: 'A-3104', assetId: 'A-3104', name: 'Weber Mixed-Use Block', type: 'MIXED_USE_REAL_ESTATE', classification: 'MIXED_USE_REAL_ESTATE', region: 'Weber County, Utah', state: 'UNDER_PROJECT', status: 'UNDER_PROJECT', lifecycleEvents: 147, verifiedCycles: 126, verifiedValue: 2480000, verifiedScore: 92, valueSignal: 'ACCELERATING', projectId: 'SRA-RE-0033', dimensions: { production: 89, condition: 90, reliability: 94, capacity: 95 } }
  ],
  projects: [
    { id: 'SRA-RE-0014', projectId: 'SRA-RE-0014', assetId: 'A-2088', assetName: 'Weber Residential Portfolio', title: '14-Unit Residential Recovery', region: 'Northern Utah', stage: 'SERVICES_SCHEDULED', progress: 62, verifiedValue: 1860000, fundingTarget: 420000, fundingProgress: 74, signal: '+4.8%', status: 'OPEN', completionState: 'WATCH', projectedCompletedValue: 2240000, projectedGain: 380000, projectedGainRate: 20.4, participationWindow: '8–14 months', trueBill: { id: 'TB-0014', state: 'ACTIVE', purpose: 'CAPITAL_FORMATION', value: 310000 } },
    { id: 'SRA-RE-0021', projectId: 'SRA-RE-0021', assetId: 'A-1042', assetName: 'North District Market', title: 'Neighborhood Grocery Expansion', region: 'Ogden, Utah', stage: 'PRODUCTION_BEGINS', progress: 39, verifiedValue: 735000, fundingTarget: 185000, fundingProgress: 91, signal: '+2.1%', status: 'OPEN', completionState: 'NORMAL', projectedCompletedValue: 842000, projectedGain: 107000, projectedGainRate: 14.6, participationWindow: '10–16 months', trueBill: { id: 'TB-0021', state: 'ISSUED', purpose: 'ASSET_EXPANSION', value: 168000 } },
    { id: 'SRA-RE-0033', projectId: 'SRA-RE-0033', assetId: 'A-3104', assetName: 'Weber Mixed-Use Block', title: 'Mixed-Use Rehabilitation', region: 'Weber County, Utah', stage: 'VERIFIED_VALUE', progress: 78, verifiedValue: 2480000, fundingTarget: 610000, fundingProgress: 83, signal: '+6.3%', status: 'OPEN', completionState: 'ELIGIBLE', projectedCompletedValue: 2677000, projectedGain: 197000, projectedGainRate: 7.9, participationWindow: '5–9 months', trueBill: { id: 'TB-0033', state: 'PLEDGED', purpose: 'COMPLETION_CAPACITY', value: 505000 } }
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

await persistentDomain.seed(RECORD_TYPES.ASSET_ACCOUNT, marketplaceSeed.assets);
await persistentDomain.seed(RECORD_TYPES.PROJECT_ACCOUNT, marketplaceSeed.projects);
const marketplace = new PersistentMarketplaceService(persistentDomain, marketplaceSeed);

const creativeFinanceService = new CreativeFinanceService(marketplace, persistentDomain);
await creativeFinanceService.initialize();
const valueIntelligenceService = new ValueIntelligenceService(marketplace, persistentDomain);
await valueIntelligenceService.initialize();
const edxConnectionService = new EdxConnectionService(persistentDomain);
const edxPermissionService = new EdxPermissionService(persistentDomain);
const edxExtractionService = new EdxExtractionService(persistentDomain, edxPermissionService);
const onboardingRouter = await createOnboardingRouter(domainStore, database, persistentDomain);

app.use('/api/access', createAccessRouter(marketplace, accessService));
app.use('/api/participation', createParticipationRouter(marketplace, accessService, persistentDomain));
app.use('/api/onboarding', onboardingRouter);
app.use('/api/custody', createCustodyRouter());
app.use('/api/sane', createSaneRouter());
app.use('/api/creative-finance', createCreativeFinanceRouter(creativeFinanceService));
app.use('/api/value-intelligence', createValueIntelligenceRouter(valueIntelligenceService));
app.use('/api/edx', createEdxConnectionRouter(edxConnectionService));
app.use('/api/edx', createEdxPermissionRouter(edxPermissionService));
app.use('/api/edx', createEdxExtractionRouter(edxExtractionService));

app.get('/api/health', async (_req, res) => {
  try {
    const persistence = await database.health();
    res.json({
      status: 'ok', service: 'SAIN Real Asset Market', version: '1.11.0',
      phase: 'EDX_PHASE_4_EXTRACTION_ENGINE', persistence,
      persistentDomain: persistentDomain.snapshot(),
      marketplaceReadSource: 'PERSISTENT_DOMAIN',
      persistentIdentity: 'ACTIVE', persistentSessions: 'ACTIVE',
      persistentCapabilityRecords: 'ACTIVE', persistentDocumentMetadata: 'ACTIVE',
      persistentOnboardingApplications: 'ACTIVE', persistentEvidencePackages: 'ACTIVE',
      persistentInstitutionalReviews: 'ACTIVE', persistentV4VPackages: 'ACTIVE',
      persistentAssetAccounts: 'ACTIVE', persistentProjects: 'ACTIVE',
      persistentParticipationPositions: 'ACTIVE', persistentTransferablePositions: 'ACTIVE',
      persistentCreativeFinanceStructures: 'ACTIVE', persistentValueIntelligence: 'ACTIVE',
      edxConnectorRegistry: 'ACTIVE', edxEnterpriseConnections: 'ACTIVE', edxPermissionEngine: 'ACTIVE',
      edxExtractionEngine: 'ACTIVE',
      lifecycleEventLedger: 'ACTIVE', auditLedger: 'ACTIVE',
      durableFileStorage: process.env.SRA_PRIVATE_DOCUMENT_ROOT ? 'CONFIGURED_PATH' : 'TEMPORARY_PATH',
      saneAgent: 'ACTIVE', creativeFinanceSkill: 'ACTIVE', marketplaceParticipation: 'ACTIVE',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({ status: 'degraded', service: 'SAIN Real Asset Market', version: '1.11.0', persistence: { ready: false, error: error.message }, timestamp: new Date().toISOString() });
  }
});
app.get('/api/marketplace', (_req, res) => res.json(marketplace.snapshot()));
app.get('/api/domain', (_req, res) => res.json({ persistent: persistentDomain.snapshot() }));
app.get('/api/assets/:assetId/studio', (req, res) => {
  const asset = persistentDomain.get(RECORD_TYPES.ASSET_ACCOUNT, req.params.assetId);
  if (!asset) return res.status(404).json({ error: 'Asset Account not found.' });
  const studio = {
    asset,
    onboardingApplication: asset.metadata?.onboardingApplicationId ? persistentDomain.get(RECORD_TYPES.ONBOARDING_APPLICATION, asset.metadata.onboardingApplicationId) : null,
    evidencePackage: asset.metadata?.evidencePackageId ? persistentDomain.get(RECORD_TYPES.EVIDENCE_PACKAGE, asset.metadata.evidencePackageId) : null,
    institutionalReview: asset.metadata?.institutionalReviewId ? persistentDomain.get(RECORD_TYPES.INSTITUTIONAL_REVIEW, asset.metadata.institutionalReviewId) : null,
    verifiedValuePackages: persistentDomain.list(RECORD_TYPES.V4V_PACKAGE).filter((item) => item.assetId === asset.id || item.assetId === asset.assetId),
    projects: persistentDomain.list(RECORD_TYPES.PROJECT_ACCOUNT).filter((item) => item.assetId === asset.id || item.assetId === asset.assetId),
    marketSignals: persistentDomain.list(RECORD_TYPES.MARKET_SIGNAL).filter((item) => item.assetId === asset.id || item.assetId === asset.assetId),
    verifiedMarketEvents: persistentDomain.list(RECORD_TYPES.VERIFIED_MARKET_EVENT).filter((item) => item.assetId === asset.id || item.assetId === asset.assetId),
    lifecycleEvents: persistentDomain.list(RECORD_TYPES.LIFECYCLE_EVENT).filter((item) => item.objectId === asset.id || item.objectId === asset.assetId)
  };
  return res.json(studio);
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(port, '0.0.0.0', () => console.log(`SRA EDX Phase 4 Extraction Engine is running on port ${port}`));
