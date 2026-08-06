(() => {
  if (window.__sraAdminDiagnosticsInstalled) return;
  window.__sraAdminDiagnosticsInstalled = true;

  const ADMIN_SESSION_TIMEOUT_MS = 15_000;
  const ADMIN_READ_TIMEOUT_MS = 60_000;
  const ADMIN_WRITE_TIMEOUT_MS = 180_000;
  const ADMIN_READ_CACHE_TTL_MS = 5_000;
  const ADMIN_HIDDEN_CACHE_TTL_MS = 60_000;
  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
  const nativeFetch = window.fetch.bind(window);
  const inFlightReads = new Map();
  const readCache = new Map();
  let sessionRecoveryStarted = false;
  let enhancing = false;
  let inspectionScheduled = false;

  const adminView = () => document.querySelector('#admin-view');

  function lockAdminWorkspace() {
    const view = adminView();
    if (!view) return;
    view.inert = true;
    view.setAttribute('aria-hidden', 'true');
    view.style.pointerEvents = 'none';
    view.style.opacity = '0.22';
  }

  function unlockAdminWorkspace() {
    const view = adminView();
    if (!view) return;
    view.inert = false;
    view.removeAttribute('aria-hidden');
    view.style.pointerEvents = '';
    view.style.opacity = '';
  }

  function showSignedOutState() {
    document.querySelector('#setup-view')?.classList.add('hidden');
    document.querySelector('#admin-view')?.classList.add('hidden');
    document.querySelector('#login-view')?.classList.remove('hidden');
    const loginError = document.querySelector('#login-error');
    if (loginError) loginError.textContent = 'Your Platform Administration session expired. Sign in again to continue.';
    lockAdminWorkspace();
  }

  function startSessionRecovery() {
    if (sessionRecoveryStarted) return;
    sessionRecoveryStarted = true;
    window.__sraAdminSessionExpired = true;
    inFlightReads.clear();
    readCache.clear();
    window.dispatchEvent(new CustomEvent('sra-admin-session-expired'));
    showSignedOutState();

    let notice = document.querySelector('#sra-admin-session-expired');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'sra-admin-session-expired';
      notice.style.cssText = 'position:fixed;inset:16px 16px auto 16px;z-index:99999;padding:14px 16px;border:1px solid #6b5318;border-radius:12px;background:#171207;color:#f1d777;font-weight:700;text-align:center';
      document.body.append(notice);
    }
    notice.innerHTML = 'Your Platform Administration session expired. <button id="sra-admin-sign-in-again" type="button" style="margin-left:10px">Sign in again</button>';
    document.querySelector('#sra-admin-sign-in-again')?.addEventListener('click', () => document.querySelector('#email')?.focus(), { once: true });
  }

  function completeSessionRecovery() {
    if (!sessionRecoveryStarted) return;
    sessionRecoveryStarted = false;
    window.__sraAdminSessionExpired = false;
    document.querySelector('#sra-admin-session-expired')?.remove();
    unlockAdminWorkspace();
    window.dispatchEvent(new CustomEvent('sra-admin-session-restored'));
    window.setTimeout(() => {
      scheduleButtonInspection();
      void enhanceFundingInstrumentControl();
    }, 0);
  }

  function administrationTimeout({ isAdminRequest, isSessionProbe, method }) {
    if (!isAdminRequest) return 0;
    if (isSessionProbe) return ADMIN_SESSION_TIMEOUT_MS;
    return SAFE_METHODS.has(method) ? ADMIN_READ_TIMEOUT_MS : ADMIN_WRITE_TIMEOUT_MS;
  }

  function cacheKey(url, method) { return `${method}:${url}`; }

  function responseFromSnapshot(snapshot) {
    return new Response(snapshot.body, {
      status: snapshot.status,
      statusText: snapshot.statusText,
      headers: snapshot.headers
    });
  }

  async function snapshotResponse(response) {
    return {
      body: await response.clone().text(),
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      storedAt: Date.now()
    };
  }

  function cachedResponse(key, maxAgeMs) {
    const snapshot = readCache.get(key);
    if (!snapshot) return null;
    if (Date.now() - snapshot.storedAt > maxAgeMs) {
      readCache.delete(key);
      return null;
    }
    return responseFromSnapshot(snapshot);
  }

  async function performFetch(input, options, context) {
    const { isAdminRequest, isSessionProbe, method, timeoutMs, externalSignal } = context;
    const controller = timeoutMs ? new AbortController() : null;
    const timeout = timeoutMs
      ? window.setTimeout(() => controller.abort(new DOMException('Administration request timed out.', 'TimeoutError')), timeoutMs)
      : null;

    if (controller && externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
    }

    try {
      const response = await nativeFetch(input, {
        ...options,
        credentials: isAdminRequest ? 'include' : (options.credentials || 'same-origin'),
        cache: isAdminRequest ? 'no-store' : (options.cache || 'default'),
        signal: controller?.signal || externalSignal
      });
      if (isAdminRequest && !isSessionProbe && response.status === 401) startSessionRecovery();
      if (isAdminRequest && response.ok && sessionRecoveryStarted && !SAFE_METHODS.has(method)) completeSessionRecovery();
      if (response.ok) return response;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) return response;
      const body = await response.clone().text().catch(() => '');
      const detail = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
      return new Response(JSON.stringify({
        error: `HTTP ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
        code: 'SRA_ADMIN_HTTP_REQUEST_FAILED',
        status: response.status
      }), {
        status: response.status,
        statusText: response.statusText,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      if (controller?.signal.aborted && !externalSignal?.aborted) {
        const seconds = Math.round(timeoutMs / 1000);
        const operation = SAFE_METHODS.has(method) ? 'read' : 'governed action';
        throw new Error(`Administration ${operation} timed out after ${seconds} seconds. The server did not confirm completion.`);
      }
      throw error;
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
    }
  }

  window.fetch = async (input, options = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const method = String(options.method || input?.method || 'GET').toUpperCase();
    const isAdminRequest = url.startsWith('/api/admin') || url.includes('/api/admin/');
    const isSessionProbe = url.includes('/api/admin/session') || url.includes('/api/admin/bootstrap-status');
    const timeoutMs = administrationTimeout({ isAdminRequest, isSessionProbe, method });
    const externalSignal = options.signal;
    const cacheableRead = isAdminRequest && method === 'GET' && !isSessionProbe && !externalSignal;
    const key = cacheKey(url, method);

    if (cacheableRead) {
      const maxAge = document.visibilityState === 'visible' ? ADMIN_READ_CACHE_TTL_MS : ADMIN_HIDDEN_CACHE_TTL_MS;
      const cached = cachedResponse(key, maxAge);
      if (cached) return cached;
      const existing = inFlightReads.get(key);
      if (existing) return responseFromSnapshot(await existing);

      const pending = performFetch(input, options, { isAdminRequest, isSessionProbe, method, timeoutMs, externalSignal })
        .then(async (response) => {
          const snapshot = await snapshotResponse(response);
          if (response.ok) readCache.set(key, snapshot);
          return snapshot;
        })
        .finally(() => inFlightReads.delete(key));
      inFlightReads.set(key, pending);
      return responseFromSnapshot(await pending);
    }

    const response = await performFetch(input, options, { isAdminRequest, isSessionProbe, method, timeoutMs, externalSignal });
    if (isAdminRequest && !SAFE_METHODS.has(method) && response.ok) {
      readCache.clear();
      window.dispatchEvent(new CustomEvent('sra-admin-data-changed'));
    }
    return response;
  };

  const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 8 }).format(Number(value || 0));

  async function enhanceFundingInstrumentControl() {
    if (enhancing || sessionRecoveryStarted || document.visibilityState !== 'visible') return;
    const current = document.querySelector('#funding-instrument-id');
    if (!current || current.dataset.canonicalSelector === 'true') return;
    enhancing = true;
    try {
      const response = await window.fetch('/api/admin/treasury/funding-instrument-deposits/eligible-instruments');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Unable to load instruments (${response.status}).`);
      const select = document.createElement('select');
      select.id = 'funding-instrument-id';
      select.dataset.canonicalSelector = 'true';
      select.setAttribute('aria-label', 'Platform commercial instrument');
      const instruments = Array.isArray(payload.instruments) ? payload.instruments : [];
      select.innerHTML = instruments.length
        ? instruments.map((instrument) => `<option value="${String(instrument.instrumentId).replaceAll('"', '&quot;')}" ${instrument.deposited ? 'disabled' : ''}>${instrument.instrumentId} · ${instrument.name} · ${money(instrument.faceValueUsd)}${instrument.deposited ? ' · DEPOSITED' : ''}</option>`).join('')
        : '<option value="">No eligible canonical instruments found</option>';
      current.replaceWith(select);
      const applyInstrument = () => {
        const instrument = instruments.find((item) => item.instrumentId === select.value);
        if (!instrument) return;
        const value = document.querySelector('#funding-instrument-value');
        const term = document.querySelector('#funding-instrument-term');
        if (value && Number(instrument.faceValueUsd) > 0) value.value = String(instrument.faceValueUsd);
        if (term && Number(instrument.termMonths) > 0) term.value = String(instrument.termMonths);
        const message = document.querySelector('#funding-instrument-message');
        if (message) message.textContent = `${instrument.instrumentId} selected. Canonical state: ${instrument.state}. Recorded face value: ${money(instrument.faceValueUsd)}.`;
      };
      select.addEventListener('change', applyInstrument);
      const firstEligible = instruments.find((item) => !item.deposited);
      if (firstEligible) select.value = firstEligible.instrumentId;
      applyInstrument();
    } catch (error) {
      const message = document.querySelector('#funding-instrument-message');
      if (message && !sessionRecoveryStarted) message.textContent = error.message;
    } finally {
      enhancing = false;
    }
  }

  function inspectButtons() {
    const buttons = [...document.querySelectorAll('#admin-view button')];
    for (const button of buttons) {
      if (!button.type) button.type = 'button';
      if (!button.title && button.disabled) button.title = 'This action is unavailable until its required inputs or lifecycle state are satisfied.';
    }
    void enhanceFundingInstrumentControl();
  }

  function scheduleButtonInspection() {
    if (inspectionScheduled) return;
    inspectionScheduled = true;
    window.requestAnimationFrame(() => {
      inspectionScheduled = false;
      inspectButtons();
    });
  }

  window.addEventListener('sra-admin-authenticated', completeSessionRecovery);
  window.addEventListener('sra-admin-data-changed', scheduleButtonInspection);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleButtonInspection();
  });
  const observer = new MutationObserver(scheduleButtonInspection);
  observer.observe(document.documentElement, { subtree: true, childList: true });
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', scheduleButtonInspection, { once: true });
  else scheduleButtonInspection();
})();
