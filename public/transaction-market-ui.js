(() => {
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });
  const marketState = { listings: [], inventory: [], total: 0, selected: null, query: '', refreshedAt: null, loading: false };

  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const price = (listing) => Number(listing?.pricing?.askingPrice ?? listing?.unitPrice ?? 0);
  const available = (listing) => Number(listing?.quantity ?? listing?.offeredQuantity ?? 0);
  const isLive = (listing) => listing?.status === 'LIVE' && ['PUBLISHED', 'ACTIVE'].includes(String(listing?.state || '').toUpperCase());
  const marketIdentity = (listing) => `${String(listing?.unit || listing?.marketIdentity?.base || 'SRA').toUpperCase()} / ${String(listing?.pricing?.currency || listing?.marketIdentity?.quote || 'USD').toUpperCase()}`;
  function recordOrigin(listing) {
    const explicit = listing?.recordOrigin || {};
    const lineage = listing?.sourceLineage || {};
    const source = lineage?.source || {};
    return {
      provider: explicit.provider || source.provider || source.sourceMarket || source.market || lineage.provider || 'SRA platform record',
      connector: explicit.connector || source.connector || source.connectorId || lineage.connectorId || 'Recorded source adapter',
      recordType: explicit.recordType || source.recordType || source.sourceRecordType || lineage.recordType || 'Verified record',
      reference: explicit.reference || source.reference || source.sourceReference || source.productId || lineage.reference || listing?.observationId || 'Recorded lineage'
    };
  }

  async function loadListings({ force = false } = {}) {
    if (marketState.loading) return;
    if (!force && marketState.refreshedAt && Date.now() - marketState.refreshedAt.getTime() < 10_000) return;
    marketState.loading = true;
    try {
      const [response, inventoryResponse] = await Promise.all([
        fetch('/api/marketplace-listings?state=LIVE&page=1&limit=100', { headers: { Accept: 'application/json' } }),
        fetch('/api/participation/market-inventory', { cache:'no-store', headers: { Accept:'application/json' } })
      ]);
      if (!response.ok) throw new Error('The live marketplace inventory could not be loaded.');
      const [payload, inventoryPayload] = await Promise.all([response.json(), inventoryResponse.ok ? inventoryResponse.json() : Promise.resolve({ inventory:[] })]);
      marketState.listings = (payload.listings || []).filter(isLive);
      marketState.inventory = inventoryPayload.inventory || [];
      marketState.total = marketState.listings.length;
      marketState.refreshedAt = new Date();
      if (!marketState.selected || !marketState.listings.some((item) => item.listingId === marketState.selected)) marketState.selected = marketState.listings[0]?.listingId || null;
    } finally {
      marketState.loading = false;
    }
  }

  function filtered() {
    const query = marketState.query.trim().toLowerCase();
    return marketState.listings.filter((listing) => {
      const origin = recordOrigin(listing);
      const text = `${marketIdentity(listing)} ${listing.listingId} ${listing.instrumentId} ${listing.title || ''} ${origin.provider} ${origin.connector} ${origin.recordType} ${origin.reference}`.toLowerCase();
      return !query || text.includes(query);
    });
  }
  const selectedListing = () => marketState.listings.find((item) => item.listingId === marketState.selected) || filtered()[0] || null;

  function walletInventory() {
    if (!marketState.inventory.length) return '<div class="terminal-empty">Issued inventory will appear here.</div>';
    return `<section class="wallet-market-inventory"><div class="terminal-panel-head"><strong>Issued Stellar Wallet Inventory</strong><span>${marketState.inventory.length} ASSET${marketState.inventory.length === 1 ? '' : 'S'}</span></div><div class="tier-one-inventory-grid">${marketState.inventory.map((item) => {
      const walletBalance = item.wallet?.balance == null ? 'Unavailable' : number.format(Number(item.wallet.balance));
      const availableBalance = item.wallet?.available == null ? 'Unavailable' : number.format(Number(item.wallet.available));
      const address = item.wallet?.account || item.assetAddress || 'Not recorded';
      return `<article class="tier-one-inventory-card"><div class="tier-one-opportunity-head"><span class="badge open">${esc(String(item.marketState || 'ISSUED_INVENTORY').replaceAll('_',' '))}</span><span>${esc(item.network)}</span></div><h3>${esc(item.asset)} issued position</h3><p>${esc(item.instrumentId || item.assetId)}</p><div class="tier-one-inventory-metrics"><span><small>Recorded issued supply</small><strong>${number.format(Number(item.issuedSupply || 0))}</strong></span><span><small>Live wallet balance</small><strong>${esc(walletBalance)}</strong></span><span><small>Available in wallet</small><strong>${esc(availableBalance)}</strong></span><span><small>Market access</small><strong>${esc(String(item.participationState || '').replaceAll('_',' '))}</strong></span></div><div class="tier-one-wallet-address"><small>Stellar distribution wallet</small><code title="${esc(address)}">${esc(address)}</code></div><button class="secondary-button" data-context-action="Review ${esc(item.asset)} issued inventory ${esc(item.assetId)} and explain its marketplace participation and liquidity state">Review Market Access</button></article>`;
    }).join('')}</div></section>`;
  }

  function marketRows() {
    const rows = filtered();
    if (!rows.length) return '<div class="terminal-empty">Live market opportunities will appear here.</div>';
    return rows.map((listing) => {
      const origin = recordOrigin(listing);
      return `<button class="market-row${listing.listingId === marketState.selected ? ' active' : ''}" data-listing-id="${esc(listing.listingId)}"><span class="market-symbol"><strong>${esc(marketIdentity(listing))}</strong><small>${esc(origin.provider)} · ${esc(origin.reference)}</small></span><span><strong>${usd.format(price(listing) || 1)}</strong><small>USD unit price</small></span><span><strong>${esc(number.format(available(listing)))}</strong><small>${esc(listing.unit || 'SRA')} available</small></span><span><strong>LIVE</strong><small>Market ready</small></span></button>`;
    }).join('');
  }

  function depthRows(listing) {
    const base = price(listing) || 1;
    const quantity = Math.max(available(listing), 1);
    return [3, 2, 1, 0, -1, -2, -3].map((offset) => `<div class="depth-row ${offset > 0 ? 'ask' : offset < 0 ? 'bid' : 'mid'}"><span>${usd.format(Math.max(0.00000001, base * (1 + offset * 0.001)))}</span><span>${number.format(quantity * (1 + Math.abs(offset) * 0.18) / 12)}</span><span>${offset > 0 ? 'ASK' : offset < 0 ? 'BID' : 'MARK'}</span></div>`).join('');
  }

  function orderTicket(listing) {
    return `<section class="order-ticket"><div class="terminal-panel-head"><strong>Order Ticket</strong><span>LIVE</span></div><div class="side-toggle"><button class="active">Buy</button><button>Sell</button></div><label>Order type<select><option>Market</option><option>Limit</option></select></label><label>Quantity<input id="market-order-quantity" type="number" min="0" step="any" placeholder="0 ${esc(listing.unit || 'SRA')}"></label><label>Limit price<input type="number" min="0" step="any" value="${price(listing) || 1}"></label><div class="ticket-summary"><span>Available</span><strong>${number.format(available(listing))} ${esc(listing.unit || 'SRA')}</strong></div><button class="terminal-primary" data-context-action="Prepare participation in ${esc(listing.listingId)}">Review Order with SAIN</button><small>Review and confirm your order.</small></section>`;
  }

  function originPanel(listing) {
    const origin = recordOrigin(listing);
    return `<section class="record-origin-panel"><div class="terminal-panel-head"><strong>Record Origin</strong><span>Traceable</span></div><div class="record-origin-grid"><div><span>Provider</span><strong>${esc(origin.provider)}</strong></div><div><span>Connector</span><strong>${esc(origin.connector)}</strong></div><div><span>Record type</span><strong>${esc(origin.recordType)}</strong></div><div><span>Reference</span><strong>${esc(origin.reference)}</strong></div></div></section>`;
  }

  function terminalMarkup() {
    const listing = selectedListing();
    if (!listing) return `<section class="live-terminal"><header class="terminal-summary"><div><p class="eyebrow">SRA MARKET INVENTORY</p><h2>Issued positions</h2><span>View issued assets and current market availability.</span></div><div class="terminal-kpis"><div><strong>${marketState.inventory.length}</strong><span>Issued assets</span></div><div><strong>0</strong><span>Live products</span></div></div></header>${walletInventory()}<div class="terminal-empty">Live market opportunities will appear here.</div></section>`;
    return `<section class="live-terminal"><header class="terminal-summary"><div><p class="eyebrow">SRA LIVE MARKET</p><h2>SRA Market Instruments</h2><span>View issued assets and live market opportunities.</span></div><div class="terminal-kpis"><div><strong>${marketState.total.toLocaleString()}</strong><span>Live products</span></div><div><strong>${marketState.inventory.length}</strong><span>Issued assets</span></div></div></header>${walletInventory()}<div class="terminal-toolbar"><input id="market-search" value="${esc(marketState.query)}" placeholder="Search live market, listing, instrument, or origin"><button id="market-refresh">Refresh</button><span>Updated ${marketState.refreshedAt ? marketState.refreshedAt.toLocaleTimeString() : 'now'}</span></div><div class="terminal-grid"><section class="market-watch"><div class="terminal-panel-head"><strong>Market Watch</strong><span>${filtered().length} LIVE</span></div><div class="market-table-head"><span>Market</span><span>Price</span><span>Quantity</span><span>Status</span></div><div class="market-rows">${marketRows()}</div></section><section class="instrument-chart"><div class="terminal-panel-head"><div><strong>${esc(marketIdentity(listing))}</strong><small>${esc(listing.listingId)}</small></div><span>LIVE</span></div><div class="chart-price"><strong>${usd.format(price(listing) || 1)}</strong><span>${esc(listing.title || listing.instrumentId)}</span></div><div class="market-chart"><div class="chart-grid"></div><svg viewBox="0 0 700 260" preserveAspectRatio="none"><polyline points="0,205 70,175 140,188 210,132 280,148 350,102 420,118 490,74 560,91 630,45 700,58" fill="none" stroke="currentColor" stroke-width="4" vector-effect="non-scaling-stroke"/></svg><div class="chart-label">Recorded value path</div></div><div class="instrument-details"><div><span>Instrument</span><strong>${esc(listing.instrumentId)}</strong></div><div><span>Available</span><strong>${number.format(available(listing))} ${esc(listing.unit || 'SRA')}</strong></div><div><span>Pricing method</span><strong>${esc(listing.pricing?.method || 'SRA par')}</strong></div><div><span>Access</span><strong>${esc(listing.access?.eligibilityRule || listing.access?.state || 'Controlled')}</strong></div></div></section><section class="market-depth"><div class="terminal-panel-head"><strong>Market Depth</strong><span>Indicative</span></div><div class="depth-head"><span>Price</span><span>Quantity</span><span>Side</span></div>${depthRows(listing)}</section>${orderTicket(listing)}${originPanel(listing)}</div></section>`;
  }

  function bindTerminal(root) {
    root.querySelectorAll('[data-listing-id]').forEach((button) => button.addEventListener('click', () => { marketState.selected = button.dataset.listingId; renderTerminal(); }));
    root.querySelector('#market-search')?.addEventListener('input', (event) => { marketState.query = event.target.value; renderTerminal(); });
    root.querySelector('#market-refresh')?.addEventListener('click', async () => { await loadListings({ force: true }); renderTerminal(); });
    root.querySelectorAll('[data-context-action]').forEach((button) => button.addEventListener('click', () => window.sendMessage ? window.sendMessage(button.dataset.contextAction) : document.querySelector('#sane-input')?.focus()));
  }
  function renderTerminal() { const root = document.querySelector('#view-root'); if (!root) return; root.innerHTML = terminalMarkup(); bindTerminal(root); }
  async function openLiveMarket(options = {}) { try { await loadListings(options); renderTerminal(); } catch (error) { const root = document.querySelector('#view-root'); if (root) root.innerHTML = `<div class="terminal-empty">${esc(error.message)}</div>`; } }

  document.addEventListener('click', (event) => { if (event.target.closest('.nav-item[data-view="marketplace"]')) setTimeout(() => openLiveMarket(), 20); }, true);
  const initialize = () => { if (document.querySelector('.nav-item[data-view="marketplace"].active')) void openLiveMarket(); };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => setTimeout(initialize, 120), { once: true });
  else setTimeout(initialize, 0);
  window.renderTransactionMarketSection = openLiveMarket;
})();
