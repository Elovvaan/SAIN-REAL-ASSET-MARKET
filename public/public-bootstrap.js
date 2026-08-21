(() => {
  if (window.__sraPublicBootstrapInstalled) return;
  window.__sraPublicBootstrapInstalled = true;

  const CORE_PARALLEL_FEATURES = [
    '/sane-skills.js',
    '/public-chat-runtime.js',
    '/sane-chat-format.js',
    '/access.js',
    '/sra-authenticated-fetch.js',
  ];

  const CORE_FINAL_FEATURES = [
    '/public-home.js',
    '/live-market-publication-sync.js',
  ];

  const DEFERRED_FEATURES = [
    '/interoperability.js',
    '/onboarding.js',
    '/custody.js',
    '/platform-admin-workspace.js',
    '/home-project-workspace.js',
    '/institution-workspace-loader.js',
    '/transaction-market-ui.js',
    '/order-intent-ui.js',
    '/funding-intake-ui.js',
    '/participant-financing-ui.js',
    '/funding-intake-identity-evidence.js',
    '/hybrid-liquidity-market.js',
    '/participant-workspace-bootstrap.js',
    '/sain-operations-intelligence.js',
  ];

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

    // Preserve renderer ownership and late-load initialization order:
    // participation defines the base renderer, Tier One replaces it, then
    // participation initializes so an already-active marketplace renders Tier One.
    await loadScript('/participation.js');
    await loadScript('/marketplace-tier-one.js');
    if (document.readyState !== 'loading' && typeof window.initializeParticipation === 'function') {
      await window.initializeParticipation();
    }

    await Promise.all(CORE_FINAL_FEATURES.map(loadScript));

    window.dispatchEvent(new CustomEvent('sra:public-booted', {
      detail: {
        featureCount: CORE_PARALLEL_FEATURES.length + 2 + CORE_FINAL_FEATURES.length,
        deferredFeatureCount: DEFERRED_FEATURES.length,
        bootedAt: new Date().toISOString(),
      },
    }));
  }

  function loadDeferred() {
    void Promise.allSettled(DEFERRED_FEATURES.map(loadScript)).then((results) => {
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length) console.warn('Some deferred SRA public features failed to load.', failed);

      window.dispatchEvent(new CustomEvent('sra:public-features-ready', {
        detail: { featureCount: DEFERRED_FEATURES.length, readyAt: new Date().toISOString() },
      }));
    });
  }

  void loadCore()
    .then(() => {
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(loadDeferred, { timeout: 1500 });
      } else {
        window.setTimeout(loadDeferred, 0);
      }
    })
    .catch((error) => {
      console.error('SRA public bootstrap failed.', error);
    });
})();