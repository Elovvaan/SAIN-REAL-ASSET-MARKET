(() => {
  if (window.__sraAdminUsersPermissionsWorkstationInstalled) return;
  window.__sraAdminUsersPermissionsWorkstationInstalled = true;

  const mounted = new WeakSet();
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const list = (value) => Array.isArray(value) ? value : [];
  const when = (value) => value ? new Date(value).toLocaleString() : '—';
  const client = () => window.SRAAdminDataClient;
  const CAPACITIES = Object.freeze({
    UNIVERSAL:{label:'Universal Account',activation:'AUTOMATIC',scope:'Base participant account capability'},
    ASSET_PROVIDER:{label:'Asset Provider',activation:'APPLICATION',scope:'Asset intake and provider workflows'},
    MARKET_PROFESSIONAL:{label:'Market Professional',activation:'APPLICATION',scope:'Professional marketplace participation'},
    INSTITUTIONAL_OPERATOR:{label:'Institutional Operator',activation:'INSTITUTIONAL_APPROVAL',scope:'Institutional operating capability'},
    PLATFORM_ADMIN:{label:'Platform Administration',activation:'INTERNAL_AUTHORIZATION',scope:'Private platform administration'},
  });

  async function request(url) {
    if (client()) return client().json(url);
    const response = await fetch(url,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json','Cache-Control':'no-cache'}});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }
  const controls = (workspace) => workspace?.querySelector('.admin-workspace-controls');
  const records = (workspace) => workspace?.querySelector('.admin-workspace-records');
  const field = (label,value) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  const card = (title,state,body) => `<section class="admin-record-card" data-users-permissions-workstation-card><header><strong>${esc(title)}</strong><em>${esc(state)}</em></header>${body}</section>`;

  function normalizeCapacity(capacity) {
    if (typeof capacity === 'string') return capacity;
    return capacity?.id || capacity?.capacityId || null;
  }
  function userCapacities(user) { return list(user?.capacities).map(normalizeCapacity).filter(Boolean); }
  function allUsers(payload) {
    return list(payload?.users || payload?.records?.users || payload?.administrators || payload?.records?.administrators);
  }
  function administratorUsers(users) { return users.filter((user) => userCapacities(user).includes('PLATFORM_ADMIN')); }
  function uniqueRoles(users) { return [...new Set(users.flatMap(userCapacities))]; }
  function hideLegacy(workspace) {
    const host = records(workspace);
    if (host) host.style.display = 'none';
    controls(workspace)?.querySelectorAll('[data-users-permissions-workstation-card]').forEach((node) => node.remove());
  }

  async function load(tab = 'Overview') {
    const [workspacePayload, sessionPayload] = await Promise.all([
      request(`/api/admin/workspaces?workspace=users&tab=${encodeURIComponent(tab)}&limit=250`),
      request('/api/admin/session'),
    ]);
    const users = allUsers(workspacePayload);
    return { users, administrators:administratorUsers(users), roles:uniqueRoles(users), session:sessionPayload?.session || null, bootstrap:sessionPayload?.bootstrap || {} };
  }

  function renderOverview(data) {
    return card('Access Control Overview','CURRENT',`<div class="admin-record-grid">${field('Administrators',String(data.administrators.length))}${field('Known users',String(data.users.length))}${field('Active capacity',data.session?.activeCapacity || '—')}${field('Defined roles',String(Object.keys(CAPACITIES).length))}${field('Portal','PRIVATE PLATFORM ADMINISTRATION')}${field('Initialized',data.bootstrap?.initialized ? 'YES' : 'NO')}</div><p style="color:#9a9a9a;margin:12px 0 0">Users identify people. Roles/capacities define operating context. Permissions are derived from those capacities. Sessions represent authenticated access. Access History is the audit trail.</p>`);
  }

  function renderAdministrators(data) {
    const rows = data.administrators.length ? data.administrators.map((user) => `<article class="admin-record-card"><header><strong>${esc(user.displayName || user.email || user.id)}</strong><em>${esc(String(user.state || 'ACTIVE'))}</em></header><div class="admin-record-grid">${field('User ID',user.id || '—')}${field('Email',user.email || '—')}${field('Capacities',userCapacities(user).join(', ') || '—')}${field('Created',when(user.createdAt))}</div></article>`).join('') : '<div class="admin-placeholder">No real Platform Administrator records are currently exposed.</div>';
    return card('Administrators',data.administrators.length ? 'ACTIVE' : 'EMPTY',`<div class="admin-record-grid">${field('Administrator count',String(data.administrators.length))}${field('Current administrator',data.session?.displayName || data.session?.email || '—')}</div><div class="admin-record-list" style="margin-top:12px">${rows}</div>`);
  }

  function renderRoles(data) {
    const entries = Object.entries(CAPACITIES).map(([id,definition]) => {
      const assigned = data.users.filter((user) => userCapacities(user).includes(id)).length;
      return `<article class="admin-record-card"><header><strong>${esc(definition.label)}</strong><em>${esc(id)}</em></header><div class="admin-record-grid">${field('Activation',definition.activation)}${field('Assigned users',String(assigned))}${field('Operating scope',definition.scope)}</div></article>`;
    }).join('');
    return card('Roles / Capacities','DEFINED',`<p style="color:#9a9a9a;margin:0 0 12px">The access service uses capacities as the platform's role model. These are the five canonical capacities currently defined by the backend.</p><div class="admin-record-list">${entries}</div>`);
  }

  function renderPermissions() {
    const entries = [
      ['UNIVERSAL','Participant account and ordinary platform access'],
      ['ASSET_PROVIDER','Asset-provider intake and related workflows'],
      ['MARKET_PROFESSIONAL','Professional marketplace workflows'],
      ['INSTITUTIONAL_OPERATOR','Institutional operating workflows'],
      ['PLATFORM_ADMIN','Private Administration portal and protected administrator actions'],
    ].map(([role,scope]) => `<article class="admin-record-card"><header><strong>${esc(role)}</strong><em>CAPACITY BOUND</em></header><div class="admin-record-grid">${field('Permission model','ROLE / CAPACITY')}${field('Scope',scope)}${field('Activation',CAPACITIES[role]?.activation || '—')}</div></article>`).join('');
    return card('Permissions','CAPACITY-BASED',`<p style="color:#9a9a9a;margin:0 0 12px">The current backend does not maintain a separate free-form permission registry. Authorization is attached to account capacities and protected routes, so this tab renders that actual model instead of inventing ACL records.</p><div class="admin-record-list">${entries}</div>`);
  }

  function renderSessions(data) {
    const session = data.session;
    if (!session) return card('Sessions','NONE','<div class="admin-placeholder">No authenticated administrator session is active.</div>');
    return card('Sessions','AUTHENTICATED',`<div class="admin-record-grid">${field('User',session.displayName || session.email || session.id || '—')}${field('User ID',session.id || '—')}${field('Active role',session.activeRole || session.activeCapacity || '—')}${field('Active capacity',session.activeCapacity || '—')}${field('Shell',session.shell || '—')}${field('Account tier',session.accountTier || '—')}</div><p style="color:#9a9a9a;margin:12px 0 0">The private session endpoint intentionally exposes the authenticated session without exposing session tokens or token hashes.</p>`);
  }

  function renderHistory() {
    return card('Access History','AUDIT-BACKED',`<div class="admin-record-grid">${field('Audit storage','sra_audit_events')}${field('Session events','SESSION_STARTED / SESSION_ENDED')}${field('Role changes','OPERATING_TIER_CHANGED')}${field('Capacity events','APPLICATION / ACTIVATION')}${field('Admin initialization','PLATFORM_ADMINISTRATION_INITIALIZED')}</div><p style="color:#d6a92f;margin:12px 0 0">The backend records these access events, but the private Administration router does not currently expose an audit-history read endpoint to this workstation. This tab therefore reports the real audit source instead of falsely showing “no history.”</p>`);
  }

  async function render(workspace) {
    hideLegacy(workspace);
    const host = controls(workspace); if (!host) return;
    const placeholder = document.createElement('section');
    placeholder.className = 'admin-record-card';
    placeholder.dataset.usersPermissionsWorkstationCard = 'true';
    placeholder.innerHTML = '<header><strong>Users & Permissions</strong><em>READING</em></header><p>Reading current access state…</p>';
    host.prepend(placeholder);
    try {
      const tab = workspace.dataset.activeTab || 'Overview';
      const data = await load(tab);
      let markup = renderOverview(data);
      if (tab === 'Administrators') markup = renderAdministrators(data);
      else if (tab === 'Roles') markup = renderRoles(data);
      else if (tab === 'Permissions') markup = renderPermissions(data);
      else if (tab === 'Sessions') markup = renderSessions(data);
      else if (tab === 'Access History') markup = renderHistory(data);
      placeholder.outerHTML = markup;
    } catch (error) {
      placeholder.innerHTML = `<header><strong>Users & Permissions</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`;
    }
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click',(event) => {
      if (event.target.closest('[data-admin-tab]')) queueMicrotask(() => void render(workspace));
    });
    window.addEventListener('sra:admin-workspace-synchronized',(event) => {
      if (event.detail?.workspaceId === 'users') void render(workspace);
    });
    void render(workspace);
  }

  window.mountAdminUsersPermissionsWorkstation = mount;
})();
