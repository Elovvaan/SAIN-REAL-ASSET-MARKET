(() => {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const state = { workspace: null, activeView: 'incoming', selectedOpportunity: null };

  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const root = () => document.querySelector('#view-root');

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Institution Workspace request failed.');
    return payload;
  }

  function setShell(titleText, statusText = 'INSTITUTION') {
    const page = document.querySelector('#page-title');
    const context = document.querySelector('#context-title');
    const status = document.querySelector('#context-status');
    const chatContext = document.querySelector('#chat-context');
    if (page) page.textContent = titleText;
    if (context) context.textContent = titleText;
    if (status) status.textContent = statusText;
    if (chatContext) chatContext.textContent = 'Sane is guiding this institution through authorized SRA participation opportunities. SRA owns project verification and settlement readiness; the institution decides only whether and how much capital to participate with.';
  }

  function queueCount(name) {
    return state.workspace?.queues?.[name]?.length || 0;
  }

  function renderWorkspace() {
    setShell('Institution Participation', 'ACTIVE');
    const view = root();
    const queues = state.workspace?.queues || {};
    view.innerHTML = `
      <section class="institution-hero">
        <div><p class="eyebrow">PHASE 15 · INSTITUTION PARTICIPATION</p><h2>Capital participation without duplicate underwriting</h2><p>SRA presents authorized, verified Home Projects. Institutions may review the opportunity, request information, commit capital, or pass.</p></div>
        <div class="institution-metrics">
          <article><span>Incoming</span><strong>${queueCount('incoming')}</strong></article>
          <article><span>Under review</span><strong>${queueCount('underReview')}</strong></article>
          <article><span>Committed</span><strong>${queueCount('committed')}</strong></article>
          <article><span>Settled</span><strong>${queueCount('settled')}</strong></article>
        </div>
      </section>
      <nav class="institution-tabs" aria-label="Institution queues">
        ${[['incoming','Incoming Opportunities'],['underReview','Under Review'],['committed','Committed Participations'],['settled','Completed Projects']].map(([id,label]) => `<button data-institution-tab="${id}" class="${state.activeView === id ? 'active' : ''}">${label}</button>`).join('')}
      </nav>
      <section id="institution-queue"></section>`;

    view.querySelectorAll('[data-institution-tab]').forEach((button) => button.addEventListener('click', () => {
      state.activeView = button.dataset.institutionTab;
      renderWorkspace();
    }));
    renderQueue();
  }

  function opportunityCard(item) {
    return `<article class="institution-opportunity-card">
      <div class="institution-card-head"><div><span class="badge open">${esc(item.state)}</span><h3>${esc(item.title)}</h3><p>${esc(item.propertySummary?.address)}</p></div><strong>${money.format(item.remainingAmount)}</strong></div>
      <div class="institution-data-grid">
        <div><span>Purchase value</span><strong>${money.format(item.purchasePrice)}</strong></div>
        <div><span>Participation target</span><strong>${money.format(item.targetAmount)}</strong></div>
        <div><span>Already committed</span><strong>${money.format(item.committedAmount)}</strong></div>
        <div><span>Window ends</span><strong>${esc(item.participationWindowEndsAt || 'Open')}</strong></div>
      </div>
      <div class="institution-reference-row"><span>Verified Snapshot</span><strong>${esc(item.snapshotId)}</strong></div>
      <div class="institution-reference-row"><span>Verified Value Package</span><strong>${esc(item.valuePackageId)}</strong></div>
      <div class="institution-actions"><button class="primary-button" data-review-opportunity="${esc(item.planId)}">Review opportunity</button></div>
    </article>`;
  }

  function commitmentCard(item) {
    return `<article class="institution-opportunity-card">
      <div class="institution-card-head"><div><span class="badge">${esc(item.state)}</span><h3>${esc(item.homeProjectId)}</h3><p>${esc(item.planId)}</p></div><strong>${money.format(item.amount)}</strong></div>
      <div class="institution-reference-row"><span>Capital source</span><strong>${esc(item.capitalSourceReference || 'Not committed')}</strong></div>
      <div class="institution-reference-row"><span>Terms acknowledgement</span><strong>${esc(item.termsAcknowledgementReference || 'Pending')}</strong></div>
      ${item.informationRequest ? `<p class="institution-info-request">${esc(item.informationRequest)}</p>` : ''}
      <div class="institution-actions">
        ${item.state === 'INTERESTED' ? `<button data-commitment-action="review" data-commitment-id="${esc(item.commitmentId)}">Begin review</button><button data-commitment-action="request" data-commitment-id="${esc(item.commitmentId)}">Request information</button>` : ''}
        ${['INTERESTED','UNDER_REVIEW','INFORMATION_REQUESTED'].includes(item.state) ? `<button class="primary-button" data-commitment-action="commit" data-commitment-id="${esc(item.commitmentId)}">Commit capital</button><button data-commitment-action="decline" data-commitment-id="${esc(item.commitmentId)}">Decline</button>` : ''}
      </div>
    </article>`;
  }

  function renderQueue() {
    const queue = document.querySelector('#institution-queue');
    if (!queue) return;
    const items = state.workspace?.queues?.[state.activeView] || [];
    if (!items.length) {
      queue.innerHTML = `<section class="institution-empty"><h3>No items in this queue</h3><p>Sane will surface authorized participation activity here as it enters this stage.</p></section>`;
      return;
    }
    queue.innerHTML = `<section class="institution-card-grid">${state.activeView === 'incoming' ? items.map(opportunityCard).join('') : items.map(commitmentCard).join('')}</section>`;
    queue.querySelectorAll('[data-review-opportunity]').forEach((button) => button.addEventListener('click', () => openOpportunity(button.dataset.reviewOpportunity)));
    queue.querySelectorAll('[data-commitment-action]').forEach((button) => button.addEventListener('click', () => commitmentAction(button.dataset.commitmentAction, button.dataset.commitmentId)));
  }

  async function openOpportunity(planId) {
    const item = state.workspace.opportunities.find((opportunity) => opportunity.planId === planId);
    state.selectedOpportunity = item;
    setShell('Participation Opportunity', item.state);
    root().innerHTML = `
      <section class="institution-detail">
        <button id="back-institution-workspace">← Institution Workspace</button>
        <p class="eyebrow">AUTHORIZED VERIFIED OPPORTUNITY</p>
        <h2>${esc(item.title)}</h2>
        <p>${esc(item.propertySummary?.address)}</p>
        <section class="institution-data-grid large">
          <div><span>Purchase value</span><strong>${money.format(item.purchasePrice)}</strong></div>
          <div><span>Verified buyer funds</span><strong>${money.format(item.verifiedBuyerFunds)}</strong></div>
          <div><span>Participation target</span><strong>${money.format(item.targetAmount)}</strong></div>
          <div><span>Remaining amount</span><strong>${money.format(item.remainingAmount)}</strong></div>
        </section>
        <section class="institution-record-panel">
          <div><span>Verified Snapshot</span><strong>${esc(item.snapshotId)}</strong></div>
          <div><span>Verified Value Package</span><strong>${esc(item.valuePackageId)}</strong></div>
          <div><span>Participation terms</span><strong>${esc(item.participationTermsReference)}</strong></div>
          <div><span>Risk disclosure</span><strong>${esc(item.riskDisclosureReference)}</strong></div>
          <div><span>Publication authorization</span><strong>${esc(item.publicationAuthorizationReference)}</strong></div>
        </section>
        <section class="sane-guidance"><strong>Sane guidance</strong><p>SRA has already assembled and verified the Home Project. Your institution is not being asked to approve the customer or recreate SRA's verification. Decide whether the opportunity fits your institution's participation criteria and select an amount within the remaining need.</p></section>
        <form id="institution-interest-form" class="institution-interest-form">
          <label>Participation amount<input name="amount" type="number" min="1" max="${item.remainingAmount}" step="0.01" required></label>
          <div class="institution-actions"><button class="primary-button" type="submit">Record interest</button><button type="button" id="save-opportunity">Save for later</button><button type="button" id="decline-opportunity">Pass</button></div>
          <p id="institution-interest-error"></p>
        </form>
      </section>`;
    document.querySelector('#back-institution-workspace')?.addEventListener('click', renderWorkspace);
    document.querySelector('#save-opportunity')?.addEventListener('click', () => document.querySelector('#institution-interest-form input')?.focus());
    document.querySelector('#decline-opportunity')?.addEventListener('click', renderWorkspace);
    document.querySelector('#institution-interest-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        await api('/api/institutions/commitments', { method: 'POST', body: JSON.stringify({ planId, amount: Number(form.get('amount')) }) });
        await load();
        state.activeView = 'underReview';
        renderWorkspace();
      } catch (error) {
        document.querySelector('#institution-interest-error').textContent = error.message;
      }
    });
  }

  async function commitmentAction(action, commitmentId) {
    try {
      if (action === 'review') {
        await api(`/api/institutions/commitments/${commitmentId}/transition`, { method: 'POST', body: JSON.stringify({ state: 'UNDER_REVIEW' }) });
      }
      if (action === 'request') {
        const informationRequest = window.prompt('What additional information should SRA provide?');
        if (!informationRequest) return;
        await api(`/api/institutions/commitments/${commitmentId}/transition`, { method: 'POST', body: JSON.stringify({ state: 'INFORMATION_REQUESTED', informationRequest }) });
      }
      if (action === 'commit') {
        const termsAcknowledgementReference = window.prompt('Enter the participation terms acknowledgement reference.');
        if (!termsAcknowledgementReference) return;
        const capitalSourceReference = window.prompt('Enter the committed capital source reference.');
        if (!capitalSourceReference) return;
        await api(`/api/institutions/commitments/${commitmentId}/transition`, { method: 'POST', body: JSON.stringify({ state: 'COMMITTED', termsAcknowledgementReference, capitalSourceReference }) });
      }
      if (action === 'decline') {
        await api(`/api/institutions/commitments/${commitmentId}/transition`, { method: 'POST', body: JSON.stringify({ state: 'DECLINED' }) });
      }
      await load();
      renderWorkspace();
    } catch (error) {
      root().insertAdjacentHTML('afterbegin', `<div class="institution-error">${esc(error.message)}</div>`);
    }
  }

  async function load() {
    state.workspace = await api('/api/institutions/workspace');
  }

  async function activate() {
    try {
      await load();
      renderWorkspace();
    } catch (error) {
      setShell('Institution Participation');
      root().innerHTML = `<section class="institution-empty"><h3>Institution Workspace unavailable</h3><p>${esc(error.message)}</p></section>`;
    }
  }

  document.addEventListener('click', (event) => {
    const nav = event.target.closest('.nav-item[data-view="institution-participation"]');
    if (!nav) return;
    event.preventDefault();
    activate();
  }, true);

  window.activateInstitutionWorkspace = activate;
})();
