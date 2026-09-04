(() => {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function askSain(prompt) {
    const input = document.querySelector('#sane-input');
    if (!input) return;
    input.value = prompt;
    input.focus();
  }

  function shortestWindow(opportunities) {
    const values = opportunities.map((item) => String(item.participationWindow || '').match(/\d+/)).filter(Boolean).map((match) => Number(match[0]));
    return values.length ? `${Math.min(...values)} months` : 'Not available';
  }

  function opportunityMarkup(item) {
    return `<button class="tier-one-opportunity" data-open-opportunity="${pEsc(item.id)}"><div class="tier-one-opportunity-head"><span class="badge open">${pEsc(String(item.stage || '').replaceAll('_', ' '))}</span><span aria-hidden="true">›</span></div><h3>${pEsc(item.title)}</h3><p>${pEsc(item.assetName)} · ${pEsc(item.region)}</p><div class="tier-one-opportunity-metrics"><span><small>Verified Value</small><strong>${money.format(Number(item.verifiedValue || 0))}</strong></span><span><small>Projected Gain</small><strong class="gain-value">+${pEsc(item.projectedGainRate)}%</strong></span><span><small>Window</small><strong>${pEsc(item.participationWindow)}</strong></span><span><small>Status</small><strong>${pEsc(item.completionState)}</strong></span></div><small class="projection-note">Current market projection</small></button>`;
  }

  const openingAssets = [
    { type: 'DIGITAL FINANCIAL ASSET', title: 'SRA Coin Position', description: 'The common digital financial-asset representation of an eligible SRA Financial Record, with source amount, Verified Value, rights, restrictions, ownership, and evidence lineage preserved.', action: 'coin-order' },
    { type: 'PLATFORM FINANCIAL INSTRUMENT', title: 'Platform Funding Instrument', description: 'A separately formed SRA instrument for platform capital formation, with its own issuer, purpose, authorized amount, terms, rights, obligations, and transaction history.', prompt: 'Explain the Platform Funding Instrument, how it is formed, and whether any access or offering workflow is currently active.' }
  ];

  const formationSteps = [
    ['1', 'Connect', 'An authorized account, market, or source supplies transaction and asset data.'], ['2', 'Observe', 'SRA records source information, timestamp, identity, and evidence with source lineage preserved.'], ['3', 'Recognize', 'SAIN evaluates the financial relationship, authority, rights, obligations, ownership, and evidence.'], ['4', 'Record', 'A recognized financial relationship becomes an SRA Financial Record with its lineage preserved.'], ['5', 'Measure', 'SRA records Verified Value separately from the source amount, offered price, and executed trade price.'], ['6', 'Represent', 'An eligible Financial Record becomes an SRA Coin Position and exists as a platform-recognized digital financial asset.'], ['7', 'Form', 'Defined rights and terms may support formation of a separate SRA financial instrument.'], ['8', 'Participate', 'Authorized assets and instruments may enter permitted marketplace ownership, transfer, or transaction workflows.']
  ];

  function openingAssetMarkup(item) {
    const attrs = item.action === 'coin-order' ? 'data-open-coin-order="true"' : `data-native-asset-prompt="${pEsc(item.prompt)}"`;
    const label = item.action === 'coin-order' ? 'Open order workflow →' : 'Review with SAIN →';
    return `<button class="tier-one-native-asset" ${attrs}><span class="badge open">${pEsc(item.type)}</span><h3>${pEsc(item.title)}</h3><p>${pEsc(item.description)}</p><small>${label}</small></button>`;
  }

  function formationMarkup() {
    return formationSteps.map(([number, title, description]) => `<article class="tier-one-formation-step"><span>${number}</span><div><h3>${pEsc(title)}</h3><p>${pEsc(description)}</p></div></article>`).join('');
  }

  async function openCoinOrderWorkflow() {
    const root = document.querySelector('#view-root');
    if (!root) return;
    document.querySelector('#context-title').textContent = 'SRA Coin Order';
    document.querySelector('#context-status').textContent = 'REVIEW';
    root.innerHTML = `<section class="tier-one-live-market coin-order-workflow"><div class="tier-one-section-head"><div><p class="eyebrow">COIN ORDER WORKFLOW</p><h2>Loading your account and available SRA Coin Positions</h2></div><button class="secondary-button" data-return-marketplace>Return to marketplace</button></div><div class="loading-state">Checking Asset Vault and coin records…</div></section>`;
    root.querySelector('[data-return-marketplace]')?.addEventListener('click', renderSignedInMarketplace);

    const [coinResult, vaultResult] = await Promise.allSettled([
      fetch('/api/financial-records/coin-positions').then(async (response) => { if (!response.ok) throw new Error('Coin positions are unavailable.'); return response.json(); }),
      fetch('/api/access/vault').then(async (response) => { if (!response.ok) throw new Error(response.status === 401 ? 'Sign in is required.' : 'Asset Vault is unavailable.'); return response.json(); })
    ]);

    const coinPayload = coinResult.status === 'fulfilled' ? coinResult.value : {};
    const vaultPayload = vaultResult.status === 'fulfilled' ? vaultResult.value : {};
    const positions = Array.isArray(coinPayload.coinPositions) ? coinPayload.coinPositions : Array.isArray(coinPayload.positions) ? coinPayload.positions : [];
    const vault = vaultPayload.vault || vaultPayload;
    const balance = Number(vault.recordedBalance ?? vault.balance ?? 0);
    const available = positions.filter((item) => ['REPRESENTED', 'ACTIVE'].includes(String(item.state || '').toUpperCase()));
    const selected = available[0] || null;
    const positionName = selected ? (selected.coinSymbol || selected.symbol || 'SRA') : 'No orderable SRA Coin Position';
    const verifiedValue = Number(selected?.verifiedValue ?? selected?.sourceAmount ?? selected?.quantity ?? 0);
    const blockers = [];
    if (vaultResult.status !== 'fulfilled') blockers.push(vaultResult.reason?.message || 'Asset Vault could not be loaded.');
    if (!selected) blockers.push('No active SRA Coin Position is currently published for ordering.');
    if (balance <= 0) blockers.push('Add funds to your Asset Vault.');
    blockers.push('An active coin offering, pricing, order-submission, and settlement route must be connected before an order can be submitted.');

    root.innerHTML = `<section class="tier-one-live-market coin-order-workflow" aria-label="Coin order workflow"><div class="tier-one-section-head"><div><p class="eyebrow">COIN ORDER WORKFLOW</p><h2>Review SRA Coin order</h2></div><button class="secondary-button" data-return-marketplace>Return to marketplace</button></div><div class="tier-one-market-summary"><div><span>Selected asset</span><strong>${pEsc(positionName)}</strong></div><div><span>Current Verified Value</span><strong>${money.format(verifiedValue)}</strong></div><div><span>Available Asset Vault balance</span><strong>${money.format(balance)}</strong></div></div><div class="tier-one-native-asset-grid"><article class="tier-one-native-asset"><span class="badge open">STEP 1</span><h3>Select Coin Position</h3><p>${selected ? `Position ${pEsc(selected.coinPositionId || selected.id || 'recorded')} is available for review.` : 'Position selection pending.'}</p></article><article class="tier-one-native-asset"><span class="badge open">STEP 2</span><h3>Enter order amount</h3><p>Next: connect a published offering and price record.</p></article><article class="tier-one-native-asset"><span class="badge open">STEP 3</span><h3>Review account funding</h3><p>Use available funds from this Universal Account’s Asset Vault.</p></article><article class="tier-one-native-asset"><span class="badge open">STEP 4</span><h3>Submit and settle</h3><p>Submit the order and review settlement details.</p></article></div><section class="coin-order-blockers"><p class="eyebrow">CURRENT CONNECTION STATE</p><h3>Complete these steps to submit:</h3><ul>${blockers.map((item) => `<li>${pEsc(item)}</li>`).join('')}</ul></section><div class="tier-one-coin-actions"><button class="secondary-button" id="explain-current-coin-order">Ask SAIN to explain these records</button><button class="primary-button" disabled aria-disabled="true">Submit order</button></div></section>`;
    root.querySelector('[data-return-marketplace]')?.addEventListener('click', renderSignedInMarketplace);
    root.querySelector('#explain-current-coin-order')?.addEventListener('click', () => askSain('Explain the records and missing connections shown in my current SRA Coin order workflow.'));
  }

  renderSignedInMarketplace = function renderSignedInMarketplaceTierOne() {
    const root = document.querySelector('#view-root');
    const opportunities = participationState.opportunities || [];
    const totalVerified = opportunities.reduce((sum, item) => sum + Number(item.verifiedValue || 0), 0);
    const strongest = [...opportunities].sort((a, b) => Number(b.projectedGainRate || 0) - Number(a.projectedGainRate || 0))[0];
    document.body.classList.add('workspace-open'); document.querySelector('#page-title').textContent = 'Living Marketplace'; document.querySelector('#context-title').textContent = 'Marketplace'; document.querySelector('#context-status').textContent = 'LIVE';
    root.innerHTML = `<section class="tier-one-marketplace"><section class="tier-one-market-summary" aria-label="Marketplace summary"><div><span>Live opportunities</span><strong>${opportunities.length}</strong></div><div><span>Verified Value represented</span><strong>${money.format(totalVerified)}</strong></div><div><span>Marketplace status</span><strong class="gain-value">LIVE</strong></div></section><section class="tier-one-opening-assets" aria-label="Opening marketplace assets"><div class="tier-one-section-head"><div><p class="eyebrow">OPENING MARKETPLACE ASSETS</p><h2>Native SRA assets</h2></div><p>The marketplace begins with assets formed from SRA's own recorded financial relationships. These assets exist before any later listing, transfer, or trade.</p></div><div class="tier-one-native-asset-grid">${openingAssets.map(openingAssetMarkup).join('')}</div></section><section class="tier-one-formation-path" aria-label="How value enters SRA"><div class="tier-one-section-head"><div><p class="eyebrow">HOW VALUE ENTERS SRA</p><h2>From source activity to financial asset</h2></div><button class="secondary-button" id="explain-formation-path">Explain this process</button></div><div class="tier-one-formation-grid">${formationMarkup()}</div></section><section class="tier-one-signal-grid" aria-label="Daily marketplace signals"><article><p class="eyebrow">DAILY SIGNAL</p><span>Strongest current signal</span><strong>${strongest ? `+${pEsc(strongest.projectedGainRate)}%` : '—'}</strong><small>${strongest ? pEsc(strongest.title) : 'No current opportunity'}</small></article><article><p class="eyebrow">ACCESS SIGNAL</p><span>Shortest projected window</span><strong>${shortestWindow(opportunities)}</strong><small>Based on current published opportunities</small></article><article><p class="eyebrow">VERIFIED SIGNAL</p><span>Value currently represented</span><strong>${money.format(totalVerified)}</strong><small>Supported by published Verified Value records</small></article></section><section class="tier-one-coin-card" aria-label="SRA Coin access"><div class="tier-one-coin-mark"><img src="/brand-logo" alt="SRA — SAIN Real Asset Market"></div><div><p class="eyebrow">UNIVERSAL ACCOUNT ACCESS</p><h2>SRA Coin</h2><p>An eligible SRA Coin Position is a platform-recognized digital financial asset. Universal users can review its source, Verified Value, rights, restrictions, ownership, and current access state.</p></div><div class="tier-one-coin-actions"><button class="secondary-button" id="explain-sra-coin">Explain SRA Coin</button><button class="primary-button" id="review-coin-access">Open order workflow</button></div></section><section class="tier-one-live-market"><div class="tier-one-section-head"><div><p class="eyebrow">LIVE MARKET</p><h2>Opportunities</h2></div><p>Open an opportunity to review its Verified Value, market signals, participation window, and available positions.</p></div><div class="tier-one-opportunity-grid">${opportunities.map(opportunityMarkup).join('')}</div></section></section>`;
    root.querySelectorAll('[data-open-opportunity]').forEach((button) => button.addEventListener('click', () => openOpportunity(button.dataset.openOpportunity)));
    root.querySelectorAll('[data-open-coin-order]').forEach((button) => button.addEventListener('click', openCoinOrderWorkflow));
    root.querySelectorAll('[data-native-asset-prompt]').forEach((button) => button.addEventListener('click', () => askSain(button.dataset.nativeAssetPrompt)));
    document.querySelector('#explain-formation-path')?.addEventListener('click', () => askSain('Explain how authorized source data moves through Observation, Recognition, Financial Record, Verified Value, SRA Coin Position, instrument formation, and marketplace participation.'));
    document.querySelector('#explain-sra-coin')?.addEventListener('click', () => askSain('Explain the SRA Coin Position as a platform-recognized digital financial asset and distinguish source amount, Verified Value, offered price, and executed trade price.'));
    document.querySelector('#review-coin-access')?.addEventListener('click', openCoinOrderWorkflow);
  };
})();
