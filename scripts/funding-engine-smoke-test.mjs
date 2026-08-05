const baseUrl = (process.env.SRA_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const endpoints = [
  ['/api/health', 'platform health'],
  ['/api/startup', 'startup registry'],
  ['/api/funding/status', 'phase 1 intake'],
  ['/api/funding-verification/status', 'phase 2 verification'],
  ['/api/funding-value/status', 'phase 3 value preparation'],
  ['/api/funding-model/status', 'phase 4 model selection'],
  ['/api/funding-instrument/status', 'phase 5 instrument selection'],
  ['/api/funding-instrument-review/status', 'phase 6 instrument review'],
  ['/api/funding-instrument-issuance/status', 'phase 7 issuance'],
  ['/api/funding-marketplace/status', 'phase 8 marketplace preparation'],
  ['/api/funding-marketplace-publication/status', 'phase 9 publication'],
  ['/api/funding-marketplace-commitment/status', 'phase 10 commitments'],
  ['/api/funding-marketplace-allocation/status', 'phase 11 allocation'],
  ['/api/funding-marketplace-settlement/status', 'phase 12 settlement'],
  ['/api/on-chain/status', 'on-chain projection'],
];

const results = [];
for (const [path, label] of endpoints) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, { headers: { accept: 'application/json' } });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    results.push({ label, path, ok: response.ok, status: response.status, durationMs: Date.now() - startedAt, body });
  } catch (error) {
    results.push({ label, path, ok: false, status: 0, durationMs: Date.now() - startedAt, error: error.message });
  }
}

const failures = results.filter((result) => !result.ok);
console.table(results.map(({ label, path, ok, status, durationMs }) => ({ label, path, ok, status, durationMs })));

if (failures.length) {
  console.error('\nFunding engine smoke test failed.');
  for (const failure of failures) console.error(`- ${failure.label}: ${failure.path} (${failure.status || failure.error})`);
  process.exitCode = 1;
} else {
  console.log(`\nFunding engine smoke test passed against ${baseUrl}. All ${results.length} service boundaries responded successfully.`);
}
