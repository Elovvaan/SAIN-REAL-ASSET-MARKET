(() => {
  if (window.SRAAdminDataClient) return;

  const nativeFetch = window.fetch.bind(window);
  const activeWrites = new Map();
  const inFlightReads = new Map();
  const readCache = new Map();
  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
  const WORKSPACE_RECORD_LIMIT = 100;
  const ADMIN_SESSION_TIMEOUT_MS = 15_000;
  const ADMIN_READ_TIMEOUT_MS = 60_000;
  const ADMIN_WRITE_TIMEOUT_MS = 180_000;
  const ADMIN_READ_CACHE_TTL_MS = 5_000;
  const ADMIN_HIDDEN_CACHE_TTL_MS = 60_000;
  let sessionExpired = false;

  const governedKey = (url, method) => {
    if (method === 'POST' && url.pathname === '/api/admin/platform-asset/bootstrap') return 'NATIVE_PLATFORM_ASSET_BOOTSTRAP';
    if (method === 'POST' && url.pathname === '/api/admin/listing-readiness-batch/approve') return 'LISTING_READINESS_BATCH';
    if (method === 'POST' && url.pathname === '/api/admin/listing-publication-batch/approve') return 'LISTING_PUBLICATION_BATCH';
    return null;
  };

  const normalizeWorkspaceUrl = (url) => {
    if (url.pathname !== '/api/admin/workspaces') return url;
    const requested = Number(url.searchParams.get('limit') || 0);
    if (!requested || requested > WORKSPACE_RECORD_LIMIT) url.searchParams.set('limit', String(WORKSPACE_RECORD_LIMIT));
    url.searchParams.delete('_');
    return url;
  };

  const enrichWorkspacePayload = (payload) => {
    const records = payload?.records;
    if (!records || typeof records !== 'object') return payload;
    const existing = Array.isArray(records.settlementInstructions) ? records.settlementInstructions : [];
    const treasury = (Array.isArray(records.transactions) ? records.transactions : [])
      .filter((record) => String(record?.transactionType || '').toUpperCase() === 'EXTERNAL_TRANSFER_INSTRUCTION')
      .map((record) => ({
        ...record,
        instructionId: record.instructionId || record.transferInstructionId || record.transactionId,
        amount: record.amount ?? record.amountUsd ?? record.quantity,
        receivingAccountReference: record.receivingAccountReference || record.destinationReference || null,
      }));
    if (treasury.length) {
      const seen = new Set(existing.map((record) => record.instructionId || record.transferInstructionId || record.transactionId).filter(Boolean));
      records.settlementInstructions = [
        ...existing,
        ...treasury.filter((record) => {
          const key = record.instructionId || record.transferInstructionId || record.transactionId;
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      ];
    }
    return payload;
  };

  const snapshot = async (response) => ({
    body: await response.clone().text(),
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    storedAt: Date.now(),
  });

  const fromSnapshot = (value) => new Response(value.body, {
    status: value.status,
    statusText: value.statusText,
    headers: value.headers,
  });

  function cachedResponse(key, maxAgeMs) {
    const value = readCache.get(key);
    if (!value) return null;
    if (Date.now() - value.storedAt > maxAgeMs) {
      readCache.delete(key);
      return null;
    }
    return fromSnapshot(value);
  }

  function timeoutFor(isAdminRequest, isSessionProbe, method) {
    if (!isAdminRequest) return 0;
    if (isSessionProbe) return ADMIN_SESSION_TIMEOUT_MS;
    return SAFE_METHODS.has(method) ? ADMIN_READ_TIMEOUT_MS : ADMIN_WRITE_TIMEOUT_MS;
  }

  function markSessionExpired() {
    if (sessionExpired) return;
    sessionExpired = true;
    readCache.clear();
    inFlightReads.clear();
    window.__sraAdminSessionExpired = true;
    window.dispatchEvent(new CustomEvent('sra-admin-session-expired'));
  }

  function markSessionRestored() {
    if (!sessionExpired) return;
    sessionExpired = false;
    window.__sraAdminSessionExpired = false;
    window.dispatchEvent(new CustomEvent('sra-admin-session-restored'));
  }

  async function enrichWorkspaceResponse(response) {
    if (!response.ok) return response;
    try {
      const payload = enrichWorkspacePayload(await response.clone().json());
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return response;
    }
  }

  async function reconcileNativePlatformAsset() {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    const response = await nativeFetch('/api/admin/platform-asset', {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
    const status = await response.json().catch(() => ({}));
    if (!response.ok || !status.readyForExport) return null;
    return new Response(JSON.stringify({ created: false, reconciledAfterTimeout: true, status }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async function performNative(input, options, context) {
    const { isAdminRequest, isSessionProbe, method, timeoutMs, externalSignal, governed } = context;
    const controller = timeoutMs ? new AbortController() : null;
    const timer = timeoutMs
      ? window.setTimeout(() => controller.abort(new DOMException('Administration request timed out.', 'TimeoutError')), timeoutMs)
      : null;
    if (controller && externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
    }
    try {
      const response = await nativeFetch(input, {
        ...options,
        credentials: isAdminRequest ? 'include' : (options.credentials || 'same-origin'),
        cache: isAdminRequest ? 'no-store' : (options.cache || 'default'),
        signal: controller?.signal || externalSignal,
      });
      if (isAdminRequest && !isSessionProbe && response.status === 401) markSessionExpired();
      if (isAdminRequest && response.ok && sessionExpired && !SAFE_METHODS.has(method)) markSessionRestored();
      if (response.ok) return response;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) return response;
      const body = await response.clone().text().catch(() => '');
      const detail = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
      return new Response(JSON.stringify({
        error: `HTTP ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
        code: 'SRA_ADMIN_HTTP_REQUEST_FAILED',
        status: response.status,
      }), {
        status: response.status,
        statusText: response.statusText,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const timedOut = controller?.signal.aborted && !externalSignal?.aborted;
      if (timedOut && governed === 'NATIVE_PLATFORM_ASSET_BOOTSTRAP') {
        const reconciled = await reconcileNativePlatformAsset();
        if (reconciled) return reconciled;
      }
      if (timedOut) {
        const seconds = Math.round(timeoutMs / 1000);
        const operation = SAFE_METHODS.has(method) ? 'read' : 'governed action';
        throw new Error(`Administration ${operation} timed out after ${seconds} seconds. The server did not confirm completion.`);
      }
      throw error;
    } finally {
      if (timer !== null) window.clearTimeout(timer);
    }
  }

  async function request(input, init = {}) {
    const originalUrl = typeof input === 'string' ? input : input?.url;
    const url = normalizeWorkspaceUrl(new URL(originalUrl, location.origin));
    const method = String(init.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const sameOrigin = url.origin === location.origin;
    const isAdminRequest = sameOrigin && url.pathname.startsWith('/api/admin/');
    const isSessionProbe = isAdminRequest && (url.pathname === '/api/admin/session' || url.pathname === '/api/admin/bootstrap-status');
    const isWorkspaceRead = isAdminRequest && method === 'GET' && url.pathname === '/api/admin/workspaces';
    const governed = sameOrigin ? governedKey(url, method) : null;
    const externalSignal = init.signal;
    const timeoutMs = timeoutFor(isAdminRequest, isSessionProbe, method);
    const normalizedInput = typeof input === 'string'
      ? (sameOrigin ? `${url.pathname}${url.search}${url.hash}` : url.toString())
      : new Request(url.toString(), input);
    const options = { ...init };
    const readKey = `${method}:${url.pathname}${url.search}`;
    const cacheableRead = isAdminRequest && method === 'GET' && !isSessionProbe && !externalSignal;

    if (governed && activeWrites.has(governed)) return fromSnapshot(await activeWrites.get(governed));

    const execute = () => performNative(normalizedInput, options, {
      isAdminRequest,
      isSessionProbe,
      method,
      timeoutMs,
      externalSignal,
      governed,
    });

    let response;
    if (cacheableRead) {
      const maxAge = document.visibilityState === 'visible' ? ADMIN_READ_CACHE_TTL_MS : ADMIN_HIDDEN_CACHE_TTL_MS;
      const cached = cachedResponse(readKey, maxAge);
      if (cached) return cached;
      const existing = inFlightReads.get(readKey);
      if (existing) return fromSnapshot(await existing);
      const pending = execute()
        .then(async (value) => {
          const snap = await snapshot(value);
          if (value.ok) readCache.set(readKey, snap);
          return snap;
        })
        .finally(() => inFlightReads.delete(readKey));
      inFlightReads.set(readKey, pending);
      response = fromSnapshot(await pending);
    } else if (governed) {
      const pending = execute().then(snapshot).finally(() => activeWrites.delete(governed));
      activeWrites.set(governed, pending);
      response = fromSnapshot(await pending);
    } else {
      response = await execute();
    }

    if (isWorkspaceRead) response = await enrichWorkspaceResponse(response);

    if (isAdminRequest && isMutation && response.ok) {
      readCache.clear();
      window.dispatchEvent(new CustomEvent('sra-admin-data-changed'));
      window.dispatchEvent(new CustomEvent('sra:admin-mutated', {
        detail: { method, path: url.pathname, mutatedAt: new Date().toISOString() },
      }));
    }
    return response;
  }

  async function json(url, init = {}) {
    const response = await request(url, {
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
    readCache.clear();
    window.dispatchEvent(new CustomEvent('sra:admin-refresh', {
      detail: { source, requestedAt: new Date().toISOString() },
    }));
  }

  window.SRAAdminDataClient = Object.freeze({
    request,
    json,
    refresh,
    workspaceLimit: WORKSPACE_RECORD_LIMIT,
  });
  window.fetch = request;
})();
