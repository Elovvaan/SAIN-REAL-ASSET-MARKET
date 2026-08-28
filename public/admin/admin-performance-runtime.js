(() => {
  if (window.__sraAdminPerformanceRuntimeInstalled) return;
  window.__sraAdminPerformanceRuntimeInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const cache = new Map();
  const inFlight = new Map();
  const FRESH_TTL_MS = 30_000;
  const STALE_TTL_MS = 120_000;

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
    cache.clear();
  }

  async function refreshInBackground(key, input, init) {
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = nativeFetch(input, init)
      .then(async (response) => {
        const value = await snapshot(response);
        if (response.ok) cache.set(key, value);
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
  }

  async function fastFetch(input, init = {}) {
    const method = methodOf(input, init);
    const url = normalizeUrl(input);
    if (!cacheable(url, method)) return nativeFetch(input, init);

    const key = keyFor(url);
    const value = cache.get(key);
    if (value) {
      const age = Date.now() - value.storedAt;
      if (age <= FRESH_TTL_MS) return restore(value);
      if (age <= STALE_TTL_MS) {
        void refreshInBackground(key, input, init).catch(() => {});
        return restore(value);
      }
      cache.delete(key);
    }

    const existing = inFlight.get(key);
    if (existing) return restore(await existing);
    return restore(await refreshInBackground(key, input, init));
  }

  window.fetch = fastFetch;
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
      };
    },
  });
})();
