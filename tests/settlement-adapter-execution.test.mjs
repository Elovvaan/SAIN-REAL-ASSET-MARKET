import test from 'node:test';
import assert from 'node:assert/strict';
import { SettlementAdapterExecutionService } from '../services/settlement-adapter-execution-service.js';

const instruction = {
  instructionId: 'SRA-RAIL-ONE',
  settlementId: 'SETTLEMENT-ONE',
  state: 'READY',
  rail: 'ACH',
  amount: 1,
  currency: 'USD',
  senderAccountReference: 'SOURCE-ACCOUNT',
  receivingInstitutionReference: 'DESTINATION-BANK',
  receivingAccountReference: 'DESTINATION-ACCOUNT',
  purpose: 'SRA_LIVE_CANARY',
  remittanceReference: 'SRA-ONE-DOLLAR'
};

test('live execution remains disabled by default', () => {
  const service = new SettlementAdapterExecutionService({ environment: {} });
  const status = service.status();
  assert.equal(status.liveExecutionEnabled, false);
  assert.equal(status.rails.every((rail) => rail.ready === false), true);
});

test('requires an exact human live-execution confirmation', () => {
  const service = new SettlementAdapterExecutionService({ environment: {} });
  assert.throws(() => service.assertCanExecute(instruction, 'yes'), /EXECUTE 1.00 USD VIA ACH/);
  assert.equal(service.assertCanExecute(instruction, 'EXECUTE 1.00 USD VIA ACH'), 'EXECUTE 1.00 USD VIA ACH');
});

test('posts an idempotent provider request and returns hashed evidence', async () => {
  let captured = null;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ transferId: 'ACH-TRANSFER-1', status: 'COMPLETED' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const service = new SettlementAdapterExecutionService({
    fetchImpl,
    environment: {
      SRA_SETTLEMENT_EXECUTION_MODE: 'LIVE',
      SRA_ACH_ENDPOINT: 'https://provider.example/transfers',
      SRA_ACH_TOKEN: 'secret-token',
      SRA_ACH_ACCOUNT_ID: 'SOURCE-ACCOUNT'
    }
  });
  const evidence = await service.execute(instruction, { confirmation: 'EXECUTE 1.00 USD VIA ACH', actorId: 'operator-1' });
  assert.equal(captured.url, 'https://provider.example/transfers');
  assert.equal(captured.options.headers['idempotency-key'], instruction.instructionId);
  assert.equal(captured.options.headers.authorization, 'Bearer secret-token');
  assert.equal(evidence.providerReference, 'ACH-TRANSFER-1');
  assert.equal(evidence.providerStatus, 'COMPLETED');
  assert.equal(typeof evidence.payloadHash, 'string');
  assert.equal(typeof evidence.responseHash, 'string');
});

test('rejects provider failure without representing execution as complete', async () => {
  const service = new SettlementAdapterExecutionService({
    fetchImpl: async () => new Response(JSON.stringify({ status: 'REJECTED' }), { status: 422 }),
    environment: {
      SRA_SETTLEMENT_EXECUTION_MODE: 'LIVE',
      SRA_ACH_ENDPOINT: 'https://provider.example/transfers',
      SRA_ACH_API_KEY: 'key'
    }
  });
  await assert.rejects(
    service.execute(instruction, { confirmation: 'EXECUTE 1.00 USD VIA ACH' }),
    (error) => error.code === 'SETTLEMENT_PROVIDER_REJECTED' && error.executionEvidence.httpStatus === 422
  );
});
