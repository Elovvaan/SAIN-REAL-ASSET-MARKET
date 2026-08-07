(() => {
  if (window.__sraAdminSettlementDestinationInstalled) return;
  window.__sraAdminSettlementDestinationInstalled = true;

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }

  function workspace() {
    return document.querySelector('[data-workspace="settlement"]');
  }

  function activeTab() {
    return workspace()?.dataset.activeTab || '';
  }

  function formMarkup() {
    return `
      <section class="admin-ach-destination-control" data-ach-destination-control>
        <div class="admin-section-label">MANUAL ACH DESTINATION</div>
        <form data-ach-destination-form autocomplete="off">
          <div class="admin-ach-grid">
            <label><span>Bank / destination label</span><input name="bankName" type="text" placeholder="Receiving bank" required></label>
            <label><span>Account type</span><select name="accountType" required><option value="CHECKING">Checking</option><option value="SAVINGS">Savings</option></select></label>
            <label><span>Routing number</span><input name="routingNumber" type="text" inputmode="numeric" pattern="[0-9]{9}" maxlength="9" placeholder="9 digits" required></label>
            <label><span>Account number</span><input name="accountNumber" type="password" inputmode="numeric" pattern="[0-9]{4,17}" maxlength="17" placeholder="4–17 digits" required></label>
            <label><span>Amount USD</span><input name="amountUsd" type="number" min="0.01" step="0.01" value="1.00" required></label>
          </div>
          <p class="admin-ach-note">Routing and account numbers are used only for this preparation request. SRA stores an opaque destination reference and masked display label, not the full bank details.</p>
          <div class="admin-ach-actions"><button type="submit">Verify & Prepare Instruction</button><span data-ach-result></span></div>
        </form>
      </section>`;
  }

  function destinationCards(destinations = []) {
    if (!destinations.length) return '<div class="admin-placeholder">No verified ACH destinations are currently stored.</div>';
    return `<div class="admin-record-list">${destinations.map((destination) => `
      <article class="admin-record-card">
        <header><strong>${esc(destination.label || destination.destinationId)}</strong><em>${esc(destination.verificationState || destination.state || 'VERIFIED')}</em></header>
        <div class="admin-record-grid">
          <div><span>Rail</span><strong>${esc(destination.route || 'ACH')}</strong></div>
          <div><span>Destination</span><strong>${esc(destination.label || 'Masked destination')}</strong></div>
          <div><span>State</span><strong>${esc(destination.state || 'ACTIVE')}</strong></div>
          <div><span>Created</span><strong>${esc(destination.createdAt || '')}</strong></div>
        </div>
      </article>`).join('')}</div>`;
  }

  async function renderDestinationVerification() {
    const section = workspace();
    if (!section || activeTab() !== 'Destination Verification') return;
    const controls = section.querySelector('.admin-workspace-controls');
    const records = section.querySelector('.admin-workspace-records');
    if (!controls || !records) return;
    if (!controls.querySelector('[data-ach-destination-control]')) controls.insertAdjacentHTML('afterbegin', formMarkup());
    records.innerHTML = '<div class="admin-placeholder">Loading verified ACH destinations…</div>';
    try {
      const data = await requestJson(`/api/admin/treasury-transfer-readiness?_=${Date.now()}`);
      records.innerHTML = destinationCards(data.destinations || []);
    } catch (error) {
      records.innerHTML = `<div class="admin-placeholder"><strong>Unable to load ACH destinations.</strong><br>${esc(error.message)}</div>`;
    }
  }

  function removeControlWhenInactive() {
    if (activeTab() === 'Destination Verification') return;
    workspace()?.querySelector('[data-ach-destination-control]')?.remove();
  }

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-ach-destination-form]');
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const result = form.querySelector('[data-ach-result]');
    const data = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    result.textContent = 'Preparing…';
    try {
      const prepared = await requestJson('/api/admin/treasury-transfer-readiness/ach/prepare', {
        method: 'POST',
        body: JSON.stringify({
          bankName: data.bankName,
          accountType: data.accountType,
          routingNumber: data.routingNumber,
          accountNumber: data.accountNumber,
          amountUsd: Number(data.amountUsd),
        }),
      });
      result.textContent = `Ready: ${prepared.transferInstruction?.transferInstructionId || 'ACH instruction'} · $${Number(prepared.transferInstruction?.amountUsd || data.amountUsd).toFixed(2)}`;
      form.elements.routingNumber.value = '';
      form.elements.accountNumber.value = '';
      await renderDestinationVerification();
      workspace()?.querySelector('[data-refresh-workspace="settlement"]')?.click();
    } catch (error) {
      result.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-admin-tab]');
    const navigation = event.target.closest('[data-admin-workspace="settlement"],[data-open-workspace="settlement"],[data-refresh-workspace="settlement"]');
    if (!tab && !navigation) return;
    setTimeout(() => {
      if (activeTab() === 'Destination Verification') void renderDestinationVerification();
      else removeControlWhenInactive();
    }, 0);
  });

  const style = document.createElement('style');
  style.id = 'sra-admin-ach-destination-style';
  style.textContent = `
    .admin-ach-destination-control{border:1px solid #3a3422;border-radius:14px;background:#0b0a07;padding:16px}
    .admin-ach-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    .admin-ach-grid label span{display:block;color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px}
    .admin-ach-grid input,.admin-ach-grid select{width:100%;box-sizing:border-box;background:#080808;color:#fff;border:1px solid #333;border-radius:8px;padding:10px 11px}
    .admin-ach-note{color:#9a9a9a;font-size:12px;line-height:1.45;margin:12px 0}
    .admin-ach-actions{display:flex;gap:12px;align-items:center}.admin-ach-actions span{color:#d6a92f;font-size:12px}
    @media(max-width:1000px){.admin-ach-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:760px){.admin-ach-grid{grid-template-columns:1fr}}
  `;
  document.head.append(style);

  function initialize() {
    if (activeTab() === 'Destination Verification') void renderDestinationVerification();
    const observer = new MutationObserver(() => {
      if (activeTab() === 'Destination Verification' && !workspace()?.querySelector('[data-ach-destination-control]')) void renderDestinationVerification();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
