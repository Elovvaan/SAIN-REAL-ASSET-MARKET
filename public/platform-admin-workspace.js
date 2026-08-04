(() => {
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const number = (value) => new Intl.NumberFormat('en-US').format(Number(value || 0));
  const stateClass = (value) => ['CONNECTED','ACTIVE','READY','OK','LIVE'].includes(String(value || '').toUpperCase()) ? 'open' : 'pending';

  async function json(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
    return payload;
  }

  async function loadAdminSnapshot() {
    const requests = {
      agent: json('/api/sane/agent/status'),
      coinbase: json('/api/connectors/coinbase-public/status'),
      observations: json('/api/observations/summary'),
      financialRecords: json('/api/financial-records/summary'),
      coinPositions: json('/api/financial-records/coin-positions'),
      instruments: json('/api/financial-records/instruments'),
      transactions: json('/api/financial-records/transactions/summary'),
      treasury: json('/api/platform-treasury/crypto-wallets/dashboard'),
      health: json('/api/health')
    };
    const entries = await Promise.all(Object.entries(requests).map(async ([key, promise]) => {
      try { return [key, { ok: true, data: await promise }]; }
      catch (error) { return [key, { ok: false, error: error.message }]; }
    }));
    return Object.fromEntries(entries);
  }

  function metric(label, value, note = '') {
    return `<article class="admin-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note ? `<small>${esc(note)}</small>` : ''}</article>`;
  }

  function sourceState(item, fallback = 'UNAVAILABLE') {
    if (!item?.ok) return fallback;
    return item.data?.state || item.data?.status || 'AVAILABLE';
  }

  function renderSnapshot(root, snapshot) {
    const observations = snapshot.observations?.data || {};
    const records = snapshot.financialRecords?.data || {};
    const coinPositions = snapshot.coinPositions?.data?.coinPositions || [];
    const instruments = snapshot.instruments?.data?.instruments || [];
    const transactions = snapshot.transactions?.data || {};
    const treasury = snapshot.treasury?.data || {};
    const coinbase = snapshot.coinbase?.data || {};
    const agent = snapshot.agent?.data || {};

    root.innerHTML = `<section class="platform-admin-workspace">
      <header class="admin-command-header">
        <div><p class="eyebrow">PLATFORM ADMINISTRATION</p><h2>SAIN Operating Workspace</h2><p>Read the live platform, diagnose workflows, prepare changes, and keep state-changing actions behind your approval.</p></div>
        <div class="admin-command-state"><span class="badge ${stateClass(agent.available ? 'READY' : 'UNAVAILABLE')}">${agent.available ? 'AGENT READY' : 'AGENT UNAVAILABLE'}</span><small>Write access: ${esc(agent.writeAccess || 'DISABLED')}</small></div>
      </header>

      <section class="admin-agent-console" aria-label="SAIN administrative agent">
        <div class="admin-agent-heading"><div><p class="eyebrow">ADMINISTRATIVE AGENT</p><h3>Work with the platform from inside the platform</h3></div><span>Capacity: PLATFORM_ADMIN</span></div>
        <div id="admin-agent-log" class="admin-agent-log"><div class="admin-agent-message">I am operating in Platform Administration. I can inspect live records, trace workflows, identify missing connections, and prepare a proposed action for your approval.</div></div>
        <div class="admin-quick-actions">
          <button data-admin-prompt="Show me the current Coinbase connector state and recent ingestion counts.">Coinbase status</button>
          <button data-admin-prompt="Trace the current recognition pipeline from observations through Coin Positions and instruments.">Trace recognition</button>
          <button data-admin-prompt="Find incomplete or unavailable workflows across the platform and explain the exact missing connection.">Find incomplete flows</button>
          <button data-admin-prompt="Show me every state-changing action that would require my approval.">Approval review</button>
        </div>
        <form id="admin-agent-form" class="admin-agent-form"><textarea id="admin-agent-input" rows="3" placeholder="Tell SAIN what to inspect, diagnose, prepare, or explain..."></textarea><button class="primary-button" type="submit">Send to SAIN</button></form>
      </section>

      <section class="admin-metric-grid">
        ${metric('Coinbase connector', sourceState(snapshot.coinbase), `${number(coinbase.recordedTrades)} trades recorded`)}
        ${metric('Market observations', observations.total ?? observations.count ?? 0, 'Observation Layer records')}
        ${metric('Financial Records', records.total ?? records.count ?? 0, 'Recognized financial positions')}
        ${metric('SRA Coin Positions', coinPositions.length, 'Digital financial assets')}
        ${metric('Instruments', instruments.length, 'Recorded SRA instruments')}
        ${metric('Transactions', transactions.total ?? transactions.count ?? 0, 'Transaction Engine records')}
        ${metric('Hardware wallets', treasury.activeWalletCount ?? 0, `${number(treasury.wallets?.length || 0)} treasury records`)}
        ${metric('Approval queue', 0, 'No proposed state changes')}
      </section>

      <section class="admin-operations-grid">
        <article class="admin-operation-panel"><div class="admin-panel-head"><h3>Market Connections</h3><span class="badge ${stateClass(sourceState(snapshot.coinbase))}">${esc(sourceState(snapshot.coinbase))}</span></div><dl><div><dt>Provider</dt><dd>${esc(coinbase.provider || 'Coinbase')}</dd></div><div><dt>Feed</dt><dd>${esc(coinbase.channel || 'market_trades')}</dd></div><div><dt>Products</dt><dd>${esc((coinbase.products || []).join(', ') || '—')}</dd></div><div><dt>Last trade</dt><dd>${esc(coinbase.lastTradeAt || 'No trade recorded')}</dd></div></dl></article>
        <article class="admin-operation-panel"><div class="admin-panel-head"><h3>Recognition Pipeline</h3><span class="badge open">LIVE RECORDS</span></div><ol><li>Observations: ${number(observations.total ?? observations.count ?? 0)}</li><li>Financial Records: ${number(records.total ?? records.count ?? 0)}</li><li>Coin Positions: ${number(coinPositions.length)}</li><li>Instruments: ${number(instruments.length)}</li><li>Transactions: ${number(transactions.total ?? transactions.count ?? 0)}</li></ol></article>
        <article class="admin-operation-panel"><div class="admin-panel-head"><h3>Treasury and Funding</h3><span class="badge ${stateClass((treasury.activeWalletCount || 0) > 0 ? 'ACTIVE' : 'PENDING')}">${(treasury.activeWalletCount || 0) > 0 ? 'ACTIVE' : 'SETUP PENDING'}</span></div><p>Hardware-wallet signing remains outside the web platform. SAIN may inspect public wallet records and prepare actions, but treasury state changes require approval.</p></article>
        <article class="admin-operation-panel"><div class="admin-panel-head"><h3>Proposed Changes</h3><span class="badge pending">APPROVAL REQUIRED</span></div><div class="admin-empty-state">No proposed changes are waiting. When SAIN prepares a state-changing action, it will appear here before execution.</div></article>
      </section>

      <section class="admin-source-health"><h3>Source health</h3>${Object.entries(snapshot).map(([name, result]) => `<span class="admin-source-item"><b>${esc(name)}</b><small>${result.ok ? 'AVAILABLE' : esc(result.error)}</small></span>`).join('')}</section>
    </section>`;

    bindAgent(root, snapshot);
  }

  function appendMessage(root, text, type = 'agent') {
    const log = root.querySelector('#admin-agent-log');
    const message = document.createElement('div');
    message.className = `admin-agent-message ${type}`;
    message.textContent = text;
    log.appendChild(message);
    log.scrollTop = log.scrollHeight;
  }

  function bindAgent(root, snapshot) {
    const form = root.querySelector('#admin-agent-form');
    const input = root.querySelector('#admin-agent-input');
    root.querySelectorAll('[data-admin-prompt]').forEach(button => button.addEventListener('click', () => {
      input.value = button.dataset.adminPrompt || '';
      input.focus();
    }));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = input.value.trim();
      if (!message) return;
      appendMessage(root, message, 'operator');
      input.value = '';
      try {
        const payload = await json('/api/sane/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            operatingCapacity: 'PLATFORM_ADMIN',
            workspace: 'PLATFORM_ADMINISTRATION',
            context: { adminSnapshot: snapshot }
          })
        });
        appendMessage(root, payload.reply || payload.message || 'SAIN completed the administrative review.');
      } catch (error) {
        appendMessage(root, `SAIN could not complete that request: ${error.message}`, 'error');
      }
    });
  }

  async function renderPlatformAdminWorkspace() {
    const root = document.querySelector('#view-root');
    if (!root) return;
    document.querySelector('#page-title').textContent = 'Platform Administration';
    document.querySelector('#context-title').textContent = 'SAIN Administration';
    document.querySelector('#context-status').textContent = 'ADMIN';
    root.innerHTML = '<div class="loading-state">Loading live Platform Administration records…</div>';
    const snapshot = await loadAdminSnapshot();
    renderSnapshot(root, snapshot);
  }

  window.renderPlatformAdminWorkspace = renderPlatformAdminWorkspace;
})();