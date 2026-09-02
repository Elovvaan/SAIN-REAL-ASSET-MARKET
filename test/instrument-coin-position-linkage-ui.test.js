import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync(new URL('../public/admin/admin-suite-shell.js',import.meta.url),'utf8');
const workstation=fs.readFileSync(new URL('../public/admin/admin-coin-lifecycle-workstation.js',import.meta.url),'utf8');
const routes=fs.readFileSync(new URL('../routes/instrument-admin-routes.js',import.meta.url),'utf8');
const onChain=fs.readFileSync(new URL('../routes/on-chain-projection-router.js',import.meta.url),'utf8');
const issuance=fs.readFileSync(new URL('../public/admin/admin-on-chain-issuance-controls.js',import.meta.url),'utf8');

test('Coin Positions exposes the Instrument Linkage operating station',()=>{
  assert.match(shell,/Coin Intelligence','Instrument Linkage','Mint History/);
  assert.match(workstation,/Register an existing SRA Coin Position/);
  assert.match(workstation,/data-link-instrument/);
  assert.match(workstation,/\/api\/admin\/instrument-coin-position-linkages/);
  assert.match(routes,/INSTRUMENT_COIN_POSITION_LINKED/);
  assert.match(onChain,/INSTRUMENT_COIN_POSITION_LINKAGE_REQUIRED/);
  assert.match(issuance,/Coin Position linkage → network readiness/);
});
