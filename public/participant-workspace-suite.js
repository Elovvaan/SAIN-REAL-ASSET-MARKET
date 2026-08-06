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
  const OWNED_VIEWS = new Set(ORDER.filter((view) => view !== 'marketplace'));
  const signedIn = () => Boolean(window.accessState?.session);
  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  let mounted = false;
  let activeView = 'home-projects';

  const VIEW_COPY = {
    'home-projects': ['Home', 'ACTIVE'],
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
    return `<section class="participant-journey"><section class="participant-journey-section"><h3>Financing</h3><p>Prepare financing from an approved instrument. Internal platform funding operations and administrative settlement controls are not shown here.</p><div class="journey-list"><div class="journey-row"><strong>Approved instrument required</strong><span>Select an instrument in the action rail.</span></div><div class="journey-row"><strong>Capacity follows your tier</strong><span>The platform validates the requested amount before review.</span></div><div class="journey-row"><strong>SAIN prepares the request</strong><span>No financing executes without confirmation and authorization.</span></div></div></section></section>`;
  }

  function positionsMarkup() {
    return `<section class="participant-journey"><section class="participant-journey-section"><h3>My Positions</h3><p>Your active, held, transferable, settled, and completed participant positions appear here.</p><div class="journey-list"><div class="journey-row"><strong>No participant positions loaded</strong><span>Positions will appear after an instrument, financing, or marketplace action creates one for this account.</span></div></div></section></section>`;
  }

  function vaultMarkup() {
    return `<section class="participant-journey"><section class="participant-journey-section"><h3>Asset Vault</h3><p>This view shows only your participant-facing asset custody state. Restricted institutional records, internal collateral schedules, and administrative files remain in Administration.</p><div class="participant-home-summary"><article><span>Assets held</span><strong>Account linked</strong></article><article><span>Settlement status</span><strong>Review when available</strong></article><article><span>Release status</span><strong>Controlled</strong></article></div></section></section>`;
  }

  function simpleMarkup(title, description, rows) {
    return `<section class="participant-journey"><section class="participant-journey-section"><h3>${esc(title)}</h3><p>${esc(description)}</p><div class="journey-list">${rows.map(([name, copy]) => `<div class="journey-row"><strong>${esc(name)}</strong><span>${esc(copy)}</span></div>`).join('')}</div></section></section>`;
  }

  function viewMarkup(view) {
    if (view === 'home-projects') return homeMarkup();
    if (view === 'instruments') return instrumentMarkup();
    if (view === 'funding-operations') return financingMarkup();
    if (view === 'positions') return positionsMarkup();
    if (view === 'custody') return vaultMarkup();
    if (view === 'activity') return simpleMarkup('Transactions', 'Your participant transaction history and settlement events appear here.', [['Recent activity', 'No participant transactions are loaded for this account.'], ['Search', 'Transaction search becomes available when records exist.']]);
    if (view === 'assets') return simpleMarkup('SRA Coin', 'SRA representation follows verified recorded USD value at the fixed SRA/USD par reference.', [['Unit reference', '1 SRA = 1 USD'], ['Represented value', 'Linked from your recognized account records'], ['Coin intelligence', 'SAIN can explain any canonical Coin Position ID']]);
    if (view === 'pools') return simpleMarkup('Predictions / Liquidity', 'Reference markets and liquidity information are shown only when approved products exist.', [['Reference markets', 'No approved participant reference markets are currently available.'], ['Execution boundary', 'Reference information is separate from executed market activity.']]);
    if (view === 'participants') return simpleMarkup('Account', 'Manage your participant identity, tier, capabilities, and account access.', [['Current workspace', window.accessState?.session?.activeCapacity || 'Universal'], ['Capabilities', 'Use the Capabilities control to review available tiers.'], ['Security', 'Session and sign-in controls remain at the top of the page.']]);
    return homeMarkup();
  }

  function actionMarkup(view) {
    if (view === 'instruments') return ['Create Instrument', `<div class="participant-action-ticket"><div class="ticket-stat"><span>Tier</span><strong>Tier 1 — Available</strong></div><div class="ticket-stat"><span>Recognized value</span><strong>Linked from account</strong></div><div class="ticket-stat"><span>SRA available</span><strong>At par</strong></div><label>Instrument amount<input type="number" min="0" step="any" placeholder="0.00 SRA"></label><label>Purpose<select><option>Recorded-value instrument</option><option>Commercial project</option><option>Financing instrument</option></select></label><label>Term<select><option>Open term</option><option>12 months</option><option>36 months</option></select></label><button type="button" data-participant-prompt="Review my proposed instrument with SAIN.">Review with SAIN</button></div>`];
    if (view === 'funding-operations') return ['Request Financing', `<div class="participant-action-ticket"><div class="ticket-stat"><span>Available capacity</span><strong>Based on approved tier</strong></div><label>Approved instrument<select><option>Select instrument</option></select></label><label>Amount<input type="number" min="0" step="any" placeholder="0.00 USD"></label><label>Term<select><option>Select term</option><option>12 months</option><option>36 months</option></select></label><button type="button" data-participant-prompt="Review my financing request with SAIN.">Review Financing</button></div>`];
    return ['What are you trying to accomplish?', ''];
  }

  function renderAction(view) {
    const [titleText, html] = actionMarkup(view);
    const title = document.querySelector('#sane-workspace-title');
    const context = document.querySelector('#chat-context');
    const prompts = document.querySelector('#quick-prompts');
    if (title) title.textContent = titleText;
    if (context) context.textContent = view === 'home-projects' ? 'Ask SAIN to guide your next participant action.' : 'Current participant action';
    if (prompts) prompts.innerHTML = html;
    document.querySelectorAll('[data-participant-prompt]').forEach((button) => button.addEventListener('click', () => {
      const input = document.querySelector('#sane-input');
      if (input) { input.value = button.dataset.participantPrompt; input.focus(); }
    }));
  }

  function renderOwnedView(view) {
    if (!signedIn() || !OWNED_VIEWS.has(view)) return;
    activeView = view;
    const root = document.querySelector('#view-root');
    if (!root) return;
    document.body.classList.add('workspace-open');
    setFrame(view);
    root.innerHTML = viewMarkup(view);
    root.querySelectorAll('[data-suite-view]').forEach((button) => button.addEventListener('click', () => openView(button.dataset.suiteView)));
    renderAction(view);
  }

  function openView(view) {
    if (view === 'marketplace') {
      document.querySelector('.nav-item[data-view="marketplace"]')?.click();
      return;
    }
    renderOwnedView(view);
  }

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
    document.body.classList.remove('participant-suite-ready');
    document.querySelector('.nav-list')?.removeAttribute('data-participant-nav');
  }

  function sync() { signedIn() ? mount() : unmount(); }
  const observer = new MutationObserver(sync);
  function initialize() { observer.observe(document.body, { subtree: true, childList: true }); sync(); }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
