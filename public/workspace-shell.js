(() => {
  const WORKSPACE_COPY = {
    UNIVERSAL: {
      label: 'Universal Workspace',
      intro: 'Your general SRA workspace for exploring the marketplace, understanding Verified Value, and deciding which capability to use next.',
      features: [
        ['Investment Opportunities', 'Browse productive projects currently open for market participation.', 'marketplace'],
        ['Asset Opportunities', 'Learn how real assets can enter verification, recognition, and marketplace workflows.', 'capabilities'],
        ['Professional Opportunities', 'Explore ways to contribute services, materials, equipment, contracts, or professional capacity.', 'capabilities'],
        ['Verified Value Research', 'Review how supported value is established and how market signals remain separate.', 'verified'],
        ['Participation Planning', 'Use SAIN to compare timing, contribution types, and available paths before acting.', 'sain'],
        ['Account Capabilities', 'Add or activate the operating capabilities connected to your Universal Account.', 'capabilities']
      ]
    },
    ASSET_PROVIDER: {
      label: 'Asset Provider Workspace',
      intro: 'Your workspace for bringing productive assets into SRA and moving them through evidence, verification, recognition, and marketplace preparation.',
      features: [
        ['Start V4V', 'Begin the evidence and verification workflow for a productive asset.', 'onboarding'],
        ['Asset Accounts', 'Open permanent asset records and review their lifecycle history.', 'assets'],
        ['Verified Value', 'Review supported value, evidence dimensions, and recognition state.', 'verified'],
        ['Projects', 'Create and monitor projects connected to your assets.', 'projects'],
        ['Marketplace Preparation', 'Prepare eligible assets and projects for marketplace publication.', 'marketplace'],
        ['Documents & Records', 'Review controlled records connected to the asset workflow.', 'custody']
      ]
    },
    MARKET_PROFESSIONAL: {
      label: 'Market Professional Workspace',
      intro: 'Your workspace for offering capital, services, equipment, materials, or contract capacity to productive opportunities.',
      features: [
        ['Open Opportunities', 'Find projects seeking capital or professional participation.', 'marketplace'],
        ['Professional Positions', 'Track the positions and commitments you have already created.', 'positions'],
        ['Project Review', 'Compare project stage, timing, Verified Value, and participation needs.', 'projects'],
        ['Verified Value Research', 'Review authorized value summaries before participating.', 'verified'],
        ['Contribution Planning', 'Use SAIN to match what you can provide to an open project need.', 'sain'],
        ['Settlement Paths', 'Review eligible transfer, completion, and settlement activity.', 'positions']
      ]
    },
    INSTITUTIONAL_OPERATOR: {
      label: 'Institutional Workspace',
      intro: 'Your controlled workspace for verification, records, custody, settlement, discharge, and institutional review.',
      features: [
        ['Verification Review', 'Open institutional V4V and recognition workflows.', 'onboarding'],
        ['Custody & Records', 'Review controlled documents, custody state, and record actions.', 'custody'],
        ['Verified Value', 'Review recognized value and supporting evidence.', 'verified'],
        ['Projects & Instruments', 'Monitor connected projects and purpose-bound instruments.', 'projects'],
        ['Completion', 'Review completion candidates and eligible interventions.', 'completion'],
        ['Institutional Activity', 'Review lifecycle events and permanent records.', 'activity']
      ]
    },
    PLATFORM_ADMIN: {
      label: 'Platform Administration Workspace',
      intro: 'Your workspace for platform-level administration, market structures, participants, and cross-platform operations.',
      features: [
        ['Participants', 'Review identities, roles, and participation context.', 'participants'],
        ['Market Pools', 'Review productive capacity and available pool structures.', 'pools'],
        ['Marketplace', 'Review active market opportunities and publication state.', 'marketplace'],
        ['Platform Activity', 'Review lifecycle and platform-level records.', 'activity'],
        ['Interoperability', 'Review approved cross-platform and settlement paths.', 'interoperability'],
        ['Capabilities', 'Manage active platform capabilities and operating tiers.', 'capabilities']
      ]
    }
  };

  function signedIn() {
    return Boolean(window.accessState?.session);
  }

  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function currentWorkspaceDefinition() {
    const tier = window.accessState?.session?.activeCapacity || 'UNIVERSAL';
    return WORKSPACE_COPY[tier] || WORKSPACE_COPY.UNIVERSAL;
  }

  function removePublicOnlyElements() {
    document.querySelectorAll('.public-feature-rail,.public-home-actions').forEach((element) => element.remove());
    document.querySelector('#access-actions')?.classList.remove('public-top-access-hidden');
  }

  function openView(view) {
    if (view === 'capabilities') {
      document.querySelector('#capabilities-button')?.click();
      return;
    }
    if (view === 'sain') {
      document.body.classList.remove('workspace-open');
      document.querySelector('#sane-input')?.focus();
      return;
    }
    const button = document.querySelector(`.nav-item[data-view="${view}"]`);
    button?.click();
  }

  function renderCurrentWorkspace() {
    const definition = currentWorkspaceDefinition();
    const title = document.querySelector('#context-title');
    const status = document.querySelector('#context-status');
    const root = document.querySelector('#view-root');
    if (!root) return;

    if (title) title.textContent = definition.label;
    if (status) {
      status.textContent = 'ACTIVE';
      status.className = 'badge open';
    }

    root.innerHTML = `<section class="workspace-overview">
      <div class="workspace-overview-intro">
        <p class="eyebrow">AVAILABLE IN THIS WORKSPACE</p>
        <h2>${escapeHtml(definition.label)}</h2>
        <p>${escapeHtml(definition.intro)}</p>
      </div>
      <div class="workspace-feature-grid">
        ${definition.features.map(([name, description, view]) => `<button class="workspace-feature-card" data-workspace-target="${escapeHtml(view)}"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(description)}</span><small>Open →</small></button>`).join('')}
      </div>
      <p class="workspace-position-note">Your existing market commitments and holdings remain under <strong>My Positions</strong> in the left navigation.</p>
    </section>`;

    root.querySelectorAll('[data-workspace-target]').forEach((button) => {
      button.addEventListener('click', () => openView(button.dataset.workspaceTarget));
    });
  }

  function syncShell() {
    const workspaceButton = document.querySelector('.nav-item[data-view="workspace"]');
    if (!workspaceButton) return;

    if (signedIn()) {
      removePublicOnlyElements();
      workspaceButton.classList.remove('role-hidden');
      return;
    }

    document.body.classList.remove('workspace-open');
    workspaceButton.classList.add('role-hidden');
    workspaceButton.classList.remove('active');
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.nav-item');
    if (!button) return;

    if (button.dataset.view === 'workspace') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const opening = !document.body.classList.contains('workspace-open');
      document.body.classList.toggle('workspace-open', opening);
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
      button.classList.toggle('active', opening);
      if (opening) renderCurrentWorkspace();
      return;
    }

    if (signedIn()) {
      document.body.classList.remove('workspace-open');
      document.querySelector('.nav-item[data-view="workspace"]')?.classList.remove('active');
    }
  }, true);

  const observer = new MutationObserver(syncShell);
  window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    syncShell();
  });
})();
