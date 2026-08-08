import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Solana transfer path stays address-to-address', () => {
  const service = read('services/solana-transfer-service.js');
  const router = read('routes/on-chain-projection-router.js');
  const ui = read('public/admin/admin-solana-transfer.js');
  const worker = read('external/orca-executor/orca-worker.js');
  assert.match(service, /destinationAddress/);
  assert.match(service, /asset: 'SOL'/);
  assert.match(router, /\/solana\/wallet/);
  assert.match(router, /\/solana\/transfers/);
  assert.match(ui, /Platform address/);
  assert.match(ui, /Destination address/);
  assert.match(ui, /Send SOL/);
  assert.match(worker, /SystemProgram\.transfer/);
  assert.match(worker, /transactionSignature/);
});

test('Solana control is mounted before optional DEX controls', () => {
  const bootstrap = read('public/admin/admin-bootstrap.js');
  const solana = bootstrap.indexOf("['/admin/admin-solana-transfer.js'");
  const dex = bootstrap.indexOf("['/admin/admin-external-dex-adapter.js'");
  assert.ok(solana >= 0, 'Solana transfer feature must load');
  assert.ok(dex > solana, 'simple chain transfer must load before optional DEX controls');
});
