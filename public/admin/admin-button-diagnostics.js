(() => {
  const load = (source, marker) => {
    if (document.querySelector(`script[${marker}]`)) return;
    const script = document.createElement('script');
    script.src = source;
    script.async = false;
    script.setAttribute(marker, 'true');
    document.head.append(script);
  };
  load('/admin/admin-button-diagnostics-core.js', 'data-sra-admin-diagnostics-core');
  load('/admin/admin-action-reconciliation.js', 'data-sra-admin-action-reconciliation');
  load('/admin/admin-workspace-data-bridge.js', 'data-sra-admin-workspace-data-bridge');
  load('/admin/admin-suite-shell.js', 'data-sra-admin-suite-shell');
  load('/admin/admin-workspace-sync.js', 'data-sra-admin-workspace-sync');
})();