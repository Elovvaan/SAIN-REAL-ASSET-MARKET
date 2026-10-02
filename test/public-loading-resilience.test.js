import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (name) => fs.readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const flush = async () => { for (let i=0;i<20;i++) await Promise.resolve(); };

test('public controls finish loading while the session request remains pending', async () => {
  const loaded = [], events = [], styles = [{ media: 'print' }];
  const window = { initializeAccess: () => new Promise(() => {}), dispatchEvent: (e) => events.push(e.type) };
  const document = {
    readyState: 'complete', querySelector: () => null,
    querySelectorAll: () => styles, addEventListener() {},
    createElement: () => { const callbacks = {}; return { dataset: {}, setAttribute() {}, addEventListener: (name, fn) => { callbacks[name] = fn; }, callbacks }; },
    head: { append(script) { loaded.push(script.src); script.callbacks.load(); } },
    body: { classList: { remove() {} } },
  };
  vm.runInNewContext(read('public-bootstrap.js'), { window, document, console, setTimeout: (fn) => fn(), requestAnimationFrame: (fn) => fn(), CustomEvent: class { constructor(type) { this.type=type; } } });
  await flush();
  assert.ok(loaded.includes('/public-chat-runtime.js'));
  assert.ok(loaded.includes('/participant-workspace-bootstrap.js'));
  assert.ok(events.includes('sra:public-booted'));
  assert.equal(styles[0].media, 'all');
});

function accessHarness(fetch) {
  const timers = new Map(), events = [], state = { session: null, publicData: null };
  let id=0, paints=0;
  const window = { SRAPublicHome: { refreshNow() {} }, dispatchEvent: (e) => events.push(e.type) };
  const context = vm.createContext({ window, accessState: state, fetch, AbortController,
    setTimeout: (fn) => { timers.set(++id, fn); return id; }, clearTimeout: (id) => timers.delete(id),
    ensureAccessModal() {}, ensureAccessControls() {}, applyAccessShell() { paints++; },
    document: { body: { classList: { remove() {} } } },
    CustomEvent: class { constructor(type) { this.type=type; } },
  });
  vm.runInContext(read('access.js').slice(read('access.js').indexOf('let accessInitialization=null;')), context);
  return { state, timers, events, window, initialize: window.initializeAccess, painted: () => paints };
}

for (const phase of ['headers', 'body']) test(`access initialization recovers from stalled response ${phase}`, async () => {
  let signal;
  const h = accessHarness((path, options) => {
    signal=options.signal;
    return phase==='headers' ? new Promise(() => {}) : Promise.resolve({ ok: true, json: () => new Promise(() => {}) });
  });
  const pending = h.initialize();
  assert.equal(h.painted(), 1);
  await flush();
  for (const fn of [...h.timers.values()]) fn();
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.window.__sraPublicAccessReady, true);
  assert.ok(h.events.includes('sra:public-access-ready'));
});

test('initial session lookup preserves a sign-in completed while it was pending', async () => {
  let resolve;
  const h = accessHarness(() => new Promise((r) => { resolve=r; }));
  const pending = h.initialize();
  const signedIn = { displayName: 'Participant' };
  h.state.session=signedIn;
  resolve({ ok: true, json: async () => ({ session: null }) });
  await pending;
  assert.equal(h.state.session, signedIn);
  assert.equal(h.timers.size, 0);
});

test('workspace styles do not block the initial public display', () => {
  const links = [...read('index.html').matchAll(/<link rel="stylesheet"[^>]+>/g)].map((m) => m[0]);
  assert.equal(links.filter((link) => !link.includes('media="print"')).length, 6);
  assert.ok(links.filter((link) => link.includes('data-sra-deferred-style')).length >= 10);
  assert.ok(links.find((link) => link.includes('/access.css')).includes('media="print"') === false);
});

test('authenticated startup avoids requesting public data', async () => {
  const paths = [];
  const session = { displayName: 'Participant' };
  const h = accessHarness(async (path) => { paths.push(path); return { ok: true, json: async () => ({ session }) }; });
  await h.initialize();
  assert.deepEqual(paths, ['/api/access/session']);
  assert.equal(h.state.session, session);
});

test('signed-out startup applies public data and clears both request timers', async () => {
  const paths = [];
  const publicData = { opportunities: [{ id: 'opportunity' }] };
  const h = accessHarness(async (path) => { paths.push(path); return { ok: true, json: async () => path.endsWith('/session') ? { session: null } : publicData }; });
  await h.initialize();
  assert.deepEqual(paths, ['/api/access/session', '/api/access/public']);
  assert.equal(h.state.publicData, publicData);
  assert.equal(h.timers.size, 0);
});
