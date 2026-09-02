(() => {
  if (window.__sraAdminExternalDexAdapterInstalled) return;
  window.__sraAdminExternalDexAdapterInstalled = true;

  const mounted = new WeakSet();
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const list = (value) => Array.isArray(value) ? value : [];
  const field = (label, value) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  const request = async (url, options = {}) => {
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', headers:{ Accept:'application/json', ...(options.headers || {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };

  function ensureDexTab(workspace) {
    const tabs = workspace?.querySelector('.admin-workspace-tabs');
    if (!tabs || tabs.querySelector('[data-admin-tab="DEX"]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role','tab');
    button.setAttribute('aria-selected','false');
    button.dataset.adminTab = 'DEX';
    button.textContent = 'DEX';
    tabs.insertBefore(button, tabs.querySelector('[data-admin-tab="Export Adapters"]') || null);
  }

  async function connectionMarkup() {
    const [status, exports] = await Promise.all([
      request('/api/on-chain/dex/status'),
      request('/api/on-chain/dex/exports'),
    ]);
    const venue = status.supportedVenues?.[0] || {};
    return `<section class="admin-record-card" data-dex-connection-card><header><strong>External DEX Adapter</strong><em>${esc(venue.venue ? 'AVAILABLE' : 'UNAVAILABLE')}</em></header><div class="admin-record-grid">${field('First venue',venue.venue || 'None')}${field('Network',venue.network || '—')}${field('Execution model',venue.executionModel || '—')}${field('Market model',venue.marketModel || '—')}${field('Prepared exports',String(status.preparedExports || 0))}${field('Submitted exports',String(status.submittedExports || 0))}${field('Confirmed exports',String(status.confirmedExports || 0))}</div><p style="color:#9a9a9a;margin:14px 0 0">SRA prepares the governed handoff. Pool creation, liquidity, pricing, and swap execution remain external to SRA. External market price is observational and never rewrites the recorded-value basis.</p>${list(exports.records).length ? `<div style="margin-top:14px">${exports.records.slice(0,10).map((item) => `<div style="border-top:1px solid #292929;padding:10px 0"><strong>${esc(item.pair)}</strong> · ${esc(item.state)} · ${esc(item.dexExportId)}</div>`).join('')}</div>` : ''}</section>`;
  }

  async function settlementMarkup() {
    const [workspaceData, dexExports] = await Promise.all([
      request('/api/admin/workspaces?workspace=settlement&limit=100'),
      request('/api/on-chain/dex/exports'),
    ]);
    const packages = list(workspaceData.records?.exportPackages).filter((item) => item.state === 'READY_FOR_EXPORT');
    const options = packages.map((item) => `<option value="${esc(item.exportPackageId)}">${esc(item.exportPackageId)} · ${esc(item.instrumentId || '')} · ${esc(item.quantity || 0)} ${esc(item.unit || '')}</option>`).join('');
    return `<section class="admin-record-card" data-dex-export-card><header><strong>External DEX Export</strong><em>EXPORT BOUNDARY</em></header><div class="admin-record-grid">${field('Ready SRA export packages',String(packages.length))}${field('DEX exports prepared',String(list(dexExports.records).length))}${field('First venue','ORCA_WHIRLPOOLS')}${field('Network','SOLANA')}</div>${packages.length ? `<form data-dex-export-form style="margin-top:14px"><div class="admin-record-grid"><label><span>SRA export package</span><select name="exportPackageId" required style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px">${options}</select></label><label><span>Quote symbol</span><input name="quoteSymbol" value="USDC" required></label><label><span>Quote mint address</span><input name="quoteMintAddress" placeholder="Solana quote token mint" required></label></div><p style="color:#9a9a9a;font-size:12px;line-height:1.45;margin:12px 0">Preparation requires the source package to be READY_FOR_EXPORT and the instrument to have an ACTIVE real Solana projection/mint. Simulated mints are intentionally blocked from external DEX export.</p><div style="display:flex;gap:12px;align-items:center"><button type="submit">Prepare DEX Export</button><span data-dex-export-result style="color:#d6a92f;font-size:12px"></span></div></form>` : `<p style="color:#9a9a9a;margin:14px 0 0">No governed SRA export package is currently ready for an external DEX handoff.</p>`}</section>`;
  }

  async function renderConnections(workspace) {
    if (!workspace) return;
    const controls = workspace.querySelector('.admin-workspace-controls');
    const records = workspace.querySelector('.admin-workspace-records');
    if (!controls) return;
    controls.querySelectorAll('[data-dex-connection-card]').forEach((node) => node.remove());
    if (records && workspace.dataset.activeTab !== 'DEX') records.style.display = '';
    if (workspace.dataset.activeTab !== 'DEX') return;
    if (records) records.style.display = 'none';
    try {
      const markup = await connectionMarkup();
      if (!controls.isConnected || workspace.dataset.activeTab !== 'DEX') return;
      controls.insertAdjacentHTML('afterbegin', markup);
    }
    catch (error) {
      if (!controls.isConnected || workspace.dataset.activeTab !== 'DEX') return;
      controls.insertAdjacentHTML('afterbegin', `<section class="admin-record-card" data-dex-connection-card><header><strong>External DEX Adapter</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p></section>`);
    }
  }

  async function renderSettlement(workspace) {
    if (!workspace) return;
    const controls = workspace.querySelector('.admin-workspace-controls');
    if (!controls) return;
    controls.querySelectorAll('[data-dex-export-card]').forEach((node) => node.remove());
    if (workspace.dataset.activeTab !== 'Export Packages') return;
    try {
      const markup = await settlementMarkup();
      if (!controls.isConnected || workspace.dataset.activeTab !== 'Export Packages') return;
      controls.insertAdjacentHTML('afterbegin', markup);
    }
    catch (error) {
      if (!controls.isConnected || workspace.dataset.activeTab !== 'Export Packages') return;
      controls.insertAdjacentHTML('afterbegin', `<section class="admin-record-card" data-dex-export-card><header><strong>External DEX Export</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p></section>`);
    }
  }

  async function prepare(form) {
    const result = form.querySelector('[data-dex-export-result]');
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    result.textContent = 'Checking eligibility…';
    try {
      const preview = await request('/api/on-chain/dex/exports/preview', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(values) });
      if (preview.blockers?.length) throw new Error(`Blocked: ${preview.blockers.join(', ')}`);
      const created = await request('/api/on-chain/dex/exports', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...values, approval:'APPROVE' }) });
      result.textContent = `Prepared ${created.dexExportId} · ${created.pair}`;
      window.dispatchEvent(new CustomEvent('sra:admin-refresh',{detail:{source:'dex-export-prepared'}}));
    } catch (error) { result.textContent = error.message; }
    finally { button.disabled = false; }
  }

  function mountConnections(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    ensureDexTab(workspace);
    workspace.addEventListener('click', (event) => {
      if (!event.target.closest('[data-admin-tab]')) return;
      queueMicrotask(() => {
        ensureDexTab(workspace);
        void renderConnections(workspace);
      });
    });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => { if (event.detail?.workspaceId === 'connections') void renderConnections(workspace); });
    void renderConnections(workspace);
  }

  function mountSettlement(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click', (event) => { if (event.target.closest('[data-admin-tab]')) queueMicrotask(() => void renderSettlement(workspace)); });
    workspace.addEventListener('submit', (event) => {
      const form = event.target.closest('[data-dex-export-form]');
      if (!form) return;
      event.preventDefault();
      void prepare(form);
    });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => { if (event.detail?.workspaceId === 'settlement') void renderSettlement(workspace); });
    void renderSettlement(workspace);
  }

  window.mountAdminExternalDexAdapter = (admin) => {
    mountConnections(admin?.querySelector('[data-workspace="connections"]'));
    mountSettlement(admin?.querySelector('[data-workspace="settlement"]'));
  };
})();
