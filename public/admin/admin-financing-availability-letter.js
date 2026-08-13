(() => {
  if (window.__sraAdminFinancingAvailabilityLetterInstalled) return;
  window.__sraAdminFinancingAvailabilityLetterInstalled = true;

  function operationsRoot() {
    return document.querySelector('[data-workspace="operations"]');
  }

  function awaitingActive(root) {
    return root?.dataset.activeTab === 'Awaiting Actions';
  }

  function authorizationRecorded(card) {
    const fields = [...card.querySelectorAll('.financing-awaiting-meta div')];
    const field = fields.find((item) => item.querySelector('span')?.textContent.trim() === 'Financing authorization');
    const value = field?.querySelector('b')?.textContent.trim() || '';
    return Boolean(value && value !== 'Not recorded');
  }

  function installButtons(root = operationsRoot()) {
    if (!root || !awaitingActive(root)) return;
    root.querySelectorAll('[data-financing-awaiting]').forEach((card) => {
      if (card.querySelector('[data-financing-availability-letter]')) return;
      if (!authorizationRecorded(card)) return;
      const opportunityId = card.dataset.financingAwaiting;
      if (!opportunityId) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.financingAvailabilityLetter = opportunityId;
      button.textContent = 'View financing availability letter';
      button.style.marginTop = '10px';
      button.style.width = '100%';
      const result = card.querySelector('[data-financing-action-result]');
      if (result) result.before(button);
      else card.append(button);
    });
  }

  function popupShell(popup, message = 'Loading financing availability letter…') {
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Financing Availability Letter</title><style>body{margin:0;background:#f2f2f2;color:#171717;font-family:Arial,Helvetica,sans-serif}.state{max-width:760px;margin:90px auto;background:#fff;border:1px solid #ddd;border-radius:12px;padding:28px;box-shadow:0 8px 30px rgba(0,0,0,.08)}h1{font-size:20px;margin:0 0 10px}p{margin:0;color:#555;line-height:1.5}</style></head><body><main class="state"><h1>SAIN Platform</h1><p>${message}</p></main></body></html>`);
    popup.document.close();
  }

  async function openLetter(opportunityId) {
    const popup = window.open('', '_blank', 'popup=yes,width=980,height=820,resizable=yes,scrollbars=yes');
    if (!popup) throw new Error('The browser blocked the financing letter popup. Allow popups for SAIN Platform and try again.');

    popupShell(popup);

    try {
      const response = await fetch(`/api/financing-closing/letters/opportunities/${encodeURIComponent(opportunityId)}`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'text/html' },
      });
      const body = await response.text();
      if (!response.ok) throw new Error(body || `Financing letter request failed with ${response.status}.`);
      popup.document.open();
      popup.document.write(body);
      popup.document.close();
      popup.focus();
    } catch (error) {
      const message = String(error?.message || 'The financing letter could not be loaded.');
      if (!popup.closed) popupShell(popup, message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
      throw new Error(message);
    }
  }

  function mount(root = operationsRoot()) {
    if (!root || root.dataset.financingAvailabilityLetterBound === 'true') return;
    root.dataset.financingAvailabilityLetterBound = 'true';
    root.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-admin-tab="Awaiting Actions"]');
      if (tab) setTimeout(() => installButtons(root), 0);
      const button = event.target.closest('[data-financing-availability-letter]');
      if (!button) return;
      event.preventDefault();
      const opportunityId = button.dataset.financingAvailabilityLetter;
      const card = button.closest('[data-financing-awaiting]');
      const result = card?.querySelector('[data-financing-action-result]');
      button.disabled = true;
      if (result) result.textContent = 'Opening financing availability letter…';
      void openLetter(opportunityId)
        .then(() => { if (result) result.textContent = ''; })
        .catch((error) => { if (result) result.textContent = error.message; })
        .finally(() => { button.disabled = false; });
    });
    const observer = new MutationObserver(() => installButtons(root));
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => {
      if (event.detail?.workspaceId === 'operations') installButtons(root);
    });
    installButtons(root);
  }

  window.mountAdminFinancingAvailabilityLetter = mount;
  window.addEventListener('sra:admin-booted', () => mount());
})();
