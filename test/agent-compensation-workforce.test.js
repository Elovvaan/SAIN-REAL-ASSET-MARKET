import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentCompensationService } from '../services/agent-compensation-service.js';

const expected={
  'SRA-COIN-AGENT':16.50,
  'SRA-LISTING-AGENT':18.00,
  'SRA-ORDER-AGENT':8.67,
  'SRA-SETTLEMENT-AGENT':26.25,
  'SRA-EXPORT-AGENT':24.75,
  'SRA-MARKETPLACE-AGENT':17.00,
};

test('SRA agent compensation schedule returns established accepted-work values',()=>{
  const service=new AgentCompensationService();
  for(const [agentId,amount] of Object.entries(expected)){
    const quote=service.quote(agentId);
    assert.equal(quote.amount,amount);
    assert.equal(quote.currency,'USD');
    assert.equal(quote.basis,'HUMAN_EQUIVALENT_TASK_VALUE');
  }
});
