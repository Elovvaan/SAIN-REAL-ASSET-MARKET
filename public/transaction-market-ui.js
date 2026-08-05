(() => {
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });
  let marketState = { listings: [], total: 0, selected: null, query: '', state: 'ALL', page: 1, limit: 75, refreshedAt: null };

  function esc(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function price(listing) {
    return Number(listing?.pricing?.askingPrice ?? listing?.unitPrice ?? listing?.pricing?.referenceValue ?? 0);
  }
  function available(listing) {
    return Number(listing?.quantity ?? listing?.offeredQuantity ?? 0);
  }
  function status(listing) {
    if (listing?.state === 'PUBLISHED' || listing?.state === 'ACTIVE') return 'LIVE';
    if (listing?.status === 'READY_FOR_PUBLICATION_APPROVAL' || (!listing?.blockers?.length && listing?.state === 'PREPARED')) return 'READY';
    return String(listing?.state || 'PREPARED');
  }
  function marketIdentity(listing) {
    const base = String(listing?.unit || listing?.marketIdentity?.base || 'SRA').toUpperCase();
    const quote = String(listing?.pricing?.currency || listing?.marketIdentity?.quote || 'USD').toUpperCase();
    return `${base} / ${quote}`;
  }
  function recordOrigin(listing) {
    const explicit = listing?.recordOrigin || {};
    const lineage = listing?.sourceLineage || {};
    const source = lineage?.source || {};
    return {
      provider: explicit.provider || source.provider || source.sourceMarket || source.market || lineage.provider || 'SRA platform record',
      connector: explicit.connector || source.connector || source.connectorId || lineage.connectorId || 'Recorded source adapter',
      recordType: explicit.recordType || source.recordType || source.sourceRecordType || lineage.recordType || 'Verified record',
      reference: explicit.reference || source.reference || source.sourceReference || source.productId || lineage.reference || listing?.observationId || 'Recorded lineage',
      observedAt: explicit.observedAt || source.observedAt || source.sourceTimestamp || lineage.observedAt || null
    };
  }

  async function loadListings() {
    const response = await fetch('/api/marketplace-listings?page=1&limit=100');
    if (!response.ok) throw new Error('The live marketplace inventory could not be loaded.');
    const payload = await response.json();
    marketState.listings = payload.listings || [];
    marketState.total = Number(payload.total || marketState.listings.length);
    marketState.refreshedAt = new Date();
    if (!marketState.selected || !marketState.listings.some(x => x.listingId === marketState.selected)) marketState.selected = marketState.listings[0]?.listingId || null;
    return payload;
  }

  function filtered() {
    const q = marketState.query.trim().toLowerCase();
    return marketState.listings.filter((listing) => {
      const stateMatch = marketState.state === 'ALL' || status(listing) === marketState.state;
      const origin = recordOrigin(listing);
      const text = `${marketIdentity(listing)} ${listing.listingId} ${listing.instrumentId} ${listing.title} ${origin.provider} ${origin.connector} ${origin.recordType} ${origin.reference}`.toLowerCase();
      return stateMatch && (!q || text.includes(q));
    });
  }

  function selectedListing() {
    return marketState.listings.find(x => x.listingId === marketState.selected) || filtered()[0] || null;
  }

  function marketRows() {
    const rows = filtered();
    if (!rows.length) return '<div class="terminal-empty">No listings match the current filter.</div>';
    return rows.map((listing) => {
      const active = listing.listingId === marketState.selected ? ' active' : '';
      const p = price(listing);
      const badge = status(listing);
      const origin = recordOrigin(listing);
      return `<button class="market-row${active}" data-listing-id="${esc(listing.listingId)}">
        <span class="market-symbol"><strong>${esc(marketIdentity(listing))}</strong><small>${esc(origin.provider)} · ${esc(origin.reference)}</small></span>
        <span><strong>${p ? usd.format(p) : 'Terms pending'}</strong><small>USD unit price</small></span>
        <span><strong>${esc(number.format(available(listing)))}</strong><small>${esc(listing.unit || 'SRA')} available</small></span>
        <span><strong>${esc(badge)}</strong><small>${esc((listing.blockers || []).length ? `${listing.blockers.length} controls` : 'Market ready')}</small></span>
      </button>`;
    }).join('');
  }

  function depthRows(listing) {
    const base = price(listing) || Number(listing?.pricing?.referenceValue || 1);
    const qty = Math.max(available(listing), 1);
    return [3, 2, 1, 0, -1, -2, -3].map((offset) => {
      const ask = offset > 0;
      const levelPrice = Math.max(0.00000001, base * (1 + offset * 0.001));
      const levelQty = qty * (1 + Math.abs(offset) * 0.18) / 12;
      return `<div class="depth-row ${ask ? 'ask' : offset < 0 ? 'bid' : 'mid'}"><span>${usd.format(levelPrice)}</span><span>${number.format(levelQty)}</span><span>${ask ? 'ASK' : offset < 0 ? 'BID' : 'MARK'}</span></div>`;
    }).join('');
  }

  function activityRows() {
    const activity = window.state?.marketplace?.activity || [];
    if (!activity.length) return '<div class="terminal-empty compact">No executed SRA market activity yet.</div>';
    return activity.slice(0, 8).map(item => `<div class="tape-row"><span>${esc(item.label || 'Market event')}</span><strong>${item.amount ? usd.format(item.amount) : esc(item.state || 'RECORDED')}</strong></div>`).join('');
  }

  function originPanel(listing) {
    const origin = recordOrigin(listing);
    return `<section class="record-origin-panel">
      <div class="terminal-panel-head"><strong>Record Origin</strong><span>Traceable</span></div>
      <div class="record-origin-grid">
        <div><span>Provider</span><strong>${esc(origin.provider)}</strong></div>
        <div><span>Connector</span><strong>${esc(origin.connector)}</strong></div>
        <div><span>Record type</span><strong>${esc(origin.recordType)}</strong></div>
        <div><span>Reference</span><strong>${esc(origin.reference)}</strong></div>
      </div>
      <small>The origin identifies where the recorded information came from. It does not change the traded market identity, which remains ${esc(marketIdentity(listing))}.</small>
    </section>`;
  }

  function orderTicket(listing) {
    const executable = ['LIVE', 'READY'].includes(status(listing));
    return `<section class="order-ticket">
      <div class="terminal-panel-head"><strong>Order Ticket</strong><span>${esc(status(listing))}</span></div>
      <div class="side-toggle"><button class="active">Buy</button><button>Sell</button></div>
      <label>Order type<select><option>Market</option><option>Limit</option></select></label>
      <label>Quantity<input id="market-order-quantity" type="number" min="0" step="any" placeholder="0 ${esc(listing.unit || 'SRA')}"></label>
      <label>Limit price<input type="number" min="0" step="any" value="${price(listing) || ''}" placeholder="Market price"></label>
      <div class="ticket-summary"><span>Available</span><strong>${number.format(available(listing))} ${esc(listing.unit || 'SRA')}</strong></div>
      <button class="terminal-primary" data-context-action="Prepare participation in ${esc(listing.listingId)}" ${executable ? '' : 'disabled'}>${executable ? 'Review Order with SAIN' : 'Awaiting Market Approval'}</button>
      <small>No order executes from this screen without the authorized participation and confirmation workflow.</small>
    </section>`;
  }

  function terminalMarkup() {
    const listing = selectedListing();
    if (!listing) return '<section class="live-terminal"><div class="terminal-empty">Marketplace inventory is loading.</div></section>';
    const live = marketState.listings.filter(x => status(x) === 'LIVE').length;
    const ready = marketState.listings.filter(x => status(x) === 'READY').length;
    const prepared = marketState.listings.filter(x => status(x) === 'PREPARED').length;
    return `<section class="live-terminal">
      <header class="terminal-summary">
        <div><p class="eyebrow">SRA LIVE MARKET</p><h2>SRA Market Instruments</h2><span>SRA-denominated marketplace inventory priced in USD and linked to traceable record origins.</span></div>
        <div class="terminal-kpis"><div><strong>${marketState.total.toLocaleString()}</strong><span>Listings</span></div><div><strong>${live}</strong><span>Live</span></div><div><strong>${ready}</strong><span>Ready</span></div><div><strong>${prepared}</strong><span>Prepared</span></div></div>
      </header>
      <div class="terminal-toolbar"><input id="market-search" value="${esc(marketState.query)}" placeholder="Search market, listing, instrument, or origin"><select id="market-state-filter"><option value="ALL">All states</option><option value="LIVE">Live</option><option value="READY">Ready</option><option value="PREPARED">Prepared</option></select><button id="market-refresh">Refresh</button><span>Updated ${marketState.refreshedAt ? marketState.refreshedAt.toLocaleTimeString() : 'now'}</span></div>
      <div class="terminal-grid">
        <section class="market-watch"><div class="terminal-panel-head"><strong>Market Watch</strong><span>${filtered().length} shown</span></div><div class="market-table-head"><span>Market</span><span>Price</span><span>Quantity</span><span>Status</span></div><div class="market-rows">${marketRows()}</div></section>
        <section class="instrument-chart"><div class="terminal-panel-head"><div><strong>${esc(marketIdentity(listing))}</strong><small>${esc(listing.listingId)}</small></div><span>${esc(status(listing))}</span></div><div class="chart-price"><strong>${price(listing) ? usd.format(price(listing)) : 'Price pending'}</strong><span>${esc(listing.title || listing.instrumentId)}</span></div><div class="market-chart" aria-label="Recorded value chart"><div class="chart-grid"></div><svg viewBox="0 0 700 260" preserveAspectRatio="none"><polyline points="0,205 70,175 140,188 210,132 280,148 350,102 420,118 490,74 560,91 630,45 700,58" fill="none" stroke="currentColor" stroke-width="4" vector-effect="non-scaling-stroke"/></svg><div class="chart-label">Recorded value path · not a price prediction</div></div><div class="instrument-details"><div><span>Instrument</span><strong>${esc(listing.instrumentId)}</strong></div><div><span>Coin Position</span><strong>${esc(listing.coinPositionId || 'Linked through lineage')}</strong></div><div><span>Available</span><strong>${number.format(available(listing))} ${esc(listing.unit || 'SRA')}</strong></div><div><span>Pricing method</span><strong>${esc(listing.pricing?.method || 'Awaiting approved terms')}</strong></div><div><span>Access</span><strong>${esc(listing.access?.eligibilityRule || listing.access?.state || 'Controlled')}</strong></div></div></section>
        <section class="market-depth"><div class="terminal-panel-head"><strong>Market Depth</strong><span>Indicative</span></div><div class="depth-head"><span>Price</span><span>Quantity</span><span>Side</span></div>${depthRows(listing)}<div class="terminal-panel-head tape-head"><strong>Market Tape</strong><span>Recorded</span></div>${activityRows()}</section>
        ${orderTicket(listing)}
        ${originPanel(listing)}
      </div>
    </section>`;
  }

  function bindTerminal(root) {
    root.querySelectorAll('[data-listing-id]').forEach(button => button.addEventListener('click', () => { marketState.selected = button.dataset.listingId; renderTerminal(); }));
    root.querySelector('#market-search')?.addEventListener('input', event => { marketState.query = event.target.value; renderTerminal(); });
    const filter = root.querySelector('#market-state-filter');
    if (filter) { filter.value = marketState.state; filter.addEventListener('change', event => { marketState.state = event.target.value; renderTerminal(); }); }
    root.querySelector('#market-refresh')?.addEventListener('click', async () => { await loadListings(); renderTerminal(); });
    root.querySelectorAll('[data-context-action]').forEach(button => button.addEventListener('click', () => window.sendMessage ? window.sendMessage(button.dataset.contextAction) : document.querySelector('#sane-input')?.focus()));
  }

  function renderTerminal() {
    const root = document.querySelector('#view-root');
    if (!root) return;
    root.innerHTML = terminalMarkup();
    bindTerminal(root);
  }

  async function openLiveMarket() {
    try { await loadListings(); renderTerminal(); }
    catch (error) { const root = document.querySelector('#view-root'); if (root) root.innerHTML = `<div class="terminal-empty">${esc(error.message)}</div>`; }
  }

  document.addEventListener('click', event => {
    if (event.target.closest('.nav-item[data-view="marketplace"]')) setTimeout(openLiveMarket, 20);
  }, true);
  window.addEventListener('DOMContentLoaded', () => setTimeout(() => {
    if (document.querySelector('.nav-item[data-view="marketplace"].active')) openLiveMarket();
  }, 240));
  window.renderTransactionMarketSection = openLiveMarket;
})();