(() => {
  let selectedSide = 'BUY';
  let preview = null;

  async function request(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed.');
    return payload;
  }

  function ticket() { return document.querySelector('.order-ticket'); }
  function listingId() { return document.querySelector('.instrument-chart .terminal-panel-head small')?.textContent?.trim() || ''; }
  function values() {
    const root = ticket();
    const orderType = root?.querySelector('select')?.value?.toUpperCase() || 'MARKET';
    const inputs = root?.querySelectorAll('input') || [];
    return {
      listingId: listingId(),
      side: selectedSide,
      orderType,
      quantity: Number(inputs[0]?.value || 0),
      limitPrice: orderType === 'LIMIT' ? Number(inputs[1]?.value || 0) : undefined,
    };
  }

  function enhance() {
    const root = ticket();
    if (!root || root.dataset.orderIntentReady === 'true') return;
    root.dataset.orderIntentReady = 'true';
    const sideButtons = root.querySelectorAll('.side-toggle button');
    sideButtons.forEach((button, index) => button.addEventListener('click', (event) => {
      event.preventDefault();
      selectedSide = index === 0 ? 'BUY' : 'SELL';
      sideButtons.forEach((item) => item.classList.toggle('active', item === button));
      preview = null;
      root.querySelector('[data-order-intent-review]')?.remove();
    }));
    const action = root.querySelector('.terminal-primary');
    if (action && !action.disabled) {
      action.removeAttribute('data-context-action');
      action.textContent = `Review ${selectedSide === 'BUY' ? 'Buy' : 'Sell'} Order with SAIN`;
      action.addEventListener('click', review, true);
    }
  }

  async function review(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const root = ticket();
    const action = root?.querySelector('.terminal-primary');
    if (!root || !action) return;
    action.disabled = true;
    action.textContent = 'Preparing governed review...';
    try {
      preview = await request('/api/sane/order-intents/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values()) });
      root.querySelector('[data-order-intent-review]')?.remove();
      root.insertAdjacentHTML('beforeend', `<div data-order-intent-review style="margin-top:10px;padding:12px;border:1px solid #3f3519;border-radius:10px;background:#0e0c08">
        <strong>${preview.side} ${Number(preview.quantity).toLocaleString()} ${preview.unit}</strong>
        <div style="margin-top:6px">Estimated value: ${Number(preview.estimatedNotional).toLocaleString('en-US',{style:'currency',currency:'USD'})}</div>
        <div style="margin-top:6px;color:#aaa">This creates a queued order intent only. It does not match, allocate, settle, move balances, or transfer ownership.</div>
        <button data-confirm-order-intent class="terminal-primary" style="margin-top:10px">Confirm Order Intent</button>
      </div>`);
      root.querySelector('[data-confirm-order-intent]').addEventListener('click', confirm);
      window.sendMessage?.(`SAIN reviewed a ${preview.side} order intent for ${preview.quantity} ${preview.unit} on ${preview.listingId}. Estimated value is ${preview.estimatedNotional} USD. Confirmation will queue the intent only.`);
    } catch (error) {
      window.sendMessage?.(error.message);
    } finally {
      action.disabled = false;
      action.textContent = `Review ${selectedSide === 'BUY' ? 'Buy' : 'Sell'} Order with SAIN`;
    }
  }

  async function confirm(event) {
    event.preventDefault();
    if (!preview) return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Confirming...';
    try {
      const result = await request('/api/sane/order-intents/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values(), confirmation: 'CONFIRM' }) });
      button.textContent = 'Queued for review';
      window.sendMessage?.(`Order intent ${result.orderIntentId} is queued for order review. No allocation or settlement has occurred.`);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Confirm Order Intent';
      window.sendMessage?.(error.message);
    }
  }

  const observer = new MutationObserver(enhance);
  const initialize = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(enhance, 500);
  };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initialize, { once:true });
  else initialize();
})();
