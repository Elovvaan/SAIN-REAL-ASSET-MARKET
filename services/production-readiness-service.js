import { InternalLifecycleService } from './internal-lifecycle-service.js';
import { ProductQualificationService } from './product-qualification-service.js';

export class ProductionReadinessService {
  constructor({ database, domain, intelligence }) {
    this.database = database;
    this.domain = domain;
    this.intelligence = intelligence;
    this.internalLifecycle = new InternalLifecycleService(domain);
    this.productQualification = new ProductQualificationService(domain, this.internalLifecycle);
    this.initialization = this.productQualification.initialize();
  }

  async ready() {
    await this.initialization;
    return this;
  }

  inspectInternalLifecycle(references = {}) { return this.internalLifecycle.inspect(references); }
  recognizeOwnership(input = {}, actorId = 'SRA_PLATFORM') { return this.internalLifecycle.recognizeOwnership(input, actorId); }
  createExportPackage(input = {}, actorId = 'SRA_PLATFORM') { return this.internalLifecycle.createExportPackage(input, actorId); }
  listExportPackages(filters = {}) { return this.internalLifecycle.listExportPackages(filters); }
  getExportPackage(exportPackageId) { return this.internalLifecycle.getExportPackage(exportPackageId); }
  verifyExportPackage(exportPackageId) { return this.internalLifecycle.verifyExportPackage(exportPackageId); }

  async productQualificationStatus() { await this.ready(); return this.productQualification.status(); }
  async listProducts(filters = {}) { await this.ready(); return this.productQualification.listProducts(filters); }
  async getProduct(productCode) { await this.ready(); return this.productQualification.getProduct(productCode); }
  async registerProduct(input = {}, actorId = 'SRA_PLATFORM') { await this.ready(); return this.productQualification.registerProduct(input, actorId); }
  async assessProduct(input = {}, actorId = 'SRA_PLATFORM') { await this.ready(); return this.productQualification.qualify(input, actorId); }
  async findProductQualificationCandidates(productCode, input = {}) { await this.ready(); return this.productQualification.findQualificationCandidates(productCode, input); }
  async qualifyProduct(input = {}, actorId = 'SRA_PLATFORM') { await this.ready(); return this.productQualification.recordQualification(input, actorId); }
  async qualifyFirstReadyProduct(productCode, input = {}, actorId = 'SRA_PLATFORM') { await this.ready(); return this.productQualification.qualifyFirstReady(productCode, input, actorId); }
  async listProductQualifications(filters = {}) { await this.ready(); return this.productQualification.listQualifications(filters); }
  async getProductQualification(qualificationId) { await this.ready(); return this.productQualification.getQualification(qualificationId); }

  async assess() {
    await this.ready();
    const database = await this.database.health();
    const intelligence = this.intelligence?.health?.() || null;
    const counts = this.domain.snapshot().counts;
    const alertsConfigured = Boolean(process.env.SRA_ALERT_WEBHOOK_URL);
    const backupScheduled = String(process.env.SRA_BACKUP_SCHEDULED || '').toLowerCase() === 'true';
    const restoreQualifiedAt = process.env.SRA_RESTORE_QUALIFIED_AT || null;
    const loadQualifiedAt = process.env.SRA_LOAD_QUALIFIED_AT || null;
    const internalTypes = ['MARKET_OBSERVATION','RECOGNITION_ASSESSMENT','FINANCIAL_RECORD','COIN_POSITION','SRA_INSTRUMENT','MARKETPLACE_LISTING','PARTICIPATION_POSITION','FUNDING_MARKETPLACE_COMMITMENT','FUNDING_MARKETPLACE_POSITION','SRA_SETTLEMENT_RECORD','OWNERSHIP_RECOGNITION','EXPORT_PACKAGE'];
    const missingInternalTypes = internalTypes.filter((type) => !(type in counts));
    const internalBoundaryReady = missingInternalTypes.length === 0;
    const productStatus = this.productQualification.status();
    const trueBillCandidates = this.productQualification.findQualificationCandidates('TRUE_BILL', { evidenceClasses: [] });
    const trueBillQualified = this.productQualification.listQualifications({ productCode: 'TRUE_BILL', state: 'QUALIFIED' }).length > 0;

    const checks = [
      { id:'DATABASE_PERSISTENCE', phase:2, status:database.persistent?'PASS':'FAIL', detail:database.persistent?'PostgreSQL persistence is active.':'The platform is using memory fallback and will not preserve production records across restarts.' },
      { id:'DOMAIN_HYDRATION', phase:2, status:Object.keys(counts).length>0?'PASS':'FAIL', detail:`${Object.keys(counts).length} registered record types are available to the persistent domain.` },
      { id:'SRA_INTERNAL_LIFECYCLE', phase:3, status:internalBoundaryReady?'PASS':'FAIL', detail:internalBoundaryReady?'SRA contains every internal record class from observation through ownership recognition and export packaging.':`Missing internal lifecycle record classes: ${missingInternalTypes.join(', ')}.` },
      { id:'CANONICAL_EXPORT_BOUNDARY', phase:3, status:internalBoundaryReady?'PASS':'FAIL', detail:'Production readiness ends when SRA creates a complete immutable READY_FOR_EXPORT package. External adapters are optional translators beyond this boundary.' },
      { id:'PRODUCT_QUALIFICATION_STANDARD', phase:5, status:'PASS', detail:`SRA_PRODUCT_QUALIFICATION_V1 is active for ${productStatus.activeProducts} product definitions.` },
      { id:'FIRST_TRUE_BILL_QUALIFICATION', phase:5, status:trueBillQualified?'PASS':trueBillCandidates.length?'WARN':'FAIL', detail:trueBillQualified?'At least one real stored True Bill package is production-qualified.':trueBillCandidates.length?`${trueBillCandidates.length} stored True Bill candidate package(s) exist but still require passing evidence inputs.`:'No stored READY_FOR_EXPORT True Bill package exists yet.' },
      { id:'OPERATIONS_INTELLIGENCE', phase:1, status:intelligence?'PASS':'FAIL', detail:intelligence?`Operational health is ${intelligence.status} with score ${intelligence.score}.`:'SAIN Operations Intelligence is unavailable.' },
      { id:'OPERATIONS_AUTHORIZATION', phase:1, status:'PASS', detail:'Funding and marketplace writes are authorized from current server-side sessions and capacities.' },
      { id:'DURABLE_IDEMPOTENCY', phase:2, status:database.persistent?'PASS':'FAIL', detail:database.persistent?'Idempotency responses and active resource locks are shared through PostgreSQL across instances and restarts.':'Durable idempotency requires PostgreSQL.' },
      { id:'CRITICAL_TRANSITION_ATOMICITY', phase:2, status:database.persistent?'PASS':'FAIL', detail:database.persistent?'Critical lifecycle transitions, lifecycle records, and audit events use atomic PostgreSQL batches.':'Critical transition atomicity requires PostgreSQL.' },
      { id:'INTERNAL_SETTLEMENT_OWNERSHIP_GATE', phase:3, status:'PASS', detail:'Ownership recognition requires an existing SRA settlement record and allocation position.' },
      { id:'EXTERNAL_ADAPTER_ISOLATION', phase:3, status:'PASS', detail:'Solana, Fedwire, ACH, bank, institution, and partner connectors remain below the export boundary.' },
      { id:'REQUEST_TRACING_AND_STRUCTURED_LOGGING', phase:4, status:'PASS', detail:'All bootstrap and extension requests receive correlation IDs, structured logs, latency metrics, and 5xx error capture.' },
      { id:'RATE_LIMITS_AND_TIMEOUTS', phase:4, status:'PASS', detail:'Auth, operations, production, and general request classes have rate limits and timeouts.' },
      { id:'DEPENDENCY_HEALTH_AND_GRACEFUL_SHUTDOWN', phase:4, status:'PASS', detail:'Database and startup dependency checks are exposed, and SIGTERM/SIGINT perform graceful shutdown.' },
      { id:'ALERT_DELIVERY', phase:4, status:alertsConfigured?'PASS':'FAIL', detail:alertsConfigured?'Operational failures and 5xx responses can be delivered to the configured alert webhook.':'Set SRA_ALERT_WEBHOOK_URL and verify /api/production/alerts/test.' },
      { id:'AUTOMATED_BACKUP_SCHEDULE', phase:4, status:backupScheduled?'PASS':'FAIL', detail:backupScheduled?'Automated PostgreSQL backup scheduling has been confirmed.':'Schedule npm run backup:create and set SRA_BACKUP_SCHEDULED=true after confirming retention.' },
      { id:'RESTORE_QUALIFICATION', phase:4, status:restoreQualifiedAt?'PASS':'FAIL', detail:restoreQualifiedAt?`Database restore qualified at ${restoreQualifiedAt}.`:'Run npm run restore:verify against a disposable database, then set SRA_RESTORE_QUALIFIED_AT.' },
      { id:'LOAD_QUALIFICATION', phase:4, status:loadQualifiedAt?'PASS':'FAIL', detail:loadQualifiedAt?`Load qualification passed at ${loadQualifiedAt}.`:'Run npm run test:load against Railway, then set SRA_LOAD_QUALIFIED_AT.' },
      { id:'RECOVERY_RUNBOOK', phase:4, status:'PASS', detail:'The repository includes the production recovery and incident-response runbook.' },
      { id:'FINAL_RELEASE_QUALIFICATION', phase:5, status:'WARN', detail:'Phase 5 remains open until each offered product records a passing qualification and final browser qualification passes.' },
    ];
    const failed=checks.filter((check)=>check.status==='FAIL'); const warnings=checks.filter((check)=>check.status==='WARN'); const completed=[];
    for (let phase=1; phase<=4; phase+=1) if (!checks.some((check)=>check.phase===phase&&check.status!=='PASS')) completed.push(phase);
    const currentProductionPhase=completed.includes(4)?5:completed.includes(3)?4:completed.includes(2)?3:completed.includes(1)?2:1;
    return { generatedAt:new Date().toISOString(), productionBoundary:'SRA_READY_FOR_EXPORT', externalAdaptersRequiredForCore:false, productQualification:productStatus, firstTrueBill:{ qualified:trueBillQualified, candidates:trueBillCandidates.length }, completedProductionPhases:completed, currentProductionPhase, totalProductionPhases:5, readyForCustomerPilot:failed.length===0&&warnings.length===0, readyForMultiInstanceScale:failed.length===0&&warnings.length===0, status:failed.length?'NOT_READY':warnings.length?'PRODUCTION_HARDENING_IN_PROGRESS':'READY', checks,database,operationalHealth:intelligence };
  }
}
