(() => {
  const PUBLIC_HOME_VERSION = 'V17';
  const originalFetch = window.fetch.bind(window);

  const leftCards = [
    ['Verified Value','Understand how supported value is established and recorded.','Explain Verified Value.'],
    ['Living Marketplace','Explore verified opportunities and productive projects.','Show me what is available in the Living Marketplace.'],
    ['Public Recognition','See how documented rights and obligations are evaluated.','Explain the Public Recognition Framework.']
  ];

  const rightCards = [
    ['Financial Assets','Learn how recognized assets move through the platform.','How do financial assets work here?'],
    ['SAIN Coin','Understand the platform coin and where it fits.','Explain the SAIN coin and its purpose.'],
    ['Institutional Operations','See how documents, assets, accounts, and activity connect.','Explain how the institution operates.']
  ];

  function isSignedOut() {
    return !window.accessState?.session;
  }

  function ensurePublicHomeAttributes() {
    document.body.dataset.publicHome = isSignedOut() ? 'active' : 'inactive';
    document.body.dataset.publicHomeVersion = PUBLIC_HOME_VERSION;
  }

  function openAccess(mode) {
    const target = mode === 'signup' ? '#access-signup' : '#access-signin';
    document.querySelector(target)?.click();
  }

  function openSaneWithPrompt(prompt) {
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
    return `<aside class="public-feature-rail public-feature-rail-${side}" aria-label="Platform highlights">${cards.map(([title,description,prompt])=>`<button class="public-feature-card" data-public-prompt="${escape(prompt)}"><strong>${escape(title)}</strong><span>${escape(description)}</span><small>Ask Sane →</small></button>`).join('')}</aside>`;
  }

  function buildPublicHome() {
    if (!isSignedOut()) return;
    const workspace = document.querySelector('.operating-workspace');
    const sane = document.querySelector('.sane-workspace');
    if (!workspace || !sane) return;

    document.querySelector('#access-actions')?.classList.add('public-top-access-hidden');
    const title = document.querySelector('#page-title');
    if (title) title.textContent = 'Living Marketplace';

    if (!document.querySelector('.public-feature-rail-left')) {
      sane.insertAdjacentHTML('beforebegin', cardMarkup(leftCards,'left'));
      sane.insertAdjacentHTML('afterend', cardMarkup(rightCards,'right'));
    }

    if (!document.querySelector('.public-home-actions')) {
      sane.insertAdjacentHTML('afterend', `<div class="public-home-actions"><button class="secondary-button" data-public-action="signin">Sign in</button><button class="primary-button" data-public-action="signup">Create free account</button></div>`);
    }

    const firstMessage = document.querySelector('#chat-log .sane-message');
    if (firstMessage) {
      firstMessage.textContent = 'Welcome to the Living Marketplace. I can help you understand Verified Value, explore opportunities, compare projects, explain the platform, or decide what to do next. What would you like to accomplish?';
    }

    document.querySelectorAll('[data-public-prompt]').forEach(button => {
      button.addEventListener('click', () => openSaneWithPrompt(button.dataset.publicPrompt || 'Help me understand this marketplace.'));
    });
    document.querySelector('[data-public-action="signin"]')?.addEventListener('click', () => openAccess('signin'));
    document.querySelector('[data-public-action="signup"]')?.addEventListener('click', () => openAccess('signup'));
    document.querySelector('#sane-input')?.focus();
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
    canvas.innerHTML = `<div class="public-decision-head"><p class="eyebrow">SANE GUIDANCE</p><h2>Here is what may help you decide</h2><p>This area appears only after you ask.</p></div><div class="public-guide-response">${escape(payload.reply || 'I can help you understand the marketplace and decide what to do next.')}</div>${opportunities.length ? `<div class="public-decision-grid">${opportunities.map(item=>`<button class="public-decision-card" data-public-result="${escape(item.id)}"><span class="badge open">${escape(String(item.stage || '').replaceAll('_',' '))}</span><h3>${escape(item.title)}</h3><p>${escape(item.assetName)} · ${escape(item.region)}</p><strong>${money(item.verifiedValue)} · +${escape(item.projectedGainRate)}%</strong></button>`).join('')}</div>` : ''}`;
    canvas.querySelectorAll('[data-public-result]').forEach(card=>card.addEventListener('click',()=>openAccess('signup')));
  }

  function bindPermanentPublicFlow() {
    ensurePublicHomeAttributes();
    if (!isSignedOut()) return;
    setTimeout(buildPublicHome, 40);
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const target = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (target.includes('/api/sane/message') && isSignedOut()) {
      response.clone().json().then(payload=>renderDecisionCanvas(payload,args[1]?.body)).catch(()=>{});
    }
    return response;
  };

  window.SRAPublicHome = { version: PUBLIC_HOME_VERSION, refresh: bindPermanentPublicFlow };
  window.addEventListener('DOMContentLoaded', () => setTimeout(bindPermanentPublicFlow, 220));
  window.addEventListener('sra:access-state-changed', bindPermanentPublicFlow);
})();
