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

  function basketCard(basket) {
    const progress = Math.max(0, Math.min(100, Number(basket.targetProgress || 0)));
    return `<article class="project-row context-card" data-productive-basket="${esc(basket.basketId)}"><div class="project-main"><div class="project-title"><div class="project-symbol">▦</div><div><h3>${esc(basket.name)}</h3><p>${esc(String(basket.model || '').replaceAll('_',' '))} · ${esc(basket.unitSymbol)} participation units</p></div></div><div class="project-signal"><strong>${esc(basket.state)}</strong><span>${basket.state === 'FORMATION' ? `${progress}% formed` : `${Number(basket.participantCount || 0)} participants`}</span></div></div><div class="project-gain-row"><div><span>Recognized composition</span><strong>${money.format(Number(basket.recognizedValue || 0))}</strong><small>Target ${money.format(Number(basket.targetRecognizedValue || 0))}</small></div><div><span>Current verified value</span><strong>${money.format(Number(basket.currentVerifiedValue || 0))}</strong><small>Evidence-recorded performance</small></div><div><span>Produced / distributed</span><strong>${money.format(Number(basket.distributableProduced || 0))}</strong><small>${money.format(Number(basket.totalDistributed || 0))} distributed</small></div></div><div class="project-meta"><span class="badge">${Number(basket.composition?.approvedAssets || 0)} APPROVED ASSETS</span><span class="badge">NO SILENT CONVERSION</span><span class="badge">${esc(String(basket.reconstitutionPolicy || '').replaceAll('_',' '))}</span></div>${basket.state === 'FORMATION' ? `<div style="margin-top:12px"><button class="primary-button" data-open-basket="${esc(basket.basketId)}">Participate with approved asset</button></div>` : ''}<div data-basket-panel></div></article>`;
  }

  function bindBaskets(root, baskets) {
    const byId = new Map(baskets.map((basket) => [basket.basketId, basket]));
    root.querySelectorAll('[data-open-basket]').forEach((button) => button.addEventListener('click', async () => {
      const basket = byId.get(button.dataset.openBasket);
      const panel = button.closest('[data-productive-basket]')?.querySelector('[data-basket-panel]');
      if (!basket || !panel) return;
      panel.innerHTML = '<div class="loading-state">Reading approved composition and account assets…</div>';
      try {
        const [detail, account] = await Promise.all([requestJson(`/api/productive-baskets/${encodeURIComponent(basket.basketId)}`), requestJson('/api/direct-accounts/me')]);
        const approved = (detail.admissions || []).filter((item) => item.state === 'APPROVED');
        const positions = account.positions || [];
        const eligible = approved.flatMap((admission) => positions.filter((position) => position.canonicalAssetId === admission.canonicalAssetId && position.network === admission.network && Number(position.available) > 0).map((position) => ({ admission, position })));
        panel.innerHTML = `<section class="panel contextual-panel" style="margin-top:12px"><div class="panel-header"><div><p class="eyebrow">ORIGINAL-ASSET PARTICIPATION</p><h3>Enter ${esc(basket.name)}</h3><p>The selected asset is restricted in your Direct Value Account. It is not silently sold or converted.</p></div></div>${eligible.length ? `<div class="form-grid"><div class="form-field"><label>Approved account asset</label><select data-basket-asset>${eligible.map((item, index) => `<option value="${index}">${esc(item.position.symbol)} · ${Number(item.position.available).toLocaleString()} available · ${money.format(Number(item.admission.recognitionRate))} recognized/unit</option>`).join('')}</select></div><div class="form-field"><label>Amount</label><input data-basket-amount type="number" min="0.00000001" step="any" placeholder="0"></div></div><div style="margin-top:10px"><button class="primary-button" data-basket-contribute>Confirm participation</button></div><div data-basket-result style="margin-top:10px"></div>` : '<div class="transaction-empty"><strong>No eligible account asset.</strong><span>An approved native, external, or customer-created asset must be available in your Direct Value Account.</span></div>'}</section>`;
        if (!eligible.length) return;
        panel.querySelector('[data-basket-contribute]').addEventListener('click', async () => {
          const result = panel.querySelector('[data-basket-result]');
          const selected = eligible[Number(panel.querySelector('[data-basket-asset]').value)];
          const amount = Number(panel.querySelector('[data-basket-amount]').value || 0);
          result.textContent = 'Recording participation…';
          try {
            const created = await requestJson(`/api/productive-baskets/${encodeURIComponent(basket.basketId)}/contributions`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ canonicalAssetId:selected.position.canonicalAssetId, network:selected.position.network, amount }) });
            result.innerHTML = `<strong>${Number(created.position.units).toLocaleString()} ${esc(created.position.unitSymbol)} units issued.</strong><div>${money.format(Number(created.contribution.recognizedValue))} recognized participation value.</div>`;
          } catch (error) { result.textContent = error.message; }
        });
      } catch (error) { panel.innerHTML = `<div class="transaction-empty"><strong>Participation unavailable.</strong><span>${esc(error.message)}</span></div>`; }
    }));
  }

  async function render(root) {
    if (!root) return;
    root.innerHTML = '<div class="loading-state">Reading productive baskets and approved markets…</div>';
    try {
      const [basketPayload, payload] = await Promise.all([requestJson('/api/productive-baskets'), requestJson('/api/sane/hybrid-liquidity/markets')]);
      const baskets = Array.isArray(basketPayload.baskets) ? basketPayload.baskets : [];
      const markets = Array.isArray(payload.markets) ? payload.markets : [];
      const status = payload.status || {};
      const active = baskets.filter((item) => item.state === 'ACTIVE').length;
      const value = baskets.reduce((sum, item) => sum + Number(item.currentVerifiedValue || 0), 0);
      root.innerHTML = `<section class="metric-grid compact"><article class="metric-card"><span>Productive baskets</span><strong>${baskets.length}</strong><small>${active} active · governed formation</small></article><article class="metric-card"><span>Verified basket value</span><strong>${money.format(value)}</strong><small>Across forming and active compositions</small></article><article class="metric-card"><span>Distribution rule</span><strong>PRO RATA</strong><small>Actual recorded productive value</small></article></section><section class="panel contextual-panel"><div class="panel-header"><div><p class="eyebrow">PRODUCTIVE ASSET MARKET</p><h2>Asset baskets and participation pools</h2><p>Approved native, external, and customer-created assets can form governed bundles. Once closed, productive value is recorded and distributed against participation units.</p></div><span class="badge open">LIVE</span></div><div class="project-list">${baskets.length ? baskets.map(basketCard).join('') : '<div class="transaction-empty"><strong>No productive baskets are forming yet.</strong><span>Market Professional and Institutional tiers can establish the first governed composition.</span></div>'}</div></section><section class="panel contextual-panel"><div class="panel-header"><div><p class="eyebrow">REFERENCE AND SPOT LAYER</p><h2>Hybrid reference markets</h2><p>These remain distinct from productive baskets. Reference observations are non-executable; approved spot definitions use the existing marketplace order workflow.</p></div><span class="badge">SEPARATE LANE</span></div><div class="project-list">${markets.length ? markets.map(card).join('') : '<div class="transaction-empty"><strong>No approved hybrid markets yet.</strong></div>'}</div></section>`;
      bindBaskets(root, baskets);
      bindOrders(root, markets);
    } catch (error) {
      root.innerHTML = `<div class="empty-view"><h2>Predictions / Liquidity unavailable</h2><p>${esc(error.message)}</p></div>`;
    }
  }

  window.renderHybridLiquidityWorkspace = render;
})();
