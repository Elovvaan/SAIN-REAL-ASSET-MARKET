const baseUrl = String(process.env.SRA_PRODUCTION_URL || 'https://www.sainrealasset.com').replace(/\/$/, '');
const expectedCommit = String(process.env.SRA_EXPECTED_COMMIT || '').trim();
const timings = {};
const failures = [];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function timedFetch(path, options = {}) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(20_000),
      ...options,
      headers: { ...(options.headers || {}) },
    });
    timings[path] = Date.now() - startedAt;
    return response;
  } catch (error) {
    timings[path] = Date.now() - startedAt;
    throw new Error(`${path} failed after ${timings[path]}ms: ${error.message}`);
  }
}

async function requestJson(path, { expectedStatuses = [200] } = {}) {
  const response = await timedFetch(path, { headers: { accept: 'application/json' } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch { throw new Error(`${path} returned non-JSON content (${response.status}): ${text.slice(0, 300)}`); }
  if (!expectedStatuses.includes(response.status)) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body).slice(0, 800)}`);
  return { body, status: response.status };
}

async function requestText(path, expectedContent = null) {
  const response = await timedFetch(path, { headers: { accept: 'text/html,application/javascript,text/css,*/*' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${text.slice(0, 300)}`);
  if (expectedContent && !text.includes(expectedContent)) throw new Error(`${path} did not contain expected content: ${expectedContent}`);
  return text;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function localAssets(html) {
  const paths = new Set();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const value = match[1];
    if (!value.startsWith('/')) continue;
    if (!/\.(?:js|css)(?:\?|$)/i.test(value)) continue;
    paths.add(value.split('?')[0]);
  }
  return [...paths];
}

async function capture(label, operation) {
  try { return await operation(); }
  catch (error) {
    failures.push({ label, error: error.message });
    return null;
  }
}

async function waitForCurrentDeployment() {
  if (!expectedCommit) return null;
  const deadline = Date.now() + 180_000;
  let lastHealth = null;
  while (Date.now() < deadline) {
    try {
      const response = await timedFetch('/api/health', { headers: { accept: 'application/json' } });
      const text = await response.text();
      lastHealth = text ? JSON.parse(text) : null;
      if (lastHealth?.deployment?.commitSha === expectedCommit && response.status === 200) return lastHealth;
    } catch {}
    await sleep(10_000);
  }
  throw new Error(`Production did not reach expected commit ${expectedCommit}. Live commit is ${lastHealth?.deployment?.commitSha || 'unreported'}; startup state is ${lastHealth?.startupState || 'unknown'}.`);
}

await capture('deployment synchronization', waitForCurrentDeployment);

const publicHtml = await capture('public page', () => requestText('/', '<html'));
const adminHtml = await capture('admin page', () => requestText('/admin/', 'admin-bootstrap.js'));

const assetPaths = new Set([
  ...(publicHtml ? localAssets(publicHtml) : []),
  ...(adminHtml ? localAssets(adminHtml) : []),
  '/admin/admin-bootstrap.js',
  '/admin/admin-suite-shell.js',
  '/admin/admin-data-client.js',
  '/admin/admin-navigation-simplifier.js',
  '/admin/admin-workstation-controls.js',
]);

await Promise.all([...assetPaths].map((path) => capture(`asset ${path}`, () => requestText(path))));

const healthResult = await capture('health', () => requestJson('/api/health'));
const health = healthResult?.body || null;
if (health) {
  await capture('health status', async () => {
    assert(health.status === 'ok', `Health status is ${health.status || 'missing'}.`);
    assert(health.startupState === 'READY', `Startup state is ${health.startupState || 'missing'}.`);
    if (expectedCommit) assert(health.deployment?.commitSha === expectedCommit, `Live commit ${health.deployment?.commitSha || 'unreported'} does not match ${expectedCommit}.`);
  });
}

await capture('admin bootstrap status', () => requestJson('/api/admin/bootstrap-status'));
await capture('admin session endpoint', () => requestJson('/api/admin/session'));
await capture('admin authentication gate', async () => {
  const result = await requestJson('/api/admin/workspaces?workspace=treasury&tab=Overview&limit=1', { expectedStatuses: [401] });
  assert(result.status === 401, `Unauthenticated admin workspace returned ${result.status}.`);
});

const productStatusResult = await capture('product status', () => requestJson('/api/production/products/status'));
const productStatus = productStatusResult?.body || null;
if (productStatus) await capture('product status contract', async () => {
  assert(productStatus.standard === 'SRA_PRODUCT_QUALIFICATION_V1', 'Product qualification standard is unavailable.');
  assert(Number(productStatus.activeProducts) >= 10, `Expected at least 10 active products, received ${productStatus.activeProducts}.`);
});

const catalogResult = await capture('product catalog', () => requestJson('/api/production/products'));
const catalog = catalogResult?.body || null;
if (catalog) await capture('product catalog contract', async () => {
  assert(Array.isArray(catalog.products), 'Product catalog did not return a products array.');
  assert(catalog.products.some((product) => product.productCode === 'TRUE_BILL'), 'TRUE_BILL is missing from the hydrated product catalog.');
});

const trueBillResult = await capture('TRUE_BILL lookup', () => requestJson('/api/production/products/TRUE_BILL'));
const trueBill = trueBillResult?.body || null;
if (trueBill) await capture('TRUE_BILL contract', async () => {
  assert(trueBill.productCode === 'TRUE_BILL', 'TRUE_BILL product lookup returned the wrong product code.');
  assert(trueBill.state === 'ACTIVE', `TRUE_BILL state is ${trueBill.state || 'missing'}.`);
});

const candidatesResult = await capture('TRUE_BILL candidates', () => requestJson('/api/production/products/TRUE_BILL/qualification-candidates'));
const candidates = candidatesResult?.body || null;
if (candidates) await capture('TRUE_BILL candidate contract', async () => {
  assert(candidates.productCode === 'TRUE_BILL', 'True Bill candidate endpoint returned the wrong product code.');
  assert(Array.isArray(candidates.candidates), 'True Bill candidate endpoint did not return a candidates array.');
});

const qualificationsResult = await capture('qualification records', () => requestJson('/api/production/products/qualifications/records?productCode=TRUE_BILL'));
const qualifications = qualificationsResult?.body || null;
if (qualifications) await capture('qualification record contract', async () => {
  assert(Array.isArray(qualifications.qualifications), 'Qualification record endpoint did not return an array.');
});

const readinessResult = await capture('production readiness', () => requestJson('/api/production/readiness'));
const readiness = readinessResult?.body || null;
if (readiness) await capture('production readiness contract', async () => {
  assert(readiness.productionBoundary === 'SRA_READY_FOR_EXPORT', `Unexpected production boundary: ${readiness.productionBoundary}.`);
  assert(readiness.externalAdaptersRequiredForCore === false, 'External adapters are incorrectly required for core readiness.');
  assert(readiness.productQualification?.standard === 'SRA_PRODUCT_QUALIFICATION_V1', 'Readiness response does not include the product qualification standard.');
});

const slow = Object.entries(timings).filter(([, milliseconds]) => milliseconds >= 5000).sort((a, b) => b[1] - a[1]);
const report = {
  ok: failures.length === 0 && slow.length === 0,
  baseUrl,
  expectedCommit: expectedCommit || null,
  liveCommit: health?.deployment?.commitSha || null,
  deployment: health?.deployment || null,
  startup: health ? { state: health.startupState, startedAt: health.startedAt, milestones: health.milestones } : null,
  timings,
  slow,
  failures,
  checkedAssets: [...assetPaths],
  health: health ? { status: health.status, startupState: health.startupState } : null,
  productStatus,
  catalogCount: catalog?.products?.length ?? null,
  trueBillCandidates: candidates?.candidates?.length ?? null,
  trueBillQualifications: qualifications?.qualifications?.length ?? null,
  readiness: readiness ? {
    status: readiness.status,
    productionBoundary: readiness.productionBoundary,
    currentProductionPhase: readiness.currentProductionPhase,
  } : null,
};

console.log(JSON.stringify(report, null, 2));
if (slow.length) failures.push({ label: 'performance', error: `${slow.length} production request(s) took at least 5 seconds.` });
if (failures.length) throw new Error(`Production diagnostics failed: ${failures.map((item) => `${item.label}: ${item.error}`).join(' | ')}`);
