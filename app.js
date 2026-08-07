import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSeededDomainStore } from './services/domain-store.js';
import { createOnboardingRouter } from './routes/onboarding-router.js';
import { createCustodyRouter } from './routes/custody-router.js';
import { createAccessRouter } from './routes/access-router.js';
import { createParticipationRouter } from './routes/participation-router.js';
import { createInstitutionParticipationRouter } from './routes/institution-participation-router.js';
import { createSettlementRailGatewayRouter } from './routes/settlement-rail-gateway-router.js';
import { createTreasuryBankConnectorRouter } from './routes/treasury-bank-connector-router.js';
import { createPlatformEconomicsRouter } from './routes/platform-economics-router.js';
import { createPlatformLedgerRouter } from './routes/platform-ledger-router.js';
import { createInstitutionalBillingRouter } from './routes/institutional-billing-router.js';
import { createAssetServicingRouter } from './routes/asset-servicing-router.js';
import { createPlatformTreasuryRouter } from './routes/platform-treasury-router.js';
import { createFinancialStatementsRouter } from './routes/financial-statements-router.js';
import { createSaneRouter } from './routes/sane-router.js';
import { createCreativeFinanceRouter } from './routes/creative-finance-router.js';
import { createValueIntelligenceRouter } from './routes/value-intelligence-router.js';
import { createEdxConnectionRouter } from './routes/edx-connection-router.js';
import { createEdxPermissionRouter } from './routes/edx-permission-router.js';
import { createEdxExtractionRouter } from './routes/edx-extraction-router.js';
import { createEdxNormalizationRouter } from './routes/edx-normalization-router.js';
import { createEdxSnapshotRouter } from './routes/edx-snapshot-router.js';
import { createEdxValuePackageRouter } from './routes/edx-value-package-router.js';
import { createEdxMarketplacePublisherRouter } from './routes/edx-marketplace-publisher-router.js';
import { createEdxDashboardIntelligenceRouter } from './routes/edx-dashboard-intelligence-router.js';
import { createEdxEnterpriseSdkRouter } from './routes/edx-enterprise-sdk-router.js';
import { createHomeFinancingRouter } from './routes/home-financing-router.js';
import { createSraSettlementRouter } from './routes/sra-settlement-router.js';
import { createObservationLayerRouter } from './routes/observation-layer-router.js';
import { createFinancialRecordRouter } from './routes/financial-record-router.js';
import { createFinancialHistoryRouter } from './routes/financial-history-router.js';
import { createAssetRelationshipRouter } from './routes/asset-relationship-router.js';
import { AccessService } from './services/access-service.js';
import { CreativeFinanceService } from './services/creative-finance-service.js';
import { ValueIntelligenceService } from './services/value-intelligence-service.js';
import { EdxConnectionService } from './services/edx-connection-service.js';
import { EdxPermissionService } from './services/edx-permission-service.js';
import { EdxExtractionService } from './services/edx-extraction-service.js';
import { EdxNormalizationService } from './services/edx-normalization-service.js';
import { EdxSnapshotService } from './services/edx-snapshot-service.js';
import { EdxValuePackageService } from './services/edx-value-package-service.js';
import { EdxMarketplacePublisherService } from './services/edx-marketplace-publisher-service.js';
import { EdxDashboardIntelligenceService } from './services/edx-dashboard-intelligence-service.js';
import { EdxEnterpriseSdkService } from './services/edx-enterprise-sdk-service.js';
import { SaneEdxOperationsService } from './services/sane-edx-operations-service.js';
import { SraAgentService } from './services/sra-agent-service.js';
import { HomeFinancingService } from './services/home-financing-service.js';
import { SraSettlementService } from './services/sra-settlement-service.js';
import { InstitutionParticipationService } from './services/institution-participation-service.js';
import { SettlementRailGatewayService } from './services/settlement-rail-gateway-service.js';
import { TreasuryBankConnectorService } from './services/treasury-bank-connector-service.js';
import { PlatformEconomicsService } from './services/platform-economics-service.js';
import { PlatformLedgerService } from './services/platform-ledger-service.js';
import { InstitutionalBillingService } from './services/institutional-billing-service.js';
import { AssetServicingService } from './services/asset-servicing-service.js';
import { PlatformTreasuryService } from './services/platform-treasury-service.js';
import { FinancialStatementsService } from './services/financial-statements-service.js';
import { ObservationLayerService } from './services/observation-layer-service.js';
import { FinancialRecordService } from './services/financial-record-service.js';
import { FinancialHistoryService } from './services/financial-history-service.js';
import { AssetRelationshipLedgerService } from './services/asset-relationship-ledger-service.js';
import { DatabaseService } from './services/database-service.js';
import { PersistentDomainService, RECORD_TYPES } from './services/persistent-domain-service.js';
import { PersistentMarketplaceService } from './services/persistent-marketplace-service.js';
import { installAuthoritativeAssetRegistry } from './app-authoritative-registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  ], completionWatch: [], activity: []
};

const ledgerSeed = [
  { accountId: 'GL-CASH-OPERATING', code: '1000-CASH', name: 'Operating Cash', type: 'ASSET', normalBalance: 'DEBIT', currency: 'USD', state: 'ACTIVE' },
  { accountId: 'GL-AR', code: '1100-AR', name: 'Accounts Receivable', type: 'ASSET', normalBalance: 'DEBIT', currency: 'USD', state: 'ACTIVE' },
  { accountId: 'GL-AP', code: '2000-AP', name: 'Accounts Payable', type: 'LIABILITY', normalBalance: 'CREDIT', currency: 'USD', state: 'ACTIVE' },
  { accountId: 'GL-CONTRIBUTED-CAPITAL', code: '3000-CONTRIBUTED-CAPITAL', name: 'Contributed Capital', type: 'EQUITY', normalBalance: 'CREDIT', currency: 'USD', state: 'ACTIVE' },
  { accountId: 'GL-RETAINED-EARNINGS', code: '3100-RETAINED-EARNINGS', name: 'Retained Earnings', type: 'EQUITY', normalBalance: 'CREDIT', currency: 'USD', state: 'ACTIVE' },
  { accountId: 'GL-FEE-REVENUE', code: '4100-FEE-REVENUE', name: 'Platform Fee Revenue', type: 'REVENUE', normalBalance: 'CREDIT', currency: 'USD', state: 'ACTIVE' },
  { accountId: 'GL-FEE-WAIVERS', code: '4190-FEE-WAIVERS', name: 'Fee Waivers and Concessions', type: 'CONTRA_REVENUE', normalBalance: 'DEBIT', currency: 'USD', state: 'ACTIVE' },
  { accountId: 'GL-OPERATING-EXPENSE', code: '5100-OPERATING-EXPENSE', name: 'Operating Expense', type: 'EXPENSE', normalBalance: 'DEBIT', currency: 'USD', state: 'ACTIVE' }
];

export async function createApp(options = {}) {
  const app = express();
  const database = options.database || new DatabaseService({ connectionString: options.connectionString });
  await database.initialize();
  const persistentDomain = new PersistentDomainService(database);
  await persistentDomain.hydrate();
  const domainStore = options.domainStore || createSeededDomainStore();
  const accessService = new AccessService({ database });
  await accessService.initialize();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.get('/brand-logo', (_req, res) => res.sendFile(path.join(__dirname, 'SRA LOGO.jpg')));
  if (options.serveStatic !== false) app.use(express.static(path.join(__dirname, 'public')));
  if (options.seedMarketplace !== false) {
    await persistentDomain.seed(RECORD_TYPES.ASSET_ACCOUNT, marketplaceSeed.assets);
    await persistentDomain.seed(RECORD_TYPES.PROJECT_ACCOUNT, marketplaceSeed.projects);
  }
  await persistentDomain.seed(RECORD_TYPES.LEDGER_ACCOUNT, ledgerSeed);
  const marketplace = new PersistentMarketplaceService(persistentDomain, marketplaceSeed);
  const creativeFinanceService = new CreativeFinanceService(marketplace, persistentDomain); await creativeFinanceService.initialize();
  const valueIntelligenceService = new ValueIntelligenceService(marketplace, persistentDomain); await valueIntelligenceService.initialize();
  const observationLayerService = new ObservationLayerService(persistentDomain);
  const financialRecordService = new FinancialRecordService(persistentDomain);
  const financialHistoryService = new FinancialHistoryService(persistentDomain);
  const assetRelationshipLedgerService = new AssetRelationshipLedgerService(persistentDomain);
  const edxConnectionService = new EdxConnectionService(persistentDomain);
  const edxPermissionService = new EdxPermissionService(persistentDomain);
  const edxExtractionService = new EdxExtractionService(persistentDomain, edxPermissionService);
  const edxNormalizationService = new EdxNormalizationService(persistentDomain);
  const edxSnapshotService = new EdxSnapshotService(persistentDomain);
  const edxValuePackageService = new EdxValuePackageService(persistentDomain);
  const edxMarketplacePublisherService = new EdxMarketplacePublisherService(persistentDomain, edxValuePackageService);
  const edxDashboardIntelligenceService = new EdxDashboardIntelligenceService(persistentDomain);
  const edxEnterpriseSdkService = new EdxEnterpriseSdkService(persistentDomain);
  const saneEdxOperationsService = new SaneEdxOperationsService(persistentDomain, edxMarketplacePublisherService);
  const homeFinancingService = new HomeFinancingService(persistentDomain);
  const sraSettlementService = new SraSettlementService(persistentDomain, homeFinancingService);
  const institutionParticipationService = new InstitutionParticipationService(persistentDomain, homeFinancingService, sraSettlementService);
  const settlementRailGatewayService = new SettlementRailGatewayService(persistentDomain, sraSettlementService, institutionParticipationService);
  const treasuryBankConnectorService = new TreasuryBankConnectorService(persistentDomain, settlementRailGatewayService);
  const platformLedgerService = new PlatformLedgerService(persistentDomain);
  const platformEconomicsService = new PlatformEconomicsService(persistentDomain, platformLedgerService);
  const institutionalBillingService = new InstitutionalBillingService(persistentDomain, platformEconomicsService);
  const assetServicingService = new AssetServicingService(persistentDomain);
  const platformTreasuryService = new PlatformTreasuryService(persistentDomain, platformLedgerService);
  const financialStatementsService = new FinancialStatementsService(persistentDomain, platformLedgerService);
  const sraAgentService = new SraAgentService({
    persistentDomain,
    marketplace,
    ledgerService: platformLedgerService,
    treasuryService: platformTreasuryService,
    financialStatementsService,
    assetServicingService,
    institutionBillingService: institutionalBillingService,
    economicsService: platformEconomicsService,
    homeFinancingService,
    settlementService: sraSettlementService
  });
  const onboardingRouter = await createOnboardingRouter(domainStore, database, persistentDomain);
  const authoritativeAssetRegistryService = installAuthoritativeAssetRegistry(app, { persistentDomain, accessService });

  app.use('/api/access', createAccessRouter(marketplace, accessService));
  app.use('/api/participation', createParticipationRouter(marketplace, accessService, persistentDomain));
  app.use('/api/institutions', createInstitutionParticipationRouter(institutionParticipationService, accessService));
  app.use('/api/settlement-rails', createSettlementRailGatewayRouter(settlementRailGatewayService));
  app.use('/api/treasury', createTreasuryBankConnectorRouter(treasuryBankConnectorService));
  app.use('/api/economics', createPlatformEconomicsRouter(platformEconomicsService));
  app.use('/api/ledger', createPlatformLedgerRouter(platformLedgerService));
  app.use('/api/institution-billing', createInstitutionalBillingRouter(institutionalBillingService));
  app.use('/api/servicing', createAssetServicingRouter(assetServicingService));
  app.use('/api/platform-treasury', createPlatformTreasuryRouter(platformTreasuryService));
  app.use('/api/financial-statements', createFinancialStatementsRouter(financialStatementsService));
  app.use('/api/observations', createObservationLayerRouter(observationLayerService));
  app.use('/api/financial-records', createFinancialRecordRouter(financialRecordService));
  app.use('/api/financial-history', createFinancialHistoryRouter(financialHistoryService, accessService));
  app.use('/api/asset-relationships', createAssetRelationshipRouter(assetRelationshipLedgerService, accessService));
  app.use('/api/onboarding', onboardingRouter);
  app.use('/api/custody', createCustodyRouter());
  app.use('/api/sane', createSaneRouter(undefined, saneEdxOperationsService, sraAgentService));
  app.use('/api/creative-finance', createCreativeFinanceRouter(creativeFinanceService));
  app.use('/api/value-intelligence', createValueIntelligenceRouter(valueIntelligenceService));
  app.use('/api/edx/connections', createEdxConnectionRouter(edxConnectionService));
  app.use('/api/edx/permissions', createEdxPermissionRouter(edxPermissionService));
  app.use('/api/edx/extractions', createEdxExtractionRouter(edxExtractionService));
  app.use('/api/edx/extraction', createEdxExtractionRouter(edxExtractionService));
  app.use('/api/edx/normalization', createEdxNormalizationRouter(edxNormalizationService));
  app.use('/api/edx/snapshots', createEdxSnapshotRouter(edxSnapshotService));
  app.use('/api/edx/value-packages', createEdxValuePackageRouter(edxValuePackageService));
  app.use('/api/edx/marketplace', createEdxMarketplacePublisherRouter(edxMarketplacePublisherService));
  app.use('/api/edx/dashboard', createEdxDashboardIntelligenceRouter(edxDashboardIntelligenceService));
  app.use('/api/edx/sdk', createEdxEnterpriseSdkRouter(edxEnterpriseSdkService));
  app.use('/api/home-financing', createHomeFinancingRouter(homeFinancingService));
  app.use('/api/sra-settlement', createSraSettlementRouter(sraSettlementService));

  return {
    app,
    database,
    persistentDomain,
    marketplace,
    accessService,
    observationLayerService,
    financialRecordService,
    financialHistoryService,
    assetRelationshipLedgerService,
    authoritativeAssetRegistryService,
    sraAgentService,
  };
}
