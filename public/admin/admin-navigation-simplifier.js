(() => {
  if (window.__sraAdminNavigationSimplifierInstalled) return;
  window.__sraAdminNavigationSimplifierInstalled = true;

  const GROUPS = [
    { id: 'dashboard', label: 'Dashboard', defaultWorkspace: 'dashboard', workspaces: ['dashboard'] },
    { id: 'market', label: 'Market Operations', defaultWorkspace: 'operations', workspaces: ['operations','records','instruments','coin-positions','marketplace','transactions','settlement'] },
    { id: 'treasury', label: 'Treasury', defaultWorkspace: 'treasury', workspaces: ['treasury'] },
    { id: 'agent', label: 'SAIN Agent', defaultWorkspace: 'agent', workspaces: ['agent'] },
    { id: 'administration', label: 'Administration', defaultWorkspace: 'users', workspaces: ['users','connections','system','native-asset'] },
  ];

  const MARKET_STATIONS = [
    ['operations','Workflow'],
    ['records','Recognition'],
    ['instruments','Instruments'],
    ['coin-positions','Coin Positions'],
    ['marketplace','Marketplace'],
    ['transactions','Transactions'],
    ['settlement','Settlement'],
  ];

  const ADMIN_STATIONS = [
    ['users','Users & Access'],
    ['connections','Connections'],
    ['system','System Health'],
    ['native-asset','Platform Asset'],
  ];

  function currentWorkspace() {
    return document.querySelector('.admin-workspace.active')?.dataset.workspace
      || location.hash.replace('#admin-', '')
      || 'dashboard';
  }

  function groupForWorkspace(workspaceId) {
    return GROUPS.find(group => group.workspaces.includes(workspaceId)) || GROUPS[0];
  }

  function openWorkspace(workspaceId) {
    const existing = document.querySelector(`[data-admin-workspace="${CSS.escape(workspaceId)}"]`);
    if (existing) {
      existing.click();
      return;
    }
    location.hash = `#admin-${workspaceId}`;
  }

  function buildPrimaryNavigation(admin) {
    const rail = admin.querySelector('.admin-suite-rail');
    const legacyNav = rail?.querySelector('.admin-suite-nav');
    if (!rail || !legacyNav) return;

    legacyNav.dataset.legacyWorkspaceNavigation = 'true';
    legacyNav.setAttribute('aria-hidden', 'true');

    let nav = rail.querySelector('[data-sra-simplified-nav]');
    if (!nav) {
      nav = document.createElement('nav');
      nav.className = 'admin-suite-nav admin-simplified-nav';
      nav.dataset.sraSimplifiedNav = 'true';
      nav.setAttribute('aria-label', 'Administration');
      nav.innerHTML = GROUPS.map(group => `<button type="button" data-admin-group="${group.id}"><strong>${group.label}</strong></button>`).join('');
      legacyNav.before(nav);
      nav.addEventListener('click', event => {
        const button = event.target.closest('[data-admin-group]');
        if (!button) return;
        const group = GROUPS.find(item => item.id === button.dataset.adminGroup);
        if (group) openWorkspace(group.defaultWorkspace);
      });
    }
  }

  function stationMarkup(stations, activeWorkspace) {
    return stations.map(([workspaceId,label]) => `<button type="button" data-admin-station="${workspaceId}" class="${workspaceId===activeWorkspace?'active':''}" aria-current="${workspaceId===activeWorkspace?'page':'false'}">${label}</button>`).join('');
  }

  function ensureWorkflowNavigation(admin) {
    const workspaceId = currentWorkspace();
    const group = groupForWorkspace(workspaceId);
    admin.querySelectorAll('[data-admin-workflow-navigation]').forEach(node => node.remove());

    const section = admin.querySelector(`[data-workspace="${CSS.escape(workspaceId)}"]`);
    const head = section?.querySelector('.admin-workspace-head');
    if (!section || !head) return;

    let stations = null;
    let title = '';
    if (group.id === 'market') {
      stations = MARKET_STATIONS;
      title = 'Market lifecycle';
    } else if (group.id === 'administration') {
      stations = ADMIN_STATIONS;
      title = 'Administration';
    }
    if (!stations) return;

    const nav = document.createElement('div');
    nav.className = 'admin-workflow-navigation';
    nav.dataset.adminWorkflowNavigation = 'true';
    nav.innerHTML = `<span>${title}</span><div>${stationMarkup(stations, workspaceId)}</div>`;
    head.after(nav);
    nav.addEventListener('click', event => {
      const button = event.target.closest('[data-admin-station]');
      if (button) openWorkspace(button.dataset.adminStation);
    });
  }

  function sync(admin = document.querySelector('#admin-view:not(.hidden)')) {
    if (!admin?.querySelector('.admin-suite')) return;
    buildPrimaryNavigation(admin);
    const workspaceId = currentWorkspace();
    const group = groupForWorkspace(workspaceId);
    admin.querySelectorAll('[data-admin-group]').forEach(button => {
      const active = button.dataset.adminGroup === group.id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    ensureWorkflowNavigation(admin);
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-admin-workspace],[data-open-workspace],[data-admin-station]')) {
      queueMicrotask(() => sync());
    }
  }, true);
  window.addEventListener('hashchange', () => queueMicrotask(() => sync()));
  window.addEventListener('sra:admin-booted', () => sync());
  window.addEventListener('sra:admin-workspace-features-ready', () => sync());
  window.addEventListener('sra:admin-visible', () => setTimeout(() => sync(), 0));

  if (document.readyState !== 'loading') setTimeout(() => sync(), 0);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(() => sync(), 0), { once: true });
})();
