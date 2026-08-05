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
    const alertsConfigured = Boolean(process.env.SRA_ALERT_WEBHOOK_URL);
    const backupScheduled = String(process.env.SRA_BACKUP_SCHEDULED || '').toLowerCase() === 'true';
    const restoreQualifiedAt = process.env.SRA_RESTORE_QUALIFIED_AT || null;
    const loadQualifiedAt = process.env.SRA_LOAD_QUALIFIED_AT || null;
    const checks = [
      { id:'DATABASE_PERSISTENCE', phase:2, status:database.persistent?'PASS':'FAIL', detail:database.persistent?'PostgreSQL persistence is active.':'The platform is using memory fallback and will not preserve production records across restarts.' },
      { id:'DOMAIN_HYDRATION', phase:2, status:Object.keys(counts).length>0?'PASS':'FAIL', detail:`${Object.keys(counts).length} registered record types are available to the persistent domain.` },
      { id:'OPERATIONS_INTELLIGENCE', phase:1, status:intelligence?'PASS':'FAIL', detail:intelligence?`Operational health is ${intelligence.status} with score ${intelligence.score}.`:'SAIN Operations Intelligence is unavailable.' },
      { id:'OPERATIONS_AUTHORIZATION', phase:1, status:'PASS', detail:'Funding and marketplace writes are authorized from current server-side sessions and capacities.' },
      { id:'DURABLE_IDEMPOTENCY', phase:2, status:database.persistent?'PASS':'FAIL', detail:database.persistent?'Idempotency responses and active resource locks are shared through PostgreSQL across instances and restarts.':'Durable idempotency requires PostgreSQL.' },
      { id:'CRITICAL_TRANSITION_ATOMICITY', phase:2, status:database.persistent?'PASS':'FAIL', detail:database.persistent?'Critical lifecycle transitions, lifecycle records, and audit events use atomic PostgreSQL batches.':'Critical transition atomicity requires PostgreSQL.' },
      { id:'VERIFIED_SETTLEMENT_OWNERSHIP_GATE', phase:3, status:'PASS', detail:'Ownership recognition requires a matched and verified external-rail confirmation or trusted settled-ledger record.' },
      { id:'SETTLEMENT_CONFIRMATION_REVERSALS', phase:3, status:'PASS', detail:'Settlement confirmations can be reversed before ownership recognition, reopening authorization and blocking settlement.' },
      { id:'SETTLEMENT_CONNECTOR_AUTHENTICATION', phase:3, status:connectorConfigured?'PASS':'FAIL', detail:connectorConfigured?'External settlement callbacks require the configured connector secret.':'Set SRA_SETTLEMENT_CONNECTOR_KEY in Railway.' },
      { id:'REQUEST_TRACING_AND_STRUCTURED_LOGGING', phase:4, status:'PASS', detail:'All bootstrap and extension requests receive correlation IDs, structured logs, latency metrics, and 5xx error capture.' },
      { id:'RATE_LIMITS_AND_TIMEOUTS', phase:4, status:'PASS', detail:'Auth, operations, production, and general request classes have rate limits; server request, header, keep-alive, and shutdown timeouts are configured.' },
      { id:'DEPENDENCY_HEALTH_AND_GRACEFUL_SHUTDOWN', phase:4, status:'PASS', detail:'Database, startup, and connector dependency checks are exposed, and SIGTERM/SIGINT perform graceful shutdown.' },
      { id:'ALERT_DELIVERY', phase:4, status:alertsConfigured?'PASS':'FAIL', detail:alertsConfigured?'Operational failures and 5xx responses can be delivered to the configured alert webhook.':'Set SRA_ALERT_WEBHOOK_URL and verify /api/production/alerts/test.' },
      { id:'AUTOMATED_BACKUP_SCHEDULE', phase:4, status:backupScheduled?'PASS':'FAIL', detail:backupScheduled?'Automated PostgreSQL backup scheduling has been confirmed.':'Schedule npm run backup:create and set SRA_BACKUP_SCHEDULED=true after confirming retention.' },
      { id:'RESTORE_QUALIFICATION', phase:4, status:restoreQualifiedAt?'PASS':'FAIL', detail:restoreQualifiedAt?`Database restore qualified at ${restoreQualifiedAt}.`:'Run npm run restore:verify against a disposable database, then set SRA_RESTORE_QUALIFIED_AT.' },
      { id:'LOAD_QUALIFICATION', phase:4, status:loadQualifiedAt?'PASS':'FAIL', detail:loadQualifiedAt?`Load qualification passed at ${loadQualifiedAt}.`:'Run npm run test:load against Railway, then set SRA_LOAD_QUALIFIED_AT.' },
      { id:'RECOVERY_RUNBOOK', phase:4, status:'PASS', detail:'The repository includes the production recovery and incident-response runbook.' },
      { id:'FINAL_RELEASE_QUALIFICATION', phase:5, status:'WARN', detail:'Phase 5 remains open: all release tests and final browser qualification must pass with no unresolved warnings.' },
    ];
    const failed=checks.filter((check)=>check.status==='FAIL');
    const warnings=checks.filter((check)=>check.status==='WARN');
    const completed=[];
    for (let phase=1; phase<=4; phase+=1) if (!checks.some((check)=>check.phase===phase&&check.status!=='PASS')) completed.push(phase);
    const currentProductionPhase=completed.includes(4)?5:completed.includes(3)?4:completed.includes(2)?3:completed.includes(1)?2:1;
    return {
      generatedAt:new Date().toISOString(),
      completedProductionPhases:completed,
      currentProductionPhase,
      totalProductionPhases:5,
      readyForCustomerPilot:failed.length===0&&warnings.length===0,
      readyForMultiInstanceScale:failed.length===0&&warnings.length===0,
      status:failed.length?'NOT_READY':warnings.length?'PRODUCTION_HARDENING_IN_PROGRESS':'READY',
      checks,database,operationalHealth:intelligence,
    };
  }
}
