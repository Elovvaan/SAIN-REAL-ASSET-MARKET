const baseUrl = process.env.SRA_BASE_URL || 'http://127.0.0.1:3000';
const concurrency = Number(process.env.SRA_LOAD_CONCURRENCY || 20);
const requests = Number(process.env.SRA_LOAD_REQUESTS || 500);
const timeoutMs = Number(process.env.SRA_LOAD_TIMEOUT_MS || 10000);
const paths = ['/api/health', '/api/startup', '/api/marketplace-listings/status'];

const durations = [];
const statuses = {};
let failures = 0;
let cursor = 0;

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= requests) return;
    const path = paths[index % paths.length];
    const started = performance.now();
    try {
      const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json', 'x-load-qualification': 'true' } });
      durations.push(performance.now() - started);
      statuses[response.status] = (statuses[response.status] || 0) + 1;
      if (!response.ok) failures += 1;
      await response.arrayBuffer();
    } catch {
      durations.push(performance.now() - started);
      failures += 1;
      statuses.NETWORK_ERROR = (statuses.NETWORK_ERROR || 0) + 1;
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
durations.sort((a, b) => a - b);
const percentile = (p) => durations[Math.min(durations.length - 1, Math.floor(durations.length * p))] || 0;
const report = {
  baseUrl,
  requests,
  concurrency,
  failures,
  failureRate: requests ? failures / requests : 0,
  statuses,
  latencyMs: {
    min: Number((durations[0] || 0).toFixed(2)),
    p50: Number(percentile(0.5).toFixed(2)),
    p95: Number(percentile(0.95).toFixed(2)),
    p99: Number(percentile(0.99).toFixed(2)),
    max: Number((durations.at(-1) || 0).toFixed(2)),
  },
  qualified: failures === 0 && percentile(0.95) < Number(process.env.SRA_LOAD_P95_LIMIT_MS || 1500),
  generatedAt: new Date().toISOString(),
};
console.log(JSON.stringify(report, null, 2));
if (!report.qualified) process.exitCode = 1;
