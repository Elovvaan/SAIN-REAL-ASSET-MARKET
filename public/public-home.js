(() => {
  const PUBLIC_HOME_VERSION = 'V22_INFRASTRUCTURE';
  const PUBLIC_WELCOME = 'SRA is the infrastructure connecting productive assets to verified financial positions, governed markets, and settlement. Ask me to explain the asset path, current system status, SRA Coin participation, or how to bring an asset into SRA.';
  const originalFetch = window.fetch.bind(window);
  let syncQueued = false;

  const leftCards = [
    ['Verified Value','Understand how supported value is established and recorded.','Explain Verified Value.'],
    ['Living Marketplace','Explore verified opportunities and productive projects.','Show me what is available in the Living Marketplace.'],
    ['Public Recognition','See how documented rights and obligations are evaluated.','Explain the Public Recognition Framework.']
  ];

  const rightCards = [
    ['Financial Assets','Learn how recognized financial relationships become assets on SRA.','How do financial assets work here?'],
    ['SRA Coin','Understand the platform-recognized digital financial asset and where it fits.','Explain the SRA Coin Position and its purpose.'],
    ['How Value Enters SRA','Follow the path from authorized source data to Financial Record, Verified Value, Coin Position, instrument, and marketplace.','Show me how value enters SRA and becomes a financial asset.']
  ];

  function accessResolved() {
    return Boolean(window.accessState && window.accessState.publicData !== null);
  }

  function isSignedOut() {
    return accessResolved() && !window.accessState.session;
  }

  function ensurePublicHomeAttributes() {
    const state = isSignedOut() ? 'active' : 'inactive';
    if (document.body.dataset.publicHome !== state) document.body.dataset.publicHome = state;
    if (document.body.dataset.publicHomeVersion !== PUBLIC_HOME_VERSION) document.body.dataset.publicHomeVersion = PUBLIC_HOME_VERSION;
  }

  function openAccess(mode) {
    const target = mode === 'signup' ? '#access-signup' : '#access-signin';
    document.querySelector(target)?.click();
  }

  function openSainWithPrompt(prompt) {
    const input = document.querySelector('#sane-input');
    if (!input) return;
    input.value = prompt;
    input.focus();
  }

  function escape(value) {
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }

  function money(value) {
    return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(value || 0));
  }

  function stateLabel(value) {
    return String(value || 'AVAILABLE').replaceAll('_',' ');
  }

  function statusMarkup() {
    const status = window.accessState?.publicData?.infrastructureStatus;
    const stages = Array.isArray(status?.stages) ? status.stages : [];
    return `<section class="public-infrastructure-status" aria-label="Current SRA infrastructure status"><div class="public-section-heading"><div><p class="eyebrow">CURRENT BUILD STATUS</p><h2>Infrastructure, matched to operations</h2></div><span class="public-phase">${escape(stateLabel(status?.phase || 'INFRASTRUCTURE BUILDOUT'))}</span></div><div class="public-status-grid">${stages.map((stage)=>`<article><div><span class="public-status-dot" data-state="${escape(stage.state)}"></span><strong>${escape(stage.label)}</strong></div><em>${escape(stateLabel(stage.state))}</em><p>${escape(stage.detail)}</p></article>`).join('') || '<article><strong>Status initializing</strong><p>Operational records are being read.</p></article>'}</div></section>`;
  }

  function infrastructureNarrative() {
    return `<section class="public-infrastructure-intro"><div class="public-infrastructure-hero"><p class="eyebrow">ASSET · MARKET · SETTLEMENT INFRASTRUCTURE</p><h2>Make productive assets liquid.</h2><p>SRA verifies real-world economic activity, forms approved assets into tokenized financial positions, and connects them to governed market participation and settlement.</p><strong class="public-infrastructure-thesis">The moat is not lending. The moat is infrastructure that makes business assets liquid.</strong><div class="public-infrastructure-actions"><button class="primary-button" data-public-action="signup">Bring an asset</button><button class="secondary-button" data-public-prompt="Show me how an asset moves from verification to a financial position and market participation.">See how the system works</button></div></div><div class="public-model-shift"><p class="eyebrow">THE STRUCTURAL SHIFT</p><div><span>Traditional model</span><strong>Qualify for standardized credit</strong><small>Capital decisions begin with lender criteria and a centralized balance sheet.</small></div><div class="sra-model"><span>SRA infrastructure</span><strong>Verify, form, connect, settle</strong><small>Economic activity becomes a governed financial position with a visible lifecycle.</small></div></div></section><section class="public-asset-path" aria-label="How productive assets move through SRA"><article><span>01</span><strong>Bring the asset</strong><p>Connect an eligible productive asset, revenue stream, or obligation and its supporting records.</p></article><article><span>02</span><strong>Verify the value</strong><p>Record ownership, evidence, economic output, and recognized value.</p></article><article><span>03</span><strong>Form the position</strong><p>Move approved records through instrument formation and authorized on-chain representation.</p></article><article><span>04</span><strong>Open market access</strong><p>Enter supported markets and settlement workflows when authorization and liquidity are present.</p></article></section>${statusMarkup()}<section class="public-ecosystem"><div class="public-section-heading"><div><p class="eyebrow">ONE INFRASTRUCTURE · DISTINCT ROLES</p><h2>Built for the entire asset lifecycle</h2></div></div><div><article><strong>Businesses and asset providers</strong><p>Bring productive activity into verification and financial-position formation.</p></article><article><strong>Market participants</strong><p>Review and participate in authorized, evidence-backed positions through SRA Coin workflows.</p></article><article><strong>Institutions and settlement partners</strong><p>Provide liquidity, custody, or external settlement at the governed boundaries of the system.</p></article></div></section>`;
  }

  function cardMarkup(cards, side) {
    return `<aside class="public-feature-rail public-feature-rail-${side}" aria-label="Platform highlights">${cards.map(([title,description,prompt])=>`<button class="public-feature-card" data-public-prompt="${escape(prompt)}"><strong>${escape(title)}</strong><span>${escape(description)}</span><small>Ask SAIN →</small></button>`).join('')}</aside>`;
  }

  function removePublicHome() {
    document.querySelectorAll('.public-feature-rail,.public-home-actions,.public-business-identity,.public-infrastructure-intro,.public-asset-path,.public-infrastructure-status,.public-ecosystem').forEach(node => node.remove());
    document.querySelector('#access-actions')?.classList.remove('public-top-access-hidden');
    if (document.body.dataset.publicHome !== 'inactive') document.body.dataset.publicHome = 'inactive';
  }

  function ownSignedOutCanvas() {
    const root = document.querySelector('#view-root');
    if (!root) return;
    const alreadyOwned = root.children.length === 1 && root.firstElementChild?.id === 'public-decision-canvas';
    if (!alreadyOwned) root.innerHTML = '<section id="public-decision-canvas" class="public-decision-canvas" hidden></section>';
  }

  function buildPublicHome() {
    if (!isSignedOut()) return;
    const workspace = document.querySelector('.operating-workspace');
    const sane = document.querySelector('.sane-workspace');
    if (!workspace || !sane) return;

    if (!document.querySelector('.public-infrastructure-intro')) workspace.insertAdjacentHTML('beforebegin', infrastructureNarrative());

    ownSignedOutCanvas();
    document.querySelector('#access-actions')?.classList.add('public-top-access-hidden');
    const title = document.querySelector('#page-title');
    if (title && title.textContent !== 'Living Marketplace') title.textContent = 'Living Marketplace';

    if (!document.querySelector('.public-feature-rail-left')) {
      sane.insertAdjacentHTML('beforebegin', cardMarkup(leftCards,'left'));
      sane.insertAdjacentHTML('afterend', cardMarkup(rightCards,'right'));
    }

    if (!document.querySelector('.public-home-actions')) {
      sane.insertAdjacentHTML('afterend', '<div class="public-home-actions"><button class="secondary-button" data-public-action="signin">Sign in</button><button class="primary-button" data-public-action="signup">Create free account</button></div>');
    }

    if (!document.querySelector('.public-business-identity')) {
      workspace.insertAdjacentHTML('afterend', '<footer class="public-business-identity" aria-label="SRA business information"><div><strong>Sain Real Asset LLC</strong><span>Utah domestic limited liability company · Active</span></div><div><span>Entity 14733803-0160 · Effective September 3, 2026</span><a href="/support/">Contact and support</a><a href="https://businessregistration.utah.gov/">Utah business registry</a></div></footer>');
    }

    const firstMessage = document.querySelector('#chat-log .sane-message');
    if (firstMessage && firstMessage.textContent !== PUBLIC_WELCOME) firstMessage.textContent = PUBLIC_WELCOME;

    document.querySelectorAll('[data-public-prompt]:not([data-public-bound])').forEach(button => {
      button.dataset.publicBound = 'true';
      button.addEventListener('click', () => openSainWithPrompt(button.dataset.publicPrompt || 'Help me understand this marketplace.'));
    });
    document.querySelectorAll('[data-public-action="signin"]:not([data-public-bound])').forEach((button) => {
      button.dataset.publicBound = 'true';
      button.addEventListener('click', () => openAccess('signin'));
    });
    document.querySelectorAll('[data-public-action="signup"]:not([data-public-bound])').forEach((button) => {
      button.dataset.publicBound = 'true';
      button.addEventListener('click', () => openAccess('signup'));
    });
  }

  async function renderDecisionCanvas(payload, requestBody) {
    if (!isSignedOut()) return;
    const canvas = document.querySelector('#public-decision-canvas');
    if (!canvas) return;
    let message = '';
    try { message = JSON.parse(requestBody || '{}').message || ''; } catch {}
    const lower = message.toLowerCase();
    const shouldShowMarket = lower.includes('opportun') || lower.includes('compare') || lower.includes('project') || lower.includes('small') || lower.includes('begin');
    let opportunities = [];
    if (shouldShowMarket) {
      try {
        const response = await originalFetch('/api/participation/opportunities');
        const data = await response.json();
        opportunities = Array.isArray(data.opportunities) ? data.opportunities.slice(0,3) : [];
      } catch {}
    }
    canvas.hidden = false;
    canvas.innerHTML = `<div class="public-decision-head"><p class="eyebrow">SAIN GUIDANCE</p><h2>Here is what may help you decide</h2><p>This area appears only after you ask.</p></div><div class="public-guide-response">${escape(payload.reply || 'I can help you understand the marketplace and decide what to do next.')}</div>${opportunities.length ? `<div class="public-decision-grid">${opportunities.map(item=>`<button class="public-decision-card" data-public-result="${escape(item.id)}"><span class="badge open">${escape(String(item.stage || '').replaceAll('_',' '))}</span><h3>${escape(item.title)}</h3><p>${escape(item.assetName)} · ${escape(item.region)}</p><strong>${money(item.verifiedValue)} · +${escape(item.projectedGainRate)}%</strong></button>`).join('')}</div>` : ''}`;
    canvas.querySelectorAll('[data-public-result]').forEach(card=>card.addEventListener('click',()=>openAccess('signup')));
  }

  function syncPublicHome() {
    syncQueued = false;
    ensurePublicHomeAttributes();
    if (!accessResolved()) {
      document.body.classList.add('sra-access-resolving');
      return;
    }
    if (isSignedOut()) buildPublicHome();
    else removePublicHome();
  }

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(syncPublicHome);
  }

  function scheduleAccessSync() {
    queueSync();
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const target = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (target.includes('/api/sane/message') && isSignedOut()) {
      response.clone().json().then(payload=>renderDecisionCanvas(payload,args[1]?.body)).catch(()=>{});
    }
    if (target.includes('/api/access/')) scheduleAccessSync();
    return response;
  };

  window.SRAPublicHome = { version: PUBLIC_HOME_VERSION, refresh: queueSync, refreshNow: syncPublicHome };
  window.addEventListener('sra:access-state-changed', scheduleAccessSync);
  function initialize() {
    queueSync();
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
