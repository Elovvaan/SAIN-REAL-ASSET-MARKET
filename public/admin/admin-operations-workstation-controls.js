(() => {
  if (window.__sraAdminOperationsWorkstationControlsInstalled) return;
  window.__sraAdminOperationsWorkstationControlsInstalled = true;

  const client = () => window.SRAAdminDataClient;
  const request = async (url, options = {}) => {
    if (client()) return client().json(url, options);
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const number = (value) => Number(value || 0).toLocaleString();

  function operationsWorkspace() {
    const workspace = document.querySelector('[data-workspace="operations"]');
    return workspace?.classList.contains('active') ? workspace : null;
  }

  function host() {
    const workspace = operationsWorkspace();
    const root = workspace?.querySelector('.admin-workspace-controls');
    if (!root) return null;
    let section = root.querySelector('[data-workstation-control="operations-queue"]');
    if (!section) {
      section = document.createElement('section');
      section.className = 'admin-record-card';
      section.dataset.workstationControl = 'operations-queue';
      root.append(section);
    }
    return section;
  }

  async function render() {
    const root = host();
    if (!root) return;
    root.innerHTML = '<header><strong>Unified Market Operations Queue</strong><em>LOADING</em></header>';
    try {
      const data = await request('/api/sane/operations-queue');
      if (!operationsWorkspace() || !root.isConnected) return;
      const entries = [
        ...(data.exceptions || []).map((item) => ({ ...item, exception:true })),
        ...(data.queue || []),
      ];
      root.innerHTML = `<header><strong>Unified Market Operations Queue</strong><em>${esc(data.state || 'UNKNOWN')}</em></header><div class="admin-record-grid"><div><span>Awaiting action</span><strong>${number(data.totalAwaitingAction)}</strong></div><div><span>Exceptions</span><strong>${number(data.totalExceptions)}</strong></div><div><span>Coin positions</span><strong>${number(data.coinAgents?.coinAgentCount)}</strong></div><div><span>Need approval</span><strong>${number(data.coinAgents?.requiringHumanApproval)}</strong></div></div><p>${esc(data.nextRecommendedAction?.explanation || 'No governed market operation is presently waiting.')}</p><div style="display:grid;gap:8px">${entries.slice(0,20).map((entry) => `<article class="admin-record-card"><strong>${esc(entry.stage || 'Operation')}</strong><div>${esc(entry.explanation || '')}</div><small>${esc(entry.id || '')} · ${esc(entry.nextAction || '')}</small></article>`).join('') || '<p>No waiting operations or exceptions.</p>'}</div><div style="display:flex;gap:8px;margin-top:12px"><input data-coin-position placeholder="Coin Position ID"><button data-coin-explain>Explain Coin Position</button></div><pre data-coin-result style="white-space:pre-wrap;max-height:220px;overflow:auto"></pre>`;
      root.querySelector('[data-coin-explain]')?.addEventListener('click', async () => {
        const id = root.querySelector('[data-coin-position]')?.value.trim();
        if (!id) return;
        const result = root.querySelector('[data-coin-result]');
        try {
          const explanation = await request(`/api/sane/coin-agents/${encodeURIComponent(id)}`);
          if (result) result.textContent = JSON.stringify(explanation, null, 2);
        } catch (error) {
          if (result) result.textContent = error.message;
        }
      });
    } catch (error) {
      if (root.isConnected) root.innerHTML = `<header><strong>Unified Market Operations Queue</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`;
    }
  }

  function schedule(detail = null) {
    if (detail?.workspaceId && detail.workspaceId !== 'operations') return;
    if (!operationsWorkspace()) return;
    queueMicrotask(() => void render());
  }

  window.addEventListener('sra:admin-workspace-synchronized', (event) => schedule(event.detail));
  window.addEventListener('sra:admin-refresh', () => schedule({ workspaceId:'operations' }));
  window.addEventListener('sra:admin-mutated', () => schedule({ workspaceId:'operations' }));
  window.addEventListener('sra:admin-workspace-features-ready', (event) => schedule(event.detail));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => schedule({ workspaceId:'operations' }), { once:true });
  else schedule({ workspaceId:'operations' });
})();
