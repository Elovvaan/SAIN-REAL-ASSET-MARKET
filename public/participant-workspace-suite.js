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
    ['pools', ['⬡', 'Market Pools']],
    ['events', ['◉', 'Event Market']],
    ['participants', ['◌', 'Account']]
  ]);
  const ORDER = [...LABELS.keys()];
  const OWNED_VIEWS = new Set(ORDER);
  const signedIn = () => Boolean(window.accessState?.session);
  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const qty = (value) => number(value).toLocaleString(undefined, { maximumFractionDigits: 8 });
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const moneyCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  let mounted = false;
  let activeView = 'home-projects';
  let participantMirror = null;
  let participantMirrorRequest = null;

  const VIEW_COPY = {
    'home-projects': ['Home', 'ACTIVE'],
    marketplace: ['Marketplace', 'LIVE'],
    instruments: ['Create Instrument', 'AVAILABLE'],
    'funding-operations': ['Financing', 'AVAILABLE'],
    positions: ['My Positions', 'ACTIVE'],
    custody: ['Asset Vault', 'CONTROLLED'],
    activity: ['Transactions', 'RECORDED'],
    assets: ['SRA Coin', 'AT PAR'],
    pools: ['Market Pools', 'PRODUCTIVE'],
    events: ['Event Market', 'LIVE EVENTS'],
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
    for (const button of nav.querySelectorAll('.nav-item')) if (!LABELS.has(button.dataset.view)) button.classList.add('role-hidden');
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

  async function requestJson(url) {
    const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }

  function identityKeys() {
    const session = window.accessState?.session || {};
    return new Set([session.id, session.universalAccountId].filter(Boolean));
  }

  function belongsToParticipant(record, keys = identityKeys()) {
    return [record?.participantId, record?.ownerId, record?.holderId, record?.accountId, record?.universalAccountId, record?.fromAccountId, record?.toAccountId]
      .some((value) => value && keys.has(value));
  }

  function isDerivativeCoinPosition(record) {
    const id = record?.coinPositionId || record?.positionId || record?.id || null;
    return Boolean(record?.parentPositionId || record?.segmentationState === 'ACTIVE_CHILD' || (record?.sourcePositionId && record.sourcePositionId !== id));
  }

  function coinUnit(position) {
    return String(position?.symbol || position?.unit || position?.denomination?.symbol || '').toUpperCase();
  }

  function participantSpendableSra(position) {
    return Math.max(0, number(position?.availableQuantity ?? position?.quantity));
  }

  function coinBasisUsd(record) {
    return number(record?.recordedValue?.amount ?? record?.representedValueUsd ?? (String(record?.sourcePosition?.unit || '').toUpperCase() === 'USD' ? record?.sourcePosition?.amount : 0));
  }

  function settledValue(result, fallback) {
    return result?.status === 'fulfilled' ? result.value : fallback;
  }

  function settledError(result) {
    return result?.status === 'rejected' ? (result.reason?.message || String(result.reason || 'Request failed.')) : null;
  }

  async function getParticipantMirror(force = false) {
    if (force) participantMirror = null;
    if (participantMirror) return participantMirror;
    if (!participantMirrorRequest) {
      participantMirrorRequest = Promise.allSettled([
        requestJson('/api/participation/positions'),
        requestJson('/api/access/vault'),
        requestJson('/api/marketplace-listings?state=LIVE&limit=100'),
        requestJson('/api/financial-records/coin-positions'),
      ]).then(([positionsResult, vaultResult, listingsResult, coinResult]) => {
        const positionsPayload = settledValue(positionsResult, { positions: [] });
        const vaultPayload = settledValue(vaultResult, { vault: {} });
        const listingsPayload = settledValue(listingsResult, { listings: [] });
        const coinPayload = settledValue(coinResult, { coinPositions: [] });
        const positions = Array.isArray(positionsPayload.positions) ? positionsPayload.positions : [];
        const vault = vaultPayload.vault || {};
        const listings = Array.isArray(listingsPayload.listings) ? listingsPayload.listings.filter((listing) => {
          const live = listing.status === 'LIVE' || ['PUBLISHED', 'ACTIVE'].includes(listing.state);
          return live && !listing.executionBlocked && !(listing.blockers || []).length;
        }) : [];
        const allCoinPositions = Array.isArray(coinPayload.coinPositions) ? coinPayload.coinPositions.filter((position) => coinUnit(position) === 'SRA') : [];
        const roots = allCoinPositions.filter((item) => !isDerivativeCoinPosition(item));
        const activeRoots = roots.filter((item) => String(item.state || '').toUpperCase() !== 'RETIRED');
        const participantCoins = allCoinPositions.filter((item) => belongsToParticipant(item));
        const representedSra = activeRoots.reduce((sum, item) => sum + number(item.quantity), 0);
        const recognizedUsd = activeRoots.reduce((sum, item) => sum + coinBasisUsd(item), 0);
        const missingBasis = activeRoots.filter((item) => coinBasisUsd(item) <= 0).length;
        const mismatches = activeRoots.filter((item) => coinBasisUsd(item) > 0 && Math.abs(number(item.quantity) - coinBasisUsd(item)) > 0.00000001).length;
        const sourceMix = {};
        for (const item of activeRoots) {
          const unit = String(item?.sourcePosition?.unit || item?.nativeUnit || item?.sourceUnit || 'SOURCE').toUpperCase();
          sourceMix[unit] = (sourceMix[unit] || 0) + 1;
        }
        participantMirror = {
          positions,
          vault,
          listings,
          errors: {
            positions: settledError(positionsResult),
            vault: settledError(vaultResult),
            listings: settledError(listingsResult),
            coin: settledError(coinResult),
          },
          coin: {
            all: allCoinPositions,
            roots,
            participant: participantCoins,
            network: {
              totalPositionCount: allCoinPositions.length,
              rootPositionCount: roots.length,
              derivativePositionCount: allCoinPositions.length - roots.length,
              representedSra,
              recognizedUsd,
              missingBasis,
              mismatches,
              coveragePct: activeRoots.length ? ((activeRoots.length - missingBasis) / activeRoots.length) * 100 : 100,
              sourceMix,
            }
          }
        };
        return participantMirror;
      }).finally(() => { participantMirrorRequest = null; });
    }
    return participantMirrorRequest;
  }

  function card(title, copy, target) {
    return `<button class="product-card" data-suite-view="${esc(target)}"><strong>${esc(title)}</strong><span>${esc(copy)}</span><small>Open →</small></button>`;
  }

  function capability(id) {
    return (window.accessState?.session?.capabilities || []).find((item) => item.id === id) || null;
  }

  function instrumentMarkup() {
    const session = window.accessState?.session || {};
    const activeCapacity = session.activeCapacity || 'UNIVERSAL';
    const assetProvider = capability('ASSET_PROVIDER');
    const professional = capability('MARKET_PROFESSIONAL');
    const institutional = capability('INSTITUTIONAL_OPERATOR');
    const transferableReady = ['ASSET_PROVIDER','MARKET_PROFESSIONAL','INSTITUTIONAL_OPERATOR','PLATFORM_ADMIN'].includes(activeCapacity);
    return `<section class="participant-journey"><section class="participant-journey-section"><div class="transaction-section-title"><div><p class="eyebrow">INSTRUMENT FORMATION</p><h2>Create an Instrument</h2><p>This workspace reflects the capabilities currently attached to your Universal Account. It does not treat an internal record as an issued instrument.</p></div><span class="badge open">${esc(activeCapacity.replaceAll('_',' '))}</span></div><div class="participant-home-summary"><article><span>Universal account</span><strong>${esc(session.universalAccountId || 'Linked')}</strong></article><article><span>Asset Provider</span><strong>${esc(assetProvider?.state || 'NOT ADDED')}</strong></article><article><span>Market Professional</span><strong>${esc(professional?.state || 'NOT ADDED')}</strong></article><article><span>Institutional Operator</span><strong>${esc(institutional?.state || 'NOT ADDED')}</strong></article></div><div class="journey-list"><div class="journey-row"><strong>Recorded-value formation</strong><span>SAIN can review a proposed instrument against recognized value and the records already attached to this account.</span></div><div class="journey-row"><strong>Commercial / project formation</strong><span>${assetProvider?.state === 'ACTIVE' ? 'Asset Provider capability is active for this identity.' : 'Asset Provider capability is not currently active.'}</span></div><div class="journey-row"><strong>Transferable financing instruments</strong><span>${transferableReady ? 'Your current operating tier can enter the governed financing workflow when the required underlying records exist.' : 'A governed operating capability and qualifying underlying records are required before transferable financing formation.'}</span></div><div class="journey-row"><strong>Issuance boundary</strong><span>Creating or reviewing a proposal here is not issuance. Review, authorization, and the instrument lifecycle remain separate platform stages.</span></div></div></section></section>`;
  }

  function financingMarkup() {
    return `<section class="participant-journey"><section class="participant-journey-section"><h3>Financing</h3><p>Funding operations are loading inside this participant workspace.</p><div class="journey-list"><div class="journey-row"><strong>Approved instrument required</strong><span>Select an instrument in the action rail.</span></div><div class="journey-row"><strong>Capacity follows your tier</strong><span>The platform validates the requested amount before review.</span></div><div class="journey-row"><strong>SAIN prepares the request</strong><span>No financing executes without confirmation and authorization.</span></div></div></section></section>`;
  }

  function simpleMarkup(title, description, rows) {
    return `<section class="participant-journey"><section class="participant-journey-section"><h3>${esc(title)}</h3><p>${esc(description)}</p><div class="journey-list">${rows.map(([name, copy]) => `<div class="journey-row"><strong>${esc(name)}</strong><span>${esc(copy)}</span></div>`).join('')}</div></section></section>`;
  }

  function staticMarkup(view) {
    if (view === 'instruments') return instrumentMarkup();
    if (view === 'funding-operations') return financingMarkup();
    if (view === 'pools') return simpleMarkup('Market Pools', 'Productive basket capability is loading.', [['Productive baskets', 'Governed bundles of approved assets.'], ['Reference markets', 'Maintained as a separate informational lane.']]);
    if (view === 'events') return simpleMarkup('Event Market', 'Evidence-controlled event markets are loading.', [['Yes / No contracts', 'Outcome positions settle at zero or one SRA/USD.'], ['Resolution', 'Published sources and rules control settlement.']]);
    if (view === 'participants') return simpleMarkup('Account', 'Your Universal Account and capability states are loading.', [['Identity', 'One identity and one Universal Account.'], ['Capabilities', 'Operating tiers follow the capability records on this account.']]);
    return '';
  }

  function positionRows(positions = []) {
    if (!positions.length) return '<div class="transaction-empty"><strong>No participant positions recorded yet.</strong><span>A position will appear only after this signed-in participant actually creates or receives one.</span></div>';
    return positions.map((item) => `<article class="transaction-row"><div class="transaction-row-main"><span class="transaction-kind">${esc(String(item.participationType || item.positionType || 'POSITION').replaceAll('_', ' '))}</span><strong>${esc(item.opportunityTitle || item.assetName || item.projectId || item.id || 'Participant position')}</strong><small>${esc(item.updatedAt || item.createdAt ? new Date(item.updatedAt || item.createdAt).toLocaleString() : 'Time not recorded')}</small></div><div class="transaction-row-state"><strong>${item.contribution?.statedAmount ? moneyCents.format(number(item.contribution.statedAmount)) : esc(item.state || 'RECORDED')}</strong><span class="badge">${esc(item.state || 'RECORDED')}</span></div></article>`).join('');
  }

  function vaultActivityRows(transactions = []) {
    if (!transactions.length) return '<div class="transaction-empty"><strong>No participant-linked activity recorded yet.</strong><span>Your balance remains zero until completed incoming or outgoing account activity is recorded.</span></div>';
    return transactions.map((item) => `<article class="transaction-row"><div class="transaction-row-main"><span class="transaction-kind">${esc(String(item.kind || 'TRANSACTION').replaceAll('_', ' '))}</span><strong>${esc(item.transactionId || item.referenceId || 'Recorded transaction')}</strong><small>${esc(item.occurredAt ? new Date(item.occurredAt).toLocaleString() : 'Time not recorded')}</small></div><div class="transaction-row-state"><strong>${moneyCents.format(number(item.amount))}</strong><span class="badge ${item.verified ? 'open' : ''}">${esc(item.direction || item.state || 'RECORDED')}</span></div></article>`).join('');
  }

  async function renderHome(root) {
    root.innerHTML = '<div class="loading-state">Reading your current platform state…</div>';
    try {
      const [data, eventPayload] = await Promise.all([getParticipantMirror(), requestJson('/api/event-markets').catch(() => ({ markets: [] }))]);
      if (activeView !== 'home-projects') return;
      const participantSra = data.coin.participant.reduce((sum, item) => sum + participantSpendableSra(item), 0);
      const pendingTransactions = number(data.vault.pendingTransactionCount);
      const pendingPositions = data.positions.filter((item) => /PENDING|AWAITING|AUTHORIZED|REVIEW|READY/.test(String(item.state || '').toUpperCase())).length;
      const marketPulse = typeof window.sraEventMarketHomeMarkup === 'function' ? window.sraEventMarketHomeMarkup(eventPayload.markets || []) : '';
      root.innerHTML = `<section class="participant-journey">
        ${marketPulse}
        <div class="participant-home-summary">
          <article><span>Recorded vault balance</span><strong>${data.errors.vault ? 'Unavailable' : moneyCents.format(number(data.vault.recordedBalance))}</strong></article>
          <article><span>Your available SRA</span><strong>${data.errors.coin ? 'Unavailable' : `${qty(participantSra)} SRA`}</strong></article>
          <article><span>Your positions</span><strong>${data.errors.positions ? 'Unavailable' : data.positions.length}</strong></article>
          <article><span>LIVE marketplace products</span><strong>${data.errors.listings ? 'Initializing' : data.listings.length}</strong></article>
          <article><span>Pending actions</span><strong>${pendingTransactions + pendingPositions}</strong></article>
        </div>
        <section class="participant-journey-section"><h3>Continue where you left off</h3><div class="journey-list">
          <button class="journey-row" data-suite-view="positions"><strong>${data.errors.positions ? 'Positions temporarily unavailable' : data.positions.length ? 'Review your positions' : 'No positions yet'}</strong><span>${data.errors.positions ? 'Other participant workspaces remain available.' : data.positions.length ? 'See holdings and their current recorded state.' : 'Positions appear only after a participant action creates one.'}</span></button>
          <button class="journey-row" data-suite-view="marketplace"><strong>${data.errors.listings ? 'Marketplace listing layer is initializing' : data.listings.length ? `${data.listings.length} LIVE marketplace product${data.listings.length === 1 ? '' : 's'}` : 'No LIVE marketplace products'}</strong><span>Marketplace only shows products that have completed publication.</span></button>
          <button class="journey-row" data-suite-view="activity"><strong>${data.errors.vault ? 'Transaction activity temporarily unavailable' : `${data.vault.transactionCount || 0} linked transaction record${Number(data.vault.transactionCount || 0) === 1 ? '' : 's'}`}</strong><span>Open your participant-linked activity and settlement history.</span></button>
        </div></section>
        <section class="participant-journey-section"><h3>Available platform services</h3><div class="product-grid">
          ${card('Create an Instrument', 'Create within the tier and capacity approved for your account.', 'instruments')}
          ${card('Financing', 'Prepare financing from an approved instrument.', 'funding-operations')}
          ${card('Marketplace', 'Browse published LIVE SRA/USD products only.', 'marketplace')}
          ${card('Event Market', 'Follow live market movement and governed YES / NO event contracts.', 'events')}
          ${card('Asset Vault', 'Review participant-linked balance and transaction activity.', 'custody')}
          ${card('SRA Coin', 'Separate your linked SRA from the network-wide representation state.', 'assets')}
        </div></section>
      </section>`;
      bindSuiteLinks(root);
    } catch (error) {
      if (activeView !== 'home-projects') return;
      root.innerHTML = `<div class="empty-view"><h2>Home state unavailable</h2><p>${esc(error.message)}</p></div>`;
    }
  }

  async function renderPositions(root) {
    root.innerHTML = '<div class="loading-state">Loading your positions…</div>';
    try {
      const data = await getParticipantMirror();
      if (activeView !== 'positions') return;
      if (data.errors.positions) throw new Error(data.errors.positions);
      root.innerHTML = `<section class="asset-vault-view"><section class="asset-vault-ledger"><div class="transaction-section-title"><div><p class="eyebrow">PARTICIPANT STATE</p><h2>My Positions</h2><p>Only positions linked to the signed-in participant are shown here.</p></div><span class="badge">${data.positions.length} RECORDED</span></div><div class="transaction-list">${positionRows(data.positions)}</div></section></section>`;
    } catch (error) {
      if (activeView !== 'positions') return;
      root.innerHTML = `<div class="empty-view"><h2>Positions unavailable</h2><p>${esc(error.message)}</p></div>`;
    }
  }

  async function renderTransactions(root) {
    root.innerHTML = '<div class="loading-state">Loading participant-linked transaction activity…</div>';
    try {
      const data = await getParticipantMirror();
      if (activeView !== 'activity') return;
      if (data.errors.vault) throw new Error(data.errors.vault);
      root.innerHTML = `<section class="asset-vault-view"><section class="asset-vault-balance-grid"><article class="asset-vault-balance"><span>Linked transactions</span><strong>${data.vault.transactionCount || 0}</strong></article><article class="asset-vault-balance"><span>Completed</span><strong>${data.vault.completedTransactionCount || 0}</strong></article><article class="asset-vault-balance"><span>Pending</span><strong>${data.vault.pendingTransactionCount || 0}</strong></article></section><section class="asset-vault-ledger"><div class="transaction-section-title"><div><p class="eyebrow">TRANSACTION HISTORY</p><h2>Your recorded activity</h2><p>Global platform activity is not mixed into this account view.</p></div><span class="badge">LIVE READ MODEL</span></div><div class="transaction-list">${vaultActivityRows(data.vault.transactions || [])}</div></section></section>`;
    } catch (error) {
      if (activeView !== 'activity') return;
      root.innerHTML = `<div class="empty-view"><h2>Transactions unavailable</h2><p>${esc(error.message)}</p></div>`;
    }
  }

  async function renderSraCoin(root) {
    root.innerHTML = '<div class="loading-state">Reading SRA representation state…</div>';
    try {
      const data = await getParticipantMirror();
      if (activeView !== 'assets') return;
      if (data.errors.coin) throw new Error(data.errors.coin);
      const network = data.coin.network;
      const participantSra = data.coin.participant.reduce((sum, item) => sum + participantSpendableSra(item), 0);
      const sources = Object.entries(network.sourceMix).sort((a, b) => b[1] - a[1]).map(([unit, count]) => `${unit}: ${count}`).join(' · ') || 'No represented sources';
      root.innerHTML = `<section class="participant-journey"><section class="participant-journey-section"><div class="transaction-section-title"><div><p class="eyebrow">SRA / USD REPRESENTATION</p><h2>SRA Coin</h2><p>Network representation and your account ownership are separate facts.</p></div><span class="badge open">1 SRA = 1 USD</span></div><div class="participant-home-summary"><article><span>Network represented SRA</span><strong>${qty(network.representedSra)} SRA</strong></article><article><span>Network recognized USD basis</span><strong>${moneyCents.format(network.recognizedUsd)}</strong></article><article><span>Network Coin Positions</span><strong>${network.totalPositionCount}</strong></article><article><span>Your linked position slices</span><strong>${data.coin.participant.length}</strong></article><article><span>Your available SRA</span><strong>${qty(participantSra)} SRA</strong></article></div><div class="journey-list"><div class="journey-row"><strong>Representation coverage ${network.coveragePct.toFixed(1)}%</strong><span>${network.missingBasis} root positions are missing a visible USD basis in this read model; ${network.mismatches} are off par.</span></div><div class="journey-row"><strong>Position lineage</strong><span>${network.rootPositionCount} independent root positions · ${network.derivativePositionCount} derivative/segmented slices. Derivatives do not create new supply.</span></div><div class="journey-row"><strong>Participant holding math</strong><span>Your available SRA is summed from spendable position quantities, so segmented children do not create a duplicate holding.</span></div><div class="journey-row"><strong>Source mix</strong><span>${esc(sources)}</span></div></div></section></section>`;
    } catch (error) {
      if (activeView !== 'assets') return;
      root.innerHTML = `<div class="empty-view"><h2>SRA Coin state unavailable</h2><p>${esc(error.message)}</p></div>`;
    }
  }

  async function renderAssetVault(root) {
    root.innerHTML = '<section class="asset-vault-view"><div class="loading-state">Loading your recorded Asset Vault activity…</div></section>';
    try {
      const data = await getParticipantMirror();
      if (activeView !== 'custody') return;
      if (data.errors.vault) throw new Error(data.errors.vault);
      const vault = data.vault || {};
      const contextStatus = document.querySelector('#context-status');
      if (contextStatus) contextStatus.textContent = 'OWNER CONTROLLED';
      root.innerHTML = `<section class="asset-vault-view"><section class="asset-vault-hero"><div><p class="eyebrow">PARTICIPANT-OWNED DIGITAL ACCOUNT</p><h2>${esc(vault.displayName || 'Participant')} Asset Vault</h2><p>This view is derived from participant-linked transaction records. SRA connects, verifies, records, and routes authorized activity without representing the participant's assets as platform-owned property.</p></div><div class="asset-vault-identity"><span>Universal Account</span><strong>${esc(vault.accountId || window.accessState?.session?.universalAccountId || 'Account linked')}</strong><small>Current operating tier: ${esc(vault.activeCapacity || window.accessState?.session?.activeCapacity || 'UNIVERSAL')}</small></div></section><section class="asset-vault-balance-grid"><article class="asset-vault-balance primary"><span>Recorded account balance</span><strong>${moneyCents.format(number(vault.recordedBalance))}</strong><small>Completed incoming activity minus completed outgoing activity.</small></article><article class="asset-vault-balance"><span>Incoming recorded</span><strong>${moneyCents.format(number(vault.incomingTotal))}</strong><small>Completed value recorded into this account.</small></article><article class="asset-vault-balance"><span>Outgoing recorded</span><strong>${moneyCents.format(number(vault.outgoingTotal))}</strong><small>Completed value recorded out of this account.</small></article></section><section class="asset-vault-control-grid"><article><span>Ownership</span><strong>${esc(vault.ownership || 'PARTICIPANT')}</strong><p>The account belongs to the identified participant.</p></article><article><span>Platform role</span><strong>${esc(vault.platformRole || 'INFRASTRUCTURE')}</strong><p>SRA provides access, verification, recording, routing, and settlement coordination.</p></article><article><span>Custody state</span><strong>${esc(String(vault.custodyState || 'NOT_INFERRED').replaceAll('_', ' '))}</strong><p>Custody is shown only when an actual custody arrangement is recorded.</p></article></section><section class="asset-vault-balance-grid"><article class="asset-vault-balance"><span>Linked transactions</span><strong>${esc(vault.transactionCount || 0)}</strong></article><article class="asset-vault-balance"><span>Completed</span><strong>${esc(vault.completedTransactionCount || 0)}</strong></article><article class="asset-vault-balance"><span>Pending</span><strong>${esc(vault.pendingTransactionCount || 0)}</strong></article></section><section class="asset-vault-ledger"><div class="transaction-section-title"><div><p class="eyebrow">ACCOUNT LEDGER</p><h2>Participant-linked activity</h2></div><span class="badge">LIVE READ MODEL</span></div><div class="transaction-list">${vaultActivityRows(vault.transactions)}</div></section></section>`;
    } catch (error) {
      if (activeView !== 'custody') return;
      document.querySelector('#context-status')?.replaceChildren(document.createTextNode('UNAVAILABLE'));
      root.innerHTML = `<section class="asset-vault-view"><div class="transaction-empty"><strong>Asset Vault could not load.</strong><span>${esc(error.message)}</span></div></section>`;
    }
  }

  function marketplaceRows(listings = []) {
    if (!listings.length) return '<div class="transaction-empty"><strong>No LIVE marketplace products are currently available.</strong><span>Prepared, reviewed, or internal records do not appear here until publication is complete.</span></div>';
    return listings.map((listing) => `<article class="project-row context-card"><div class="project-main"><div class="project-title"><div class="project-symbol">◇</div><div><h3>${esc(listing.title || listing.instrumentId || listing.listingId)}</h3><p>${esc(listing.instrumentId || '')} · SRA/USD</p></div></div><div class="project-signal"><strong>${moneyCents.format(number(listing.pricing?.unitPrice || listing.pricing?.askingPrice || 1))}</strong><span>per SRA</span></div></div><div class="project-gain-row"><div><span>Recorded USD value</span><strong>${money.format(number(listing.recordedValueUsd || listing.verifiedRecordedValueUsd || listing.faceValueUsd))}</strong></div><div><span>Available quantity</span><strong>${qty(listing.quantity)} SRA</strong></div></div><div class="project-meta"><span class="badge open">LIVE</span><span class="badge">${esc(listing.listingType || 'SRA INSTRUMENT')}</span></div><div class="context-actions"><button data-participant-prompt="Open marketplace listing ${esc(listing.listingId)}">Open</button><button data-participant-prompt="Explain marketplace listing ${esc(listing.listingId)}">Explain</button></div></article>`).join('');
  }

  async function renderMarketplace(root) {
    root.innerHTML = '<div class="loading-state">Loading published Marketplace products…</div>';
    try {
      const data = await getParticipantMirror();
      if (activeView !== 'marketplace') return;
      if (data.errors.listings) throw new Error(data.errors.listings);
      const represented = data.listings.reduce((sum, listing) => sum + number(listing.recordedValueUsd || listing.verifiedRecordedValueUsd || listing.faceValueUsd), 0);
      root.innerHTML = `<section class="metric-grid compact"><article class="metric-card"><span>LIVE products</span><strong>${data.listings.length}</strong><small>Published participant-facing listings only</small></article><article class="metric-card"><span>Recorded value represented</span><strong>${money.format(represented)}</strong><small>USD basis of LIVE products</small></article><article class="metric-card"><span>Marketplace</span><strong>LIVE</strong><small>Feature state does not imply products exist</small></article></section><section class="panel contextual-panel"><div class="panel-header"><div><h2>Marketplace</h2><p>Internal projects, Financial Records, Coin Positions, and prepared listings remain out of this view until they become a published product.</p></div><span class="badge open">LIVE MARKET</span></div><div class="project-list">${marketplaceRows(data.listings)}</div></section>`;
      bindParticipantPrompts(root);
    } catch (error) {
      if (activeView !== 'marketplace') return;
      root.innerHTML = `<div class="empty-view"><h2>Marketplace unavailable</h2><p>${esc(error.message || 'Marketplace could not load.')}</p></div>`;
    }
  }

  function actionMarkup(view) {
    if (view === 'marketplace') return ['Marketplace', `<div class="participant-action-ticket"><div class="ticket-stat"><span>Market</span><strong>LIVE SRA/USD</strong></div><button type="button" data-participant-prompt="Show me opportunities I can participate in.">Find opportunities</button><button type="button" data-participant-prompt="Explain what is currently LIVE in the marketplace.">Explain market</button></div>`];
    if (view === 'instruments') return ['Create Instrument', `<div class="participant-action-ticket"><div class="ticket-stat"><span>Current operating tier</span><strong>${esc(String(window.accessState?.session?.activeCapacity || 'UNIVERSAL').replaceAll('_',' '))}</strong></div><div class="ticket-stat"><span>Representation rule</span><strong>1 SRA = 1 USD recognized value</strong></div><button type="button" data-participant-prompt="Review what instrument formation paths are currently available to my account.">Review formation paths</button><button type="button" data-participant-prompt="What recognized value and authority records do I need before creating an instrument?">Explain prerequisites</button></div>`];
    if (view === 'funding-operations') return ['Request Financing', `<div class="participant-action-ticket"><div class="ticket-stat"><span>Workflow</span><strong>Verified Value → Model → Instrument → Market → Settlement</strong></div><button type="button" data-participant-prompt="Explain my current financing state and the next available action.">Explain financing state</button></div>`];
    if (view === 'pools') return ['Market Pools', `<div class="participant-action-ticket"><div class="ticket-stat"><span>Market</span><strong>PRODUCTIVE BASKETS</strong></div><button type="button" data-participant-prompt="Explain how productive asset baskets form, close, perform, and distribute value.">Explain market pools</button></div>`];
    if (view === 'events') return ['Event Market', `<div class="participant-action-ticket"><div class="ticket-stat"><span>Contract</span><strong>YES / NO · $1 SETTLEMENT</strong></div><button type="button" data-participant-prompt="Explain the open event markets, their resolution rules, and my maximum exposure.">Explain event markets</button></div>`];
    if (view === 'participants') return ['Account', `<div class="participant-action-ticket"><div class="ticket-stat"><span>Universal account</span><strong>${esc(window.accessState?.session?.universalAccountId || 'Linked')}</strong></div><button type="button" data-participant-prompt="Explain my current capabilities and operating tier.">Explain my capabilities</button></div>`];
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

  function bindSuiteLinks(scope = document) {
    scope.querySelectorAll('[data-suite-view]').forEach((button) => {
      if (button.dataset.participantSuiteBound === 'true') return;
      button.dataset.participantSuiteBound = 'true';
      button.addEventListener('click', () => openView(button.dataset.suiteView));
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
    renderAction(view);
    if (window.SRAPublicFeatures?.requires(view) && !window.SRAPublicFeatures.isReady(view)) {
      root.innerHTML = '<div class="loading-state">Opening this workspace…</div>';
      void window.SRAPublicFeatures.ensure(view).catch((error) => {
        if (activeView === view) root.innerHTML = `<div class="empty-view"><h2>Workspace unavailable</h2><p>${esc(error.message)}</p></div>`;
      });
      return;
    }
    if (view === 'home-projects') void renderHome(root);
    else if (view === 'marketplace') {
      if (typeof window.renderTransactionMarketSection === 'function') void window.renderTransactionMarketSection();
      else void renderMarketplace(root);
    }
    else if (view === 'positions') void renderPositions(root);
    else if (view === 'custody') void renderAssetVault(root);
    else if (view === 'activity') void renderTransactions(root);
    else if (view === 'assets') void renderSraCoin(root);
    else if (view === 'instruments') root.innerHTML = instrumentMarkup();
    else if (view === 'funding-operations') {
      if (typeof window.renderParticipantFundingOperations === 'function') void window.renderParticipantFundingOperations(root);
      else root.innerHTML = financingMarkup();
    } else if (view === 'pools') {
      if (typeof window.renderHybridLiquidityWorkspace === 'function') void window.renderHybridLiquidityWorkspace(root);
      else root.innerHTML = staticMarkup(view);
    } else if (view === 'events') {
      if (typeof window.renderEventMarketWorkspace === 'function') void window.renderEventMarketWorkspace(root);
      else root.innerHTML = staticMarkup(view);
    } else if (view === 'participants') {
      if (typeof window.renderCapabilities === 'function') {
        window.renderCapabilities();
        setFrame('participants');
      } else root.innerHTML = staticMarkup(view);
    } else root.innerHTML = staticMarkup(view);
    bindSuiteLinks(root);
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
      document.body.dataset.publicPresentationOwner = 'participant-workspace-suite';
      renderOwnedView(activeView);
    }
  }

  function unmount() {
    mounted = false;
    participantMirror = null;
    participantMirrorRequest = null;
    document.body.classList.remove('participant-suite-ready');
    delete document.body.dataset.publicPresentationOwner;
    document.querySelector('.nav-list')?.removeAttribute('data-participant-nav');
  }

  function sync() {
    participantMirror = null;
    signedIn() ? mount() : unmount();
  }
  function initialize() { sync(); }
  window.addEventListener('sra:access-state-changed', sync);
  window.addEventListener('sra:participant-data-mutated', () => { participantMirror = null; participantMirrorRequest = null; if (signedIn()) renderOwnedView(activeView); });
  window.addEventListener('sra:public-workspace-features-ready', (event) => {
    if (signedIn() && event.detail?.view === activeView) renderOwnedView(activeView);
  });
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
