(() => {
  if (window.__sraAdminExternalDexExecutorInstalled) return;
  window.__sraAdminExternalDexExecutorInstalled = true;
  const mounted = new WeakSet();
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const list = (value) => Array.isArray(value) ? value : [];
  const request = async (url, options = {}) => {
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', headers:{ Accept:'application/json', ...(options.headers || {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };
  const field = (label,value) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;

  async function markup() {
    const [status, exports] = await Promise.all([request('/api/on-chain/dex/executor/status'), request('/api/on-chain/dex/exports')]);
    const ready = list(exports.records).filter((item) => item.state === 'READY_FOR_EXTERNAL_DEX');
    return `<section class="admin-record-card" data-dex-executor-card><header><strong>Orca External Executor</strong><em>${status.ready ? 'LIVE' : 'NOT CONFIGURED'}</em></header><div class="admin-record-grid">${field('Execution mode',status.executionMode)}${field('Endpoint',status.endpointConfigured ? 'CONFIGURED' : 'NOT CONFIGURED')}${field('Credential',status.credentialConfigured ? 'CONFIGURED' : 'NOT CONFIGURED')}${field('Contract',status.contract)}${field('Ready DEX exports',String(ready.length))}</div><p style="color:#9a9a9a;margin:12px 0">The executor creates/seeds the external Orca Whirlpool. Initial market price and liquidity inputs are external-market instructions only; they do not rewrite SRA recorded value.</p>${ready.map((item) => `<form data-dex-live-execution-form data-dex-export-id="${esc(item.dexExportId)}" style="border-top:1px solid #292929;padding-top:14px;margin-top:14px"><strong>${esc(item.pair)} · ${esc(item.dexExportId)}</strong><div class="admin-record-grid" style="margin-top:10px"><label><span>Base liquidity quantity</span><input name="baseLiquidityQuantity" type="number" min="0.00000001" step="any" value="${esc(item.quantity)}" required></label><label><span>Quote liquidity quantity</span><input name="quoteLiquidityQuantity" type="number" min="0.00000001" step="any" required></label><label><span>Initial market price</span><input name="initialMarketPrice" type="number" min="0.00000001" step="any" required></label><label><span>Tick spacing</span><input name="tickSpacing" type="number" min="1" step="1" value="64" required></label><label><span>Max slippage bps</span><input name="maxSlippageBps" type="number" min="0" step="1" value="100" required></label></div><div style="display:flex;gap:12px;align-items:center;margin-top:12px"><button type="submit" ${status.ready ? '' : 'disabled'}>Execute on Orca</button><span data-dex-execution-result style="font-size:12px;color:#d6a92f"></span></div></form>`).join('')}</section>`;
  }

  async function render(workspace) {
    if (!workspace || workspace.dataset.activeTab !== 'DEX') return;
    const controls = workspace.querySelector('.admin-workspace-controls');
    if (!controls) return;
    controls.querySelectorAll('[data-dex-executor-card]').forEach((node) => node.remove());
    try { controls.insertAdjacentHTML('afterbegin', await markup()); }
    catch (error) { controls.insertAdjacentHTML('afterbegin', `<section class="admin-record-card" data-dex-executor-card><header><strong>Orca External Executor</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p></section>`); }
  }

  async function execute(form) {
    const result = form.querySelector('[data-dex-execution-result]');
    const button = form.querySelector('button[type="submit"]');
    const dexExportId = form.dataset.dexExportId;
    const values = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    result.textContent = 'Submitting to external Orca executor…';
    try {
      const response = await request(`/api/on-chain/dex/exports/${encodeURIComponent(dexExportId)}/execute`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(values) });
      result.textContent = response.confirmationPending ? `Submitted · ${response.execution.connectorReference}` : `Confirmed · ${response.execution.poolAddress}`;
      window.dispatchEvent(new CustomEvent('sra:admin-refresh',{detail:{source:'dex-live-execution'}}));
    } catch (error) { result.textContent = error.message; button.disabled = false; }
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click', (event) => { if (event.target.closest('[data-admin-tab]')) queueMicrotask(() => void render(workspace)); });
    workspace.addEventListener('submit', (event) => {
      const form = event.target.closest('[data-dex-live-execution-form]');
      if (!form) return;
      event.preventDefault();
      void execute(form);
    });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => { if (event.detail?.workspaceId === 'connections') void render(workspace); });
  }

  window.mountAdminExternalDexExecutor = (admin) => mount(admin?.querySelector('[data-workspace="connections"]'));
})();
