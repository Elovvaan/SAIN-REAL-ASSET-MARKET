import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const index = read('../public/index.html');
const bootstrap = read('../public/public-bootstrap.js');
const access = read('../public/access.js');
const home = read('../public/public-home.js');
const chat = read('../public/public-chat-runtime.js');
const css = read('../public/access.css');
const accessRouter = read('../routes/access-router.js');
const server = read('../server.js');

test('public shell resolves access once with a bounded visible fallback', () => {
  assert.match(index, /<body>/);
  assert.doesNotMatch(index, /<body class="sra-access-resolving">/);
  assert.match(css, /body\.sra-access-resolving \.app-shell\{visibility:visible\}/);
  assert.match(bootstrap, /'\/public-home\.js'/);
  assert.ok(bootstrap.indexOf('loadScript(PUBLIC_HOME_FEATURE)') < bootstrap.indexOf('loadScript(ACCESS_FEATURE)'));
  assert.match(access, /let accessInitialization=null/);
  assert.match(access, /window\.SRAPublicHome\?\.refreshNow\?\.\(\)/);
  assert.match(access, /classList\.remove\('sra-access-resolving'\)/);
  assert.doesNotMatch(access, /setTimeout\(initializeAccess/);
  assert.doesNotMatch(home, /setTimeout\(queueSync/);
});

test('production serves public files before API middleware with bounded caching', () => {
  const staticMount = server.indexOf("bootstrap.use(express.static(new URL('./public', import.meta.url).pathname");
  const runtimeMount = server.indexOf('bootstrap.use(productionRuntime)');
  assert.ok(staticMount >= 0 && staticMount < runtimeMount);
  assert.match(server, /public, max-age=300, stale-while-revalidate=60/);
  assert.match(server, /filePath\.endsWith\('\.html'\).*no-cache/);
});

test('nonessential marketplace heartbeat waits for the completed first paint', () => {
  assert.match(chat, /sra:public-access-ready/);
  assert.match(chat, /requestIdleCallback/);
  assert.doesNotMatch(chat, /bind\(\);\s*void startHeartbeat\(\)/);
});

test('homepage carries filed SRA business identity and a contact route', () => {
  assert.match(home, /Sain Real Asset LLC/);
  assert.match(home, /Utah domestic limited liability company/);
  assert.match(home, /14733803-0160/);
  assert.match(home, /September 3, 2026/);
  assert.match(home, /href="\/support\/"/);
  assert.doesNotMatch(home, /42-4236568/);
});

test('homepage positions SRA as infrastructure and reports persisted operational stages', () => {
  assert.match(home, /Make productive assets transferable/);
  assert.match(home, /One fungible SRA Coin/);
  assert.match(home, /Verify the position/);
  assert.match(home, /Create SRA Coin/);
  assert.match(home, /Transfer and settle/);
  assert.match(home, /exchange it into another asset through an available market/);
  assert.match(home, /Businesses and asset providers/);
  assert.match(home, /SRA Coin holders/);
  assert.match(home, /Markets and institutions/);
  assert.match(accessRouter, /function publicInfrastructureStatus\(\)/);
  assert.match(accessRouter, /Verified Coin Positions/);
  assert.match(accessRouter, /On-chain SRA assets/);
  assert.match(accessRouter, /Transfer and settlement/);
  assert.match(accessRouter, /hydrate\(\['ON_CHAIN_ASSET','ON_CHAIN_TRANSFER'\]\)/);
  assert.match(accessRouter, /infrastructureStatus: publicInfrastructureStatus\(\)/);
  assert.doesNotMatch(accessRouter, /MONEYGRAM_SANDBOX_CERTIFICATION_TEST/);
  assert.doesNotMatch(accessRouter, /FIAT_RAMP/);
  assert.doesNotMatch(home, /MoneyGram|Fiat entry and exit/i);
  assert.doesNotMatch(home, /licensed bank/i);
  assert.doesNotMatch(home, /freely tradeable from day one/i);
});
