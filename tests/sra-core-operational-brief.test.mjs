import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSraCoreOperationalBrief } from '../services/sra-core-operational-brief-service.js';

test('operational brief explains healthy platform movement', () => {
  const brief = buildSraCoreOperationalBrief({
    state: 'RUNNING',
    running: false,
    intervalMs: 15000,
    cycleCount: 9,
    activePolicyCount: 2,
    latestCycle: {
      cycleId: 'HBT-1',
      trigger: 'SCHEDULED',
      state: 'COMPLETED',
      startedAt: '2026-08-05T20:00:00.000Z',
      completedAt: '2026-08-05T20:00:01.000Z',
      completedEngines: 6,
      failedEngines: 0,
      results: [
        { engine: 'RECOGNITION_ENGINE', state: 'COMPLETED', output: { recordsObserved: 100, recognitionRecords: 100 } },
        { engine: 'VERIFIED_VALUE_ENGINE', state: 'COMPLETED', output: { financialRecords: 100, coinPositions: 100 } },
        { engine: 'INSTRUMENT_ENGINE', state: 'COMPLETED', output: { instruments: 100 } },
        { engine: 'MARKET_ENGINE', state: 'COMPLETED', output: { listings: 100, live: 75, prepared: 25 } },
      ],
    },
  });
  assert.equal(brief.state, 'HEALTHY');
  assert.equal(brief.movement.observations, 100);
  assert.equal(brief.movement.liveListings, 75);
  assert.equal(brief.movement.preparedListings, 25);
  assert.match(brief.reply, /100 observations/);
  assert.match(brief.nextAction, /prepared marketplace backlog/);
});

test('operational brief surfaces engine failures', () => {
  const brief = buildSraCoreOperationalBrief({
    state: 'RUNNING',
    latestCycle: {
      cycleId: 'HBT-2',
      state: 'COMPLETED_WITH_ERRORS',
      completedEngines: 1,
      failedEngines: 1,
      results: [
        { engine: 'MARKET_ENGINE', state: 'FAILED', error: 'database unavailable' },
        { engine: 'INSTRUMENT_ENGINE', state: 'COMPLETED', output: { instruments: 12 } },
      ],
    },
  });
  assert.equal(brief.state, 'ATTENTION_REQUIRED');
  assert.equal(brief.heartbeat.failedEngines, 1);
  assert.ok(brief.attention.some((item) => item.includes('database unavailable')));
  assert.match(brief.nextAction, /failed engine output/);
});
