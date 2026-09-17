(() => {
  if (window.__sraAdminBootstrapInstalled) return;
  window.__sraAdminBootstrapInstalled = true;

  const PERFORMANCE_RUNTIME = ['/admin/admin-performance-runtime.js', 'data-sra-admin-performance-runtime'];
  const SHELL = ['/admin/admin-suite-shell.js', 'data-sra-admin-suite-shell'];

  // Workspace entry loads only the capability needed to enter that workspace.
  // Downstream workflow capabilities are loaded by the explicit handoff/click
  // that owns them; a completed upstream stage is never regenerated here.
  const WORKSPACE_FEATURES = {
    dashboard: [['/admin/admin-market-dashboard.js', 'data-sra-admin-market-dashboard']],
    operations: [
      ['/funding-operations-ui.js', 'data-sra-admin-funding-operations'],
      ['/admin/admin-unified-financing-workstation.js', 'data-sra-admin-unified-financing-workstation'],
    ],
    settlement: [
      ['/admin/admin-settlement-execution-controls.js', 'data-sra-admin-settlement-execution-controls'],
      ['/admin/admin-treasury-prime-connection-test.js', 'data-sra-admin-treasury-prime-connection-test'],
      ['/admin/admin-moneygram-sandbox-test.js', 'data-sra-admin-moneygram-sandbox-test'],
    ],
    treasury: [
      ['/admin/admin-treasury-workstation.js', 'data-sra-admin-treasury-workstation'],
      ['/admin/admin-treasury-presentation-owner.js', 'data-sra-admin-treasury-presentation-owner'],
      ['/admin/admin-treasury-cash-recording.js', 'data-sra-admin-treasury-cash-recording'],
      ['/admin/admin-treasury-instrument-recording.js', 'data-sra-admin-treasury-instrument-recording'],
    ],
    'native-asset': [['/admin/admin-native-platform-asset-workstation.js', 'data-sra-admin-native-platform-asset-workstation']],
    records: [['/admin/admin-financial-records-workstation.js', 'data-sra-admin-financial-records-workstation']],
    'coin-positions': [
      ['/admin/admin-coin-representation-integrity.js', 'data-sra-admin-coin-representation-integrity'],
      ['/admin/admin-coin-lifecycle-workstation.js', 'data-sra-admin-coin-lifecycle-workstation'],
      ['/admin/admin-xrpl-exchange-workstation.js', 'data-sra-admin-xrpl-exchange-workstation'],
    ],
    marketplace: [
      ['/admin/admin-marketplace-lifecycle-workstation.js', 'data-sra-admin-marketplace-lifecycle-workstation'],
      ['/admin/admin-marketplace-stage-actions.js', 'data-sra-admin-marketplace-stage-actions'],
    ],
    users: [
      ['/admin/admin-users-permissions-workstation.js', 'data-sra-admin-users-permissions-workstation'],
      ['/admin/capability-review.js', 'data-sra-admin-capability-review'],
    ],
    agent: [['/admin/admin-agent-operations-workstation.js', 'data-sra-admin-agent-operations-workstation']],
    connections: [['/admin/admin-stellar-transfer.js', 'data-sra-admin-stellar-transfer']],
    instruments: [
      ['/admin/admin-instrument-review-workstation.js', 'data-sra-admin-instrument-review-workstation'],
      ['/admin/admin-on-chain-issuance-controls.js', 'data-sra-admin-on-chain-issuance-controls'],
    ],
    system: [
      ['/admin/admin-button-diagnostics-core.js', 'data-sra-admin-diagnostics-core'],
      ['/admin/admin-system-health-workstation.js', 'data-sra-admin-system-health-workstation'],
    ],
  };

  const OPERATION_HANDOFF_FEATURES = {
    financingDetail: [
      ['/admin/admin-financing-evidence.js', 'data-sra-admin-financing-evidence'],
    ],
    awaitingActions: [
      ['/admin/admin-financing-awaiting-actions.js', 'data-sra-admin-financing-awaiting-actions'],
      ['/admin/admin-financing-availability-letter.js', 'data-sra-admin-financing-availability-letter'],
    ],
  };

  const workspaceLoads = new Map();
  const handoffLoads = new Map();
  let performanceLoad = null;
  let shellLoad = null;
  let booted = false;
  let refreshTimer = null;
  let refreshInFlight = false;
  let refreshAgain = false;

  function loadScriptOnce(source, marker, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[${marker}]`);
      if (existing) {
        if (existing.dataset.loaded === 'true' || existing.dataset.preloaded === 'true') resolve();
        else if (existing.dataset.failed === 'true') { existing.remove(); reject(new Error(`Failed to load ${source}`)); }
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
      const timeout = setTimeout(() => { script.dataset.failed = 'true'; script.remove(); reject(new Error(`Timed out loading ${source}`)); }, timeoutMs);
      script.addEventListener('load', () => { clearTimeout(timeout); script.dataset.loaded = 'true'; resolve(); }, { once: true });
      script.addEventListener('error', () => { clearTimeout(timeout); script.dataset.failed = 'true'; script.remove(); reject(new Error(`Failed to load ${source}`)); }, { once: true });
      document.head.append(script);
    });
  }

  async function loadScript(source, marker, options = {}) {
    const { retry = true, timeoutMs = 4000 } = options;
    try { return await loadScriptOnce(source, marker, timeoutMs); }
    catch (firstError) {
      if (!retry) throw firstError;
      await new Promise((resolve) => setTimeout(resolve, 350));
      return loadScriptOnce(source, marker, timeoutMs).catch(() => { throw firstError; });
    }
  }

  function activeWorkspaceId() {
    return document.querySelector('.admin-workspace.active')?.dataset.workspace || location.hash.replace('#admin-', '') || 'dashboard';
  }

  function removeBootPlaceholder(admin) { admin?.querySelector('[data-admin-boot-placeholder]')?.remove(); }

  function reportWorkspaceFeatureFailures(workspaceId, admin, failures = []) {
    const workspace = admin?.querySelector(`[data-workspace="${CSS.escape(workspaceId)}"]`);
    const controls = workspace?.querySelector('.admin-workspace-controls');
    if (!controls) return;
    controls.querySelector('[data-admin-feature-load-failure]')?.remove();
    if (!failures.length) return;
    const notice = document.createElement('section');
    notice.className = 'admin-record-card';
    notice.dataset.adminFeatureLoadFailure = 'true';
    notice.innerHTML = `<header><strong>Some ${workspaceId.replaceAll('-', ' ')} controls did not load</strong><em>RETRY AVAILABLE</em></header><p>The available controls remain usable. Retry only the missing ${failures.length === 1 ? 'panel' : 'panels'} without reloading the entire administration portal.</p><button type="button" data-retry-admin-features="${workspaceId}">Retry missing controls</button>`;
    notice.querySelector('[data-retry-admin-features]')?.addEventListener('click', () => void loadWorkspaceFeatures(workspaceId, true));
    controls.prepend(notice);
  }

  function mountWorkspaceFeatures(workspaceId, admin) {
    if (!admin) return;
    if (workspaceId === 'dashboard') return window.mountAdminMarketDashboard?.(admin.querySelector('[data-workspace="dashboard"]'));
    if (workspaceId === 'operations') return window.mountAdminUnifiedFinancingWorkstation?.(admin.querySelector('[data-workspace="operations"]'));
    if (workspaceId === 'settlement') {
      const root = admin.querySelector('[data-workspace="settlement"]');
      window.mountAdminSettlementExecutionControls?.(root); window.mountAdminTreasuryPrimeConnectionTest?.(root); window.mountAdminMoneyGramSandboxTest?.(root); return;
    }
    if (workspaceId === 'treasury') {
      const root = admin.querySelector('[data-workspace="treasury"]');
      window.mountAdminTreasuryWorkstation?.(root); window.mountAdminTreasuryPresentationOwner?.(root); window.mountAdminTreasuryCashRecording?.(root); return;
    }
    if (workspaceId === 'native-asset') return window.mountAdminNativePlatformAssetWorkstation?.(admin.querySelector('[data-workspace="native-asset"]'));
    if (workspaceId === 'records') return window.mountAdminFinancialRecordsWorkstation?.(admin.querySelector('[data-workspace="records"]'));
    if (workspaceId === 'coin-positions') {
      const root = admin.querySelector('[data-workspace="coin-positions"]');
      window.mountAdminCoinRepresentationIntegrityControls?.(root); window.mountAdminCoinLifecycleWorkstation?.(root); window.mountAdminXrplExchangeWorkstation?.(root); return;
    }
    if (workspaceId === 'marketplace') {
      const root = admin.querySelector('[data-workspace="marketplace"]');
      window.mountAdminMarketplaceLifecycleWorkstation?.(root); window.mountAdminMarketplaceStageActions?.(root); return;
    }
    if (workspaceId === 'users') return window.mountAdminUsersPermissionsWorkstation?.(admin.querySelector('[data-workspace="users"]'));
    if (workspaceId === 'agent') return window.mountAdminAgentOperationsWorkstation?.(admin);
    if (workspaceId === 'connections') return window.mountAdminStellarTransfer?.(admin);
    if (workspaceId === 'instruments') {
      const root = admin.querySelector('[data-workspace="instruments"]');
      window.mountAdminInstrumentReviewWorkstation?.(root); window.mountAdminOnChainIssuanceControls?.(root); return;
    }
    if (workspaceId === 'system') return window.mountAdminSystemHealthWorkstation?.(admin.querySelector('[data-workspace="system"]'));
  }

  async function loadFeatureSet(key, featureList, mount) {
    if (handoffLoads.has(key)) return handoffLoads.get(key).then(mount);
    const pending = Promise.allSettled(featureList.map(([source, marker]) => loadScript(source, marker))).then((results) => {
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length) handoffLoads.delete(key);
      mount();
      return { loaded: featureList.length - failures.length, failures };
    });
    handoffLoads.set(key, pending);
    return pending;
  }

  function loadOperationsHandoff(kind) {
    const admin = document.querySelector('#admin-view:not(.hidden)');
    const root = admin?.querySelector('[data-workspace="operations"]');
    const featureList = OPERATION_HANDOFF_FEATURES[kind];
    if (!root || !featureList) return Promise.resolve();
    return loadFeatureSet(`operations:${kind}`, featureList, () => {
      if (kind === 'financingDetail') window.mountAdminFinancingEvidence?.(root);
      if (kind === 'awaitingActions') {
        window.mountAdminFinancingAwaitingActions?.(root);
        window.mountAdminFinancingAvailabilityLetter?.(root);
      }
    });
  }

  async function loadWorkspaceFeatures(workspaceId = activeWorkspaceId(), forceRetry = false) {
    const admin = document.querySelector('#admin-view:not(.hidden)');
    if (!admin) return;
    const featureList = WORKSPACE_FEATURES[workspaceId] || [];
    if (!featureList.length) return;
    if (workspaceLoads.has(workspaceId) && !forceRetry) return workspaceLoads.get(workspaceId).then(() => mountWorkspaceFeatures(workspaceId, admin));
    if (forceRetry) workspaceLoads.delete(workspaceId);
    const pending = Promise.allSettled(featureList.map(([source, marker]) => loadScript(source, marker))).then((results) => {
      const failures = results.map((result, index) => result.status === 'rejected' ? { source: featureList[index][0], error: result.reason } : null).filter(Boolean);
      mountWorkspaceFeatures(workspaceId, admin);
      reportWorkspaceFeatureFailures(workspaceId, admin, failures);
      if (failures.length) workspaceLoads.delete(workspaceId);
      window.dispatchEvent(new CustomEvent('sra:admin-workspace-features-ready', { detail: { workspaceId, featureCount: featureList.length - failures.length, failedFeatureCount: failures.length, loadedAt: new Date().toISOString() } }));
      return { loaded: featureList.length - failures.length, failures };
    }).catch((error) => { workspaceLoads.delete(workspaceId); console.error(`SAIN Administration workspace failed to load: ${workspaceId}`, error); throw error; });
    workspaceLoads.set(workspaceId, pending);
    return pending;
  }

  async function ensurePerformanceRuntime() {
    if (performanceLoad) return performanceLoad;
    performanceLoad = loadScript(...PERFORMANCE_RUNTIME, { retry: false, timeoutMs: 3000 }).catch((error) => { performanceLoad = null; throw error; });
    return performanceLoad;
  }

  async function ensureShell() {
    if (shellLoad) return shellLoad;
    shellLoad = (async () => {
      const [source, marker] = SHELL;
      await loadScript(source, marker, { retry: false, timeoutMs: 4000 });
      const admin = document.querySelector('#admin-view:not(.hidden)');
      if (!admin?.querySelector('.admin-suite')) throw new Error('Administration shell did not mount.');
      admin.querySelector('#admin-suite-account .top')?.style.removeProperty('display');
      removeBootPlaceholder(admin); admin.dataset.presentationOwner = 'admin-suite';
      void ensurePerformanceRuntime().catch((error) => console.warn('SAIN Administration performance enhancement did not load; the shell remains available.', error));
      return admin;
    })().catch((error) => { shellLoad = null; throw error; });
    return shellLoad;
  }

  async function boot() {
    if (booted) return;
    const admin = document.querySelector('#admin-view:not(.hidden)');
    if (!admin) return;
    booted = true;
    try {
      await ensureShell(); await loadWorkspaceFeatures(activeWorkspaceId());
      window.dispatchEvent(new CustomEvent('sra:admin-booted', { detail: { mode: 'single-shell-handoff-workflows', bootedAt: new Date().toISOString() } }));
    } catch (error) {
      booted = false; console.error('SAIN Administration bootstrap failed.', error);
      const placeholder = admin.querySelector('[data-admin-boot-placeholder]'); if (placeholder) placeholder.textContent = 'Administration failed to load. Refresh to retry.';
    }
  }

  function requestAdministrationRefresh(source = 'manual') {
    if (refreshInFlight) { refreshAgain = true; return; }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      refreshInFlight = true;
      try {
        const id = activeWorkspaceId();
        document.querySelector(`[data-refresh-workspace="${CSS.escape(id)}"]`)?.click();
        window.dispatchEvent(new CustomEvent('sra:admin-workspace-synchronized', { detail: { workspaceId: id, source, synchronizedAt: new Date().toISOString() } }));
      } finally {
        refreshInFlight = false;
        if (refreshAgain) { refreshAgain = false; requestAdministrationRefresh(source); }
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

    // Explicit Operations handoffs. Nothing downstream loads before its click.
    if (event.target?.closest?.('[data-admin-tab="Awaiting Actions"]')) queueMicrotask(() => void loadOperationsHandoff('awaitingActions'));
    if (event.target?.closest?.('.funding-ops-row[data-opportunity-id]')) queueMicrotask(() => void loadOperationsHandoff('financingDetail'));
  }, true);

  window.addEventListener('hashchange', () => void loadWorkspaceFeatures(activeWorkspaceId()));
  window.addEventListener('sra:admin-visible', () => void boot());
  window.addEventListener('sra:admin-refresh', (event) => requestAdministrationRefresh(event.detail?.source || 'manual'));
  window.sraRefreshAdministration = requestAdministrationRefresh;
  window.sraLoadAdminWorkspaceFeatures = loadWorkspaceFeatures;
  window.sraLoadOperationsHandoff = loadOperationsHandoff;

  if (document.readyState !== 'loading' && document.querySelector('#admin-view:not(.hidden)')) void boot();
})();
