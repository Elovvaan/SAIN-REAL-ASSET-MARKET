import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Transaction } from '@solana/web3.js';
import { OnChainProjectionService } from '../services/on-chain-projection-service.js';
import { SolanaTransferService, exactUnits, U64_MAX } from '../services/solana-transfer-service.js';

test('SPL token unit conversion rejects values above u64 before RPC', () => {
  assert.equal(exactUnits('18446744073709551615', 0), U64_MAX);
  assert.throws(
    () => exactUnits('1', 20),
    (error) => error?.code === 'ON_CHAIN_TOKEN_AMOUNT_U64_OVERFLOW',
  );
});

test('issuance authorization compares exact atomic units instead of JavaScript Number values', () => {
  const service = new SolanaTransferService({ environment: {} });
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

test('projection preserves an authorized supply string before producing the legacy numeric field', async () => {
  const instrumentId = 'INS-EXACT';
  const instrument = {
    instrumentId,
    state: 'ISSUED',
    issuerId: 'SRA_PLATFORM',
    financialRecordId: 'FR-EXACT',
    authorizedSupply: '9007199254740995',
  };
  const approval = {
    id: `IRA-${instrumentId}`,
    approvalId: `IRA-${instrumentId}`,
    instrumentId,
    state: 'APPROVED',
    linkedCoinPositionIds: [],
  };
  const records = new Map();
  const domain = {
    get(type, id) {
      if (type === 'SRA_INSTRUMENT' && id === instrumentId) return instrument;
      if (type === 'INSTRUMENT_REPRESENTATION_APPROVAL' && id === `IRA-${instrumentId}`) return approval;
      return records.get(`${type}:${id}`) || null;
    },
    list() { return []; },
    async put(type, id, value) { records.set(`${type}:${id}`, value); return value; },
    async lifecycle() { return { id: 'LE-1' }; },
  };
  const service = new OnChainProjectionService(domain);
  const projection = await service.createProjection({ instrumentId, decimals: 0 }, 'USR-1');

  assert.equal(projection.authorizedSupplyExact, '9007199254740995');
  assert.notEqual(String(projection.authorizedSupply), projection.authorizedSupplyExact);

  const adapter = new SolanaTransferService({ environment: {} });
  assert.throws(
    () => adapter.validateIssuance(projection, { amount: '9007199254740996', decimals: 0 }),
    /exceeds authorized supply/i,
  );
});

test('initial mint setup is prepared as one atomic signed transaction before broadcast', async () => {
  const payer = Keypair.generate();
  const service = new SolanaTransferService({ environment: {} });
  service.ensure = () => ({
    payer,
    connection: {
      getMinimumBalanceForRentExemption: async () => 1_000_000,
      getLatestBlockhash: async () => ({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 12345,
      }),
    },
  });

  const projection = {
    network: 'SOLANA',
    status: 'APPROVED',
    chainProgram: 'TOKEN_2022',
    authorizedSupplyExact: '10',
  };
  const prepared = await service.prepareIssuance(projection, { amount: '1', decimals: 2 });
  const transaction = Transaction.from(Buffer.from(prepared.serializedTransactionBase64, 'base64'));

  assert.equal(transaction.instructions.length, 4);
  assert.ok(prepared.mintAddress);
  assert.ok(prepared.platformTokenAccount);
  assert.equal(prepared.issuedSupplyExact, '1');
  assert.equal(prepared.issuedSupplyUnits, '100');
});
