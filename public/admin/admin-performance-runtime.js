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
  let forceNextWorkspaceRead = false;

  function normalizeUrl(input) {
    const raw = typeof input === 'string' ? input : input?.url;
    const url = new URL(raw, location.origin);
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
    if (url.pathname === '/api/on-chain/status' || url.pathname === '/api/on-chain/assets') return true;
    return false;
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

  function forceWorkspaceRefresh() {
    invalidate();
    forceNextWorkspaceRead = true;
  }

  async function fastRequest(input, init = {}) {
    const method = methodOf(input, init);
    const url = normalizeUrl(input);
    if (!cacheable(url, method)) return execute(input, init);

    const key = keyFor(url);
    const explicitWorkspaceRefresh = forceNextWorkspaceRead && url.pathname === '/api/admin/workspaces';
    if (explicitWorkspaceRefresh) {
      forceNextWorkspaceRead = false;
      const requestGeneration = generation;
      return restore(await fetchFresh(key, input, init, requestGeneration));
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

  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-refresh-workspace]')) forceWorkspaceRefresh();
  }, true);

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
    forceWorkspaceRefresh,
    status() {
      return {
        cachedReads: cache.size,
        inFlightReads: inFlight.size,
        freshTtlMs: FRESH_TTL_MS,
        staleTtlMs: STALE_TTL_MS,
        generation,
        forceNextWorkspaceRead,
        dataClientWrapped: Boolean(baseClient),
      };
    },
  });
})();
