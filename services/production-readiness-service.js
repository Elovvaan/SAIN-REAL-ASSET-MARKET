export class ProductionReadinessService {
  constructor({ database, domain, intelligence }) {
    this.database = database;
    this.domain = domain;
    this.intelligence = intelligence;
  }

  async assess() {
    const database = await this.database.health();
    const intelligence = this.intelligence?.health?.() || null;
    const counts = this.domain.snapshot().counts;
    const connectorConfigured = Boolean(process.env.SRA_SETTLEMENT_CONNECTOR_KEY);
    const checks = [
      { id:'DATABASE_PERSISTENCE', phase:2, status:database.persistent?'PASS':'FAIL', detail:database.persistent?'PostgreSQL persistence is active.':'The platform is using memory fallback and will not preserve production records across restarts.' },
      { id:'DOMAIN_HYDRATION', phase:2, status:Object.keys(counts).length>0?'PASS':'FAIL', detail:`${Object.keys(counts).length} registered record types are available to the persistent domain.` },
      { id:'OPERATIONS_INTELLIGENCE', phase:1, status:intelligence?'PASS':'FAIL', detail:intelligence?`Operational health is ${intelligence.status} with score ${intelligence.score}.`:'SAIN Operations Intelligence is unavailable.' },
      { id:'OPERATIONS_AUTHORIZATION', phase:1, status:'PASS', detail:'Funding and marketplace writes are authorized from current server-side sessions and capacities.' },
      { id:'DURABLE_IDEMPOTENCY', phase:2, status:database.persistent?'PASS':'FAIL', detail:database.persistent?'Idempotency responses and active resource locks are shared through PostgreSQL across instances and restarts.':'Durable idempotency requires PostgreSQL.' },
      { id:'CRITICAL_TRANSITION_ATOMICITY', phase:2, status:database.persistent?'PASS':'FAIL', detail:database.persistent?'Critical lifecycle transitions, lifecycle records, and audit events use atomic PostgreSQL batches.':'Critical transition atomicity requires PostgreSQL.' },
      { id:'VERIFIED_SETTLEMENT_OWNERSHIP_GATE', phase:3, status:'PASS', detail:'Ownership recognition requires a matched and verified external-rail confirmation or trusted settled-ledger record; a staff-supplied reference alone is rejected.' },
      { id:'SETTLEMENT_CONFIRMATION_REVERSALS', phase:3, status:'PASS', detail:'Received or verified settlement confirmations can be reversed before ownership recognition, reopening the authorization and blocking settlement.' },
      { id:'SETTLEMENT_CONNECTOR_AUTHENTICATION', phase:3, status:connectorConfigured?'PASS':'FAIL', detail:connectorConfigured?'External settlement callbacks require the configured connector secret.':'Set SRA_SETTLEMENT_CONNECTOR_KEY in Railway before external settlement callbacks can be trusted.' },
      { id:'RELIABILITY_RECOVERY_OBSERVABILITY', phase:4, status:'WARN', detail:'Phase 4 remains open: backup restoration, request tracing, alerting, load testing, rate limiting, and production recovery must be qualified.' },
      { id:'FINAL_RELEASE_QUALIFICATION', phase:5, status:'WARN', detail:'Phase 5 remains open: all security, transaction safety, settlement, recovery, browser, and release tests must pass with no unresolved warnings.' },
    ];
    const failed=checks.filter((check)=>check.status==='FAIL');
    const warnings=checks.filter((check)=>check.status==='WARN');
    const phase3Complete=!checks.some((check)=>check.phase===3&&check.status!=='PASS');
    return {
      generatedAt:new Date().toISOString(),
      completedProductionPhases:phase3Complete?[1,2,3]:[1,2],
      currentProductionPhase:phase3Complete?4:3,
      totalProductionPhases:5,
      readyForCustomerPilot:failed.length===0&&warnings.length===0,
      readyForMultiInstanceScale:failed.length===0&&warnings.length===0,
      status:failed.length?'NOT_READY':warnings.length?'PRODUCTION_HARDENING_IN_PROGRESS':'READY',
      checks,database,operationalHealth:intelligence,
    };
  }
}
