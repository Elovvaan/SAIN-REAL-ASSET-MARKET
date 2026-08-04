(() => {
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function market() {
    return window.state?.marketplace?.transactionMarket || state?.marketplace?.transactionMarket || {
      status: 'READY', transactionCount: 0, completedCount: 0, pendingCount: 0,
      verifiedCount: 0, completedVolume: 0, verifiedVolume: 0, averageCompletedSize: 0,
      byKind: [], recentTransactions: []
    };
  }

  function ensureAccountNavigation() {
    const nav = document.querySelector('.nav-list');
    if (!nav || nav.querySelector('[data-view="account"]')) return;
    const positions = nav.querySelector('[data-view="positions"]');
    const button = document.createElement('button');
    button.className = 'nav-item role-hidden';
    button.dataset.view = 'account';
    button.innerHTML = '<span>▣</span> My Asset Vault';
    positions?.after(button);
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      renderAssetVault();
    });
  }

  function revealAccountNavigation() {
    const button = document.querySelector('.nav-item[data-view="account"]');
    if (button) button.classList.toggle('role-hidden', !window.accessState?.session);
  }

  function transactionCards(data) {
    const cards = [
      ['Recorded transactions', data.transactionCount, 'All normalized economic records'],
      ['Completed volume', usd.format(data.completedVolume || 0), 'Completed recorded activity'],
      ['Verified volume', usd.format(data.verifiedVolume || 0), 'Evidence-supported completed activity'],
      ['Pending activity', data.pendingCount, 'Awaiting completion or verification']
    ];
    return cards.map(([label, value, note]) => `<article class="transaction-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join('');
  }

  function recentRows(data, limit = 8) {
    const rows = (data.recentTransactions || []).slice(0, limit);
    if (!rows.length) {
      return '<div class="transaction-empty"><strong>No transaction activity recorded yet.</strong><span>The market is ready. Records will appear when authorized activity begins.</span></div>';
    }
    return rows.map((item) => `<article class="transaction-row">
      <div class="transaction-row-main">
        <span class="transaction-kind">${esc(String(item.kind || 'TRANSACTION').replaceAll('_', ' '))}</span>
        <strong>${esc(item.label || item.id || 'Recorded transaction')}</strong>
        <small>${esc(item.occurredAt ? new Date(item.occurredAt).toLocaleString() : 'Time not recorded')}</small>
      </div>
      <div class="transaction-row-state">
        <strong>${usd.format(Number(item.amount || 0))}</strong>
        <span class="badge ${item.verified ? 'open' : ''}">${esc(item.verified ? 'VERIFIED' : item.state || 'RECORDED')}</span>
      </div>
    </article>`).join('');
  }

  function renderTransactionMarketSection() {
    const host = document.querySelector('.tier-one-marketplace') || document.querySelector('#view-root');
    if (!host || host.querySelector('#transaction-market-panel')) return;
    const data = market();
    host.insertAdjacentHTML('afterbegin', `<section class="transaction-market-panel" id="transaction-market-panel">
      <div class="transaction-market-head">
        <div>
          <p class="eyebrow">TRANSACTION MARKET</p>
          <h2>Verified Economic Activity</h2>
          <p>This market reads completed and pending transaction records across the SRA network. The records remain records; they are not converted into separate instruments.</p>
        </div>
        <span class="badge open">${esc(data.status || 'READY')}</span>
      </div>
      <div class="transaction-metric-grid">${transactionCards(data)}</div>
      <div class="transaction-market-body">
        <div>
          <div class="transaction-section-title"><h3>Recent market activity</h3><span>${esc(data.completedCount || 0)} completed</span></div>
          <div class="transaction-list">${recentRows(data, 6)}</div>
        </div>
        <aside class="transaction-market-explainer">
          <span class="eyebrow">WHAT THIS SHOWS</span>
          <strong>Movement, not speculation.</strong>
          <p>The Transaction Market measures what has actually moved, completed, settled, or reached verified-event status inside SRA.</p>
          <button class="secondary-button" data-open-asset-vault>Open My Asset Vault</button>
        </aside>
      </div>
    </section>`);
    host.querySelector('[data-open-asset-vault]')?.addEventListener('click', renderAssetVault);
  }

  function renderAssetVault() {
    const root = document.querySelector('#view-root');
    const session = window.accessState?.session;
    if (!root || !session) return;
    const data = market();
    document.body.classList.add('workspace-open');
    document.querySelector('#page-title').textContent = 'My Asset Vault';
    document.querySelector('#context-title').textContent = 'Participant Account';
    document.querySelector('#context-status').textContent = 'OWNER CONTROLLED';

    const recordedBalance = Number(data.participantRecordedBalance || 0);
    root.innerHTML = `<section class="asset-vault-view">
      <section class="asset-vault-hero">
        <div>
          <p class="eyebrow">PARTICIPANT-OWNED DIGITAL ACCOUNT</p>
          <h2>${esc(session.displayName)} Asset Vault</h2>
          <p>This is the participant account and ledger view. SRA connects, verifies, records, and routes authorized activity without representing the participant's assets as platform-owned property.</p>
        </div>
        <div class="asset-vault-identity">
          <span>Universal Account</span>
          <strong>${esc(session.universalAccountId)}</strong>
          <small>Current operating tier: ${esc(session.activeCapacity || 'UNIVERSAL')}</small>
        </div>
      </section>

      <section class="asset-vault-balance-grid">
        <article class="asset-vault-balance primary">
          <span>Recorded account balance</span>
          <strong>${usd.format(recordedBalance)}</strong>
          <small>${recordedBalance ? 'Derived from participant-linked ledger records.' : 'No participant-linked monetary balance has been recorded yet.'}</small>
        </article>
        <article class="asset-vault-balance"><span>Recorded transactions</span><strong>${esc(data.transactionCount || 0)}</strong><small>Network records visible to this market read model.</small></article>
        <article class="asset-vault-balance"><span>Verified network volume</span><strong>${usd.format(data.verifiedVolume || 0)}</strong><small>Market-wide verified activity, not the participant balance.</small></article>
      </section>

      <section class="asset-vault-control-grid">
        <article><span>Ownership</span><strong>Participant</strong><p>The account belongs to the identified participant.</p></article>
        <article><span>Platform role</span><strong>Infrastructure</strong><p>SRA provides account access, verification, recording, routing, and settlement coordination.</p></article>
        <article><span>Custody state</span><strong>Not inferred</strong><p>Custody is shown only when an actual custody arrangement is recorded.</p></article>
      </section>

      <section class="asset-vault-ledger">
        <div class="transaction-section-title"><div><p class="eyebrow">ACCOUNT LEDGER</p><h2>Recorded activity</h2></div><span class="badge">READ MODEL</span></div>
        <div class="transaction-list">${recentRows(data, 12)}</div>
      </section>
    </section>`;
  }

  function enhanceMarketplaceSoon() {
    setTimeout(renderTransactionMarketSection, 30);
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('.nav-item[data-view="marketplace"]')) enhanceMarketplaceSoon();
  }, true);

  const originalConfigureNavigation = window.configureNavigation;
  if (typeof originalConfigureNavigation === 'function') {
    window.configureNavigation = function configuredWithAssetVault(...args) {
      const result = originalConfigureNavigation.apply(this, args);
      ensureAccountNavigation();
      revealAccountNavigation();
      return result;
    };
  }

  window.addEventListener('DOMContentLoaded', () => {
    ensureAccountNavigation();
    setTimeout(() => {
      revealAccountNavigation();
      if (document.querySelector('.nav-item[data-view="marketplace"].active')) renderTransactionMarketSection();
    }, 180);
  });

  window.renderAssetVault = renderAssetVault;
  window.renderTransactionMarketSection = renderTransactionMarketSection;
})();
