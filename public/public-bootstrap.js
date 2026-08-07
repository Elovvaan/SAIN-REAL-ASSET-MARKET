(() => {
  if (window.__sraPublicBootstrapInstalled) return;
  window.__sraPublicBootstrapInstalled = true;

  const FEATURES = [
    '/sane-skills.js',
    '/public-chat-runtime.js',
    '/sane-chat-format.js',
    '/interoperability.js',
    '/onboarding.js',
    '/custody.js',
    '/access.js',
    '/sra-authenticated-fetch.js',
    '/participation.js',
    '/marketplace-tier-one.js',
    '/platform-admin-workspace.js',
    '/account-capacities.js',
    '/public-home.js',
    '/participant-workspace-bootstrap.js',
    '/home-project-workspace.js',
    '/institution-workspace-loader.js',
    '/transaction-market-ui.js',
    '/order-intent-ui.js',
    '/live-market-publication-sync.js',
    '/live-asset-vault.js',
    '/funding-intake-ui.js',
    '/funding-operations-ui.js',
    '/funding-verification-desk.js',
    '/funding-value-model-desk.js',
    '/funding-instrument-desk.js',
    '/sain-operations-intelligence.js',
    '/funding-market-activation-desk.js',
    '/verified-settlement-desk.js',
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
        else existing.addEventListener('load', resolve, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = source;
      script.async = false;
      script.setAttribute(marker, 'true');
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${source}`)), { once: true });
      document.head.append(script);
    });
  }

  async function boot() {
    for (const source of FEATURES) {
      await loadScript(source);
      if (source === '/access.js' && document.readyState !== 'loading' && typeof window.initializeAccess === 'function') {
        await window.initializeAccess();
      }
    }
    window.dispatchEvent(new CustomEvent('sra:public-booted', {
      detail: { featureCount: FEATURES.length, bootedAt: new Date().toISOString() },
    }));
  }

  void boot().catch((error) => {
    console.error('SRA public bootstrap failed.', error);
  });
})();
