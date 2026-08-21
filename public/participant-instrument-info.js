(() => {
  if (window.__sraParticipantInstrumentInfoBootstrapped) return;
  window.__sraParticipantInstrumentInfoBootstrapped = true;

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
    return body;
  }

  function ensureStyle() {
    if (document.querySelector('#participant-instrument-info-style')) return;
    const style = document.createElement('style');
    style.id = 'participant-instrument-info-style';
    style.textContent = `
      .participant-action-alert{padding:18px;border:1px solid rgba(215,166,42,.58);border-radius:16px;background:rgba(215,166,42,.09);display:grid;gap:10px;margin-bottom:16px}
      .participant-action-alert h3,.participant-action-alert p{margin:0}.participant-action-alert p{opacity:.82;line-height:1.5}
      .participant-action-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px}.participant-action-form input,.participant-action-form select{width:100%;box-sizing:border-box;padding:11px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#101010;color:#fff}
      .participant-action-form .wide{grid-column:1/-1}.participant-action-message{grid-column:1/-1;font-size:13px}.participant-action-message.error{color:#ff9b9b}
      @media(max-width:800px){.participant-action-form{grid-template-columns:1fr}.participant-action-form .wide{grid-column:auto}}
    `;
    document.head.append(style);
  }

  function actionMarkup(record) {
    const action = record.action || {};
    const completed = action.status === 'COMPLETED';
    return `<section class="participant-action-alert" data-participant-action="${esc(record.opportunityId)}" role="status" aria-live="polite">
      <p class="eyebrow">${completed ? 'INFORMATION RECEIVED' : 'ACTION REQUIRED'}</p>
      <h3>${completed ? 'Applicant information submitted' : 'Complete applicant information'}</h3>
      <p>${esc(action.alert || (completed ? 'SRA has received the requested applicant information.' : 'SRA needs your legal applicant information before the financing instrument can be prepared.'))}</p>
      <p><strong>${esc(record.title || record.opportunityId)}</strong> · ${esc(record.status || '')}</p>
      ${completed ? '' : `<form class="participant-action-form" data-applicant-info-form>
        <select name="applicantType" required><option value="">Applicant type</option><option value="PERSON">Individual</option><option value="ORGANIZATION">Organization</option><option value="TRUST">Trust</option><option value="SPV">SPV / acquisition entity</option></select>
        <input name="legalName" placeholder="Legal name" required>
        <input name="email" type="email" placeholder="Email" required>
        <input name="phone" placeholder="Phone" required>
        <input class="wide" name="addressLine1" placeholder="Physical address" required>
        <input name="addressLine2" placeholder="Address line 2 (optional)">
        <input name="city" placeholder="City" required>
        <input name="state" placeholder="State / province" required>
        <input name="postalCode" placeholder="Postal code" required>
        <input name="country" value="US" placeholder="Country code" required>
        <input name="dateOfBirth" type="date" data-person-only aria-label="Date of birth">
        <input name="jurisdiction" data-entity-only placeholder="Formation jurisdiction">
        <input name="authorizedSignerName" data-entity-only placeholder="Authorized signer name">
        <input name="authorizedSignerTitle" data-entity-only placeholder="Authorized signer title">
        <div class="wide"><button class="primary-button" type="submit">Submit applicant information</button></div>
        <div class="participant-action-message" data-action-message></div>
      </form>`}
    </section>`;
  }

  function syncConditionalFields(form) {
    const type = form.querySelector('[name="applicantType"]')?.value;
    const person = type === 'PERSON';
    form.querySelectorAll('[data-person-only]').forEach((field) => { field.hidden = !person; field.required = person; });
    form.querySelectorAll('[data-entity-only]').forEach((field) => { field.hidden = !type || person; field.required = Boolean(type) && !person; });
  }

  function stillFinancingRender(root, renderToken) {
    return Boolean(
      root?.isConnected
      && root.dataset.sraParticipantInstrumentRenderToken === renderToken
      && root.querySelector('.participant-financing')
    );
  }

  function bindAction(root, record, renderToken) {
    const card = root.querySelector(`[data-participant-action="${CSS.escape(record.opportunityId)}"]`);
    const form = card?.querySelector('[data-applicant-info-form]');
    if (!form) return;
    const type = form.querySelector('[name="applicantType"]');
    type?.addEventListener('change', () => syncConditionalFields(form));
    syncConditionalFields(form);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]');
      const message = form.querySelector('[data-action-message]');
      const values = Object.fromEntries(new FormData(form).entries());
      button.disabled = true;
      message.className = 'participant-action-message';
      message.textContent = 'Submitting applicant information…';
      try {
        await request(`/api/funding-verification/opportunities/${encodeURIComponent(record.opportunityId)}/applicant-information`, { method: 'POST', body: JSON.stringify(values) });
        await mount(root, renderToken);
      } catch (error) {
        button.disabled = false;
        message.className = 'participant-action-message error';
        message.textContent = error.message;
      }
    });
  }

  async function mount(root, renderToken) {
    if (!root || !window.accessState?.session || !stillFinancingRender(root, renderToken)) return;
    ensureStyle();
    root.querySelectorAll('[data-participant-action]').forEach((node) => node.remove());
    try {
      const payload = await request('/api/funding-verification/participant-actions');
      if (!stillFinancingRender(root, renderToken)) return;
      const records = payload.records || [];
      if (!records.length) return;
      const holder = document.createElement('div');
      holder.innerHTML = records.map(actionMarkup).join('');
      if (!stillFinancingRender(root, renderToken)) return;
      root.prepend(...holder.children);
      records.forEach((record) => bindAction(root, record, renderToken));
    } catch (error) {
      if (stillFinancingRender(root, renderToken)) console.warn('Participant financing actions could not load.', error);
    }
  }

  function install() {
    if (window.__sraParticipantInstrumentInfoInstalled) return true;
    const originalRender = window.renderParticipantFundingOperations;
    if (typeof originalRender !== 'function') return false;
    window.__sraParticipantInstrumentInfoInstalled = true;
    window.renderParticipantFundingOperations = function renderParticipantFundingOperations(root) {
      const renderToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      root.dataset.sraParticipantInstrumentRenderToken = renderToken;
      originalRender(root);
      void mount(root, renderToken);
    };
    return true;
  }

  if (!install()) {
    window.addEventListener('sra:public-features-ready', install, { once: true });
  }
})();
