(() => {
  const REFRESH_INTERVAL_MS = 15000;
  let refreshInFlight = false;
  let timer = null;
  let orderSide = 'BUY';

  function marketplaceIsOpen() {
    return Boolean(document.querySelector('.nav-item[data-view="marketplace"].active'));
  }

  function userIsEditingMarketControls() {
    const active = document.activeElement;
    return Boolean(active?.closest?.('.live-terminal input, .live-terminal select, .live-terminal textarea'));
  }

  async function marketplaceStatus() {
    const response = await fetch('/api/marketplace-listings/status', { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    return response.json();
  }

  function patchTruthfulCounts(status) {
    if (!status) return;
    const totals = {
      Listings: Number(status.listingCount || 0),
      Live: Number(status.byState?.PUBLISHED || 0) + Number(status.byState?.ACTIVE || 0),
      Prepared: Number(status.byState?.PREPARED || 0)
    };
    document.querySelectorAll('.terminal-kpis > div').forEach((card) => {
      const label = card.querySelector('span')?.textContent?.trim();
      const value = card.querySelector('strong');
      if (value && Object.hasOwn(totals, label)) value.textContent = totals[label].toLocaleString();
      if (label === 'Ready' && value) value.textContent = 'See admin';
    });
    const shown = document.querySelector('.market-watch .terminal-panel-head span');
    if (shown) shown.title = 'The table shows up to 100 records. Header totals represent the complete marketplace.';
  }

  async function refreshPublishedInventory() {
    if (refreshInFlight || document.hidden || !marketplaceIsOpen() || userIsEditingMarketControls()) return;
    if (typeof window.renderTransactionMarketSection !== 'function') return;
    refreshInFlight = true;
    try {
      await window.renderTransactionMarketSection();
      patchTruthfulCounts(await marketplaceStatus());
      window.dispatchEvent(new CustomEvent('sra:marketplace-refreshed', { detail: { refreshedAt: new Date().toISOString() } }));
    } catch {
      // Keep the last successful state and retry on the next cycle.
    } finally {
      refreshInFlight = false;
    }
  }

  function selectSide(button) {
    const ticket = button.closest('.order-ticket');
    if (!ticket) return;
    orderSide = button.textContent.trim().toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    ticket.querySelectorAll('.side-toggle button').forEach((item) => item.classList.toggle('active', item === button));
    const review = ticket.querySelector('[data-context-action]');
    if (review) review.textContent = `Review ${orderSide === 'BUY' ? 'Buy' : 'Sell'} Order with SAIN`;
  }

  function reviewOrder(button) {
    if (button.disabled) return;
    const ticket = button.closest('.order-ticket');
    const terminal = button.closest('.live-terminal');
    const quantity = Number(ticket?.querySelector('#market-order-quantity')?.value || 0);
    const orderType = ticket?.querySelector('select')?.value || 'Market';
    const limitInputs = ticket?.querySelectorAll('input[type="number"]') || [];
    const limitPrice = Number(limitInputs[1]?.value || 0);
    const listingId = terminal?.querySelector('.instrument-chart .terminal-panel-head small')?.textContent?.trim() || '';
    const market = terminal?.querySelector('.instrument-chart .terminal-panel-head strong')?.textContent?.trim() || 'SRA / USD';
    if (!Number.isFinite(quantity) || quantity <= 0) {
      ticket.querySelector('#market-order-quantity')?.focus();
      button.textContent = 'Enter a quantity first';
      setTimeout(() => { button.textContent = `Review ${orderSide === 'BUY' ? 'Buy' : 'Sell'} Order with SAIN`; }, 1600);
      return;
    }
    const prompt = `Prepare a ${orderSide} order review for ${quantity} SRA in market ${market}, listing ${listingId}, order type ${orderType}${orderType === 'Limit' && limitPrice > 0 ? `, limit price $${limitPrice}` : ''}. Explain availability, rights, restrictions, required confirmation, and the next authorized step. Do not execute the order.`;
    const input = document.querySelector('#sane-input');
    if (input) input.value = prompt;
    document.querySelector('#send-message')?.click();
    document.querySelector('.sane-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function start() {
    if (timer) clearInterval(timer);
    timer = setInterval(refreshPublishedInventory, REFRESH_INTERVAL_MS);
    timer.unref?.();
  }

  document.addEventListener('click', (event) => {
    const marketplace = event.target.closest('.nav-item[data-view="marketplace"]');
    if (marketplace) setTimeout(refreshPublishedInventory, 300);

    const side = event.target.closest('.order-ticket .side-toggle button');
    if (side) {
      event.preventDefault();
      event.stopImmediatePropagation();
      selectSide(side);
      return;
    }

    const review = event.target.closest('.order-ticket [data-context-action]');
    if (review) {
      event.preventDefault();
      event.stopImmediatePropagation();
      reviewOrder(review);
    }
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshPublishedInventory();
  });

  window.addEventListener('focus', () => void refreshPublishedInventory());
  window.addEventListener('sra:marketplace-refreshed', async () => patchTruthfulCounts(await marketplaceStatus()));
  window.addEventListener('DOMContentLoaded', () => {
    start();
    setTimeout(refreshPublishedInventory, 800);
  });
})();