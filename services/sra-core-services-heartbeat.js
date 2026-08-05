import crypto from 'node:crypto';

export const CORE_HEARTBEAT_RECORD = 'SRA_CORE_HEARTBEAT_CYCLE';
export const CORE_POLICY_RECORD = 'SRA_CORE_POLICY';

function now() { return new Date().toISOString(); }
function cycleId() { return `HBT-${crypto.randomUUID().toUpperCase()}`; }
function recordId(type, record) {
  if (type === CORE_HEARTBEAT_RECORD) return record?.cycleId || null;
  if (type === CORE_POLICY_RECORD) return record?.policyId || record?.id || null;
  return record?.id || null;
}

export class SraCoreServicesHeartbeat {
  constructor({ domain, eventBus, intervalMs = 15000, engines = [], logger = console }) {
    this.domain = domain;
    this.eventBus = eventBus;
    this.intervalMs = Math.max(1000, Number(intervalMs) || 15000);
    this.engines = engines;
    this.logger = logger;
    this.timer = null;
    this.running = false;
    this.lastCycle = null;
    this.lastError = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return this;
    const database = this.domain?.database;
    if (database?.listRecords && this.domain?.cache && this.domain?.key) {
      for (const type of [CORE_HEARTBEAT_RECORD, CORE_POLICY_RECORD]) {
        const records = await database.listRecords(type);
        for (const record of records) {
          const id = recordId(type, record);
          if (id) this.domain.cache.set(this.domain.key(type, id), JSON.parse(JSON.stringify(record)));
        }
      }
    }
    this.initialized = true;
    return this;
  }

  registerEngine(engine) {
    if (!engine?.name || typeof engine.run !== 'function') throw new Error('A core engine requires a name and run function.');
    this.engines.push(engine);
    return this;
  }

  policies() {
    return this.domain.list(CORE_POLICY_RECORD).filter((item) => item.state === 'ACTIVE');
  }

  publish(eventType, payload) {
    try {
      return this.eventBus?.publish(eventType, payload) || null;
    } catch (error) {
      this.logger?.error?.({ event: 'SRA_CORE_EVENT_DELIVERY_FAILED', eventType, error: error?.message || String(error) });
      return null;
    }
  }

  async runCycle(trigger = 'SCHEDULED') {
    if (this.running) return { skipped: true, reason: 'CYCLE_ALREADY_RUNNING', lastCycle: this.lastCycle };
    this.running = true;
    const id = cycleId();
    const startedAt = now();
    const results = [];
    try {
      await this.initialize();
      const policyRecords = this.policies();
      this.publish('SRA_CORE_CYCLE_STARTED', { cycleId: id, trigger, policyCount: policyRecords.length });
      for (const engine of this.engines) {
        const engineStartedAt = now();
        try {
          const output = await engine.run({ cycleId: id, trigger, policies: policyRecords, domain: this.domain, eventBus: this.eventBus });
          results.push({ engine: engine.name, state: 'COMPLETED', startedAt: engineStartedAt, completedAt: now(), output: output || null });
          this.publish('SRA_CORE_ENGINE_COMPLETED', { cycleId: id, engine: engine.name, output: output || null });
        } catch (error) {
          results.push({ engine: engine.name, state: 'FAILED', startedAt: engineStartedAt, completedAt: now(), error: error?.message || String(error) });
          this.publish('SRA_CORE_ENGINE_FAILED', { cycleId: id, engine: engine.name, error: error?.message || String(error) });
        }
      }
      const record = {
        cycleId: id,
        trigger,
        state: results.some((item) => item.state === 'FAILED') ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
        startedAt,
        completedAt: now(),
        engineCount: results.length,
        completedEngines: results.filter((item) => item.state === 'COMPLETED').length,
        failedEngines: results.filter((item) => item.state === 'FAILED').length,
        policyCount: policyRecords.length,
        results,
      };
      await this.domain.put(CORE_HEARTBEAT_RECORD, id, record, { actorId: 'SRA_CORE_SERVICES', eventType: 'SRA_CORE_HEARTBEAT_RECORDED' });
      this.lastCycle = record;
      this.lastError = null;
      this.publish('SRA_CORE_CYCLE_COMPLETED', record);
      return record;
    } catch (error) {
      this.lastError = { trigger, message: error?.message || String(error), occurredAt: now() };
      this.publish('SRA_CORE_CYCLE_FAILED', { cycleId: id, trigger, error: this.lastError.message });
      throw error;
    } finally {
      this.running = false;
    }
  }

  runSafely(trigger) {
    return this.runCycle(trigger).catch((error) => {
      this.logger?.error?.({ event: 'SRA_CORE_CYCLE_REJECTED', trigger, error: error?.message || String(error) });
      return null;
    });
  }

  async start() {
    if (this.timer) return;
    await this.initialize();
    void this.runSafely('STARTUP');
    this.timer = setInterval(() => { void this.runSafely('SCHEDULED'); }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    const cycles = this.domain.list(CORE_HEARTBEAT_RECORD).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
    return {
      state: this.timer ? 'RUNNING' : 'STOPPED',
      runningCycle: this.running,
      intervalMs: this.intervalMs,
      engineCount: this.engines.length,
      engines: this.engines.map((engine) => engine.name),
      activePolicyCount: this.policies().length,
      cycleCount: cycles.length,
      latestCycle: this.lastCycle || cycles[0] || null,
      lastError: this.lastError,
    };
  }
}
