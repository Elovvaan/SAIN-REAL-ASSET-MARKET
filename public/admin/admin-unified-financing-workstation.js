(() => {
  let mounted = false;
  let workspaceCache = null;
  let workspaceCacheAt = 0;

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const friendly = (value) => String(value || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  const stateOf = (record) => String(record?.state || record?.status || record?.lifecycleState || record?.financingState || 'UNKNOWN').toUpperCase();
  const idOf = (record) => record?.opportunityId || record?.closingId || record?.disbursementId || record?.transactionId || record?.instructionId || record?.exportPackageId || record?.eventId || record?.id || 'Record';

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }

  function workspace() { return document.querySelector('[data-workspace="operations"]'); }
  function recordsRoot() { return workspace()?.querySelector('.admin-workspace-records'); }
  function controlsRoot() { return workspace()?.querySelector('.admin-workspace-controls'); }
  function activeTab() { return workspace()?.dataset.activeTab || 'Overview'; }

  function ensureFinancingTab() {
    const root = workspace();
    if (!root || root.querySelector('[data-admin-tab="Financing"]')) return;
    const tabs = root.querySelector('.admin-workspace-tabs');
    const overview = tabs?.querySelector('[data-admin-tab="Overview"]');
    if (!tabs) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.dataset.adminTab = 'Financing';
    button.textContent = 'Financing';
    overview?.insertAdjacentElement('afterend', button) || tabs.prepend(button);
  }

  function recordCards(records, emptyText) {
    if (!records.length) return `<div class="admin-placeholder">${esc(emptyText)}</div>`;
    return `<div class="admin-record-list">${records.map((record) => `<article class="admin-record-card"><header><strong>${esc(idOf(record))}</strong><em>${esc(stateOf(record))}</em></header><div class="admin-record-grid"><div><span>Type</span><strong>${esc(record.opportunityType || record.transactionType || record.eventType || record.type || 'Operation')}</strong></div>${record.requestedAmount != null ? `<div><span>Requested</span><strong>${Number(record.requestedAmount).toLocaleString()} ${esc(record.currency || 'USD')}</strong></div>` : ''}${record.amount != null ? `<div><span>Amount</span><strong>${Number(record.amount).toLocaleString()} ${esc(record.currency || 'USD')}</strong></div>` : ''}<div><span>Updated</span><strong>${esc(record.updatedAt || record.createdAt || record.occurredAt || record.submittedAt || '')}</strong></div></div><details><summary>Record details</summary><pre>${esc(JSON.stringify(record, null, 2))}</pre></details></article>`).join('')}</div>`;
  }

  async function loadWorkspaceRecords(force = false) {
    if (!force && workspaceCache && Date.now() - workspaceCacheAt < 15000) return workspaceCache;
    workspaceCache = await request(`/api/admin/workspaces?limit=100&_=${Date.now()}`);
    workspaceCacheAt = Date.now();
    return workspaceCache;
  }

  async function ensureFundingRenderer() {
    if (typeof window.renderParticipantFundingOperations === 'function') return;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-sra-admin-funding-operations]');
      if (existing) {
        if (existing.dataset.loaded === 'true') return resolve();
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = `/funding-operations-ui.js?v=${Date.now()}`;
      script.async = false;
      script.dataset.sraAdminFundingOperations = 'true';
      script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once: true });
      script.addEventListener('error', () => reject(new Error('Funding Operations UI could not load.')), { once: true });
      document.head.append(script);
    });
  }

  function overviewMarkup(data) {
    const agents = data.coinAgents || {};
    return `<section class="admin-record-card"><header><strong>Unified Market Operations</strong><em>${esc(data.state || 'CURRENT')}</em></header><div class="admin-record-grid"><div><span>Awaiting action</span><strong>${Number(data.totalAwaitingAction || 0).toLocaleString()}</strong></div><div><span>Exceptions</span><strong>${Number(data.totalExceptions || 0).toLocaleString()}</strong></div><div><span>Coin positions</span><strong>${Number(agents.coinAgentCount || 0).toLocaleString()}</strong></div><div><span>Need approval</span><strong>${Number(agents.requiringHumanApproval || 0).toLocaleString()}</strong></div></div><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px"><button type="button" data-open-financing>Open Financing</button><button type="button" data-refresh-unified-operations>Refresh Operations</button></div></section>`;
  }

  async function renderFinancing(root) {
    root.innerHTML = '<div class="admin-placeholder">Loading Financing…</div>';
    await ensureFundingRenderer();
    if (typeof window.renderParticipantFundingOperations !== 'function') throw new Error('Funding Operations renderer is unavailable.');
    await window.renderParticipantFundingOperations(root);
  }

  async function renderTab(force = false) {
    const root = recordsRoot();
    const controls = controlsRoot();
    if (!root) return;
    ensureFinancingTab();
    const tab = activeTab();
    if (controls) controls.style.display = tab === 'Overview' ? '' : 'none';
    root.innerHTML = '<div class="admin-placeholder">Loading current operations…</div>';
    try {
      if (tab === 'Financing') {
        await renderFinancing(root);
        return;
      }
      if (['Overview', 'Awaiting Actions', 'Exceptions'].includes(tab)) {
        const data = await request(`/api/sane/operations-queue?_=${Date.now()}`);
        if (tab === 'Overview') {
          root.innerHTML = overviewMarkup(data);
          root.querySelector('[data-open-financing]')?.addEventListener('click', () => workspace()?.querySelector('[data-admin-tab="Financing"]')?.click());
          root.querySelector('[data-refresh-unified-operations]')?.addEventListener('click', () => void renderTab(true));
          return;
        }
        const records = tab === 'Exceptions' ? (data.exceptions || []) : (data.queue || []);
        root.innerHTML = recordCards(records, tab === 'Exceptions' ? 'No operation exceptions are currently recorded.' : 'No governed operation is currently awaiting action.');
        return;
      }

      const data = await loadWorkspaceRecords(force);
      const r = data.records || {};
      let records = [];
      if (tab === 'Settlement Queue') records = [...(r.settlementInstructions || []), ...(r.marketplaceSettlementPreparations || []), ...(r.marketplaceSettlementReviews || []), ...(r.marketplaceSettlementAuthorizations || [])];
      else if (tab === 'Exports') records = [...(r.exportPackages || []), ...(r.transactions || []).filter((item) => /EXPORT/i.test(JSON.stringify(item)))];
      else if (tab === 'Imports') records = (r.transactions || []).filter((item) => /IMPORT/i.test(JSON.stringify(item)));
      else if (tab === 'Transaction Router') records = [...(r.transactions || []), ...(r.fundingInstructions || []), ...(r.treasuryPaymentOrders || [])];
      else if (tab === 'Audit Trail' || tab === 'Operation History') records = r.lifecycleEvents || [];
      root.innerHTML = recordCards(records, `No ${friendly(tab).toLowerCase()} records are currently stored.`);
    } catch (error) {
      root.innerHTML = `<div class="admin-placeholder"><strong>Unable to load ${esc(tab)}.</strong><br>${esc(error.message)}</div>`;
    }
  }

  function mount(root = workspace()) {
    if (!root || mounted) return;
    mounted = true;
    ensureFinancingTab();
    root.addEventListener('click', (event) => {
      if (event.target.closest('[data-admin-tab]')) setTimeout(() => void renderTab(false), 0);
    });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => {
      if (event.detail?.workspaceId === 'operations') void renderTab(true);
    });
    if (root.classList.contains('active')) void renderTab(false);
  }

  window.mountAdminUnifiedFinancingWorkstation = mount;
})();
