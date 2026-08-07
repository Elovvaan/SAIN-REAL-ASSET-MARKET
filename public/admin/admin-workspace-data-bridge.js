(() => {
  if (window.__sraAdminWorkspaceDataBridgeInstalled) return;
  window.__sraAdminWorkspaceDataBridgeInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const WORKSPACE_RECORD_LIMIT = 100;

  window.fetch = function sraAdminWorkspaceFetch(input, init) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      if (raw) {
        const url = new URL(raw, window.location.origin);
        if (url.pathname === '/api/admin/workspaces') {
          const requested = Number(url.searchParams.get('limit') || 0);
          if (!requested || requested > WORKSPACE_RECORD_LIMIT) {
            url.searchParams.set('limit', String(WORKSPACE_RECORD_LIMIT));
          }
          const rewritten = raw.startsWith('http') ? url.toString() : `${url.pathname}${url.search}`;
          input = typeof input === 'string' ? rewritten : new Request(rewritten, input);
        }
      }
    } catch (error) {
      console.warn('SAIN workspace data bridge could not normalize the request.', error);
    }
    return nativeFetch(input, init);
  };

  const style = document.createElement('style');
  style.id = 'sra-admin-workspace-data-bridge-style';
  style.textContent = `
    .admin-workspace-controls .metric { display: none !important; }
    .admin-workspace-controls:empty { display: none; }
  `;
  document.head.append(style);
})();
