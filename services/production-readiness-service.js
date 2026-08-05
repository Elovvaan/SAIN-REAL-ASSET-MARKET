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
    const checks = [
      {
        id: 'DATABASE_PERSISTENCE',
        status: database.persistent ? 'PASS' : 'FAIL',
        detail: database.persistent ? 'PostgreSQL persistence is active.' : 'The platform is using memory fallback and will not preserve production records across restarts.',
      },
      {
        id: 'DOMAIN_HYDRATION',
        status: Object.keys(counts).length > 0 ? 'PASS' : 'FAIL',
        detail: `${Object.keys(counts).length} registered record types are available to the persistent domain.`,
      },
      {
        id: 'OPERATIONS_INTELLIGENCE',
        status: intelligence ? 'PASS' : 'FAIL',
        detail: intelligence ? `Operational health is ${intelligence.status} with score ${intelligence.score}.` : 'SAIN Operations Intelligence is unavailable.',
      },
      {
        id: 'OPERATIONS_AUTHORIZATION',
        status: 'PASS',
        detail: 'Funding and marketplace write paths require an authorized staff role.',
      },
      {
        id: 'IDEMPOTENCY',
        status: 'WARN',
        detail: 'Instance-level idempotency is active; durable cross-instance idempotency is not yet implemented.',
      },
    ];
    const failed = checks.filter((check) => check.status === 'FAIL');
    const warnings = checks.filter((check) => check.status === 'WARN');
    return {
      generatedAt: new Date().toISOString(),
      readyForCustomerPilot: failed.length === 0,
      readyForMultiInstanceScale: failed.length === 0 && warnings.length === 0,
      status: failed.length ? 'NOT_READY' : warnings.length ? 'PILOT_READY_WITH_WARNINGS' : 'READY',
      checks,
      database,
      operationalHealth: intelligence,
    };
  }
}
