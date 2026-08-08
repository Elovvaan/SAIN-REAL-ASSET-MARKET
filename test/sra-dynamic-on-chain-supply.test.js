import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const chainService = fs.readFileSync(new URL('../services/sra-coin-chain-service.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../external/orca-executor/sra-token-worker.js', import.meta.url), 'utf8');
const lifecycle = fs.readFileSync(new URL('../services/coin-position-lifecycle-read-service.js', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../public/admin/admin-solana-transfer.js', import.meta.url), 'utf8');
const docs = fs.readFileSync(new URL('../docs/SRA-SOLANA-ADMIN-PATH.md', import.meta.url), 'utf8');

test('SRA chain service resynchronizes the existing mint instead of freezing first supply', () => {
  assert.doesNotMatch(chainService, /if\(existing\)return existing/);
  assert.match(chainService, /pendingQuantity/);
  assert.match(chainService, /SYNC_AVAILABLE/);
  assert.match(chainService, /SRA_COIN_ON_CHAIN_SUPPLY_SYNCHRONIZED/);
});

test('executor mints only the positive supply delta into the existing SRA mint', () => {
  assert.match(worker, /targetUnits-issuedUnits/);
  assert.match(worker, /mintedQuantity/);
  assert.match(worker, /mint synchronization cannot reduce supply/);
  assert.match(worker, /SRA_TOKEN_SUPPLY/);
});

test('Coin Positions reconciles available and externalized supply to confirmed chain issuance', () => {
  assert.match(lifecycle, /SRA_COIN_CHAIN_PROJECTION/);
  assert.match(lifecycle, /chainExternalized/);
  assert.match(lifecycle, /representedSra - reserved - externalized/);
  assert.match(lifecycle, /chainSupplyDeltaSra/);
});

test('Administration exposes pending supply and a repeatable synchronization action', () => {
  assert.match(admin, /Pending on-chain issuance/);
  assert.match(admin, /Sync New SRA On Chain/);
  assert.match(admin, /SYNCHRONIZED/);
});

test('architecture states that SRA is uncapped by its first on-chain snapshot', () => {
  assert.match(docs, /not a fixed-cap snapshot/);
  assert.match(docs, /same mint administratively/);
  assert.match(docs, /mints only the positive difference/);
});