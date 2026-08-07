(() => {
  if (window.__sraAdminWorkspaceSyncInstalled) return;
  window.__sraAdminWorkspaceSyncInstalled = true;

  const originalFetch = window.fetch.bind(window);
  let refreshTimer = null;
  let refreshInFlight = false;
  let refreshAgain = false;

  function activeWorkspaceId() {
    return document.querySelector('.admin-workspace.active')?.dataset.workspace ||
      location.hash.replace('#admin-', '') ||
      'dashboard';
  }

  function requestWorkspaceRefresh() {
    if (refreshInFlight) {
      refreshAgain = true;
      return;
    }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      refreshInFlight = true;
      try {
        const id = activeWorkspaceId();
        const button = document.querySelector(`[data-refresh-workspace="${CSS.escape(id)}"]`);
        if (button) button.click();
        await Promise.resolve(window.loadSummary?.());
        window.dispatchEvent(new CustomEvent('sra:admin-workspace-synchronized', {
          detail: { workspaceId: id, synchronizedAt: new Date().toISOString() }
        }));
      } finally {
        refreshInFlight = false;
        if (refreshAgain) {
          refreshAgain = false;
          requestWorkspaceRefresh();
        }
      }
    }, 180);
  }

  window.fetch = async function synchronizedAdminFetch(input, init = {}) {
    const response = await originalFetch(input, init);
    try {
      const url = new URL(typeof input === 'string' ? input : input?.url, location.href);
      const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
      const isAdminMutation = url.origin === location.origin && url.pathname.startsWith('/api/admin/') && !['GET', 'HEAD', 'OPTIONS'].includes(method);
      if (isAdminMutation && response.ok) requestWorkspaceRefresh();
    } catch {}
    return response;
  };

  window.addEventListener('sra:admin-mutated', requestWorkspaceRefresh);
  window.sraRefreshAdministration = requestWorkspaceRefresh;
})();
