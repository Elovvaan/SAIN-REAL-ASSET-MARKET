const baseUrl = String(process.env.SRA_PRODUCTION_URL || 'https://www.sainrealasset.com').replace(/\/$/, '');
const timings = {};

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

async function requestJson(path) {
  const response = await timedFetch(path, { headers: { accept: 'application/json' } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch { throw new Error(`${path} returned non-JSON content (${response.status}): ${text.slice(0, 300)}`); }
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body).slice(0, 800)}`);
  return body;
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

await requestText('/', '<html');
await requestText('/admin/', 'admin-bootstrap.js');
await Promise.all([
  requestText('/admin/admin-bootstrap.js', '__sraAdminBootstrapInstalled'),
  requestText('/admin/admin-suite-shell.js', 'const WORKSPACES = ['),
  requestText('/admin/admin-data-client.js', 'SRAAdminDataClient'),
  requestText('/admin/admin-navigation-simplifier.js', '__sraAdminNavigationSimplifierInstalled'),
  requestText('/admin/admin-workstation-controls.js', '__sraAdminWorkstationControlsInstalled'),
]);

const health = await requestJson('/api/health');
assert(health.status === 'ok', `Health status is ${health.status || 'missing'}.`);
assert(health.startupState === 'READY', `Startup state is ${health.startupState || 'missing'}.`);

const productStatus = await requestJson('/api/production/products/status');
assert(productStatus.standard === 'SRA_PRODUCT_QUALIFICATION_V1', 'Product qualification standard is unavailable.');
assert(Number(productStatus.activeProducts) >= 10, `Expected at least 10 active products, received ${productStatus.activeProducts}.`);

const catalog = await requestJson('/api/production/products');
assert(Array.isArray(catalog.products), 'Product catalog did not return a products array.');
assert(catalog.products.some((product) => product.productCode === 'TRUE_BILL'), 'TRUE_BILL is missing from the hydrated product catalog.');

const trueBill = await requestJson('/api/production/products/TRUE_BILL');
assert(trueBill.productCode === 'TRUE_BILL', 'TRUE_BILL product lookup returned the wrong product code.');
assert(trueBill.state === 'ACTIVE', `TRUE_BILL state is ${trueBill.state || 'missing'}.`);

const candidates = await requestJson('/api/production/products/TRUE_BILL/qualification-candidates');
assert(candidates.productCode === 'TRUE_BILL', 'True Bill candidate endpoint returned the wrong product code.');
assert(Array.isArray(candidates.candidates), 'True Bill candidate endpoint did not return a candidates array.');

const qualifications = await requestJson('/api/production/products/qualifications/records?productCode=TRUE_BILL');
assert(Array.isArray(qualifications.qualifications), 'Qualification record endpoint did not return an array.');

const readiness = await requestJson('/api/production/readiness');
assert(readiness.productionBoundary === 'SRA_READY_FOR_EXPORT', `Unexpected production boundary: ${readiness.productionBoundary}.`);
assert(readiness.externalAdaptersRequiredForCore === false, 'External adapters are incorrectly required for core readiness.');
assert(readiness.productQualification?.standard === 'SRA_PRODUCT_QUALIFICATION_V1', 'Readiness response does not include the product qualification standard.');

const slow = Object.entries(timings).filter(([, milliseconds]) => milliseconds >= 5000).sort((a, b) => b[1] - a[1]);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  timings,
  slow,
  health: { status: health.status, startupState: health.startupState },
  productStatus,
  catalogCount: catalog.products.length,
  trueBillCandidates: candidates.candidates.length,
  trueBillQualifications: qualifications.qualifications.length,
  readiness: {
    status: readiness.status,
    productionBoundary: readiness.productionBoundary,
    currentProductionPhase: readiness.currentProductionPhase,
  },
}, null, 2));
