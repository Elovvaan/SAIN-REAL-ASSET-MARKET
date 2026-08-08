(() => {
  if (window.__sraHybridLiquidityWorkspaceInstalled) return;
  window.__sraHybridLiquidityWorkspaceInstalled = true;

  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  async function requestJson(url) {
    const response = await fetch(url, { cache:'no-store', headers:{ Accept:'application/json', 'Cache-Control':'no-cache' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }

  function card(market) {
    const mode = String(market.mode || 'REFERENCE_ONLY').replaceAll('_', ' ');
    const sources = market.indexMethodology?.referenceSources || [];
    return `<article class="project-row context-card"><div class="project-main"><div class="project-title"><div class="project-symbol">◇</div><div><h3>${esc(market.marketIdentity || 'SRA / USD')}</h3><p>Underlying: ${esc(market.underlyingInstrumentId || 'Not linked')}</p></div></div><div class="project-signal"><strong>${esc(mode)}</strong><span>reference mode</span></div></div><div class="project-gain-row"><div><span>Index methodology</span><strong>${esc(market.indexMethodology?.method || 'Not defined')}</strong></div><div><span>Execution</span><strong>${esc(market.executionState || 'DISABLED')}</strong></div></div><div class="project-meta"><span class="badge">REFERENCE ONLY</span><span class="badge">${esc(sources.join(', ') || 'No reference sources')}</span></div></article>`;
  }

  async function render(root) {
    if (!root) return;
    root.innerHTML = '<div class="loading-state">Reading approved reference markets…</div>';
    try {
      const payload = await requestJson('/api/sane/hybrid-liquidity/markets');
      const markets = Array.isArray(payload.markets) ? payload.markets : [];
      const status = payload.status || {};
      root.innerHTML = `<section class="metric-grid compact"><article class="metric-card"><span>Approved reference markets</span><strong>${markets.length}</strong><small>Verified-instrument reference definitions</small></article><article class="metric-card"><span>Boundary</span><strong>${esc(String(status.boundary || 'REFERENCE_ONLY').replaceAll('_',' '))}</strong><small>Reference and price discovery only</small></article><article class="metric-card"><span>Execution</span><strong>SEPARATE</strong><small>Reference markets do not imply executed trades</small></article></section><section class="panel contextual-panel"><div class="panel-header"><div><p class="eyebrow">HYBRID LIQUIDITY LAYER</p><h2>Predictions / Liquidity</h2><p>Approved reference prices and event probabilities around verified SRA instruments. Internal definitions do not become participant markets until approved.</p></div><span class="badge open">REFERENCE</span></div><div class="project-list">${markets.length ? markets.map(card).join('') : '<div class="transaction-empty"><strong>No approved reference markets yet.</strong><span>Administration can define one around a verified SRA instrument; nothing is presented here as an executed trade.</span></div>'}</div></section>`;
    } catch (error) {
      root.innerHTML = `<div class="empty-view"><h2>Predictions / Liquidity unavailable</h2><p>${esc(error.message)}</p></div>`;
    }
  }

  window.renderHybridLiquidityWorkspace = render;
})();