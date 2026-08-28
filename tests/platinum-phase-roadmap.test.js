import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const roadmap = fs.readFileSync(new URL('../docs/architecture/platinum-phase-roadmap.md', import.meta.url), 'utf8');
const phase3 = fs.readFileSync(new URL('../docs/architecture/platinum-phase-3-governed-action-execution.md', import.meta.url), 'utf8');

test('Platinum roadmap preserves Phase 1 through Phase 3 boundaries', () => {
  assert.match(roadmap, /Phase 1 — Operational Memory and Event Nervous System/);
  assert.match(roadmap, /Phase 2 — Context and Instruction Reasoning/);
  assert.match(roadmap, /Phase 3 — Governed Action Execution/);
  assert.match(roadmap, /external-world success remains separate pending `OUTCOME_EVALUATION` evidence/);
});

test('Phase 3 architecture reserves financial authority and external outcome verification', () => {
  assert.match(phase3, /SAFE_PREPARATION/);
  assert.match(phase3, /PROTECTED/);
  assert.match(phase3, /AWAITING_AUTHORITY/);
  assert.match(phase3, /does not claim that an outside party received, accepted, settled, reconciled/);
});
