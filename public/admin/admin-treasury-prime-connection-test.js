(() => {
  if (window.__sraTreasuryPrimeConnectionTestInstalled) return;
  window.__sraTreasuryPrimeConnectionTestInstalled = true;

  const request = async (url, options = {}) => {
    if (window.SRAAdminDataClient) return window.SRAAdminDataClient.json(url, options);
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };

  function mount(workspace = document.querySelector('[data-workspace="settlement"]')) {
    if (!workspace || workspace.querySelector('[data-treasury-prime-connection-test]')) return;
    const card = document.createElement('section');
    card.className = 'admin-record-card';
    card.dataset.treasuryPrimeConnectionTest = 'true';
    card.innerHTML = `
      <header><strong>Treasury Prime Connection</strong><em>SANDBOX</em></header>
      <p style="color:#9a9a9a;margin:0 0 14px;line-height:1.5">Test SRA's server-side Treasury Prime API authentication. This does not create an ACH or move money.</p>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <button type="button" data-treasury-prime-ping>Test Treasury Prime Connection</button>
        <span data-treasury-prime-result style="color:#d6a92f;font-size:12px">Not tested</span>
      </div>`;
    workspace.prepend(card);
    const button = card.querySelector('[data-treasury-prime-ping]');
    const result = card.querySelector('[data-treasury-prime-result]');
    button.addEventListener('click', async () => {
      button.disabled = true;
      result.textContent = 'Connecting to Treasury Prime sandbox…';
      try {
        const payload = await request('/api/treasury/treasury-prime/ping', { method: 'POST' });
        result.textContent = `CONNECTED · ${payload.environment || 'SANDBOX'} · API ${payload.apiVersion || 'available'}${payload.providerTime ? ` · ${payload.providerTime}` : ''}`;
      } catch (error) {
        result.textContent = `CONNECTION FAILED · ${error.message}`;
      } finally {
        button.disabled = false;
      }
    });
  }

  window.mountAdminTreasuryPrimeConnectionTest = mount;
  window.addEventListener('sra:admin-booted', () => mount());
  window.addEventListener('sra:admin-workspace-features-ready', (event) => { if (event.detail?.workspaceId === 'settlement') mount(); });
  window.addEventListener('hashchange', () => queueMicrotask(() => mount()));
})();
