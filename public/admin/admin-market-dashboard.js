(() => {
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const number = (value, digits = 0) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits:digits });
  const money = (value) => Number(value || 0).toLocaleString(undefined, { style:'currency', currency:'USD', maximumFractionDigits:2 });
  const state = { mounted:false, loading:false };

  function sparkline(series = []) {
    const values = series.map((item) => Number(item.yesPrice)).filter(Number.isFinite);
    if (values.length < 2) return '<div class="admin-market-empty-chart">Awaiting verified signal history</div>';
    const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${40 - (Math.max(0, Math.min(1, value)) * 36)}`).join(' ');
    return `<svg class="admin-market-spark" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Verified YES price signal history"><path d="M0 10H100M0 20H100M0 30H100M25 0V40M50 0V40M75 0V40"/><polyline points="${points}"/></svg>`;
  }

  function eventCard(item) {
    return `<article class="admin-market-reading"><header><div><span>${esc(item.category || 'EVENT')}</span><strong>${esc(item.shortName || item.question || item.eventMarketId)}</strong></div><em>${esc(item.state)}</em></header>${sparkline(item.series)}<div class="admin-market-numbers"><div><span>YES</span><b>${item.yesPrice == null ? '—' : `${number(Number(item.yesPrice) * 100, 1)}¢`}</b></div><div><span>Volume</span><b>${number(item.volume, 2)}</b></div><div><span>Open interest</span><b>${number(item.openInterest, 2)}</b></div></div><small>${item.observedAt ? `Verified ${esc(new Date(item.observedAt).toLocaleString())}` : 'No verified signal received'}${item.signalSource ? ` · ${esc(item.signalSource)}` : ''}</small></article>`;
  }

  function basketCard(item) {
    const progress = item.minimumCloseValue > 0 ? Math.min(100, (item.recognizedValue / item.minimumCloseValue) * 100) : 0;
    const active = String(item.state || '').toUpperCase() === 'ACTIVE';
    return `<article class="admin-market-reading admin-productive-reading"><header><div><span>${esc(item.model || 'PRODUCTIVE BASKET')}</span><strong>${esc(item.name || item.basketId)}</strong><small>${esc(item.symbol || '')}</small></div><em>${esc(item.state)}</em></header><div class="admin-basket-track" aria-label="Formation progress"><i style="width:${progress}%"></i></div><div class="admin-market-numbers"><div><span>Recognized value</span><b>${money(item.recognizedValue)}</b></div><div><span>Active positions</span><b>${number(item.positionCount)}</b></div><div><span>Undistributed</span><b>${money(item.undistributedValue)}</b></div></div><small>${active ? `Latest performance ${item.latestPerformanceAt ? esc(new Date(item.latestPerformanceAt).toLocaleString()) : 'not yet recorded'}` : `${number(progress, 1)}% of formation threshold`}${item.pendingAdmissions ? ` · ${number(item.pendingAdmissions)} admission${item.pendingAdmissions === 1 ? '' : 's'} awaiting review` : ''}</small></article>`;
  }

  function lifecycleMarkup(payload) {
    const statuses = payload.statuses || {};
    const market = payload.market || {};
    const basketTotal = Number(market.productiveBaskets?.total || 0);
    const basketActive = Number(market.productiveBaskets?.counts?.ACTIVE || 0);
    const stages = [
      ['Originate / Finance', statuses.operations?.recordCount || 0, 'operations'],
      ['Instrument', statuses.nativeAsset?.recordCount || 0, 'instruments'],
      ['Pool / Basket', basketTotal, 'dashboard'],
      ['Participation', statuses.coinPositions?.recordCount || 0, 'coin-positions'],
      ['Service / Collect', basketActive, 'operations'],
      ['Distribute', market.productiveBaskets?.items?.filter((item) => Number(item.undistributedValue || 0) > 0).length || 0, 'dashboard'],
      ['Settle / Reconcile', statuses.settlement?.recordCount || 0, 'settlement'],
    ];
    return `<section class="admin-operating-chain"><div class="admin-section-label">PRODUCTIVE ASSET OPERATING CHAIN</div><div class="admin-operating-chain-grid">${stages.map(([label,count,target],index) => `<button type="button" data-open-workspace="${esc(target)}"><span>${index + 1}</span><strong>${esc(label)}</strong><b>${number(count)}</b></button>`).join('')}</div></section>`;
  }

  function render(workspace, payload) {
    for (const [key, status] of Object.entries(payload.statuses || {})) {
      const node = workspace.querySelector(`[data-workspace-status="${key}"]`);
      if (node) node.textContent = `${status.state} · ${number(status.recordCount)}`;
    }
    const events = payload.market?.eventMarkets?.items || [];
    const baskets = payload.market?.productiveBaskets?.items || [];
    const workflow = payload.market?.workflow || [];
    const activeBaskets = Number(payload.market?.productiveBaskets?.counts?.ACTIVE || 0);
    const undistributed = baskets.reduce((sum, item) => sum + Number(item.undistributedValue || 0), 0);
    let panel = workspace.querySelector('[data-admin-market-dashboard]');
    if (!panel) {
      panel = document.createElement('section');
      panel.dataset.adminMarketDashboard = 'true';
      panel.className = 'admin-market-dashboard';
      workspace.querySelector('.admin-status-section')?.insertAdjacentElement('afterend', panel);
    }
    panel.innerHTML = `${lifecycleMarkup(payload)}<div class="admin-market-heading"><div><p class="admin-section-label">PRODUCTIVE ASSET PERFORMANCE</p><h3>Portfolio operations and surveillance</h3><p>Current pool formation, participation, performance, distributable value, and administrative actions from persistent platform records.</p></div><button type="button" data-admin-market-refresh>Refresh</button></div><div class="admin-market-summary"><div><span>Productive baskets</span><b>${number(payload.market?.productiveBaskets?.total)}</b></div><div><span>Active baskets</span><b>${number(activeBaskets)}</b></div><div><span>Undistributed value</span><b>${money(undistributed)}</b></div><div><span>Actions waiting</span><b>${number(workflow.length)}</b></div></div><section><h4>Productive baskets</h4><div class="admin-market-card-list admin-basket-grid">${baskets.length ? baskets.map(basketCard).join('') : '<div class="admin-placeholder">No productive baskets are stored yet.</div>'}</div></section><section class="admin-market-workflow"><h4>Administrative workflow</h4>${workflow.length ? `<div>${workflow.map((item) => `<article><span>${esc(item.kind)}</span><div><strong>${esc(item.title)}</strong><small>${esc(item.id)} · ${esc(item.state)}</small></div><b>${esc(item.action)}</b></article>`).join('')}</div>` : '<div class="admin-placeholder">No productive-asset or market actions are waiting for administration.</div>'}</section><details class="admin-event-market-secondary"><summary>Event market intelligence <b>${number(payload.market?.eventMarkets?.total)}</b></summary><div class="admin-market-card-list admin-event-grid">${events.length ? events.map(eventCard).join('') : '<div class="admin-placeholder">No governed event markets are stored yet.</div>'}</div></details><footer>Updated ${esc(new Date(payload.generatedAt).toLocaleString())} · Persistent platform records only.</footer>`;
  }

  async function load(workspace, force = false) {
    if (state.loading) return;
    state.loading = true;
    const panel = workspace.querySelector('[data-admin-market-dashboard]');
    if (panel) panel.setAttribute('aria-busy','true');
    try {
      const client = window.SRAAdminDataClient;
      const payload = client
        ? await client.json('/api/admin/dashboard', force ? { cache:'reload' } : {})
        : await (async () => {
            const response = await fetch('/api/admin/dashboard', { ...(force ? { cache:'reload' } : {}), headers:{ Accept:'application/json' } });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || `Dashboard request failed with ${response.status}.`);
            return body;
          })();
      render(workspace, payload);
    } catch (error) {
      const target = workspace.querySelector('[data-admin-market-dashboard]') || workspace.querySelector('.admin-workspace-records');
      target?.insertAdjacentHTML('afterbegin', `<div class="admin-placeholder"><strong>Dashboard unavailable.</strong><br>${esc(error.message)}</div>`);
    } finally {
      state.loading = false;
      workspace.querySelector('[data-admin-market-dashboard]')?.removeAttribute('aria-busy');
    }
  }

  function mount(workspace) {
    if (!workspace || state.mounted) return;
    state.mounted = true;
    const stylesheet = document.createElement('link'); stylesheet.rel='stylesheet'; stylesheet.href='/admin/admin-market-dashboard.css'; stylesheet.dataset.adminMarketDashboardStyle='true'; document.head.append(stylesheet);
    workspace.addEventListener('click', (event) => { if (event.target.closest('[data-admin-market-refresh]')) void load(workspace, true); });
    window.addEventListener('sra:admin-dashboard-refresh', () => void load(workspace, true));
    window.addEventListener('sra:admin-mutated', () => void load(workspace, true));
    void load(workspace);
  }
  window.mountAdminMarketDashboard = mount;
})();
