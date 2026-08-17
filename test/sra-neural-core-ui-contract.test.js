import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [agentService, neuralService, agentPage] = await Promise.all([
  readFile(new URL('../services/admin-intelligence-agent-service.js', import.meta.url), 'utf8'),
  readFile(new URL('../services/sra-neural-core-service.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/admin/agent.html', import.meta.url), 'utf8'),
]);

test('existing private admin agent endpoint carries the three neural levels',()=>{
  assert.match(agentService,/SraNeuralCoreService/);
  assert.match(agentService,/CREATE_ORCHESTRATION_PLAN/);
  assert.match(agentService,/TRAIN_ADAPTIVE_MODEL/);
  assert.match(agentService,/FORECAST_OPPORTUNITY/);
  assert.match(agentService,/INSTITUTIONAL_INSIGHTS/);
  assert.match(agentService,/if\(input\.action\)/);
});

test('neural core preserves governed financial boundaries',()=>{
  assert.match(neuralService,/NEURAL_OUTPUT_CANNOT_SELF_APPROVE_FINANCING/);
  assert.match(neuralService,/NEURAL_OUTPUT_CANNOT_SELF_AUTHORIZE_FUNDING/);
  assert.match(neuralService,/NEURAL_OUTPUT_CANNOT_SELF_CONFIRM_SETTLEMENT/);
  assert.match(neuralService,/PROTECTED_PERSONAL_CHARACTERISTICS_ARE_NOT_MODEL_FEATURES/);
  assert.match(neuralService,/executedFinancialActions:\[\]/);
  assert.match(neuralService,/decisionAuthority:'ADVISORY_ONLY'/);
});

test('admin neural page exposes Copilot Orchestrator and Adaptive Intelligence',()=>{
  assert.match(agentPage,/Level 1 · Copilot/);
  assert.match(agentPage,/Level 2 · Orchestrator/);
  assert.match(agentPage,/Level 3 · Adaptive Institutional Intelligence/);
  assert.match(agentPage,/CREATE_ORCHESTRATION_PLAN/);
  assert.match(agentPage,/APPROVE_ORCHESTRATION_PLAN/);
  assert.match(agentPage,/DISPATCH_ORCHESTRATION_PLAN/);
  assert.match(agentPage,/TRAIN_ADAPTIVE_MODEL/);
  assert.match(agentPage,/FORECAST_OPPORTUNITY/);
});