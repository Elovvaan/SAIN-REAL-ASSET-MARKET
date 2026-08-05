const baseUrl = String(process.env.SRA_PRODUCTION_URL || 'https://sain-real-asset-market-production.up.railway.app').replace(/\/$/, '');

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch { throw new Error(`${path} returned non-JSON content (${response.status}): ${text.slice(0, 300)}`); }
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body).slice(0, 800)}`);
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const health = await request('/api/health');
assert(health.status === 'ok', `Health status is ${health.status || 'missing'}.`);
assert(health.startupState === 'READY', `Startup state is ${health.startupState || 'missing'}.`);

const productStatus = await request('/api/production/products/status');
assert(productStatus.standard === 'SRA_PRODUCT_QUALIFICATION_V1', 'Product qualification standard is unavailable.');
assert(Number(productStatus.activeProducts) >= 10, `Expected at least 10 active products, received ${productStatus.activeProducts}.`);

const catalog = await request('/api/production/products');
assert(Array.isArray(catalog.products), 'Product catalog did not return a products array.');
assert(catalog.products.some((product) => product.productCode === 'TRUE_BILL'), 'TRUE_BILL is missing from the hydrated product catalog.');

const trueBill = await request('/api/production/products/TRUE_BILL');
assert(trueBill.productCode === 'TRUE_BILL', 'TRUE_BILL product lookup returned the wrong product.');
assert(trueBill.state === 'ACTIVE', `TRUE_BILL state is ${trueBill.state || 'missing'}.`);

const candidates = await request('/api/production/products/TRUE_BILL/qualification-candidates');
assert(candidates.productCode === 'TRUE_BILL', 'True Bill candidate endpoint returned the wrong product code.');
assert(Array.isArray(candidates.candidates), 'True Bill candidate endpoint did not return a candidates array.');

const qualifications = await request('/api/production/products/qualifications/records?productCode=TRUE_BILL');
assert(Array.isArray(qualifications.qualifications), 'Qualification record endpoint did not return an array.');

const readiness = await request('/api/production/readiness');
assert(readiness.productionBoundary === 'SRA_READY_FOR_EXPORT', `Unexpected production boundary: ${readiness.productionBoundary}.`);
assert(readiness.externalAdaptersRequiredForCore === false, 'External adapters are incorrectly required for core readiness.');
assert(readiness.productQualification?.standard === 'SRA_PRODUCT_QUALIFICATION_V1', 'Readiness response does not include the product qualification standard.');

console.log(JSON.stringify({
  ok: true,
  baseUrl,
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
