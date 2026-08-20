(() => {
  if (window.__sraAdminBootstrapInstalled) return;
  window.__sraAdminBootstrapInstalled = true;

  const SHELL = ['/admin/admin-suite-shell.js', 'data-sra-admin-suite-shell'];
  const WORKSPACE_FEATURES = {
    operations: [
      ['/admin/admin-unified-financing-workstation.js', 'data-sra-admin-unified-financing-workstation'],
      ['/admin/admin-financing-evidence.js', 'data-sra-admin-financing-evidence'],
      ['/admin/admin-financing-awaiting-actions.js', 'data-sra-admin-financing-awaiting-actions'],
      ['/admin/admin-financing-availability-letter.js', 'data-sra-admin-financing-availability-letter'],
      ['/admin/admin-workstation-controls.js', 'data-sra-admin-workstation-controls'],
      ['/admin/admin-button-diagnostics-core.js', 'data-sra-admin-diagnostics-core'],
    ],
    settlement: [
      ['/admin/admin-settlement-execution-controls.js', 'data-sra-admin-settlement-execution-controls'],
    ],
    treasury: [
      ['/admin/admin-treasury-workstation.js', 'data-sra-admin-treasury-workstation'],
      ['/admin/admin-treasury-presentation-owner.js', 'data-sra-admin-treasury-presentation-owner'],
      ['/admin/admin-treasury-cash-recording.js', 'data-sra-admin-treasury-cash-recording'],
    ],
    'native-asset': [
      ['/admin/admin-native-platform-asset-workstation.js', 'data-sra-admin-native-platform-asset-workstation'],
    ],
    records: [
      ['/admin/admin-financial-records-workstation.js', 'data-sra-admin-financial-records-workstation'],
    ],
    'coin-positions': [
      ['/admin/admin-coin-representation-integrity.js', 'data-sra-admin-coin-representation-integrity'],
      ['/admin/admin-coin-lifecycle-workstation.js', 'data-sra-admin-coin-lifecycle-workstation'],
    ],
    marketplace: [
      ['/admin/admin-marketplace-lifecycle-workstation.js', 'data-sra-admin-marketplace-lifecycle-workstation'],
      ['/admin/admin-marketplace-stage-actions.js', 'data-sra-admin-marketplace-stage-actions'],
    ],
    users: [
      ['/admin/admin-users-permissions-workstation.js', 'data-sra-admin-users-permissions-workstation'],
    ],
    agent: [
      ['/admin/admin-agent-operations-workstation.js', 'data-sra-admin-agent-operations-workstation'],
    ],
    connections: [
      ['/admin/admin-stellar-transfer.js', 'data-sra-admin-stellar-transfer'],
    ],
    instruments: [
      ['/admin/admin-on-chain-issuance-controls.js', 'data-sra-admin-on-chain-issuance-controls'],
    ],
    system: [
      ['/admin/admin-button-diagnostics-core.js', 'data-sra-admin-diagnostics-core'],
      ['/admin/admin-system-health-workstation.js', 'data-sra-admin-system-health-workstation'],
    ],
  };

  const workspaceLoads = new Map();
  let shellLoad = null;
  let booted = false;
  let refreshTimer = null;
  let refreshInFlight = false;
  let refreshAgain = false;

  function loadScript(source, marker) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[${marker}]`);
      if (existing) {
        if (existing.dataset.loaded === 'true' || existing.dataset.preloaded === 'true') resolve();
        else {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', () => reject(new Error(`Failed to load ${source}`)), { once: true });
        }
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

  function configureConnectionTabs(admin) {
    const workspace = admin?.querySelector('[data-workspace="connections"]');
    if (!workspace) return;
    for (const tab of ['Ethereum', 'Bitcoin']) {
      workspace.querySelector(`[data-admin-tab="${tab}"]`)?.remove();
    }
    const formerSolana = workspace.querySelector('[data-admin-tab="Solana"]');
    if (formerSolana) {
      formerSolana.dataset.adminTab = 'Stellar';
      formerSolana.textContent = 'Stellar';
    }
  }

  function removeBootPlaceholder(admin) {
    admin?.querySelector('[data-admin-boot-placeholder]')?.remove();
  }

  function mountWorkspaceFeatures(workspaceId, admin) {
    if (!admin) return;
    if (workspaceId === 'operations') {
      const operations = admin.querySelector('[data-workspace="operations"]');
      window.mountAdminUnifiedFinancingWorkstation?.(operations);
      window.mountAdminFinancingAwaitingActions?.(operations);
      window.mountAdminFinancingAvailabilityLetter?.(operations);
      return;
    }
    if (workspaceId === 'settlement') {
      window.mountAdminSettlementExecutionControls?.(admin.querySelector('[data-workspace="settlement"]'));
      return;
    }
    if (workspaceId === 'treasury') {
      const treasury = admin.querySelector('[data-workspace="treasury"]');
      window.mountAdminTreasuryWorkstation?.(treasury);
      window.mountAdminTreasuryPresentationOwner?.(treasury);
      window.mountAdminTreasuryCashRecording?.(treasury);
      return;
    }
    if (workspaceId === 'native-asset') {
      window.mountAdminNativePlatformAssetWorkstation?.(admin.querySelector('[data-workspace="native-asset"]'));
      return;
    }
    if (workspaceId === 'records') {
      window.mountAdminFinancialRecordsWorkstation?.(admin.querySelector('[data-workspace="records"]'));
      return;
    }
    if (workspaceId === 'coin-positions') {
      const coin = admin.querySelector('[data-workspace="coin-positions"]');
      window.mountAdminCoinRepresentationIntegrityControls?.(coin);
      window.mountAdminCoinLifecycleWorkstation?.(coin);
      return;
    }
    if (workspaceId === 'marketplace') {
      const market = admin.querySelector('[data-workspace="marketplace"]');
      window.mountAdminMarketplaceLifecycleWorkstation?.(market);
      window.mountAdminMarketplaceStageActions?.(market);
      return;
    }
    if (workspaceId === 'users') {
      window.mountAdminUsersPermissionsWorkstation?.(admin.querySelector('[data-workspace="users"]'));
      return;
    }
    if (workspaceId === 'agent') {
      window.mountAdminAgentOperationsWorkstation?.(admin);
      return;
    }
    if (workspaceId === 'connections') {
      window.mountAdminStellarTransfer?.(admin);
      return;
    }
    if (workspaceId === 'instruments') {
      window.mountAdminOnChainIssuanceControls?.(admin.querySelector('[data-workspace="instruments"]'));
      return;
    }
    if (workspaceId === 'system') {
      window.mountAdminSystemHealthWorkstation?.(admin.querySelector('[data-workspace="system"]'));
    }
  }

  async function loadWorkspaceFeatures(workspaceId = activeWorkspaceId()) {
    const admin = document.querySelector('#admin-view:not(.hidden)');
    if (!admin) return;
    const featureList = WORKSPACE_FEATURES[workspaceId] || [];
    if (!featureList.length) return;
    if (workspaceLoads.has(workspaceId)) return workspaceLoads.get(workspaceId);

    const pending = (async () => {
      for (const [source, marker] of featureList) await loadScript(source, marker);
      mountWorkspaceFeatures(workspaceId, admin);
      window.dispatchEvent(new CustomEvent('sra:admin-workspace-features-ready', {
        detail: { workspaceId, featureCount: featureList.length, loadedAt: new Date().toISOString() },
      }));
    })().catch((error) => {
      workspaceLoads.delete(workspaceId);
      console.error(`SAIN Administration workspace failed to load: ${workspaceId}`, error);
      throw error;
    });

    workspaceLoads.set(workspaceId, pending);
    return pending;
  }

  async function ensureShell() {
    if (shellLoad) return shellLoad;
    shellLoad = (async () => {
      const [source, marker] = SHELL;
      await loadScript(source, marker);
      const admin = document.querySelector('#admin-view:not(.hidden)');
      if (!admin?.querySelector('.admin-suite')) throw new Error('Administration shell did not mount.');
      configureConnectionTabs(admin);
      admin.querySelector('#admin-suite-account .top')?.style.removeProperty('display');
      removeBootPlaceholder(admin);
      admin.dataset.presentationOwner = 'admin-suite';
      return admin;
    })().catch((error) => {
      shellLoad = null;
      throw error;
    });
    return shellLoad;
  }

  async function boot() {
    if (booted) return;
    const admin = document.querySelector('#admin-view:not(.hidden)');
    if (!admin) return;
    booted = true;
    try {
      await ensureShell();
      await loadWorkspaceFeatures(activeWorkspaceId());
      window.dispatchEvent(new CustomEvent('sra:admin-booted', {
        detail: { mode: 'single-shell-lazy-workspaces', bootedAt: new Date().toISOString() },
      }));
    } catch (error) {
      booted = false;
      console.error('SAIN Administration bootstrap failed.', error);
      const placeholder = admin.querySelector('[data-admin-boot-placeholder]');
      if (placeholder) placeholder.textContent = 'Administration failed to load. Refresh to retry.';
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

  function requestedWorkspaceFromEvent(event) {
    const button = event.target?.closest?.('[data-admin-workspace],[data-open-workspace]');
    return button?.dataset.adminWorkspace || button?.dataset.openWorkspace || null;
  }

  document.addEventListener('click', (event) => {
    const workspaceId = requestedWorkspaceFromEvent(event);
    if (workspaceId) queueMicrotask(() => void loadWorkspaceFeatures(workspaceId));
  }, true);
  window.addEventListener('hashchange', () => void loadWorkspaceFeatures(activeWorkspaceId()));
  window.addEventListener('sra:admin-visible', () => void boot());
  window.addEventListener('sra:admin-mutated', (event) => requestAdministrationRefresh(event.detail?.path || 'mutation'));
  window.addEventListener('sra:admin-refresh', (event) => requestAdministrationRefresh(event.detail?.source || 'manual'));
  window.sraRefreshAdministration = requestAdministrationRefresh;
  window.sraLoadAdminWorkspaceFeatures = loadWorkspaceFeatures;

  if (document.readyState !== 'loading' && document.querySelector('#admin-view:not(.hidden)')) void boot();
})();