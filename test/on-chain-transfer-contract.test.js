import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('on-chain mutations remain operations-authorized', () => {
  const auth = read('middleware/operations-authorization.js');
  assert.match(auth, /['"]\/api\/on-chain['"]/);
});

test('generic transfer interface contains only transfer intent', () => {
  const service = read('services/on-chain-transfer-service.js');
  assert.match(service, /interface: \['asset', 'amount', 'destinationAddress', 'network'\]/);
  assert.doesNotMatch(service, /mintAddress|sourceTokenAccount/);
});

test('network adapter performs build sign broadcast confirm below generic interface', () => {
  const adapter = read('services/stellar-transfer-service.js');
  assert.match(adapter, /async build\(/);
  assert.match(adapter, /sign\(prepared\)/);
  assert.match(adapter, /async broadcast\(/);
  assert.match(adapter, /async confirm\(/);
  assert.match(adapter, /const prepared = await this\.build\(input\)/);
  assert.match(adapter, /const signed = this\.sign\(prepared\)/);
  assert.match(adapter, /const submitted = await this\.broadcast\(signed\)/);
  assert.match(adapter, /const confirmation = await this\.confirm\(submitted\.transactionId\)/);
});

test('Instruments on-chain UI submits generic transfer intent', () => {
  const ui = read('public/admin/admin-on-chain-issuance-controls.js');
  assert.match(ui, /\/api\/on-chain\/transfers/);
  assert.match(ui, /network:button\.dataset\.transferNetwork/);
  assert.match(ui, /asset:button\.dataset\.transferSymbol/);
  assert.match(ui, /amount,/);
  assert.match(ui, /destinationAddress,/);
});
