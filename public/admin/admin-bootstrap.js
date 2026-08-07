(() => {
  if (window.__sraAdminBootstrapInstalled) return;
  window.__sraAdminBootstrapInstalled = true;

  const FEATURES = [
    ['/admin/listing-authorization-ui.js', 'data-sra-listing-authorization'],
    ['/admin/hybrid-liquidity-admin.js', 'data-sra-hybrid-liquidity'],
    ['/admin/core-services-dashboard.js', 'data-sra-core-services'],
    ['/admin/operations-queue-ui.js', 'data-sra-operations-queue'],
    ['/admin/treasury-ledger-ui.js', 'data-sra-treasury-ledger'],
    ['/admin/admin-button-diagnostics-core.js', 'data-sra-admin-diagnostics-core'],
    ['/admin/admin-suite-shell.js', 'data-sra-admin-suite-shell'],
    ['/admin/admin-instrument-approvals.js', 'data-sra-admin-instrument-approvals'],
  ];

  let booted = false;
  let refreshTimer = null;
  let refreshInFlight = false;
  let refreshAgain = false;

  function loadScript(source, marker) {
    return new Promise((resolve, reject) => {
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
      script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${source}`)), { once: true });
      document.head.append(script);
    });
  }

  function activeWorkspaceId() {
    return document.querySelector('.admin-workspace.active')?.dataset.workspace || location.hash.replace('#admin-', '') || 'dashboard';
  }

  function requestAdministrationRefresh(source = 'mutation') {
    if (refreshInFlight) {
      refreshAgain = true;
      return;
    }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      refreshInFlight = true;
      try {
        const id = activeWorkspaceId();
        document.querySelector(`[data-refresh-workspace="${CSS.escape(id)}"]`)?.click();
        await Promise.resolve(window.loadSummary?.());
        window.dispatchEvent(new CustomEvent('sra:admin-workspace-synchronized', {
          detail: { workspaceId: id, source, synchronizedAt: new Date().toISOString() },
        }));
      } finally {
        refreshInFlight = false;
        if (refreshAgain) {
          refreshAgain = false;
          requestAdministrationRefresh(source);
        }
      }
    }, 180);
  }

  async function boot() {
    if (booted) return;
    const admin = document.querySelector('#admin-view:not(.hidden)');
    if (!admin) return;
    booted = true;
    try {
      for (const [source, marker] of FEATURES) await loadScript(source, marker);
      window.dispatchEvent(new CustomEvent('sra:admin-booted', {
        detail: { featureCount: FEATURES.length, bootedAt: new Date().toISOString() },
      }));
    } catch (error) {
      booted = false;
      console.error('SAIN Administration bootstrap failed.', error);
    }
  }

  window.addEventListener('sra:admin-mutated', (event) => requestAdministrationRefresh(event.detail?.path || 'mutation'));
  window.addEventListener('sra:admin-refresh', (event) => requestAdministrationRefresh(event.detail?.source || 'manual'));
  window.sraRefreshAdministration = requestAdministrationRefresh;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else void boot();

  const observer = new MutationObserver(() => {
    if (document.querySelector('#admin-view:not(.hidden)')) {
      observer.disconnect();
      void boot();
    }
  });
  observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
})();
