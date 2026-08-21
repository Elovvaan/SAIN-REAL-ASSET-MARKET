(() => {
  if (window.__sraTreasuryPrimeConnectionTestInstalled) return;
  window.__sraTreasuryPrimeConnectionTestInstalled = true;

  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const request = async (url, options = {}) => {
    if (window.SRAAdminDataClient) return window.SRAAdminDataClient.json(url, options);
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };

  function accountOptions(accounts) {
    return `<option value="">Select sandbox account</option>${accounts.map((item) => `<option value="${esc(item.id)}">${esc(item.name || item.id)}${item.last4 ? ` · ••••${esc(item.last4)}` : ''}${item.availableBalance !== null ? ` · $${esc(item.availableBalance)} available` : ''}</option>`).join('')}`;
  }

  function counterpartyOptions(counterparties) {
    return `<option value="">Select ACH destination</option>${counterparties.map((item) => `<option value="${esc(item.id)}">${esc(item.name || item.id)}${item.last4 ? ` · ••••${esc(item.last4)}` : ''}</option>`).join('')}`;
  }

  function mount(workspace = document.querySelector('[data-workspace="settlement"]')) {
    if (!workspace || workspace.querySelector('[data-treasury-prime-connection-test]')) return;
    const card = document.createElement('section');
    card.className = 'admin-record-card';
    card.dataset.treasuryPrimeConnectionTest = 'true';
    card.innerHTML = `
      <header><strong>Treasury Prime Sandbox Test Workflow</strong><em>SANDBOX</em></header>
      <p style="color:#9a9a9a;margin:0 0 14px;line-height:1.5">Run the Treasury Prime integration test in order without leaving Export & Settlement. The ACH test is locked to sandbox and creates a $1.00 sandbox ACH credit only.</p>
      <div class="admin-record-grid">
        <div><span>1 · Connection</span><strong data-tp-connection-status>Not tested</strong></div>
        <div><span>2 · Account</span><strong data-tp-account-status>Waiting for connection</strong></div>
        <div><span>3 · Destination</span><strong data-tp-counterparty-status>Waiting for account</strong></div>
        <div><span>4 · ACH test</span><strong data-tp-ach-status>Waiting for destination</strong></div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px">
        <button type="button" data-tp-ping>1 · Test Connection</button>
        <button type="button" data-tp-load-accounts disabled>2 · Load Accounts</button>
      </div>
      <div data-tp-account-row style="display:none;margin-top:12px">
        <select data-tp-account style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"></select>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px">
        <button type="button" data-tp-load-counterparties disabled>3 · Prepare ACH Destination</button>
      </div>
      <div data-tp-counterparty-row style="display:none;margin-top:12px">
        <select data-tp-counterparty style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"></select>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px">
        <button type="button" data-tp-send-ach disabled>4 · Send $1 Sandbox ACH</button>
        <span data-tp-result style="color:#d6a92f;font-size:12px"></span>
      </div>`;
    workspace.prepend(card);

    const pingButton = card.querySelector('[data-tp-ping]');
    const accountsButton = card.querySelector('[data-tp-load-accounts]');
    const counterpartiesButton = card.querySelector('[data-tp-load-counterparties]');
    const achButton = card.querySelector('[data-tp-send-ach]');
    const accountSelect = card.querySelector('[data-tp-account]');
    const counterpartySelect = card.querySelector('[data-tp-counterparty]');
    const accountRow = card.querySelector('[data-tp-account-row]');
    const counterpartyRow = card.querySelector('[data-tp-counterparty-row]');
    const connectionStatus = card.querySelector('[data-tp-connection-status]');
    const accountStatus = card.querySelector('[data-tp-account-status]');
    const counterpartyStatus = card.querySelector('[data-tp-counterparty-status]');
    const achStatus = card.querySelector('[data-tp-ach-status]');
    const result = card.querySelector('[data-tp-result]');

    pingButton.addEventListener('click', async () => {
      pingButton.disabled = true;
      result.textContent = 'Connecting to Treasury Prime sandbox…';
      try {
        const payload = await request('/api/treasury/treasury-prime/ping', { method: 'POST' });
        connectionStatus.textContent = `CONNECTED · API ${payload.apiVersion || 'available'}`;
        accountsButton.disabled = false;
        result.textContent = `${payload.environment || 'SANDBOX'} · ${payload.providerTime || payload.checkedAt || ''}`;
      } catch (error) {
        connectionStatus.textContent = 'FAILED';
        result.textContent = error.message;
      } finally {
        pingButton.disabled = false;
      }
    });

    accountsButton.addEventListener('click', async () => {
      accountsButton.disabled = true;
      result.textContent = 'Loading Treasury Prime sandbox accounts…';
      try {
        const payload = await request('/api/treasury/treasury-prime/accounts');
        const accounts = payload.accounts || [];
        if (!accounts.length) throw new Error('No Treasury Prime sandbox accounts were returned.');
        accountSelect.innerHTML = accountOptions(accounts);
        accountRow.style.display = '';
        accountStatus.textContent = `${accounts.length} account${accounts.length === 1 ? '' : 's'} available`;
        result.textContent = 'Select the sandbox account to originate the test ACH.';
      } catch (error) {
        accountStatus.textContent = 'FAILED';
        result.textContent = error.message;
        accountsButton.disabled = false;
      }
    });

    accountSelect.addEventListener('change', () => {
      const selected = Boolean(accountSelect.value);
      counterpartiesButton.disabled = !selected;
      accountStatus.textContent = selected ? `Selected · ${accountSelect.options[accountSelect.selectedIndex]?.textContent || accountSelect.value}` : 'Select an account';
      counterpartyStatus.textContent = selected ? 'Ready to prepare' : 'Waiting for account';
      counterpartySelect.value = '';
      achButton.disabled = true;
    });

    counterpartiesButton.addEventListener('click', async () => {
      counterpartiesButton.disabled = true;
      result.textContent = 'Preparing Treasury Prime ACH destination…';
      try {
        let payload = await request('/api/treasury/treasury-prime/counterparties');
        let counterparties = payload.counterparties || [];
        if (!counterparties.length) {
          result.textContent = 'No sandbox ACH destination exists yet. Creating one now…';
          const created = await request('/api/treasury/treasury-prime/counterparties/sandbox-test', { method: 'POST' });
          counterparties = created.counterparty ? [created.counterparty] : [];
        }
        if (!counterparties.length) throw new Error('Treasury Prime did not return an ACH-enabled sandbox destination.');
        counterpartySelect.innerHTML = counterpartyOptions(counterparties);
        counterpartyRow.style.display = '';
        if (counterparties.length === 1) {
          counterpartySelect.value = counterparties[0].id;
          achButton.disabled = !accountSelect.value;
          counterpartyStatus.textContent = `Selected · ${counterpartySelect.options[counterpartySelect.selectedIndex]?.textContent || counterparties[0].id}`;
          achStatus.textContent = 'Ready for $1 sandbox ACH';
          result.textContent = 'Sandbox ACH destination is ready.';
        } else {
          counterpartyStatus.textContent = `${counterparties.length} destinations available`;
          result.textContent = 'Select the ACH destination for the $1 sandbox test.';
        }
      } catch (error) {
        counterpartyStatus.textContent = 'FAILED';
        result.textContent = error.message;
        counterpartiesButton.disabled = false;
      }
    });

    counterpartySelect.addEventListener('change', () => {
      const selected = Boolean(counterpartySelect.value);
      achButton.disabled = !(selected && accountSelect.value);
      counterpartyStatus.textContent = selected ? `Selected · ${counterpartySelect.options[counterpartySelect.selectedIndex]?.textContent || counterpartySelect.value}` : 'Select a destination';
      achStatus.textContent = selected ? 'Ready for $1 sandbox ACH' : 'Waiting for destination';
    });

    achButton.addEventListener('click', async () => {
      if (!accountSelect.value || !counterpartySelect.value) return;
      achButton.disabled = true;
      result.textContent = 'Submitting $1.00 Treasury Prime sandbox ACH…';
      try {
        const payload = await request('/api/treasury/treasury-prime/ach-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: accountSelect.value, counterpartyId: counterpartySelect.value }),
        });
        achStatus.textContent = `${payload.status || 'CREATED'} · ${payload.achId || 'ACH ID returned'}`;
        result.textContent = `$${payload.amount || '1.00'} ${String(payload.direction || 'credit').toUpperCase()} · ${payload.effectiveDate || payload.createdAt || ''}`;
      } catch (error) {
        achStatus.textContent = 'FAILED';
        result.textContent = error.message;
        achButton.disabled = false;
      }
    });
  }

  window.mountAdminTreasuryPrimeConnectionTest = mount;
  window.addEventListener('sra:admin-booted', () => mount());
  window.addEventListener('sra:admin-workspace-features-ready', (event) => { if (event.detail?.workspaceId === 'settlement') mount(); });
  window.addEventListener('hashchange', () => queueMicrotask(() => mount()));
})();
