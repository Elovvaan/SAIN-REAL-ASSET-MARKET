import crypto from 'node:crypto';

export const CORE_HEARTBEAT_RECORD = 'SRA_CORE_HEARTBEAT_CYCLE';
export const CORE_POLICY_RECORD = 'SRA_CORE_POLICY';

function now() { return new Date().toISOString(); }
function cycleId() { return `HBT-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }

export class SraCoreServicesHeartbeat {
  constructor({ domain, eventBus, intervalMs = 15000, engines = [] }) {
    this.domain = domain;
    this.eventBus = eventBus;
    this.intervalMs = Math.max(1000, Number(intervalMs) || 15000);
    this.engines = engines;
    this.timer = null;
    this.running = false;
    this.lastCycle = null;
  }

  registerEngine(engine) {
    if (!engine?.name || typeof engine.run !== 'function') throw new Error('A core engine requires a name and run function.');
    this.engines.push(engine);
    return this;
  }

  policies() {
    return this.domain.list(CORE_POLICY_RECORD).filter((item) => item.state === 'ACTIVE');
  }

  async runCycle(trigger = 'SCHEDULED') {
    if (this.running) return { skipped: true, reason: 'CYCLE_ALREADY_RUNNING', lastCycle: this.lastCycle };
    this.running = true;
    const id = cycleId();
    const startedAt = now();
    const policyRecords = this.policies();
    const results = [];
    this.eventBus?.publish('SRA_CORE_CYCLE_STARTED', { cycleId: id, trigger, policyCount: policyRecords.length });
    try {
      for (const engine of this.engines) {
        const engineStartedAt = now();
        try {
          const output = await engine.run({ cycleId: id, trigger, policies: policyRecords, domain: this.domain, eventBus: this.eventBus });
          results.push({ engine: engine.name, state: 'COMPLETED', startedAt: engineStartedAt, completedAt: now(), output: output || null });
          this.eventBus?.publish('SRA_CORE_ENGINE_COMPLETED', { cycleId: id, engine: engine.name, output: output || null });
        } catch (error) {
          results.push({ engine: engine.name, state: 'FAILED', startedAt: engineStartedAt, completedAt: now(), error: error.message });
          this.eventBus?.publish('SRA_CORE_ENGINE_FAILED', { cycleId: id, engine: engine.name, error: error.message });
        }
      }
      const completedAt = now();
      const record = {
        cycleId: id,
        trigger,
        state: results.some((item) => item.state === 'FAILED') ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
        startedAt,
        completedAt,
        engineCount: results.length,
        completedEngines: results.filter((item) => item.state === 'COMPLETED').length,
        failedEngines: results.filter((item) => item.state === 'FAILED').length,
        policyCount: policyRecords.length,
        results,
      };
      await this.domain.put(CORE_HEARTBEAT_RECORD, id, record, { actorId: 'SRA_CORE_SERVICES', eventType: 'SRA_CORE_HEARTBEAT_RECORDED' });
      this.lastCycle = record;
      this.eventBus?.publish('SRA_CORE_CYCLE_COMPLETED', record);
      return record;
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) return;
    void this.runCycle('STARTUP');
    this.timer = setInterval(() => void this.runCycle('SCHEDULED'), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    const cycles = this.domain.list(CORE_HEARTBEAT_RECORD).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
    const latest = this.lastCycle || cycles[0] || null;
    return {
      state: this.timer ? 'RUNNING' : 'STOPPED',
      intervalMs: this.intervalMs,
      engineCount: this.engines.length,
      engines: this.engines.map((engine) => engine.name),
      activePolicyCount: this.policies().length,
      cycleCount: cycles.length,
      latestCycle: latest,
    };
  }
}
