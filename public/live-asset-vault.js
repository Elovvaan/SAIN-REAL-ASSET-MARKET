(() => {
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function activityRows(transactions = []) {
    if (!transactions.length) {
      return '<div class="transaction-empty"><strong>No participant-linked activity recorded yet.</strong><span>Your balance remains zero until completed incoming or outgoing account activity is recorded.</span></div>';
    }
    return transactions.map((item) => `<article class="transaction-row">
      <div class="transaction-row-main">
        <span class="transaction-kind">${esc(String(item.kind || 'TRANSACTION').replaceAll('_', ' '))}</span>
        <strong>${esc(item.transactionId || item.referenceId || 'Recorded transaction')}</strong>
        <small>${esc(item.occurredAt ? new Date(item.occurredAt).toLocaleString() : 'Time not recorded')}</small>
      </div>
      <div class="transaction-row-state">
        <strong>${usd.format(Number(item.amount || 0))}</strong>
        <span class="badge ${item.verified ? 'open' : ''}">${esc(item.direction || item.state || 'RECORDED')}</span>
      </div>
    </article>`).join('');
  }

  function assetPositionRows(positions = []) {
    if (!positions.length) return '<div class="transaction-empty"><strong>No direct asset positions yet.</strong><span>Authorized native funding and confirmed external deposits will appear here.</span></div>';
    return positions.map((item) => `<article class="transaction-row">
      <div class="transaction-row-main"><span class="transaction-kind">${esc(item.network || 'NATIVE')}</span><strong>${esc(item.canonicalAssetId)}</strong><small>${esc(String(item.custodyModel || 'RECORDED POSITION').replaceAll('_', ' '))}</small></div>
      <div class="transaction-row-state"><strong>${Number(item.available || 0).toLocaleString(undefined, { maximumFractionDigits: 8 })}</strong><span class="badge">${Number(item.restricted || 0).toLocaleString(undefined, { maximumFractionDigits: 8 })} restricted</span></div>
    </article>`).join('');
  }

  function loading() {
    const root = document.querySelector('#view-root');
    if (!root) return;
    document.body.classList.add('workspace-open');
    document.querySelector('#page-title').textContent = 'My Asset Vault';
    document.querySelector('#context-title').textContent = 'Participant Account';
    document.querySelector('#context-status').textContent = 'LOADING';
    root.innerHTML = '<section class="asset-vault-view"><div class="loading-state">Loading your recorded Asset Vault activity…</div></section>';
  }

  function render(vault, direct = null) {
    const root = document.querySelector('#view-root');
    if (!root) return;
    document.querySelector('#context-status').textContent = 'OWNER CONTROLLED';
    root.innerHTML = `<section class="asset-vault-view">
      <section class="asset-vault-hero">
        <div>
          <p class="eyebrow">PARTICIPANT-OWNED DIGITAL ACCOUNT</p>
          <h2>${esc(vault.displayName)} Asset Vault</h2>
          <p>This view is derived from participant-linked transaction records. SRA connects, verifies, records, and routes authorized activity without representing the participant's assets as platform-owned property.</p>
        </div>
        <div class="asset-vault-identity">
          <span>Universal Account</span>
          <strong>${esc(vault.accountId)}</strong>
          <small>Current operating tier: ${esc(vault.activeCapacity || 'UNIVERSAL')}</small>
        </div>
      </section>

      <section class="asset-vault-balance-grid">
        <article class="asset-vault-balance primary">
          <span>Recorded account balance</span>
          <strong>${usd.format(Number(vault.recordedBalance || 0))}</strong>
          <small>Completed incoming activity minus completed outgoing activity.</small>
        </article>
        <article class="asset-vault-balance"><span>Incoming recorded</span><strong>${usd.format(Number(vault.incomingTotal || 0))}</strong><small>Completed value recorded into this account.</small></article>
        <article class="asset-vault-balance"><span>Outgoing recorded</span><strong>${usd.format(Number(vault.outgoingTotal || 0))}</strong><small>Completed value recorded out of this account.</small></article>
      </section>

      <section class="asset-vault-control-grid">
        <article><span>Ownership</span><strong>${esc(vault.ownership || 'PARTICIPANT')}</strong><p>The account belongs to the identified participant.</p></article>
        <article><span>Platform role</span><strong>${esc(vault.platformRole || 'INFRASTRUCTURE')}</strong><p>SRA provides access, verification, recording, routing, and settlement coordination.</p></article>
        <article><span>Custody state</span><strong>${esc(String(vault.custodyState || 'NOT_INFERRED').replaceAll('_', ' '))}</strong><p>Custody is shown only when an actual custody arrangement is recorded.</p></article>
      </section>

      <section class="asset-vault-balance-grid">
        <article class="asset-vault-balance"><span>Linked transactions</span><strong>${esc(vault.transactionCount || 0)}</strong><small>Records linked to this participant or Universal Account.</small></article>
        <article class="asset-vault-balance"><span>Completed</span><strong>${esc(vault.completedTransactionCount || 0)}</strong><small>Completed directional and recorded activity.</small></article>
        <article class="asset-vault-balance"><span>Pending</span><strong>${esc(vault.pendingTransactionCount || 0)}</strong><small>Not included in the recorded balance.</small></article>
      </section>

      <section class="asset-vault-ledger">
        <div class="transaction-section-title"><div><p class="eyebrow">DIRECT MULTI-ASSET ACCOUNT</p><h2>Native and external asset positions</h2></div><span class="badge">${esc(direct?.account?.accountModel || 'DIRECT MULTI ASSET')}</span></div>
        <div class="transaction-list">${assetPositionRows(direct?.positions || [])}</div>
        <div class="asset-vault-control-grid">
          <article><span>Participant assets</span><strong>PARTICIPANT OWNED</strong><p>Positions remain attributed to this account and do not fund origination.</p></article>
          <article><span>Origination</span><strong>INDEPENDENT</strong><p>New funding value arises from an authorized SRA transaction.</p></article>
          <article><span>Repayments</span><strong>INSTITUTIONAL GROWTH</strong><p>Received repayments support SRA operations and expansion.</p></article>
        </div>
      </section>

      <section class="asset-vault-ledger">
        <div class="transaction-section-title"><div><p class="eyebrow">ACCOUNT LEDGER</p><h2>Participant-linked activity</h2></div><span class="badge">LIVE READ MODEL</span></div>
        <div class="transaction-list">${activityRows(vault.transactions)}</div>
      </section>
    </section>`;
  }

  async function openLiveVault() {
    if (!window.accessState?.session) return;
    loading();
    try {
      const [vaultResponse, directResponse] = await Promise.all([
        fetch('/api/access/vault', { headers: { Accept: 'application/json' } }),
        fetch('/api/direct-accounts/me', { headers: { Accept: 'application/json' } }),
      ]);
      const [payload, direct] = await Promise.all([vaultResponse.json(), directResponse.json()]);
      if (!vaultResponse.ok) throw new Error(payload.error || 'Asset Vault lookup failed.');
      if (!directResponse.ok) throw new Error(direct.error || 'Direct Value Account lookup failed.');
      render(payload.vault, direct);
    } catch (error) {
      const root = document.querySelector('#view-root');
      document.querySelector('#context-status').textContent = 'UNAVAILABLE';
      if (root) root.innerHTML = `<section class="asset-vault-view"><div class="transaction-empty"><strong>Asset Vault could not load.</strong><span>${esc(error.message)}</span></div></section>`;
    }
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('.nav-item[data-view="account"], [data-open-asset-vault]');
    if (!trigger) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
    document.querySelector('.nav-item[data-view="account"]')?.classList.add('active');
    openLiveVault();
  }, true);

  window.openLiveAssetVault = openLiveVault;
})();
