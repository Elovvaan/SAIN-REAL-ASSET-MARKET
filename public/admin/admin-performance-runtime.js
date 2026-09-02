(() => {
  if (window.__sraAdminPerformanceRuntimeInstalled) return;
  window.__sraAdminPerformanceRuntimeInstalled = true;

  const baseClient = window.SRAAdminDataClient || null;
  const nativeFetch = window.fetch.bind(window);
  const cache = new Map();
  const inFlight = new Map();
  const FRESH_TTL_MS = 30_000;
  const STALE_TTL_MS = 120_000;
  let generation = 0;

  function rawUrl(input) {
    const raw = typeof input === 'string' ? input : input?.url;
    return new URL(raw, location.origin);
  }

  function normalizeUrl(input) {
    const url = rawUrl(input);
    url.searchParams.delete('_');
    return url;
  }

  function methodOf(input, init = {}) {
    return String(init.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
  }

  function cacheable(url, method) {
    if (method !== 'GET' || url.origin !== location.origin) return false;
    if (url.pathname === '/api/admin/session' || url.pathname === '/api/admin/bootstrap-status') return false;
    if (url.pathname.startsWith('/api/admin/')) return true;
    if (url.pathname === '/api/sane/operations-queue') return true;
    if (url.pathname === '/api/on-chain/status' || url.pathname === '/api/on-chain/assets' || url.pathname === '/api/on-chain/source-positions' || url.pathname === '/api/on-chain/market-offers') return true;
    return false;
  }

  function explicitlyFresh(input, init = {}) {
    const url = rawUrl(input);
    return url.searchParams.has('_') || init.cache === 'reload';
  }

  async function snapshot(response) {
    return {
      body: await response.clone().text(),
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      storedAt: Date.now(),
    };
  }

  function restore(value) {
    return new Response(value.body, {
      status: value.status,
      statusText: value.statusText,
      headers: value.headers,
    });
  }

  function keyFor(url) {
    return `${url.pathname}${url.search}`;
  }

  function invalidate() {
    generation += 1;
    cache.clear();
  }

  function invalidateKey(key) {
    generation += 1;
    cache.delete(key);
  }

  async function execute(input, init) {
    if (baseClient?.request) return baseClient.request(input, init);
    return nativeFetch(input, init);
  }

  async function fetchFresh(key, input, init, requestGeneration = generation) {
    const existing = inFlight.get(key);
    if (existing?.generation === requestGeneration) return existing.promise;

    const pending = execute(input, init)
      .then(async (response) => {
        const value = await snapshot(response);
        if (response.ok && generation === requestGeneration) cache.set(key, value);
        return value;
      })
      .finally(() => {
        const current = inFlight.get(key);
        if (current?.promise === pending) inFlight.delete(key);
      });

    inFlight.set(key, { generation: requestGeneration, promise: pending });
    return pending;
  }

  async function fastRequest(input, init = {}) {
    const method = methodOf(input, init);
    const url = normalizeUrl(input);
    if (!cacheable(url, method)) return execute(input, init);

    const key = keyFor(url);
    if (explicitlyFresh(input, init)) {
      invalidateKey(key);
      const requestGeneration = generation;
      return restore(await fetchFresh(key, input, { ...init, cache: 'reload' }, requestGeneration));
    }

    const value = cache.get(key);
    if (value) {
      const age = Date.now() - value.storedAt;
      if (age <= FRESH_TTL_MS) return restore(value);
      if (age <= STALE_TTL_MS) {
        const requestGeneration = generation;
        void fetchFresh(key, input, init, requestGeneration).catch(() => {});
        return restore(value);
      }
      cache.delete(key);
    }

    const requestGeneration = generation;
    const existing = inFlight.get(key);
    if (existing?.generation === requestGeneration) return restore(await existing.promise);
    return restore(await fetchFresh(key, input, init, requestGeneration));
  }

  async function fastJson(url, init = {}) {
    const response = await fastRequest(url, {
      ...init,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', ...(init.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed with HTTP ${response.status}.`);
      error.payload = payload;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function refresh(source = 'manual') {
    invalidate();
    if (baseClient?.refresh) return baseClient.refresh(source);
    window.dispatchEvent(new CustomEvent('sra:admin-refresh', {
      detail: { source, requestedAt: new Date().toISOString() },
    }));
  }

  window.fetch = fastRequest;
  if (baseClient) {
    window.SRAAdminDataClient = Object.freeze({
      request: fastRequest,
      json: fastJson,
      refresh,
      workspaceLimit: baseClient.workspaceLimit,
    });
  }

  window.addEventListener('sra:admin-mutated', invalidate);
  window.addEventListener('sra:admin-refresh', invalidate);
  window.addEventListener('sra-admin-session-expired', invalidate);
  window.addEventListener('sra-admin-session-restored', invalidate);

  window.SRAAdminPerformance = Object.freeze({
    clear: invalidate,
    status() {
      return {
        cachedReads: cache.size,
        inFlightReads: inFlight.size,
        freshTtlMs: FRESH_TTL_MS,
        staleTtlMs: STALE_TTL_MS,
        generation,
        dataClientWrapped: Boolean(baseClient),
      };
    },
  });
})();
