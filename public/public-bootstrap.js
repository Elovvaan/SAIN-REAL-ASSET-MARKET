(() => {
  if (window.__sraPublicBootstrapInstalled) return;
  window.__sraPublicBootstrapInstalled = true;

  const CORE_PARALLEL_FEATURES = [
    '/sane-skills.js',
    '/public-chat-runtime.js',
    '/public-home.js',
    '/sane-chat-format.js',
    '/access.js',
    '/sra-authenticated-fetch.js',
  ];

  const CORE_FINAL_FEATURES = [
    '/participant-workspace-bootstrap.js',
  ];

  const VIEW_FEATURES = {
    marketplace: {
      parallel: ['/transaction-market-ui.js', '/order-intent-ui.js', '/live-market-publication-sync.js'],
    },
    custody: {
      parallel: ['/funding-intake-ui.js'],
    },
    'funding-operations': {
      first: ['/participant-financing-ui.js'],
      parallel: ['/participant-instrument-info.js', '/funding-intake-identity-evidence.js', '/sain-operations-intelligence.js'],
    },
    onboarding: {
      parallel: ['/onboarding.js'],
    },
    interoperability: {
      parallel: ['/interoperability.js'],
    },
    pools: {
      parallel: ['/hybrid-liquidity-market.js'],
    },
    events: {
      parallel: ['/event-market.js'],
    },
    'institution-participation': {
      parallel: ['/institution-workspace-loader.js'],
    },
  };
  const viewLoads = new Map();
  const readyViews = new Set();
  const LEGACY_ACTIVATION_VIEWS = new Set(['onboarding', 'interoperability', 'institution-participation']);

  function markerFor(source) {
    return `data-sra-public-${source.replace(/^\//, '').replace(/\.js$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  }

  function loadScript(source) {
    return new Promise((resolve, reject) => {
      const marker = markerFor(source);
      const existing = document.querySelector(`script[${marker}]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') resolve();
        else {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', reject, { once: true });
        }
        return;
      }

      const script = document.createElement('script');
      script.src = source;
      script.async = true;
      script.setAttribute(marker, 'true');
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${source}`)), { once: true });
      document.head.append(script);
    });
  }

  async function loadCore() {
    await Promise.all(CORE_PARALLEL_FEATURES.map(loadScript));

    if (document.readyState !== 'loading' && typeof window.initializeAccess === 'function') {
      await window.initializeAccess();
    }

    await Promise.all(CORE_FINAL_FEATURES.map(loadScript));

    window.dispatchEvent(new CustomEvent('sra:public-booted', {
      detail: {
        featureCount: CORE_PARALLEL_FEATURES.length + CORE_FINAL_FEATURES.length,
        lazyWorkspaceCount: Object.keys(VIEW_FEATURES).length,
        bootedAt: new Date().toISOString(),
      },
    }));
  }

  async function loadWorkspaceFeatures(view) {
    const definition = VIEW_FEATURES[view];
    if (!definition || readyViews.has(view)) return;
    if (viewLoads.has(view)) return viewLoads.get(view);
    const pending = (async () => {
      for (const source of definition.first || []) await loadScript(source);
      await Promise.all((definition.parallel || []).map(loadScript));
      readyViews.add(view);
      window.dispatchEvent(new CustomEvent('sra:public-workspace-features-ready', {
        detail: { view, featureCount:(definition.first?.length || 0) + (definition.parallel?.length || 0), readyAt:new Date().toISOString() },
      }));
      if (LEGACY_ACTIVATION_VIEWS.has(view)) {
        queueMicrotask(() => document.querySelector(`.nav-item[data-view="${view}"]`)?.click());
      }
    })().catch((error) => {
      viewLoads.delete(view);
      console.error(`SRA public workspace failed to load: ${view}`, error);
      throw error;
    });
    viewLoads.set(view, pending);
    return pending;
  }

  function requestedView(event) {
    return event.target?.closest?.('[data-view],[data-suite-view],[data-participant-view]')?.dataset.view
      || event.target?.closest?.('[data-suite-view]')?.dataset.suiteView
      || event.target?.closest?.('[data-participant-view]')?.dataset.participantView
      || null;
  }

  window.SRAPublicFeatures = {
    ensure: loadWorkspaceFeatures,
    isReady: (view) => !VIEW_FEATURES[view] || readyViews.has(view),
    requires: (view) => Boolean(VIEW_FEATURES[view]),
  };

  document.addEventListener('click', (event) => {
    const view = requestedView(event);
    if (view) void loadWorkspaceFeatures(view).catch(() => {});
  }, true);

  void loadCore()
    .catch((error) => {
      console.error('SRA public bootstrap failed.', error);
    });
})();
