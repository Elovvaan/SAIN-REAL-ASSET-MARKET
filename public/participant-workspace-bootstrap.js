(() => {
  let suiteLoaded = false;
  let loading = false;
  let sessionKey = '';
  let stateHooked = false;
  let syncAfterLoad = false;

  function currentSessionKey() {
    const session = window.accessState?.session;
    if (!session) return '';
    return `${session.universalAccountId || session.id || 'session'}:${session.activeCapacity || 'UNIVERSAL'}`;
  }

  function dispatchAccessStateChanged() {
    window.dispatchEvent(new CustomEvent('sra:access-state-changed', {
      detail: {
        authenticated: Boolean(window.accessState?.session),
        sessionKey: currentSessionKey()
      }
    }));
  }

  function hookAccessState() {
    if (stateHooked || !window.accessState) return Boolean(stateHooked);
    const descriptor = Object.getOwnPropertyDescriptor(window.accessState, 'session');
    if (descriptor && descriptor.configurable === false) return false;

    let assignedSession = window.accessState.session;
    Object.defineProperty(window.accessState, 'session', {
      configurable: true,
      enumerable: true,
      get() { return assignedSession; },
      set(nextSession) {
        if (assignedSession === nextSession) return;
        assignedSession = nextSession;
        dispatchAccessStateChanged();
      }
    });
    stateHooked = true;
    return true;
  }

  function loadParticipantSuite() {
    if (suiteLoaded || loading || !window.accessState?.session) return;
    loading = true;
    syncAfterLoad = false;

    const NativeMutationObserver = window.MutationObserver;
    class OneShotMutationObserver {
      constructor(callback) { this.callback = callback; }
      observe() { queueMicrotask(() => this.callback([], this)); }
      disconnect() {}
      takeRecords() { return []; }
    }

    window.MutationObserver = OneShotMutationObserver;
    const script = document.createElement('script');
    script.src = '/participant-workspace-suite.js';
    script.async = false;
    script.dataset.sraParticipantWorkspaceSuite = 'true';
    script.addEventListener('load', () => {
      window.MutationObserver = NativeMutationObserver;
      suiteLoaded = true;
      loading = false;
      const loadedSessionKey = currentSessionKey();
      sessionKey = loadedSessionKey;

      if (!loadedSessionKey) {
        window.location.reload();
        return;
      }

      if (syncAfterLoad) syncAfterLoad = false;
      queueMicrotask(syncParticipantSuite);
    }, { once: true });
    script.addEventListener('error', () => {
      window.MutationObserver = NativeMutationObserver;
      loading = false;
      syncAfterLoad = false;
      queueMicrotask(syncParticipantSuite);
    }, { once: true });
    document.head.append(script);
  }

  function syncParticipantSuite() {
    hookAccessState();
    const nextKey = currentSessionKey();

    if (loading) {
      syncAfterLoad = true;
      return;
    }

    if (!nextKey) {
      if (suiteLoaded) window.location.reload();
      return;
    }
    if (suiteLoaded && sessionKey && nextKey !== sessionKey) {
      window.location.reload();
      return;
    }
    loadParticipantSuite();
  }

  function initialize() {
    hookAccessState();
    syncParticipantSuite();
  }

  window.addEventListener('sra:access-state-changed', syncParticipantSuite);
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
