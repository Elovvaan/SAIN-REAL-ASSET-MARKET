(() => {
  const universalCapabilities = [
    ['Investment Opportunities','Review published opportunities supported by Verified Value.','marketplace'],
    ['Asset Opportunities','Understand how productive assets enter the market.','onboarding'],
    ['Professional Opportunities','Explore service, equipment, material, and contract participation.','projects'],
    ['Verified Value Research','Review supported value and its evidence basis.','verified'],
    ['Participation Planning','Use SAIN to compare timing, contribution types, and next steps.','marketplace'],
    ['Account Capabilities','Review additional operating capabilities available to this identity.','capabilities']
  ];

  function activate(view) {
    if (view === 'capabilities' && typeof renderCapabilities === 'function') {
      document.body.classList.remove('workspace-open');
      renderCapabilities();
      return;
    }
    const button = document.querySelector(`.nav-item[data-view="${view}"]`);
    button?.click();
  }

  function renderCurrentWorkspaceOverview() {
    const root = document.querySelector('#view-root');
    if (!root || !window.accessState?.session) return;
    const workspace = typeof currentWorkspace === 'function' ? currentWorkspace() : { label: 'Universal' };
    document.querySelector('#context-title').textContent = workspace.label || 'Universal';
    document.querySelector('#context-status').textContent = 'ACTIVE';
    root.innerHTML = `<section class="current-workspace-overview">
      <div class="current-workspace-intro">
        <p class="eyebrow">ACTIVE OPERATING TIER</p>
        <h2>${pEsc(workspace.label || 'Universal')} Workspace</h2>
        <p>These are the features and paths available from the current account tier. Marketplace opportunities and market signals remain inside Marketplace. Existing commitments remain inside My Positions.</p>
      </div>
      <div class="current-workspace-capabilities">
        ${universalCapabilities.map(([title,description,view]) => `<button class="current-workspace-capability" data-workspace-view="${pEsc(view)}"><strong>${pEsc(title)}</strong><span>${pEsc(description)}</span><small>Open →</small></button>`).join('')}
      </div>
    </section>`;
    root.querySelectorAll('[data-workspace-view]').forEach((button) => button.addEventListener('click', () => activate(button.dataset.workspaceView)));
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.nav-item[data-view="workspace"]');
    if (!button || !window.accessState?.session) return;
    setTimeout(renderCurrentWorkspaceOverview, 0);
  }, true);
})();
