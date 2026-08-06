(() => {
  const PUBLIC_HOME_VERSION = 'V21';
  const PUBLIC_WELCOME = 'Welcome to the Living Marketplace. SRA connects authorized transaction and asset data to recognized financial assets. Source activity moves through Observation, Recognition, Financial Record, Verified Value, SRA Coin representation, instrument formation, and marketplace participation. What would you like to understand or accomplish?';
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

  function ensureBootStyle() {
    if (document.querySelector('style[data-public-home-boot]')) return;
    const style = document.createElement('style');
    style.dataset.publicHomeBoot = 'true';
    style.textContent = 'body.sra-access-resolving .app-shell{visibility:hidden}';
    document.head.append(style);
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

  function cardMarkup(cards, side) {
    return `<aside class="public-feature-rail public-feature-rail-${side}" aria-label="Platform highlights">${cards.map(([title,description,prompt])=>`<button class="public-feature-card" data-public-prompt="${escape(prompt)}"><strong>${escape(title)}</strong><span>${escape(description)}</span><small>Ask SAIN →</small></button>`).join('')}</aside>`;
  }

  function removePublicHome() {
    document.querySelectorAll('.public-feature-rail,.public-home-actions').forEach(node => node.remove());
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

    const firstMessage = document.querySelector('#chat-log .sane-message');
    if (firstMessage && firstMessage.textContent !== PUBLIC_WELCOME) firstMessage.textContent = PUBLIC_WELCOME;

    document.querySelectorAll('[data-public-prompt]:not([data-public-bound])').forEach(button => {
      button.dataset.publicBound = 'true';
      button.addEventListener('click', () => openSainWithPrompt(button.dataset.publicPrompt || 'Help me understand this marketplace.'));
    });
    const signin = document.querySelector('[data-public-action="signin"]');
    if (signin && signin.dataset.publicBound !== 'true') {
      signin.dataset.publicBound = 'true';
      signin.addEventListener('click', () => openAccess('signin'));
    }
    const signup = document.querySelector('[data-public-action="signup"]');
    if (signup && signup.dataset.publicBound !== 'true') {
      signup.dataset.publicBound = 'true';
      signup.addEventListener('click', () => openAccess('signup'));
    }
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
    document.body.classList.remove('sra-access-resolving');
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
    setTimeout(queueSync, 50);
    setTimeout(queueSync, 250);
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

  ensureBootStyle();
  document.body?.classList.add('sra-access-resolving');
  window.SRAPublicHome = { version: PUBLIC_HOME_VERSION, refresh: queueSync };
  window.addEventListener('sra:access-state-changed', scheduleAccessSync);
  function initialize() {
    queueSync();
    setTimeout(queueSync, 100);
    setTimeout(queueSync, 300);
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
