(() => {
  if (window.__sraCoinRepresentationIntegrityInstalled) return;
  window.__sraCoinRepresentationIntegrityInstalled = true;

  const mounted = new WeakSet();
  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const amount = (value) => Number.isFinite(Number(value))
    ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 8 })
    : '—';

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      cache: 'no-store',
      ...options,
      headers: { Accept: 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }

  function controls(workspace) {
    return workspace?.querySelector('.admin-workspace-controls') || null;
  }

  function active(workspace) {
    return workspace?.dataset.activeTab === 'Legacy Corrections';
  }

  function removePanel(workspace) {
    controls(workspace)?.querySelector('[data-coin-representation-integrity]')?.remove();
  }

  function panel(workspace) {
    const root = controls(workspace);
    if (!root) return null;
    let node = root.querySelector('[data-coin-representation-integrity]');
    if (!node) {
      node = document.createElement('section');
      node.className = 'admin-record-card';
      node.dataset.coinRepresentationIntegrity = 'true';
      root.prepend(node);
    }
    return node;
  }

  function sampleMarkup(sample = []) {
    if (!sample.length) return '<p style="color:#9a9a9a;margin:12px 0 0">No legacy representation mismatches were found.</p>';
    return `<div class="admin-record-list" style="margin-top:12px">${sample.map((item) => `
      <article class="admin-record-card" style="margin:0">
        <header><strong>${esc(item.coinPositionId)}</strong><em>RESTATEMENT PREVIEW</em></header>
        <div class="admin-record-grid">
          <div><span>Native source</span><strong>${esc(amount(item.sourceAmount))} ${esc(item.sourceUnit || 'source units')}</strong></div>
          <div><span>Current SRA</span><strong>${esc(amount(item.currentQuantity))} SRA</strong></div>
          <div><span>Target SRA</span><strong>${esc(amount(item.targetQuantity))} SRA</strong></div>
          <div><span>Par rule</span><strong>1 SRA = 1 USD</strong></div>
        </div>
      </article>`).join('')}</div>`;
  }

  async function refresh(workspace) {
    if (!active(workspace)) { removePanel(workspace); return; }
    const node = panel(workspace);
    if (!node) return;
    node.innerHTML = '<header><strong>Representation Integrity</strong><em>CHECKING</em></header><p style="color:#9a9a9a">Comparing represented SRA quantity with recognized recorded USD value…</p>';
    try {
      const preview = await requestJson('/api/admin/recorded-value-representation');
      if (!active(workspace) || !node.isConnected) return;
      const count = Number(preview.correctablePositionCount || 0);
      node.innerHTML = `
        <header><strong>Representation Integrity</strong><em>${count ? 'ACTION AVAILABLE' : 'AT PAR'}</em></header>
        <div class="admin-record-grid" style="margin-top:12px">
          <div><span>Positions inspected</span><strong>${Number(preview.inspectedPositionCount || 0).toLocaleString()}</strong></div>
          <div><span>Legacy mismatches</span><strong>${count.toLocaleString()}</strong></div>
          <div><span>Current represented</span><strong>${esc(amount(preview.currentRepresentedQuantity))} SRA</strong></div>
          <div><span>Target represented</span><strong>${esc(amount(preview.targetRepresentedQuantity))} SRA</strong></div>
        </div>
        <p style="color:#9a9a9a;font-size:12px;line-height:1.5;margin:12px 0 0">Native asset quantity remains source data. Recognized recorded USD value is the representation basis, and SRA is restated at 1 SRA = 1 USD. This action does not create instruments, listings, transactions, settlement, export, or ownership changes.</p>
        ${sampleMarkup(preview.sample || [])}
        ${count ? '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:14px"><button type="button" data-approve-representation-correction>Approve USD-at-par correction</button><span data-integrity-result style="color:#d6a92f;font-size:12px"></span></div>' : ''}`;

      node.querySelector('[data-approve-representation-correction]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const result = node.querySelector('[data-integrity-result]');
        if (!window.confirm(`Approve correction of ${count} legacy SRA Coin Position${count === 1 ? '' : 's'} to recognized USD value at par?`)) return;
        button.disabled = true;
        if (result) result.textContent = 'Correcting…';
        try {
          const completed = await requestJson('/api/admin/recorded-value-representation/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approval: 'APPROVE' }),
          });
          if (result) result.textContent = `Corrected ${Number(completed.correctedPositionCount || 0).toLocaleString()} position${Number(completed.correctedPositionCount || 0) === 1 ? '' : 's'}.`;
          window.dispatchEvent(new CustomEvent('sra:admin-refresh', { detail: { source: 'coin-representation-integrity' } }));
          await refresh(workspace);
        } catch (error) {
          if (result) result.textContent = error.message;
          button.disabled = false;
        }
      });
    } catch (error) {
      node.innerHTML = `<header><strong>Representation Integrity</strong><em>UNAVAILABLE</em></header><p style="color:#d6a92f">${esc(error.message)}</p>`;
    }
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click', (event) => {
      if (!event.target.closest('[data-admin-tab]')) return;
      queueMicrotask(() => { void refresh(workspace); });
    });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => {
      if (event.detail?.workspaceId === 'coin-positions') void refresh(workspace);
    });
    void refresh(workspace);
  }

  window.mountAdminCoinRepresentationIntegrityControls = mount;
})();