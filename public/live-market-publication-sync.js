(() => {
  const REFRESH_INTERVAL_MS = 15000;
  let refreshInFlight = false;
  let timer = null;

  function marketplaceIsOpen() {
    return Boolean(document.querySelector('.nav-item[data-view="marketplace"].active'));
  }

  function userIsEditingMarketControls() {
    const active = document.activeElement;
    return Boolean(active?.closest?.('.live-terminal input, .live-terminal select, .live-terminal textarea'));
  }

  async function refreshPublishedInventory() {
    if (refreshInFlight || document.hidden || !marketplaceIsOpen() || userIsEditingMarketControls()) return;
    if (typeof window.renderTransactionMarketSection !== 'function') return;
    refreshInFlight = true;
    try {
      await window.renderTransactionMarketSection();
      window.dispatchEvent(new CustomEvent('sra:marketplace-refreshed', { detail: { refreshedAt: new Date().toISOString() } }));
    } catch {
      // The visible terminal keeps its last successful state and retries on the next cycle.
    } finally {
      refreshInFlight = false;
    }
  }

  function start() {
    if (timer) clearInterval(timer);
    timer = setInterval(refreshPublishedInventory, REFRESH_INTERVAL_MS);
    timer.unref?.();
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.nav-item[data-view="marketplace"]')) return;
    setTimeout(refreshPublishedInventory, 300);
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshPublishedInventory();
  });

  window.addEventListener('focus', () => void refreshPublishedInventory());
  window.addEventListener('DOMContentLoaded', () => {
    start();
    setTimeout(refreshPublishedInventory, 800);
  });
})();
