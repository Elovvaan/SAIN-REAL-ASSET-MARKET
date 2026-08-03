(() => {
  function renderCompactCurrentWorkspace() {
    const root = document.querySelector('#view-root');
    if (!root || !window.accessState?.session) return;

    const opportunities = participationState.opportunities || [];
    root.innerHTML = `<section class="current-workspace-market">
      <div class="market-rail-head">
        <div><p class="eyebrow">LIVE MARKET</p><h2>Opportunities</h2></div>
      </div>
      <div class="compact-opportunity-list current-workspace-opportunities">
        ${opportunities.map(opportunityCard).join('')}
      </div>
    </section>`;

    root.querySelectorAll('[data-open-opportunity]').forEach((button) => {
      button.addEventListener('click', () => openOpportunity(button.dataset.openOpportunity));
    });
  }

  const originalRenderSignedInMarketplace = renderSignedInMarketplace;
  renderSignedInMarketplace = function renderSignedInMarketplaceWithoutDuplicateAgent() {
    if (document.body.classList.contains('workspace-open')) {
      renderCompactCurrentWorkspace();
      return;
    }
    originalRenderSignedInMarketplace();
  };

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.nav-item[data-view="workspace"]');
    if (!button || !window.accessState?.session) return;
    setTimeout(renderCompactCurrentWorkspace, 0);
  }, true);
})();
