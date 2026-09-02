import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../public/admin/admin-suite-shell.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/admin/admin-xrpl-exchange-workstation.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../routes/on-chain-projection-router.js', import.meta.url), 'utf8');

test('XRPL exchange workflow is mounted in the Coin Positions tab area', () => {
  assert.match(shell, /'Mint History','XRPL Exchange','Retirements'/);
  assert.match(bootstrap, /admin-xrpl-exchange-workstation\.js/);
  assert.match(bootstrap, /mountAdminXrplExchangeWorkstation\?\.\(coinWorkspace\)/);
  assert.match(ui, /window\.mountAdminXrplExchangeWorkstation = mount/);
});

test('workflow starts with SRAUSD and separates issuance from XRP exchange', () => {
  assert.match(ui, /SRAUSD → XRP Mainnet Workflow/);
  assert.match(ui, /Issuance is not an XRP exchange/);
  assert.match(ui, /sellAmount,buyAmountXrp/);
  assert.match(ui, /Issue exactly \$\{amount\} SRAUSD/);
  assert.match(ui, /selling \$\{sellAmount\} SRAUSD for \$\{buyAmountXrp\} XRP/);
});

test('every XRPL Mainnet write requires entered values and explicit confirmation', () => {
  assert.doesNotMatch(ui, /value=["']1000["']/);
  for (const marker of ['data-confirm-create','data-confirm-issue','data-confirm-offer']) assert.match(ui, new RegExp(marker));
  assert.match(ui, /window\.confirm\('Create the SRAUSD asset identity/);
  assert.match(ui, /positive\(sellAmount\).*positive\(buyAmountXrp\)/s);
});

test('XRPL asset offers can be read back after confirmed submission', () => {
  assert.match(routes, /router\.get\('\/assets\/:assetId\/markets\/offers'/);
  assert.match(routes, /domain\.list\('ON_CHAIN_MARKET_OFFER'\)/);
  assert.match(ui, /markets\/offers/);
});
