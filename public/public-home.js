(() => {
  const PUBLIC_HOME_VERSION = 'V16';
  const originalFetch = window.fetch.bind(window);

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
    document.querySelector('#open-sane')?.click();
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
    canvas.innerHTML = `<div class="public-decision-head"><p class="eyebrow">SANE GUIDANCE</p><h2>Here is what may help you decide</h2><p>This area appears only after you ask. Nothing is preloaded beside the conversation.</p></div><div class="public-guide-response">${escape(payload.reply || 'I can help you understand the marketplace and decide what to do next.')}</div>${opportunities.length ? `<div class="public-decision-grid">${opportunities.map(item=>`<button class="public-decision-card" data-public-result="${escape(item.id)}"><span class="badge open">${escape(String(item.stage || '').replaceAll('_',' '))}</span><h3>${escape(item.title)}</h3><p>${escape(item.assetName)} · ${escape(item.region)}</p><strong>${money(item.verifiedValue)} · +${escape(item.projectedGainRate)}%</strong></button>`).join('')}</div>` : ''}<div><button class="primary-button" data-public-action="signup">Create free account</button></div>`;
    canvas.scrollIntoView({behavior:'smooth',block:'start'});
    canvas.querySelector('[data-public-action="signup"]')?.addEventListener('click',()=>openAccess('signup'));
    canvas.querySelectorAll('[data-public-result]').forEach(card=>card.addEventListener('click',()=>openAccess('signup')));
  }

  function bindPermanentPublicFlow() {
    ensurePublicHomeAttributes();
    if (!isSignedOut()) return;
    document.querySelector('[data-public-action="signup"]')?.addEventListener('click', () => openAccess('signup'));
    document.querySelector('[data-public-action="signin"]')?.addEventListener('click', () => openAccess('signin'));
    document.querySelector('[data-public-action="ask-sane"]')?.addEventListener('click', () => document.querySelector('#open-sane')?.click());
    document.querySelectorAll('[data-public-prompt]').forEach((button) => button.addEventListener('click', () => openSaneWithPrompt(button.dataset.publicPrompt || 'Help me understand this marketplace.')));
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
