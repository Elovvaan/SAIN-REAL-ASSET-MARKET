import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const coin=fs.readFileSync(new URL('../public/admin/admin-coin-lifecycle-workstation.js',import.meta.url),'utf8');
const instruments=fs.readFileSync(new URL('../public/admin/admin-on-chain-issuance-controls.js',import.meta.url),'utf8');
const bootstrap=fs.readFileSync(new URL('../public/admin/admin-bootstrap.js',import.meta.url),'utf8');
const performance=fs.readFileSync(new URL('../public/admin/admin-performance-runtime.js',import.meta.url),'utf8');

test('Coin Positions deduplicates lifecycle reads through the shared admin client',()=>{
  assert.match(coin,/SRAAdminDataClient/);
  assert.match(coin,/refreshState/);
  assert.match(coin,/state\.inFlight/);
  assert.doesNotMatch(coin,/coin-position-lifecycle\?_=/);
  assert.doesNotMatch(coin,/instrument-coin-position-linkages\?_=/);
});

test('Instruments restores dynamic tabs and caches its scoped market reads',()=>{
  assert.match(instruments,/ensureTabs\(workspace\);\s*if \(!workspace \|\| mounted\.has\(workspace\)\) return/);
  assert.match(bootstrap,/loaded\.then\(\(\)=>mountWorkspaceFeatures\(workspaceId,admin\)\)/);
  assert.match(performance,/\/api\/on-chain\/market-swaps/);
  assert.match(performance,/\/api\/on-chain\/usdc-markets/);
});

test('Instruments on-chain feature executes at startup and registers its mount function',()=>{
  const window={};
  assert.doesNotThrow(()=>vm.runInNewContext(instruments,{window}));
  assert.equal(typeof window.mountAdminOnChainIssuanceControls,'function');
});
