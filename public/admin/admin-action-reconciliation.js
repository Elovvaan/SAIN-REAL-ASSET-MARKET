(() => {
  if (window.__sraAdminActionReconciliationInstalled) return;
  window.__sraAdminActionReconciliationInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const activeWrites = new Map();

  function normalizeAgentPrompts() {
    document.querySelectorAll('[data-prompt]').forEach((button) => {
      const prompt = String(button.dataset.prompt || '');
      if (/incomplete\s+product\s+workflows/i.test(prompt)) {
        button.dataset.prompt = 'Generate an operational brief showing all incomplete workflows and the next action for each.';
      }
    });
  }

  async function responseSnapshot(response) {
    return {
      body: await response.clone().text(),
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
    };
  }

  function responseFromSnapshot(snapshot) {
    return new Response(snapshot.body, {
      status: snapshot.status,
      statusText: snapshot.statusText,
      headers: snapshot.headers,
    });
  }

  async function reconcileNativePlatformAsset() {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    const statusResponse = await nativeFetch('/api/admin/platform-asset', {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
    const status = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok || !status.readyForExport) return null;
    return new Response(JSON.stringify({
      created: false,
      reconciledAfterTimeout: true,
      status,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function governedKey(url, method) {
    if (method === 'POST' && url.includes('/api/admin/platform-asset/bootstrap')) return 'NATIVE_PLATFORM_ASSET_BOOTSTRAP';
    if (method === 'POST' && url.includes('/api/admin/listing-readiness-batch/approve')) return 'LISTING_READINESS_BATCH';
    if (method === 'POST' && url.includes('/api/admin/listing-publication-batch/approve')) return 'LISTING_PUBLICATION_BATCH';
    return null;
  }

  window.fetch = async (input, options = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const method = String(options.method || input?.method || 'GET').toUpperCase();
    const key = governedKey(url, method);
    if (!key) return nativeFetch(input, options);

    const existing = activeWrites.get(key);
    if (existing) return responseFromSnapshot(await existing);

    const pending = (async () => {
      try {
        return await responseSnapshot(await nativeFetch(input, options));
      } catch (error) {
        if (key === 'NATIVE_PLATFORM_ASSET_BOOTSTRAP' && /timed out|did not confirm completion/i.test(String(error?.message || error))) {
          const reconciled = await reconcileNativePlatformAsset();
          if (reconciled) return responseSnapshot(reconciled);
        }
        throw error;
      }
    })().finally(() => activeWrites.delete(key));

    activeWrites.set(key, pending);
    return responseFromSnapshot(await pending);
  };

  normalizeAgentPrompts();
  const observer = new MutationObserver(normalizeAgentPrompts);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
