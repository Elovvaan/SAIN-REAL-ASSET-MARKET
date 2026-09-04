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

test('public shell stays hidden until one resolved access render is complete', () => {
  assert.match(index, /<body class="sra-access-resolving">/);
  assert.match(css, /body\.sra-access-resolving \.app-shell\{visibility:hidden\}/);
  assert.match(bootstrap, /'\/public-home\.js'/);
  assert.match(access, /let accessInitialization=null/);
  assert.match(access, /window\.SRAPublicHome\?\.refreshNow\?\.\(\)/);
  assert.match(access, /classList\.remove\('sra-access-resolving'\)/);
  assert.doesNotMatch(access, /setTimeout\(initializeAccess/);
  assert.doesNotMatch(home, /setTimeout\(queueSync/);
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
  assert.match(home, /Make productive assets liquid/);
  assert.match(home, /tokenized financial positions/);
  assert.match(home, /The moat is not lending/);
  assert.match(home, /Verify the value/);
  assert.match(home, /Form the position/);
  assert.match(home, /Open market access/);
  assert.match(home, /Businesses and asset providers/);
  assert.match(home, /Market participants/);
  assert.match(home, /Institutions and settlement partners/);
  assert.match(accessRouter, /function publicInfrastructureStatus\(\)/);
  assert.match(accessRouter, /ON_CHAIN_USDC_MARKET_READINESS/);
  assert.match(accessRouter, /MONEYGRAM_SANDBOX_CERTIFICATION_TEST/);
  assert.match(accessRouter, /record\.anchorStatus/);
  assert.match(accessRouter, /TWO_SIDED/);
  assert.match(accessRouter, /infrastructureStatus: publicInfrastructureStatus\(\)/);
  assert.doesNotMatch(home, /licensed bank/i);
  assert.doesNotMatch(home, /freely tradeable from day one/i);
});
