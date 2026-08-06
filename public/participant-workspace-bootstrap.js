(() => {
  let suiteLoaded = false;
  let loading = false;
  let sessionKey = '';
  const inheritedFetch = window.fetch.bind(window);

  function currentSessionKey() {
    const session = window.accessState?.session;
    if (!session) return '';
    return `${session.universalAccountId || session.id || 'session'}:${session.activeCapacity || 'UNIVERSAL'}`;
  }

  function loadParticipantSuite() {
    if (suiteLoaded || loading || !window.accessState?.session) return;
    loading = true;

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
      sessionKey = currentSessionKey();
    }, { once: true });
    script.addEventListener('error', () => {
      window.MutationObserver = NativeMutationObserver;
      loading = false;
    }, { once: true });
    document.head.append(script);
  }

  function syncParticipantSuite() {
    const nextKey = currentSessionKey();
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

  function scheduleSync() {
    queueMicrotask(syncParticipantSuite);
    setTimeout(syncParticipantSuite, 50);
    setTimeout(syncParticipantSuite, 250);
  }

  window.fetch = async (...args) => {
    const target = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    try {
      return await inheritedFetch(...args);
    } finally {
      if (target.includes('/api/access/')) scheduleSync();
    }
  };

  window.addEventListener('sra:access-state-changed', scheduleSync);
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', scheduleSync, { once: true });
  } else {
    scheduleSync();
  }
})();
