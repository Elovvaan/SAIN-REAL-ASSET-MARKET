import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('on-chain mutations require an administrator session',()=>{const auth=read('middleware/operations-authorization.js');assert.match(auth,/['"]\/api\/on-chain['"]/);assert.match(auth,/path\.startsWith\(['"]\/api\/on-chain['"]\).*PLATFORM_ADMIN.*OPERATIONS_ADMIN/);});

test('SOL transfer persists submission before confirmation and reconciles retries',()=>{const worker=read('external/orca-executor/sra-token-worker.js');assert.match(worker,/sendRawTransaction/);assert.match(worker,/state='SUBMITTED'/);assert.match(worker,/getSignatureStatuses/);assert.match(worker,/pg_advisory_lock/);assert.match(worker,/Quantity exceeds \$\{decimals\} decimals/);assert.doesNotMatch(worker,/Math\.round\(amount/);});

test('admin retains one transfer id across transport retries and removes stale Solana controls',()=>{const ui=read('public/admin/admin-solana-transfer.js');assert.match(ui,/form\.dataset\.transferId\|\|=/);assert.match(ui,/transferId:form\.dataset\.transferId/);const remove=ui.indexOf("querySelectorAll('[data-solana-transfer]')");const tab=ui.indexOf("dataset.activeTab!=='Solana'");assert.ok(remove>=0&&tab>remove,'stale Solana card must be removed before active-tab return');assert.match(ui,/if\(w\.dataset\.activeTab!=='Solana'\)return;const chain=/);});

test('chain executor has one credential and no Orca execution route',()=>{const server=read('external/orca-executor/server.js');const service=read('services/solana-transfer-service.js');assert.match(server,/SOLANA_EXECUTOR_TOKEN/);assert.doesNotMatch(server,/DEX_ORCA|ORCA_EXECUTION|app\.post\('\/execute'/);assert.doesNotMatch(service,/DEX_ORCA_EXECUTOR/);});
