(() => {
  const LABELS = new Map([
    ['home-projects', ['⌂', 'Home']],
    ['marketplace', ['◫', 'Marketplace']],
    ['instruments', ['▱', 'Create Instrument']],
    ['funding-operations', ['↳', 'Financing']],
    ['positions', ['▤', 'My Positions']],
    ['custody', ['▣', 'Asset Vault']],
    ['activity', ['≋', 'Transactions']],
    ['assets', ['◇', 'SRA Coin']],
    ['pools', ['⬡', 'Predictions / Liquidity']],
    ['participants', ['◌', 'Account']]
  ]);
  const ORDER = [...LABELS.keys()];
  const OWNED_VIEWS = new Set(ORDER);
  const signedIn = () => Boolean(window.accessState?.session);
  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const moneyCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  let mounted = false;
  let activeView = 'home-projects';
  let marketplaceState = null;
  let marketplaceRequest = null;

  const VIEW_COPY = {
    'home-projects': ['Home', 'ACTIVE'],
    marketplace: ['Marketplace', 'LIVE'],
    instruments: ['Create Instrument', 'AVAILABLE'],
    'funding-operations': ['Financing', 'AVAILABLE'],
    positions: ['My Positions', 'ACTIVE'],
    custody: ['Asset Vault', 'CONTROLLED'],
    activity: ['Transactions', 'RECORDED'],
    assets: ['SRA Coin', 'AT PAR'],
    pools: ['Predictions / Liquidity', 'REFERENCE'],
    participants: ['Account', 'ACTIVE']
  };

  function loadStyle() {
    if (document.querySelector('link[data-participant-suite]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/participant-workspace-suite.css';
    link.dataset.participantSuite = 'true';
    document.head.append(link);
  }

  function configureNavigation() {
    const nav = document.querySelector('.nav-list');
    if (!nav) return;
    const existing = new Map([...nav.querySelectorAll('.nav-item')].map((button) => [button.dataset.view, button]));
    for (const view of ORDER) {
      const button = existing.get(view);
      if (!button) continue;
      const [icon, label] = LABELS.get(view);
      button.innerHTML = `<span>${icon}</span> ${label}`;
      button.classList.remove('role-hidden');
      nav.append(button);
    }
    for (const button of nav.querySelectorAll('.nav-item')) {
      if (!LABELS.has(button.dataset.view)) button.classList.add('role-hidden');
    }
    nav.dataset.participantNav = 'true';
  }

  function setFrame(view) {
    const [title, status] = VIEW_COPY[view] || ['Home', 'ACTIVE'];
    const pageTitle = document.querySelector('#page-title');
    const contextTitle = document.querySelector('#context-title');
    const contextStatus = document.querySelector('#context-status');
    if (pageTitle) pageTitle.textContent = title;
    if (contextTitle) contextTitle.textContent = title;
    if (contextStatus) contextStatus.textContent = status;
    document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  }

  function card(title, copy, target) {
    return `<button class="product-card" data-suite-view="${esc(target)}"><strong>${esc(title)}</strong><span>${esc(copy)}</span><small>Open →</small></button>`;
  }

  function homeMarkup() {
    return `<section class="participant-journey">
      <div class="participant-home-summary">
        <article><span>Total recognized value</span><strong>Account linked</strong></article>
        <article><span>SRA balance</span><strong>At par</strong></article>
        <article><span>Active instruments</span><strong>Open positions</strong></article>
        <article><span>Available financing</span><strong>Tier based</strong></article>
        <article><span>Pending actions</span><strong>Continue below</strong></article>
      </div>
      <section class="participant-journey-section"><h3>Continue where you left off</h3><div class="journey-list">
        <button class="journey-row" data-suite-view="instruments"><strong>Instrument ready to create</strong><span>Open your approved instrument workflow.</span></button>
        <button class="journey-row" data-suite-view="funding-operations"><strong>Review financing eligibility</strong><span>Use an approved instrument and available capacity.</span></button>
        <button class="journey-row" data-suite-view="positions"><strong>Review your positions</strong><span>See participant holdings and their next available action.</span></button>
      </div></section>
      <section class="participant-journey-section"><h3>Available platform services</h3><div class="product-grid">
        ${card('Create an Instrument', 'Create within the tier and capacity approved for your account.', 'instruments')}
        ${card('Financing', 'Prepare financing from an approved instrument.', 'funding-operations')}
        ${card('Marketplace', 'Browse LIVE SRA/USD products only.', 'marketplace')}
        ${card('Asset Vault', 'Review assets and participant-facing custody status.', 'custody')}
        ${card('SRA Coin', 'Review SRA represented at par from recognized value.', 'assets')}
      </div></section>
      <section class="participant-journey-section"><h3>Your approved capabilities</h3><div class="capability-list">
        <div class="capability-item available">✓ Record verified value</div>
        <div class="capability-item available">✓ Receive SRA representation</div>
        <div class="capability-item available">✓ Create Tier 1 instruments</div>
        <div class="capability-item available">✓ Participate in SRA/USD</div>
        <div class="capability-item pending">○ Tier 2 review pending</div>
        <div class="capability-item pending">○ External settlement not configured</div>
      </div></section>
    </section>`;
  }

  function instrumentMarkup() {
    return `<section class="participant-journey"><section class="participant-journey-section"><h3>Create an Instrument</h3><p>Your available instrument types are based on recognized value, current tier, and approved capacity.</p><div class="capability-list"><div class="capability-item available">Tier 1 — Recorded-value instruments</div><div class="capability-item pending">Tier 2 — Commercial and project instruments require approval</div><div class="capability-item pending">Tier 3 — Transferable financing instruments require governed settlement access</div></div></section></section>`;
  }

  function financingMarkup() {
    return `<section class="participant-journey"><section class="participant-journey-section"><h3>Financing</h3><p>Funding operations are loading inside this participant workspace.</p><div class="journey-list"><div class="journey-row"><strong>Approved instrument required</strong><span>Select an instrument in the action rail.</span></div><div class="journey-row"><strong>Capacity follows your tier</strong><span>The platform validates the requested amount before review.</span></div><div class="journey-row"><strong>SAIN prepares the request</strong><span>No financing executes without confirmation and authorization.</span></div></div></section></section>`;
  }

  function positionsMarkup() {
    return `<section class="participant-journey"><section class="participant-journey-section"><h3>My Positions</h3><p>Your active, held, transferable, settled, and completed participant positions appear here.</p><div class="journey-list"><div class="journey-row"><strong>No participant positions loaded</strong><span>Positions will appear after an instrument, financing, or marketplace action creates one for this account.</span></div></div></section></section>`;
  }

  function simpleMarkup(title, description, rows) {
    return `<section class="participant-journey"><section class="participant-journey-section"><h3>${esc(title)}</h3><p>${esc(description)}</p><div class="journey-list">${rows.map(([name, copy]) => `<div class="journey-row"><strong>${esc(name)}</strong><span>${esc(copy)}</span></div>`).join('')}</div></section></section>`;
  }

  function viewMarkup(view) {
    if (view === 'home-projects') return homeMarkup();
    if (view === 'instruments') return instrumentMarkup();
    if (view === 'funding-operations') return financingMarkup();
    if (view === 'positions') return positionsMarkup();
    if (view === 'activity') return simpleMarkup('Transactions', 'Your participant transaction history and settlement events appear here.', [['Recent activity', 'No participant transactions are loaded for this account.'], ['Search', 'Transaction search becomes available when records exist.']]);
    if (view === 'assets') return simpleMarkup('SRA Coin', 'SRA representation follows verified recorded USD value at the fixed SRA/USD par reference.', [['Unit reference', '1 SRA = 1 USD'], ['Represented value', 'Linked from your recognized account records'], ['Coin intelligence', 'SAIN can explain any canonical Coin Position ID']]);
    if (view === 'pools') return simpleMarkup('Predictions / Liquidity', 'Reference markets and liquidity information are shown only when approved products exist.', [['Reference markets', 'No approved participant reference markets are currently available.'], ['Execution boundary', 'Reference information is separate from executed market activity.']]);
    if (view === 'participants') return simpleMarkup('Account', 'Manage your participant identity, tier, capabilities, and account access.', [['Current workspace', window.accessState?.session?.activeCapacity || 'Universal'], ['Capabilities', 'Use the Capabilities control to review available tiers.'], ['Security', 'Session and sign-in controls remain at the top of the page.']]);
    return homeMarkup();
  }

  function vaultActivityRows(transactions = []) {
    if (!transactions.length) {
      return '<div class="transaction-empty"><strong>No participant-linked activity recorded yet.</strong><span>Your balance remains zero until completed incoming or outgoing account activity is recorded.</span></div>';
    }
    return transactions.map((item) => `<article class="transaction-row"><div class="transaction-row-main"><span class="transaction-kind">${esc(String(item.kind || 'TRANSACTION').replaceAll('_', ' '))}</span><strong>${esc(item.transactionId || item.referenceId || 'Recorded transaction')}</strong><small>${esc(item.occurredAt ? new Date(item.occurredAt).toLocaleString() : 'Time not recorded')}</small></div><div class="transaction-row-state"><strong>${moneyCents.format(Number(item.amount || 0))}</strong><span class="badge ${item.verified ? 'open' : ''}">${esc(item.direction || item.state || 'RECORDED')}</span></div></article>`).join('');
  }

  async function renderAssetVault(root) {
    root.innerHTML = '<section class="asset-vault-view"><div class="loading-state">Loading your recorded Asset Vault activity…</div></section>';
    try {
      const response = await fetch('/api/access/vault', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Asset Vault lookup failed.');
      if (activeView !== 'custody') return;
      const vault = payload.vault || {};
      const contextStatus = document.querySelector('#context-status');
      if (contextStatus) contextStatus.textContent = 'OWNER CONTROLLED';
      root.innerHTML = `<section class="asset-vault-view">
        <section class="asset-vault-hero"><div><p class="eyebrow">PARTICIPANT-OWNED DIGITAL ACCOUNT</p><h2>${esc(vault.displayName || 'Participant')} Asset Vault</h2><p>This view is derived from participant-linked transaction records. SRA connects, verifies, records, and routes authorized activity without representing the participant's assets as platform-owned property.</p></div><div class="asset-vault-identity"><span>Universal Account</span><strong>${esc(vault.accountId || window.accessState?.session?.universalAccountId || 'Account linked')}</strong><small>Current operating tier: ${esc(vault.activeCapacity || window.accessState?.session?.activeCapacity || 'UNIVERSAL')}</small></div></section>
        <section class="asset-vault-balance-grid"><article class="asset-vault-balance primary"><span>Recorded account balance</span><strong>${moneyCents.format(Number(vault.recordedBalance || 0))}</strong><small>Completed incoming activity minus completed outgoing activity.</small></article><article class="asset-vault-balance"><span>Incoming recorded</span><strong>${moneyCents.format(Number(vault.incomingTotal || 0))}</strong><small>Completed value recorded into this account.</small></article><article class="asset-vault-balance"><span>Outgoing recorded</span><strong>${moneyCents.format(Number(vault.outgoingTotal || 0))}</strong><small>Completed value recorded out of this account.</small></article></section>
        <section class="asset-vault-control-grid"><article><span>Ownership</span><strong>${esc(vault.ownership || 'PARTICIPANT')}</strong><p>The account belongs to the identified participant.</p></article><article><span>Platform role</span><strong>${esc(vault.platformRole || 'INFRASTRUCTURE')}</strong><p>SRA provides access, verification, recording, routing, and settlement coordination.</p></article><article><span>Custody state</span><strong>${esc(String(vault.custodyState || 'NOT_INFERRED').replaceAll('_', ' '))}</strong><p>Custody is shown only when an actual custody arrangement is recorded.</p></article></section>
        <section class="asset-vault-balance-grid"><article class="asset-vault-balance"><span>Linked transactions</span><strong>${esc(vault.transactionCount || 0)}</strong><small>Records linked to this participant or Universal Account.</small></article><article class="asset-vault-balance"><span>Completed</span><strong>${esc(vault.completedTransactionCount || 0)}</strong><small>Completed directional and recorded activity.</small></article><article class="asset-vault-balance"><span>Pending</span><strong>${esc(vault.pendingTransactionCount || 0)}</strong><small>Not included in the recorded balance.</small></article></section>
        <section class="asset-vault-ledger"><div class="transaction-section-title"><div><p class="eyebrow">ACCOUNT LEDGER</p><h2>Participant-linked activity</h2></div><span class="badge">LIVE READ MODEL</span></div><div class="transaction-list">${vaultActivityRows(vault.transactions)}</div></section>
      </section>`;
    } catch (error) {
      if (activeView !== 'custody') return;
      const contextStatus = document.querySelector('#context-status');
      if (contextStatus) contextStatus.textContent = 'UNAVAILABLE';
      root.innerHTML = `<section class="asset-vault-view"><div class="transaction-empty"><strong>Asset Vault could not load.</strong><span>${esc(error.message)}</span></div></section>`;
    }
  }

  async function getMarketplace() {
    if (marketplaceState) return marketplaceState;
    if (!marketplaceRequest) {
      marketplaceRequest = fetch('/api/marketplace', { cache: 'no-store' })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || 'Marketplace request failed.');
          marketplaceState = payload;
          return payload;
        })
        .finally(() => { marketplaceRequest = null; });
    }
    return marketplaceRequest;
  }

  function marketplaceProjectRows(projects = []) {
    return projects.map((project) => `<article class="project-row context-card"><div class="project-main"><div class="project-title"><div class="project-symbol">◇</div><div><h3>${esc(project.title)}</h3><p>${esc(project.assetName)} · ${esc(project.region)}</p></div></div><div class="project-signal"><strong>+${esc(project.projectedGainRate)}%</strong><span>market signal</span></div></div><div class="project-gain-row"><div><span>Verified Value</span><strong>${money.format(Number(project.verifiedValue || 0))}</strong></div><div><span>Projected window</span><strong>${esc(project.participationWindow)}</strong></div></div><div class="project-meta"><span class="badge open">${esc(project.stage)}</span><span class="badge ${project.completionState === 'ELIGIBLE' ? 'watch' : ''}">${esc(project.completionState)}</span></div><div class="context-actions"><button data-participant-prompt="Open ${esc(project.title)}">Open</button><button data-participant-prompt="Compare ${esc(project.title)}">Compare</button><button data-participant-prompt="Participate in ${esc(project.title)}">Participate</button></div></article>`).join('');
  }

  async function renderMarketplace(root) {
    root.innerHTML = '<div class="loading-state">Loading Marketplace…</div>';
    try {
      const data = await getMarketplace();
      if (activeView !== 'marketplace') return;
      const projects = Array.isArray(data.projects) ? data.projects : [];
      const represented = projects.reduce((sum, project) => sum + Number(project.verifiedValue || 0), 0);
      root.innerHTML = `<section class="metric-grid compact"><article class="metric-card"><span>Verified opportunities</span><strong>${projects.length}</strong><small>Live productive opportunities</small></article><article class="metric-card"><span>Verified Value represented</span><strong>${money.format(represented)}</strong><small>Current value represented</small></article><article class="metric-card"><span>Marketplace</span><strong>${esc(data.marketStatus || 'LIVE')}</strong><small>Current operating state</small></article></section><section class="panel contextual-panel"><div class="panel-header"><div><h2>Opportunities</h2><p>Results and actions remain in the Marketplace workspace.</p></div><span class="badge open">LIVE MARKET</span></div><div class="project-list">${marketplaceProjectRows(projects)}</div></section>`;
      bindParticipantPrompts(root);
    } catch (error) {
      root.innerHTML = `<div class="empty-view"><h2>Marketplace unavailable</h2><p>${esc(error.message || 'Marketplace could not load.')}</p></div>`;
    }
  }

  function actionMarkup(view) {
    if (view === 'marketplace') return ['Marketplace', `<div class="participant-action-ticket"><div class="ticket-stat"><span>Market</span><strong>LIVE SRA/USD</strong></div><button type="button" data-participant-prompt="Show me opportunities I can participate in.">Find opportunities</button><button type="button" data-participant-prompt="Compare the current projects for me.">Compare projects</button><button type="button" data-participant-prompt="Show me the smallest eligible opportunity.">Start small</button></div>`];
    if (view === 'instruments') return ['Create Instrument', `<div class="participant-action-ticket"><div class="ticket-stat"><span>Tier</span><strong>Tier 1 — Available</strong></div><div class="ticket-stat"><span>Recognized value</span><strong>Linked from account</strong></div><div class="ticket-stat"><span>SRA available</span><strong>At par</strong></div><label>Instrument amount<input type="number" min="0" step="any" placeholder="0.00 SRA"></label><label>Purpose<select><option>Recorded-value instrument</option><option>Commercial project</option><option>Financing instrument</option></select></label><label>Term<select><option>Open term</option><option>12 months</option><option>36 months</option></select></label><button type="button" data-participant-prompt="Review my proposed instrument with SAIN.">Review with SAIN</button></div>`];
    if (view === 'funding-operations') return ['Request Financing', `<div class="participant-action-ticket"><div class="ticket-stat"><span>Available capacity</span><strong>Based on approved tier</strong></div><label>Approved instrument<select><option>Select instrument</option></select></label><label>Amount<input type="number" min="0" step="any" placeholder="0.00 USD"></label><label>Term<select><option>Select term</option><option>12 months</option><option>36 months</option></select></label><button type="button" data-participant-prompt="Review my financing request with SAIN.">Review Financing</button></div>`];
    return ['What are you trying to accomplish?', ''];
  }

  function bindParticipantPrompts(scope = document) {
    scope.querySelectorAll('[data-participant-prompt]').forEach((button) => {
      if (button.dataset.participantPromptBound === 'true') return;
      button.dataset.participantPromptBound = 'true';
      button.addEventListener('click', () => {
        const input = document.querySelector('#sane-input');
        if (input) { input.value = button.dataset.participantPrompt; input.focus(); }
      });
    });
  }

  function renderAction(view) {
    const [titleText, html] = actionMarkup(view);
    const title = document.querySelector('#sane-workspace-title');
    const context = document.querySelector('#chat-context');
    const prompts = document.querySelector('#quick-prompts');
    if (title) title.textContent = titleText;
    if (context) context.textContent = view === 'home-projects' ? 'Ask SAIN to guide your next participant action.' : 'Current participant action';
    if (prompts) prompts.innerHTML = html;
    bindParticipantPrompts();
  }

  function renderOwnedView(view) {
    if (!signedIn() || !OWNED_VIEWS.has(view)) return;
    activeView = view;
    const root = document.querySelector('#view-root');
    if (!root) return;
    document.body.classList.add('workspace-open');
    setFrame(view);
    if (view === 'marketplace') void renderMarketplace(root);
    else if (view === 'custody') void renderAssetVault(root);
    else if (view === 'funding-operations') {
      if (typeof window.renderParticipantFundingOperations === 'function') void window.renderParticipantFundingOperations(root);
      else root.innerHTML = financingMarkup();
    } else {
      root.innerHTML = viewMarkup(view);
      root.querySelectorAll('[data-suite-view]').forEach((button) => button.addEventListener('click', () => openView(button.dataset.suiteView)));
    }
    renderAction(view);
  }

  function openView(view) { renderOwnedView(view); }

  function bindOwnedButtons() {
    document.querySelectorAll('.nav-item').forEach((button) => {
      if (!OWNED_VIEWS.has(button.dataset.view) || button.dataset.participantOwnedBound === 'true') return;
      button.dataset.participantOwnedBound = 'true';
      button.addEventListener('click', (event) => {
        if (!signedIn()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        renderOwnedView(button.dataset.view);
      }, true);
    });
  }

  function mount() {
    if (!signedIn()) return;
    loadStyle();
    configureNavigation();
    bindOwnedButtons();
    if (!mounted) {
      mounted = true;
      document.body.classList.add('participant-suite-ready');
      renderOwnedView(activeView);
    }
  }

  function unmount() {
    mounted = false;
    marketplaceState = null;
    document.body.classList.remove('participant-suite-ready');
    document.querySelector('.nav-list')?.removeAttribute('data-participant-nav');
  }

  function sync() { signedIn() ? mount() : unmount(); }
  function initialize() { sync(); }
  window.addEventListener('sra:access-state-changed', sync);
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();