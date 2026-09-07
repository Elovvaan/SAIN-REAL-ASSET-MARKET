(() => {
  if (window.__sraAdminInstrumentReviewWorkstationInstalled) return;
  window.__sraAdminInstrumentReviewWorkstationInstalled = true;

  const mounted = new WeakSet();
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const request = async (url, options = {}) => {
    if (window.SRAAdminDataClient) return window.SRAAdminDataClient.json(url, options);
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };

  function active(workspace) {
    return Boolean(workspace?.classList.contains('active'));
  }

  function pendingTab(workspace) {
    return String(workspace?.dataset?.activeTab || '') === 'Pending Review';
  }

  function host(workspace) {
    const root = workspace?.querySelector('.admin-workspace-controls');
    if (!root) return null;
    let panel = root.querySelector('[data-instrument-review-workstation]');
    if (!panel) {
      panel = document.createElement('section');
      panel.className = 'admin-record-card';
      panel.dataset.instrumentReviewWorkstation = 'true';
      root.append(panel);
    }
    return panel;
  }

  function clear(workspace) {
    workspace?.querySelector('[data-instrument-review-workstation]')?.remove();
  }

  function amountOf(instrument) {
    return instrument?.denomination?.principalQuantity
      ?? instrument?.authorizedSupply
      ?? instrument?.authorizedAmount
      ?? instrument?.faceValueUsd
      ?? instrument?.quantity
      ?? null;
  }

  function card(instrument) {
    const instrumentId = instrument?.instrumentId || instrument?.id || '';
    const coinPositionId = instrument?.coinPositionId || instrument?.sourceLineage?.coinPositionId || '—';
    const purpose = instrument?.terms?.purpose || instrument?.purpose || '—';
    const amount = amountOf(instrument);
    const state = instrument?.state || instrument?.status || 'REVIEW_REQUIRED';
    return `<article class="admin-record-card" data-review-instrument="${esc(instrumentId)}" style="margin:0">
      <header><strong>${esc(instrumentId)}</strong><em>${esc(state)}</em></header>
      <div class="admin-record-grid">
        <div><span>Source Coin Position</span><strong>${esc(coinPositionId)}</strong></div>
        <div><span>Instrument Type</span><strong>${esc(instrument?.instrumentType || 'SRA_VALUE_INSTRUMENT')}</strong></div>
        <div><span>Purpose</span><strong>${esc(purpose)}</strong></div>
        <div><span>Principal / Representation</span><strong>${esc(amount ?? '—')} ${esc(instrument?.denomination?.symbol || '')}</strong></div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px">
        <button type="button" data-approve-instrument="${esc(instrumentId)}">Approve Instrument</button>
        <span data-instrument-review-result style="color:#d6a92f;font-size:12px"></span>
      </div>
    </article>`;
  }

  async function render(workspace) {
    if (!workspace || !active(workspace) || !pendingTab(workspace)) {
      clear(workspace);
      return;
    }
    const panel = host(workspace);
    if (!panel) return;
    panel.innerHTML = '<header><strong>Instrument Approval Queue</strong><em>LOADING</em></header><p style="color:#9a9a9a">Reading instruments that completed Coin Position propagation and require Platform Administration approval…</p>';
    try {
      const status = await request('/api/admin/instruments/approval-status');
      if (!active(workspace) || !pendingTab(workspace)) return;
      const pending = Array.isArray(status.pending) ? status.pending : [];
      panel.innerHTML = `<header><strong>Instrument Approval Queue</strong><em>${pending.length} PENDING</em></header>
        <p style="color:#9a9a9a;line-height:1.5">Coin Position → SRA instrument → administrative review → approved instrument → representation / marketplace lifecycle.</p>
        <div style="display:grid;gap:10px">${pending.length ? pending.map(card).join('') : '<p>No instruments currently require approval.</p>'}</div>`;
      bind(workspace, panel);
    } catch (error) {
      if (!active(workspace) || !pendingTab(workspace)) return;
      panel.innerHTML = `<header><strong>Instrument Approval Queue</strong><em>READ ERROR</em></header><p style="color:#d6a92f">${esc(error.message)}</p>`;
    }
  }

  function bind(workspace, panel) {
    panel.querySelectorAll('[data-approve-instrument]').forEach((button) => button.addEventListener('click', async () => {
      const row = button.closest('[data-review-instrument]');
      const result = row?.querySelector('[data-instrument-review-result]');
      const instrumentId = button.dataset.approveInstrument;
      if (!instrumentId) return;
      if (!confirm(`Approve SRA instrument ${instrumentId} for the next lifecycle stage?`)) return;
      button.disabled = true;
      if (result) result.textContent = 'Recording approval…';
      try {
        const response = await request(`/api/admin/instruments/${encodeURIComponent(instrumentId)}/approve`, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ approval:'APPROVE' }),
        });
        if (result) result.textContent = response.changed === false ? 'Already approved.' : 'APPROVED';
        window.SRAAdminDataClient?.refresh?.('instrument-approved');
        await render(workspace);
      } catch (error) {
        if (result) result.textContent = error.message;
        button.disabled = false;
      }
    }));
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click', (event) => {
      if (!event.target.closest('[data-admin-tab]')) return;
      queueMicrotask(() => void render(workspace));
    });
    window.addEventListener('sra:admin-tab-selected', (event) => {
      if (event.detail?.workspaceId === 'instruments') void render(workspace);
    });
    window.addEventListener('sra:admin-data-changed', () => {
      if (active(workspace) && pendingTab(workspace)) void render(workspace);
    });
    void render(workspace);
  }

  window.mountAdminInstrumentReviewWorkstation = mount;
})();