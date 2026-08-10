(() => {
  if (window.__sraAdminBootstrapInstalled) return;
  window.__sraAdminBootstrapInstalled = true;

  const FEATURES = [
    ['/admin/admin-suite-shell.js', 'data-sra-admin-suite-shell'],
    ['/admin/admin-workstation-controls.js', 'data-sra-admin-workstation-controls'],
    ['/admin/admin-button-diagnostics-core.js', 'data-sra-admin-diagnostics-core'],
    ['/admin/admin-settlement-execution-controls.js', 'data-sra-admin-settlement-execution-controls'],
    ['/admin/admin-treasury-workstation.js', 'data-sra-admin-treasury-workstation'],
    ['/admin/admin-treasury-presentation-owner.js', 'data-sra-admin-treasury-presentation-owner'],
    ['/admin/admin-treasury-cash-recording.js', 'data-sra-admin-treasury-cash-recording'],
    ['/admin/admin-native-platform-asset-workstation.js', 'data-sra-admin-native-platform-asset-workstation'],
    ['/admin/admin-financial-records-workstation.js', 'data-sra-admin-financial-records-workstation'],
    ['/admin/admin-coin-representation-integrity.js', 'data-sra-admin-coin-representation-integrity'],
    ['/admin/admin-coin-lifecycle-workstation.js', 'data-sra-admin-coin-lifecycle-workstation'],
    ['/admin/admin-marketplace-lifecycle-workstation.js', 'data-sra-admin-marketplace-lifecycle-workstation'],
    ['/admin/admin-marketplace-stage-actions.js', 'data-sra-admin-marketplace-stage-actions'],
    ['/admin/admin-users-permissions-workstation.js', 'data-sra-admin-users-permissions-workstation'],
    ['/admin/admin-agent-operations-workstation.js', 'data-sra-admin-agent-operations-workstation'],
    ['/admin/admin-solana-transfer.js', 'data-sra-admin-solana-transfer'],
    ['/admin/admin-on-chain-issuance-controls.js', 'data-sra-admin-on-chain-issuance-controls'],
    ['/admin/admin-system-health-workstation.js', 'data-sra-admin-system-health-workstation'],
  ];

  let booted = false;
  let refreshTimer = null;
  let refreshInFlight = false;
  let refreshAgain = false;

  function loadScript(source, marker) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[${marker}]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') resolve();
        else existing.addEventListener('load', resolve, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = source;
      script.async = false;
      script.setAttribute(marker, 'true');
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${source}`)), { once: true });
      document.head.append(script);
    });
  }

  function activeWorkspaceId() {
    return document.querySelector('.admin-workspace.active')?.dataset.workspace
      || location.hash.replace('#admin-', '')
      || 'dashboard';
  }

  function removeUnsupportedConnectionTabs(admin) {
    const workspace = admin?.querySelector('[data-workspace="connections"]');
    if (!workspace) return;
    for (const tab of ['Ethereum', 'Bitcoin']) {
      workspace.querySelector(`[data-admin-tab="${tab}"]`)?.remove();
    }
  }

  function requestAdministrationRefresh(source = 'mutation') {
    if (refreshInFlight) {
      refreshAgain = true;
      return;
    }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      refreshInFlight = true;
      try {
        const id = activeWorkspaceId();
        document.querySelector(`[data-refresh-workspace="${CSS.escape(id)}"]`)?.click();
        await Promise.resolve(window.loadSummary?.());
        window.dispatchEvent(new CustomEvent('sra:admin-workspace-synchronized', {
          detail: { workspaceId: id, source, synchronizedAt: new Date().toISOString() },
        }));
      } finally {
        refreshInFlight = false;
        if (refreshAgain) {
          refreshAgain = false;
          requestAdministrationRefresh(source);
        }
      }
    }, 180);
  }

  function concealLegacyFirstPaint(admin) {
    if (!admin) return;
    admin.dataset.adminSuiteBooting = 'true';
    admin.style.visibility = 'hidden';
  }

  function revealAdminSuite(admin) {
    if (!admin) return;
    admin.style.visibility = '';
    delete admin.dataset.adminSuiteBooting;
  }

  function retireLegacyPresentation(admin) {
    const suite = admin?.querySelector(':scope > .admin-suite');
    if (!admin || !suite) return;
    for (const child of [...admin.children]) {
      if (child !== suite) child.remove();
    }
    admin.dataset.presentationOwner = 'admin-suite';
  }

  async function boot() {
    if (booted) return;
    const admin = document.querySelector('#admin-view:not(.hidden)');
    if (!admin) return;

    booted = true;
    concealLegacyFirstPaint(admin);

    try {
      const [shellSource, shellMarker] = FEATURES[0];
      await loadScript(shellSource, shellMarker);
      if (!admin.querySelector('.admin-suite')) throw new Error('Administration shell did not mount.');
      removeUnsupportedConnectionTabs(admin);
      retireLegacyPresentation(admin);
      revealAdminSuite(admin);

      for (const [source, marker] of FEATURES.slice(1)) {
        await loadScript(source, marker);
      }

      window.mountAdminSettlementExecutionControls?.(admin.querySelector('[data-workspace="settlement"]'));

      const treasury = admin.querySelector('[data-workspace="treasury"]');
      window.mountAdminTreasuryWorkstation?.(treasury);
      window.mountAdminTreasuryPresentationOwner?.(treasury);
      window.mountAdminTreasuryCashRecording?.(treasury);

      window.mountAdminNativePlatformAssetWorkstation?.(admin.querySelector('[data-workspace="native-asset"]'));
      window.mountAdminFinancialRecordsWorkstation?.(admin.querySelector('[data-workspace="records"]'));

      const coin = admin.querySelector('[data-workspace="coin-positions"]');
      window.mountAdminCoinRepresentationIntegrityControls?.(coin);
      window.mountAdminCoinLifecycleWorkstation?.(coin);

      const market = admin.querySelector('[data-workspace="marketplace"]');
      window.mountAdminMarketplaceLifecycleWorkstation?.(market);
      window.mountAdminMarketplaceStageActions?.(market);

      window.mountAdminUsersPermissionsWorkstation?.(admin.querySelector('[data-workspace="users"]'));
      window.mountAdminAgentOperationsWorkstation?.(admin);
      window.mountAdminSolanaTransfer?.(admin);
      window.mountAdminOnChainIssuanceControls?.(admin.querySelector('[data-workspace="instruments"]'));
      window.mountAdminSystemHealthWorkstation?.(admin.querySelector('[data-workspace="system"]'));

      window.dispatchEvent(new CustomEvent('sra:admin-booted', {
        detail: { featureCount: FEATURES.length, bootedAt:new Date().toISOString() },
      }));
    } catch (error) {
      booted = false;
      revealAdminSuite(admin);
      console.error('SAIN Administration bootstrap failed.', error);
    }
  }

  window.addEventListener('sra:admin-mutated', (event) => requestAdministrationRefresh(event.detail?.path || 'mutation'));
  window.addEventListener('sra:admin-refresh', (event) => requestAdministrationRefresh(event.detail?.source || 'manual'));
  window.sraRefreshAdministration = requestAdministrationRefresh;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else void boot();

  const observer = new MutationObserver(() => {
    if (document.querySelector('#admin-view:not(.hidden)')) {
      observer.disconnect();
      void boot();
    }
  });
  observer.observe(document.documentElement, { subtree:true, attributes:true, attributeFilter:['class'] });
})();
