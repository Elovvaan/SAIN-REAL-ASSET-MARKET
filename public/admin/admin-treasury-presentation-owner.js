(() => {
  if (window.__sraAdminTreasuryPresentationOwnerInstalled) return;
  window.__sraAdminTreasuryPresentationOwnerInstalled = true;

  const mounted = new WeakSet();

  function hasUsefulDetail(workspace, tab) {
    if (!workspace) return false;
    const records = workspace.querySelector('.admin-workspace-records');
    if (!records) return false;
    if (['Commercial Instruments','Journal Entries','Ledger'].includes(tab)) return true;
    if (tab === 'Treasury Wallets') return !/No treasury treasury wallets records are currently stored/i.test(records.textContent || '');
    if (tab === 'Treasury Reports') return !/No treasury treasury reports records are currently stored/i.test(records.textContent || '');
    return false;
  }

  function apply(workspace) {
    if (!workspace) return;
    const tab = workspace.dataset.activeTab || 'Overview';
    const controls = workspace.querySelector('.admin-workspace-controls');
    if (!controls) return;

    for (const child of [...controls.children]) {
      if (child.matches('[data-treasury-workstation-card]')) {
        child.hidden = false;
        continue;
      }
      if (child.matches('[data-treasury-cash-recording-card]')) {
        child.hidden = tab !== 'Cash Position';
        continue;
      }
      if (child.matches('[data-workstation-control="treasury-controls"]')) continue;
      child.hidden = true;
    }

    const legacyControls = controls.querySelector('[data-workstation-control="treasury-controls"]');
    if (legacyControls) {
      const canonicalRecognized = /TREASURY RECOGNIZED|DEPOSITED_RECOGNIZED_USD/i.test(controls.textContent || '');
      const showDeposit = tab === 'Commercial Instruments' && !canonicalRecognized;
      const showJournal = tab === 'Journal Entries';
      legacyControls.hidden = !(showDeposit || showJournal);

      const summaryGrid = legacyControls.querySelector(':scope > .admin-record-grid');
      if (summaryGrid) summaryGrid.hidden = true;
      for (const detail of legacyControls.querySelectorAll(':scope > details')) {
        const text = detail.querySelector('summary')?.textContent || '';
        if (/Deposit platform commercial instrument/i.test(text)) detail.hidden = !showDeposit;
        else if (/Post balanced entry/i.test(text)) detail.hidden = !showJournal;
        else detail.hidden = true;
      }
    }

    const recordHost = workspace.querySelector('.admin-workspace-records');
    if (recordHost) recordHost.hidden = !hasUsefulDetail(workspace, tab);
  }

  function schedule(workspace) {
    queueMicrotask(() => apply(workspace));
    setTimeout(() => apply(workspace), 200);
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click', (event) => {
      if (event.target.closest('[data-admin-tab]')) schedule(workspace);
    });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => {
      if (event.detail?.workspaceId === 'treasury') schedule(workspace);
    });
    window.addEventListener('sra:admin-mutated', () => schedule(workspace));
    schedule(workspace);
  }

  window.mountAdminTreasuryPresentationOwner = mount;
})();
