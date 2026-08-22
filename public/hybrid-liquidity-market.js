(() => {
  if (window.__sraHybridLiquidityWorkspaceInstalled) return;
  window.__sraHybridLiquidityWorkspaceInstalled = true;

  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const money = new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:8 });

  async function requestJson(url, options = {}) {
    const response = await fetch(url, { cache:'no-store', headers:{ Accept:'application/json', 'Cache-Control':'no-cache', ...(options.headers || {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }

  function card(market) {
    const mode = String(market.mode || 'REFERENCE_ONLY').replaceAll('_', ' ');
    const sources = market.indexMethodology?.referenceSources || [];
    const access = market.marketplaceAccess || {};
    const reference = market.latestReference;
    const spotAvailable = Boolean(access.participantOrderAvailable);
    const referenceMarkup = reference
      ? `<div><span>Latest reference</span><strong>${money.format(Number(reference.referenceValue || 0))}</strong><small>${esc(reference.quoteCurrency || 'USD')} · non-executable reference</small></div>`
      : `<div><span>Latest reference</span><strong>—</strong><small>No reference observation recorded</small></div>`;
    const executionMarkup = spotAvailable
      ? `<div><span>Governed spot access</span><strong>AVAILABLE</strong><small>Listing ${esc(access.listingId)} · listing price ${money.format(Number(access.askingPrice || 0))}</small></div>`
      : `<div><span>Governed spot access</span><strong>REFERENCE ONLY</strong><small>${market.mode === 'SPOT' ? 'A LIVE marketplace listing is required.' : 'This market mode does not create participant orders.'}</small></div>`;
    return `<article class="project-row context-card" data-hybrid-market="${esc(market.marketId)}"><div class="project-main"><div class="project-title"><div class="project-symbol">◇</div><div><h3>${esc(market.marketIdentity || 'SRA / USD')}</h3><p>Underlying: ${esc(market.underlyingInstrumentId || 'Not linked')}</p></div></div><div class="project-signal"><strong>${esc(mode)}</strong><span>${spotAvailable ? 'governed market handoff' : 'reference mode'}</span></div></div><div class="project-gain-row"><div><span>Index methodology</span><strong>${esc(market.indexMethodology?.method || 'Not defined')}</strong></div>${referenceMarkup}${executionMarkup}</div><div class="project-meta"><span class="badge">${spotAvailable ? 'SPOT · MARKETPLACE' : 'REFERENCE ONLY'}</span><span class="badge">${esc(sources.join(', ') || 'No reference sources')}</span></div>${spotAvailable ? `<div style="margin-top:12px"><button class="primary-button" data-open-hybrid-order="${esc(market.marketId)}">Open governed order</button></div>` : ''}<div data-hybrid-order-panel></div></article>`;
  }

  function bindOrders(root, markets) {
    const byId = new Map(markets.map((market) => [market.marketId, market]));
    root.querySelectorAll('[data-open-hybrid-order]').forEach((button) => button.addEventListener('click', () => {
      const market = byId.get(button.dataset.openHybridOrder);
      const cardRoot = button.closest('[data-hybrid-market]');
      const panel = cardRoot?.querySelector('[data-hybrid-order-panel]');
      if (!market || !panel) return;
      const listingId = market.marketplaceAccess?.listingId;
      panel.innerHTML = `<section class="panel contextual-panel" style="margin-top:12px"><div class="panel-header"><div><p class="eyebrow">EXISTING MARKETPLACE ORDER ENGINE</p><h3>${esc(market.marketIdentity || 'SRA / USD')} spot order</h3><p>The Hybrid reference remains informational. Execution price comes from the LIVE marketplace listing.</p></div></div><div class="form-grid"><div class="form-field"><label>Side</label><select data-hybrid-order-side><option value="BUY">Buy</option><option value="SELL">Sell</option></select></div><div class="form-field"><label>Order type</label><select data-hybrid-order-type><option value="MARKET">Market</option><option value="LIMIT">Limit</option></select></div><div class="form-field"><label>Quantity</label><input data-hybrid-order-quantity type="number" min="0.00000001" step="any" placeholder="0"></div><div class="form-field" data-hybrid-limit-field hidden><label>Limit price USD</label><input data-hybrid-order-limit type="number" min="0.00000001" step="any" placeholder="0.00"></div></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="secondary-button" data-hybrid-review-order>Review order</button><button class="primary-button" data-hybrid-confirm-order disabled>Confirm order intent</button></div><div data-hybrid-order-result style="margin-top:10px"></div></section>`;
      const type = panel.querySelector('[data-hybrid-order-type]');
      const limitField = panel.querySelector('[data-hybrid-limit-field]');
      const result = panel.querySelector('[data-hybrid-order-result]');
      const confirmButton = panel.querySelector('[data-hybrid-confirm-order]');
      let preview = null;
      const values = () => {
        const orderType = type.value;
        return {
          listingId,
          side: panel.querySelector('[data-hybrid-order-side]').value,
          orderType,
          quantity: Number(panel.querySelector('[data-hybrid-order-quantity]').value || 0),
          limitPrice: orderType === 'LIMIT' ? Number(panel.querySelector('[data-hybrid-order-limit]').value || 0) : undefined,
        };
      };
      type.addEventListener('change', () => {
        limitField.hidden = type.value !== 'LIMIT';
        preview = null;
        confirmButton.disabled = true;
      });
      panel.querySelector('[data-hybrid-review-order]').addEventListener('click', async () => {
        confirmButton.disabled = true;
        result.textContent = 'Preparing governed order review…';
        try {
          preview = await requestJson('/api/sane/order-intents/preview', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(values()) });
          const referenceCopy = preview.hybridSpot?.referenceValue != null ? ` Hybrid reference: ${money.format(Number(preview.hybridSpot.referenceValue))}, non-executable.` : '';
          result.innerHTML = `<strong>${esc(preview.side)} ${Number(preview.quantity).toLocaleString()} ${esc(preview.unit)}</strong><div>Estimated notional: ${money.format(Number(preview.estimatedNotional || 0))}</div><small>Pricing authority: ${esc(preview.pricingAuthority || 'MARKETPLACE_LISTING')}.${esc(referenceCopy)}</small>`;
          confirmButton.disabled = false;
        } catch (error) {
          preview = null;
          result.textContent = error.message;
        }
      });
      confirmButton.addEventListener('click', async () => {
        if (!preview) return;
        confirmButton.disabled = true;
        result.textContent = 'Queuing order intent for the existing review and matching workflow…';
        try {
          const record = await requestJson('/api/sane/order-intents/confirm', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ ...values(), confirmation:'CONFIRM' }) });
          result.innerHTML = `<strong>Order intent queued.</strong><div>${esc(record.orderIntentId)} · ${esc(record.state)}</div><small>Matching, allocation, settlement, and ownership transfer remain downstream governed stages.</small>`;
        } catch (error) {
          confirmButton.disabled = false;
          result.textContent = error.message;
        }
      });
    }));
  }

  async function render(root) {
    if (!root) return;
    root.innerHTML = '<div class="loading-state">Reading approved hybrid markets…</div>';
    try {
      const payload = await requestJson('/api/sane/hybrid-liquidity/markets');
      const markets = Array.isArray(payload.markets) ? payload.markets : [];
      const status = payload.status || {};
      root.innerHTML = `<section class="metric-grid compact"><article class="metric-card"><span>Approved hybrid markets</span><strong>${markets.length}</strong><small>Verified-instrument market definitions</small></article><article class="metric-card"><span>Spot order handoffs</span><strong>${Number(status.spotOrderAvailableMarkets || 0)}</strong><small>Use the existing Marketplace Engine</small></article><article class="metric-card"><span>Boundary</span><strong>${esc(String(status.boundary || 'REFERENCE_ONLY').replaceAll('_',' '))}</strong><small>Reference modes remain non-executable</small></article></section><section class="panel contextual-panel"><div class="panel-header"><div><p class="eyebrow">HYBRID LIQUIDITY LAYER</p><h2>Predictions / Liquidity</h2><p>Reference markets remain reference-only. An approved SPOT market can hand off to the existing governed order workflow only when the same instrument has a LIVE marketplace listing.</p></div><span class="badge open">CONNECTED</span></div><div class="project-list">${markets.length ? markets.map(card).join('') : '<div class="transaction-empty"><strong>No approved hybrid markets yet.</strong><span>Administration can define one around a verified SRA instrument.</span></div>'}</div></section>`;
      bindOrders(root, markets);
    } catch (error) {
      root.innerHTML = `<div class="empty-view"><h2>Predictions / Liquidity unavailable</h2><p>${esc(error.message)}</p></div>`;
    }
  }

  window.renderHybridLiquidityWorkspace = render;
})();
