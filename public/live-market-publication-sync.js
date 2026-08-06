(() => {
  const REFRESH_INTERVAL_MS = 60000;
  let refreshInFlight = false;
  let timer = null;
  let orderSide = 'BUY';

  const marketplaceIsOpen = () => Boolean(document.querySelector('.nav-item[data-view="marketplace"].active'));
  const userIsEditingMarketControls = () => Boolean(document.activeElement?.closest?.('.live-terminal input, .live-terminal select, .live-terminal textarea'));

  async function refreshPublishedInventory({ force = false } = {}) {
    if (refreshInFlight || document.hidden || !marketplaceIsOpen() || userIsEditingMarketControls()) return;
    if (typeof window.renderTransactionMarketSection !== 'function') return;
    refreshInFlight = true;
    try {
      await window.renderTransactionMarketSection({ force });
      window.dispatchEvent(new CustomEvent('sra:marketplace-refreshed', { detail: { refreshedAt: new Date().toISOString() } }));
    } catch {
      // Preserve the last successful LIVE inventory and retry on the next scheduled cycle.
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
      ticket?.querySelector('#market-order-quantity')?.focus();
      button.textContent = 'Enter a quantity first';
      setTimeout(() => { button.textContent = `Review ${orderSide === 'BUY' ? 'Buy' : 'Sell'} Order with SAIN`; }, 1600);
      return;
    }
    const prompt = `Prepare a ${orderSide} order review for ${quantity} SRA in market ${market}, listing ${listingId}, order type ${orderType}${orderType === 'Limit' && limitPrice > 0 ? `, limit price $${limitPrice}` : ''}. Explain availability, rights, restrictions, required confirmation, and the next authorized step. Do not execute the order.`;
    const input = document.querySelector('#sane-input');
    if (input) input.value = prompt;
    document.querySelector('#send-message')?.click();
  }

  function loadHybridMarketView() {
    if (document.querySelector('script[data-hybrid-liquidity-market]')) return;
    const script = document.createElement('script');
    script.src = '/hybrid-liquidity-market.js';
    script.defer = true;
    script.dataset.hybridLiquidityMarket = 'true';
    document.head.append(script);
  }

  function start() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => void refreshPublishedInventory({ force: true }), REFRESH_INTERVAL_MS);
    timer.unref?.();
  }

  document.addEventListener('click', (event) => {
    const marketplace = event.target.closest('.nav-item[data-view="marketplace"]');
    if (marketplace) {
      loadHybridMarketView();
      setTimeout(() => void refreshPublishedInventory(), 100);
    }
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

  document.addEventListener('visibilitychange', () => { if (!document.hidden && marketplaceIsOpen()) void refreshPublishedInventory(); });
  const initialize = () => start();
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();