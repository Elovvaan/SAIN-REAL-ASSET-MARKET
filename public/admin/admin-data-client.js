(() => {
  if (window.SRAAdminDataClient) return;

  const nativeFetch = window.fetch.bind(window);
  const activeWrites = new Map();
  const WORKSPACE_RECORD_LIMIT = 100;

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
  });

  const fromSnapshot = (value) => new Response(value.body, {
    status: value.status,
    statusText: value.statusText,
    headers: value.headers,
  });

  async function reconcileNativePlatformAsset() {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    const response = await nativeFetch('/api/admin/platform-asset', {
      credentials: 'same-origin',
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

  async function request(input, init = {}) {
    const originalUrl = typeof input === 'string' ? input : input?.url;
    const url = normalizeWorkspaceUrl(new URL(originalUrl, location.origin));
    const method = String(init.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
    const sameOrigin = url.origin === location.origin;
    const key = sameOrigin ? governedKey(url, method) : null;
    const normalizedInput = typeof input === 'string'
      ? (url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : url.toString())
      : new Request(url.toString(), input);
    const options = { credentials: 'same-origin', ...init };

    if (key && activeWrites.has(key)) return fromSnapshot(await activeWrites.get(key));

    const execute = async () => {
      try {
        return await nativeFetch(normalizedInput, options);
      } catch (error) {
        if (key === 'NATIVE_PLATFORM_ASSET_BOOTSTRAP' && /timed out|did not confirm completion/i.test(String(error?.message || error))) {
          const reconciled = await reconcileNativePlatformAsset();
          if (reconciled) return reconciled;
        }
        throw error;
      }
    };

    let response;
    if (key) {
      const pending = execute().then(snapshot).finally(() => activeWrites.delete(key));
      activeWrites.set(key, pending);
      response = fromSnapshot(await pending);
    } else {
      response = await execute();
    }

    if (sameOrigin && url.pathname.startsWith('/api/admin/') && !['GET', 'HEAD', 'OPTIONS'].includes(method) && response.ok) {
      window.dispatchEvent(new CustomEvent('sra:admin-mutated', {
        detail: { method, path: url.pathname, mutatedAt: new Date().toISOString() },
      }));
    }
    return response;
  }

  async function json(url, init = {}) {
    const response = await request(url, {
      ...init,
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', ...(init.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed with HTTP ${response.status}.`);
      error.payload = payload;
      error.status = response.status;
      throw error;
    }
    return new URL(url, location.origin).pathname === '/api/admin/workspaces' ? enrichWorkspacePayload(payload) : payload;
  }

  function refresh(source = 'manual') {
    window.dispatchEvent(new CustomEvent('sra:admin-refresh', {
      detail: { source, requestedAt: new Date().toISOString() },
    }));
  }

  window.SRAAdminDataClient = Object.freeze({ request, json, refresh, workspaceLimit: WORKSPACE_RECORD_LIMIT });
})();
