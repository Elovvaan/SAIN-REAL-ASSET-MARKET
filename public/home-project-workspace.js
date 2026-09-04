(() => {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const state = { projects: [], activeProjectId: null, workspace: null, activeTab: 'overview' };

  function participantHomeOwnsPresentation() {
    return document.body.classList.contains('participant-suite-ready')
      || document.querySelector('.nav-list')?.dataset.participantNav === 'true';
  }

  function esc(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function root() { return document.querySelector('#view-root'); }
  function title(value) {
    const page = document.querySelector('#page-title');
    const context = document.querySelector('#context-title');
    const status = document.querySelector('#context-status');
    const chatContext = document.querySelector('#chat-context');
    if (page) page.textContent = value;
    if (context) context.textContent = value;
    if (status) status.textContent = state.workspace?.homeProject?.state || 'HOME';
    if (chatContext) chatContext.textContent = 'Sane guides this Home Project from verified information through funding approval, settlement readiness, and closing. Customer confirmation is required for execution.';
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-sra-actor-id': 'CUSTOMER-WEB', ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'The Home Project request could not be completed.');
    return payload;
  }

  function progressFor(project, plan) {
    const states = ['DRAFT', 'DATA_COLLECTION', 'PACKAGE_READY', 'FUNDING_PLANNING', 'FUNDING_APPROVED', 'SETTLEMENT_READY', 'SETTLED'];
    const index = Math.max(0, states.indexOf(project.state));
    let progress = Math.round((index / (states.length - 1)) * 100);
    if (plan?.state === 'READY_FOR_REVIEW') progress = Math.max(progress, 55);
    if (plan?.state === 'CUSTOMER_APPROVED') progress = Math.max(progress, 68);
    if (plan?.state === 'COMMITTED') progress = Math.max(progress, 78);
    if (plan?.state === 'SETTLEMENT_READY') progress = Math.max(progress, 90);
    if (plan?.state === 'SETTLED') progress = 100;
    return progress;
  }

  function guidance(workspace) {
    const next = workspace.financingSummary.nextAction;
    const messages = {
      BEGIN_DATA_COLLECTION: 'Start by adding the verified information and documents needed for the Home Project.',
      GENERATE_VERIFIED_SNAPSHOT_AND_PACKAGE: 'The project is collecting information. The next milestone is a Verified Snapshot and Verified Value Package.',
      CREATE_FUNDING_PLAN: `The verified package is ready. Build a Funding Plan for the ${money.format(workspace.homeProject.fundingNeeded)} funding need.`,
      COVER_FUNDING_GAP: `The Funding Plan still has an uncovered gap of ${money.format(workspace.financingSummary.remainingGap)}.`,
      SUBMIT_PLAN_FOR_REVIEW: 'The Funding Plan covers the purchase price and is ready for customer review.',
      REQUEST_CUSTOMER_APPROVAL: 'The Funding Plan is prepared. Review every source and approve it explicitly before commitment.',
      COMMIT_FUNDING_SOURCES: 'The customer approved the plan. The next step is confirming each funding source.',
      ADD_SETTLEMENT_INSTRUCTIONS: 'Funding sources are committed. Add the settlement instructions before marking the plan settlement ready.',
      PROCEED_TO_SETTLEMENT: 'The project is settlement ready. Review closing information before recording settlement.',
      CONVERT_TO_ONGOING_ASSET_RECORD: 'The acquisition is settled. Convert the property into an ongoing Asset Account.',
      REVIEW_PROJECT: 'Review the current project status and supporting records.'
    };
    return messages[next] || messages.REVIEW_PROJECT;
  }

  function renderList() {
    title('Home Projects');
    const view = root();
    view.innerHTML = `
      <section class="home-project-toolbar">
        <div><p class="eyebrow">HOME ACQUISITION</p><h2>My Home Projects</h2><p>Verified information, financing, participants, documents, and settlement in one workspace.</p></div>
        <button class="primary-button" id="new-home-project">+ New Home Project</button>
      </section>
      ${state.projects.length ? `<section class="home-project-grid">${state.projects.map(project => `
        <article class="home-project-card">
          <span>${esc(project.state)}</span>
          <h3>${esc(project.title)}</h3>
          <p>${esc(project.property?.address)}</p>
          <div class="project-numbers">
            <div><span>Purchase price</span><strong>${money.format(project.purchasePrice)}</strong></div>
            <div><span>Funding needed</span><strong>${money.format(project.fundingNeeded)}</strong></div>
          </div>
          <div class="home-project-actions"><button data-open-home-project="${esc(project.homeProjectId)}">Open workspace</button></div>
        </article>`).join('')}</section>` : `<section class="empty-home-projects"><h3>No Home Projects yet</h3><p>Create a project to organize verification, financing, and settlement.</p><button class="primary-button" id="empty-new-home-project">Create Home Project</button></section>`}`;
    document.querySelector('#new-home-project')?.addEventListener('click', renderCreateForm);
    document.querySelector('#empty-new-home-project')?.addEventListener('click', renderCreateForm);
    view.querySelectorAll('[data-open-home-project]').forEach(button => button.addEventListener('click', () => openWorkspace(button.dataset.openHomeProject)));
  }

  function renderCreateForm() {
    title('New Home Project');
    root().innerHTML = `
      <section class="panel contextual-panel">
        <div class="panel-header"><div><h2>Create Home Project</h2><p>Start with the property, purchase price, and verified buyer funds.</p></div></div>
        <form id="home-project-form" class="home-project-form">
          <label>Project title<input name="title" value="Home Acquisition Project" required></label>
          <label>Property address<input name="address" placeholder="123 Main Street, City, State" required></label>
          <div class="form-grid">
            <label>Purchase price<input name="purchasePrice" type="number" min="0" step="0.01" required></label>
            <label>Verified buyer funds<input name="verifiedBuyerFunds" type="number" min="0" step="0.01" value="0" required></label>
          </div>
          <div class="form-grid">
            <label>Target closing date<input name="targetClosingDate" type="date"></label>
            <label>Property type<select name="propertyType"><option value="RESIDENTIAL">Residential</option><option value="MULTIFAMILY">Multifamily</option><option value="OTHER_REAL_ESTATE">Other real estate</option></select></label>
          </div>
          <div class="mobile-stack"><button class="primary-button" type="submit">Create Project</button><button type="button" id="cancel-home-project">Cancel</button></div>
          <p id="home-project-form-error"></p>
        </form>
      </section>`;
    document.querySelector('#cancel-home-project')?.addEventListener('click', renderList);
    document.querySelector('#home-project-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        const customerId = window.accessState?.session?.userId || window.accessState?.session?.email || 'CUSTOMER-WEB';
        const project = await api('/api/home-financing/home-projects', {
          method: 'POST',
          body: JSON.stringify({
            customerId,
            title: form.get('title'),
            property: { address: form.get('address'), propertyType: form.get('propertyType') },
            purchasePrice: Number(form.get('purchasePrice')),
            verifiedBuyerFunds: Number(form.get('verifiedBuyerFunds')),
            targetClosingDate: form.get('targetClosingDate') || null
          })
        });
        state.projects.unshift(project);
        await openWorkspace(project.homeProjectId);
      } catch (error) {
        document.querySelector('#home-project-form-error').textContent = error.message;
      }
    });
  }

  function timelineEvents(project, plan) {
    const events = [
      ['Project created', project.createdAt, true],
      ['Data collection', project.state !== 'DRAFT' ? project.updatedAt : null, project.state !== 'DRAFT'],
      ['Verified package ready', project.snapshotId && project.valuePackageId ? project.updatedAt : null, Boolean(project.snapshotId && project.valuePackageId)],
      ['Funding Plan created', plan?.createdAt || null, Boolean(plan)],
      ['Customer approved', plan?.approvedAt || null, Boolean(plan?.approvedAt)],
      ['Funding committed', plan?.committedAt || null, Boolean(plan?.committedAt)],
      ['Settlement ready', plan?.settlementReadyAt || null, Boolean(plan?.settlementReadyAt)],
      ['Settled', project.settledAt || null, project.state === 'SETTLED']
    ];
    return events;
  }

  function renderWorkspace() {
    const { homeProject: project, fundingPlan: plan, financingSummary } = state.workspace;
    const progress = progressFor(project, plan);
    title('Home Project Workspace');
    root().innerHTML = `
      <section class="home-project-toolbar">
        <div><p class="eyebrow">${esc(project.state)}</p><h2>${esc(project.title)}</h2><p>${esc(project.property?.address)}</p></div>
        <button id="back-home-projects">All Home Projects</button>
      </section>
      <section class="home-project-summary">
        <article><span>Purchase price</span><strong>${money.format(project.purchasePrice)}</strong></article>
        <article><span>Verified buyer funds</span><strong>${money.format(project.verifiedBuyerFunds)}</strong></article>
        <article><span>Funding needed</span><strong>${money.format(project.fundingNeeded)}</strong></article>
        <article><span>Remaining gap</span><strong>${money.format(financingSummary.remainingGap)}</strong></article>
      </section>
      <section class="workspace-section">
        <div class="status-line"><strong>Project completion</strong><strong>${progress}%</strong></div>
        <div class="progress-shell"><div class="progress-bar" style="width:${progress}%"></div></div>
        <div class="sane-guidance"><strong>Sane guidance</strong><p>${esc(guidance(state.workspace))}</p><small>Next action: ${esc(financingSummary.nextAction)}</small></div>
      </section>
      <div class="workspace-tabs">
        ${['overview','snapshot','funding','documents','participants','settlement','activity'].map(tab => `<button data-home-tab="${tab}" class="${state.activeTab === tab ? 'active' : ''}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join('')}
      </div>
      <section class="workspace-section" data-tab-panel="overview">
        <h3>Overview</h3>
        <div class="status-line"><span>Current state</span><strong>${esc(project.state)}</strong></div>
        <div class="status-line"><span>Target closing</span><strong>${esc(project.targetClosingDate || 'Not set')}</strong></div>
        <div class="status-line"><span>Property type</span><strong>${esc(project.property?.propertyType)}</strong></div>
        <div class="mobile-stack">${project.state === 'DRAFT' ? '<button data-project-action="begin-data">Begin data collection</button>' : ''}</div>
      </section>
      <section class="workspace-section" data-tab-panel="snapshot" hidden>
        <h3>Verified Snapshot and Package</h3>
        <div class="status-line"><span>Snapshot</span><strong>${esc(project.snapshotId || 'Not linked')}</strong></div>
        <div class="status-line"><span>Verified Value Package</span><strong>${esc(project.valuePackageId || 'Not linked')}</strong></div>
        <p>The Home Project uses verified records from EDX. Package creation remains separate from financing approval.</p>
      </section>
      <section class="workspace-section" data-tab-panel="funding" hidden>
        <h3>Funding Plan</h3>
        ${plan ? `
          <div class="status-line"><span>Plan state</span><strong>${esc(plan.state)}</strong></div>
          <div class="status-line"><span>Total planned</span><strong>${money.format(plan.totalPlanned)}</strong></div>
          <div class="status-line"><span>Remaining gap</span><strong>${money.format(plan.remainingGap)}</strong></div>
          <div class="funding-source-list">${plan.sources.map(source => `<div class="funding-source-row"><div><span>${esc(source.type)}</span><strong>${esc(source.providerId || source.instrumentId || 'Funding source')}</strong></div><strong>${money.format(source.amount)}</strong></div>`).join('')}</div>
        ` : `<p>No Funding Plan exists yet. The project must have a Verified Snapshot and VVP before a plan can be created.</p>`}
      </section>
      <section class="workspace-section" data-tab-panel="documents" hidden>
        <h3>Documents</h3>
        ${project.documentReferences?.length ? project.documentReferences.map(reference => `<div class="timeline-row"><strong>${esc(reference)}</strong><span>Linked</span></div>`).join('') : '<p>No project documents are linked yet.</p>'}
      </section>
      <section class="workspace-section" data-tab-panel="participants" hidden>
        <h3>Participants</h3>
        ${project.participantIds?.length ? project.participantIds.map(reference => `<div class="timeline-row"><strong>${esc(reference)}</strong><span>Participant</span></div>`).join('') : '<p>No additional participants are linked yet.</p>'}
      </section>
      <section class="workspace-section" data-tab-panel="settlement" hidden>
        <h3>Settlement</h3>
        <div class="status-line"><span>Funding ready</span><strong>${plan?.state === 'SETTLEMENT_READY' || plan?.state === 'SETTLED' ? 'YES' : 'NO'}</strong></div>
        <div class="status-line"><span>Settlement instructions</span><strong>${esc(plan?.settlementInstructionsReference || 'Not linked')}</strong></div>
        <div class="status-line"><span>Settlement reference</span><strong>${esc(project.settlementReference || 'Not settled')}</strong></div>
      </section>
      <section class="workspace-section" data-tab-panel="activity" hidden>
        <h3>Activity</h3>
        <div class="timeline-list">${timelineEvents(project, plan).map(([label, at, complete]) => `<div class="timeline-row"><div><strong>${esc(label)}</strong><small>${esc(at || 'Pending')}</small></div><span>${complete ? 'COMPLETE' : 'PENDING'}</span></div>`).join('')}</div>
      </section>`;

    document.querySelector('#back-home-projects')?.addEventListener('click', async () => { await loadProjects(); renderList(); });
    root().querySelectorAll('[data-home-tab]').forEach(button => button.addEventListener('click', () => {
      state.activeTab = button.dataset.homeTab;
      root().querySelectorAll('[data-home-tab]').forEach(item => item.classList.toggle('active', item === button));
      root().querySelectorAll('[data-tab-panel]').forEach(panel => { panel.hidden = panel.dataset.tabPanel !== state.activeTab; });
    }));
    root().querySelector('[data-project-action="begin-data"]')?.addEventListener('click', async () => {
      await api(`/api/home-financing/home-projects/${project.homeProjectId}/transition`, { method: 'POST', body: JSON.stringify({ state: 'DATA_COLLECTION' }) });
      await openWorkspace(project.homeProjectId);
    });
  }

  async function loadProjects() {
    const payload = await api('/api/home-financing/home-projects');
    state.projects = payload.homeProjects || [];
  }

  async function openWorkspace(homeProjectId) {
    state.activeProjectId = homeProjectId;
    state.workspace = await api(`/api/home-financing/home-projects/${homeProjectId}/workspace`);
    state.activeTab = 'overview';
    renderWorkspace();
  }

  async function activate({ forcePresentation = false } = {}) {
    if (!forcePresentation && participantHomeOwnsPresentation()) return false;
    try {
      await loadProjects();
      if (!forcePresentation && participantHomeOwnsPresentation()) return false;
      renderList();
      return true;
    } catch (error) {
      if (!forcePresentation && participantHomeOwnsPresentation()) return false;
      root().innerHTML = `<section class="empty-home-projects"><h3>Home Projects could not load</h3><p>${esc(error.message)}</p></section>`;
      return false;
    }
  }

  document.addEventListener('click', event => {
    const nav = event.target.closest('.nav-item[data-view="home-projects"]');
    if (!nav || participantHomeOwnsPresentation()) return;
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    nav.classList.add('active');
    void activate();
  }, true);

  window.SRAHomeProjects = { activate, openWorkspace };
})();
