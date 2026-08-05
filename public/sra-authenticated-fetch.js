(() => {
  const originalFetch = window.fetch.bind(window);
  const protectedPrefixes = [
    '/api/funding',
    '/api/funding-operations',
    '/api/funding-value',
    '/api/funding-model',
    '/api/funding-instrument',
    '/api/funding-marketplace',
    '/api/sain/intelligence',
  ];

  function sessionRoles(session) {
    const roles = new Set();
    if (!session) return [];
    if (session.activeCapacity) roles.add(String(session.activeCapacity).toUpperCase());
    for (const item of session.capacities || []) {
      if (item?.id) roles.add(String(item.id).toUpperCase());
    }
    for (const role of session.roles || []) roles.add(String(role).toUpperCase());
    return [...roles];
  }

  function actorId(session) {
    return session?.participantId || session?.userId || session?.universalAccountId || session?.email || null;
  }

  function isProtectedRequest(input, init = {}) {
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
    const url = typeof input === 'string' ? input : input?.url || '';
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.origin === window.location.origin && protectedPrefixes.some((prefix) => parsed.pathname.startsWith(prefix));
    } catch {
      return false;
    }
  }

  window.fetch = function authenticatedFetch(input, init = {}) {
    if (!isProtectedRequest(input, init)) return originalFetch(input, init);
    const session = window.accessState?.session || null;
    const roles = sessionRoles(session);
    const actor = actorId(session);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    if (roles.length) {
      headers.set('x-sra-role', roles[0]);
      headers.set('x-sra-roles', roles.join(','));
    }
    if (actor) headers.set('x-sra-actor-id', actor);
    return originalFetch(input, { ...init, headers, credentials: init.credentials || 'same-origin' });
  };

  window.sraOperationsIdentity = {
    current() {
      const session = window.accessState?.session || null;
      return { actorId: actorId(session), roles: sessionRoles(session), authenticated: Boolean(session) };
    },
  };
})();
