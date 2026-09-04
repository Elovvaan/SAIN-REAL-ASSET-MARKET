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
