import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentServiceFeeService } from '../services/agent-service-fee-service.js';

test('agent service fee schedule exposes the six established SRA work-unit rates', () => {
  const service = new AgentServiceFeeService();
  assert.equal(service.quoteAgent('SRA-COIN-AGENT').amount, 16.50);
  assert.equal(service.quoteAgent('SRA-LISTING-AGENT').amount, 18.00);
  assert.equal(service.quoteAgent('SRA-ORDER-AGENT').amount, 8.67);
  assert.equal(service.quoteAgent('SRA-SETTLEMENT-AGENT').amount, 26.25);
  assert.equal(service.quoteAgent('SRA-EXPORT-AGENT').amount, 24.75);
  assert.equal(service.quoteAgent('SRA-MARKETPLACE-AGENT').amount, 17.00);
});

test('current unified operations stages resolve to the agent service rate actually processing them', () => {
  const service = new AgentServiceFeeService();
  assert.equal(service.quoteWorkflowStage('ORDER_INTENT').agentId, 'SRA-ORDER-AGENT');
  assert.equal(service.quoteWorkflowStage('MATCH_REVIEW').amount, 8.67);
  assert.equal(service.quoteWorkflowStage('RESERVATION').feeCode, 'SRA-SERVICE-ORDER-OPS');
  assert.equal(service.quoteWorkflowStage('ALLOCATION').agentId, 'SRA-SETTLEMENT-AGENT');
  assert.equal(service.quoteWorkflowStage('ALLOCATION').amount, 26.25);
  assert.equal(service.quoteWorkflowStage('SETTLEMENT').agentId, 'SRA-EXPORT-AGENT');
  assert.equal(service.quoteWorkflowStage('EXPORT_PACKAGE').amount, 24.75);
  assert.equal(service.quoteWorkflowStage('TRANSFER_INSTRUCTION').amount, 24.75);
  assert.equal(service.quoteWorkflowStage('EXTERNAL_EXECUTION').amount, 24.75);
  assert.equal(service.quoteWorkflowStage('TRANSFER_EXCEPTION').amount, 24.75);
  assert.equal(service.quoteWorkflowStage('EXPORT_EXCEPTION').amount, 24.75);
});

test('coin, listing, and marketplace agents are priced and attached to their operating stages', () => {
  const service = new AgentServiceFeeService();
  assert.deepEqual(service.quoteAgent('SRA-COIN-AGENT').workflowStages, ['COIN_POSITION','INSTRUMENT_REPRESENTATION','ON_CHAIN_REPRESENTATION','ON_CHAIN_RECONCILIATION']);
  assert.deepEqual(service.quoteAgent('SRA-LISTING-AGENT').workflowStages, ['LISTING_PREPARATION','LISTING_PUBLICATION']);
  assert.deepEqual(service.quoteAgent('SRA-MARKETPLACE-AGENT').workflowStages, ['MARKETPLACE_READINESS','MARKET_OFFER']);
  assert.equal(service.quoteWorkflowStage('COIN_POSITION').agentId, 'SRA-COIN-AGENT');
  assert.equal(service.quoteWorkflowStage('LISTING_PUBLICATION').agentId, 'SRA-LISTING-AGENT');
  assert.equal(service.quoteWorkflowStage('MARKET_OFFER').agentId, 'SRA-MARKETPLACE-AGENT');
  assert.equal(service.quoteWorkflowStage('NOT_A_REAL_STAGE'), null);
});
