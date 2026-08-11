(() => {
  if (window.__sraAdminFinancingAvailabilityLetterInstalled) return;
  window.__sraAdminFinancingAvailabilityLetterInstalled = true;

  function operationsRoot() {
    return document.querySelector('[data-workspace="operations"]');
  }

  function awaitingActive(root) {
    return root?.dataset.activeTab === 'Awaiting Actions';
  }

  function authorizationRecorded(card) {
    const fields = [...card.querySelectorAll('.financing-awaiting-meta div')];
    const field = fields.find((item) => item.querySelector('span')?.textContent.trim() === 'Financing authorization');
    const value = field?.querySelector('b')?.textContent.trim() || '';
    return Boolean(value && value !== 'Not recorded');
  }

  function installButtons(root = operationsRoot()) {
    if (!root || !awaitingActive(root)) return;
    root.querySelectorAll('[data-financing-awaiting]').forEach((card) => {
      if (card.querySelector('[data-financing-availability-letter]')) return;
      if (!authorizationRecorded(card)) return;
      const opportunityId = card.dataset.financingAwaiting;
      if (!opportunityId) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.financingAvailabilityLetter = opportunityId;
      button.textContent = 'View financing availability letter';
      button.style.marginTop = '10px';
      button.style.width = '100%';
      const result = card.querySelector('[data-financing-action-result]');
      if (result) result.before(button);
      else card.append(button);
    });
  }

  function mount(root = operationsRoot()) {
    if (!root || root.dataset.financingAvailabilityLetterBound === 'true') return;
    root.dataset.financingAvailabilityLetterBound = 'true';
    root.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-admin-tab="Awaiting Actions"]');
      if (tab) setTimeout(() => installButtons(root), 0);
      const button = event.target.closest('[data-financing-availability-letter]');
      if (!button) return;
      event.preventDefault();
      const opportunityId = button.dataset.financingAvailabilityLetter;
      window.open(`/api/financing-closing/letters/opportunities/${encodeURIComponent(opportunityId)}`, '_blank', 'noopener');
    });
    const observer = new MutationObserver(() => installButtons(root));
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => {
      if (event.detail?.workspaceId === 'operations') installButtons(root);
    });
    installButtons(root);
  }

  window.mountAdminFinancingAvailabilityLetter = mount;
  window.addEventListener('sra:admin-booted', () => mount());
})();
