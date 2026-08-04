import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recordParticipantFunding } from '../routes/access-router.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  async put(type, key, value) { this.records.set(`${type}:${key}`, value); return value; }
}

test('verified crypto funding posts participant cash and payable and records blockchain receipt', async () => {
  const domain = new MemoryDomain();
  const posts = [];
  const ledger = {
    getAccount() { return { accountId: 'existing' }; },
    async createAccount() {},
    async post(input) { posts.push(input); return { entryId: 'LE-CRYPTO-1' }; }
  };
  const verification = {
    verified: true,
    state: 'CONFIRMED',
    network: 'BASE',
    asset: 'USDC',
    transactionHash: `0x${'a'.repeat(64)}`,
    fromAddress: `0x${'1'.repeat(40)}`,
    toAddress: `0x${'2'.repeat(40)}`,
    amount: 100,
    confirmations: 3
  };
  const result = await recordParticipantFunding({
    domain,
    ledger,
    actorId: 'USR-1',
    externalReference: verification.transactionHash,
    blockchainVerification: verification,
    record: {
      fundingInstructionId: 'CRYPTO-1',
      purpose: 'ASSET_VAULT_FUNDING',
      participantId: 'USR-1',
      accountId: 'UA-1',
      amount: 100,
      currency: 'USD',
      rail: 'CRYPTO',
      state: 'AWAITING_BLOCKCHAIN_TRANSFER'
    }
  });
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].lines, [
    { accountId: 'GL-CASH-PARTICIPANT-FUNDS', debit: 100 },
    { accountId: 'GL-PARTICIPANT-FUNDS-LIABILITY', credit: 100 }
  ]);
  assert.equal(result.updated.state, 'CONFIRMED');
  assert.equal(result.receipt.transactionHash, verification.transactionHash);
  assert.equal(result.receipt.network, 'BASE');
  assert.equal(result.receipt.asset, 'USDC');
});

test('access router exposes authenticated crypto instruction and verification endpoints', () => {
  const source = fs.readFileSync(new URL('../routes/access-router.js', import.meta.url), 'utf8');
  assert.match(source, /\/funding\/crypto-instructions/);
  assert.match(source, /That blockchain transaction has already been used/);
  assert.match(source, /SRA_BASE_USDC_RECEIVING_ADDRESS/);
  assert.match(source, /verifyTransfer/);
});

test('Asset Vault UI includes Base USDC instruction and transaction-hash verification', () => {
  const source = fs.readFileSync(new URL('../public/funding-intake-ui.js', import.meta.url), 'utf8');
  assert.match(source, /Pay with Crypto/);
  assert.match(source, /USDC on Base/);
  assert.match(source, /transactionHash/);
  assert.match(source, /Verify and credit vault/);
});
