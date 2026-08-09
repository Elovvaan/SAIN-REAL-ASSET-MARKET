import test from 'node:test';
import assert from 'node:assert/strict';
import { SolanaTransferService, exactUnits, U64_MAX } from '../services/solana-transfer-service.js';

test('SPL token unit conversion rejects values above u64 before RPC', () => {
  assert.equal(exactUnits('18446744073709551615', 0), U64_MAX);
  assert.throws(
    () => exactUnits('1', 20),
    (error) => error?.code === 'SOLANA_TOKEN_AMOUNT_U64_OVERFLOW',
  );
});

test('issuance authorization compares exact atomic units instead of JavaScript Number values', () => {
  const service = new SolanaTransferService({
    environment: {},
  });
  const projection = {
    network: 'SOLANA',
    status: 'APPROVED',
    mintAddress: null,
    chainProgram: 'TOKEN_2022',
    authorizedSupply: 0.3,
    authorizedSupplyExact: '0.3',
  };

  assert.throws(
    () => service.validateIssuance(projection, { amount: '0.30000000000000001', decimals: 17 }),
    /exceeds authorized supply/i,
  );

  const accepted = service.validateIssuance(projection, { amount: '0.30000000000000000', decimals: 17 });
  assert.equal(accepted.units, accepted.authorizedUnits);
});
