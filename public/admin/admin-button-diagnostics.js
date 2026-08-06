(() => {
  if (window.__sraAdminDiagnosticsInstalled) return;
  window.__sraAdminDiagnosticsInstalled = true;

  const ADMIN_REQUEST_TIMEOUT_MS = 20_000;
  const nativeFetch = window.fetch.bind(window);
  let sessionRecoveryStarted = false;
  let enhancing = false;

  function showSignedOutState() {
    const setupView = document.querySelector('#setup-view');
    const loginView = document.querySelector('#login-view');
    const adminView = document.querySelector('#admin-view');
    setupView?.classList.add('hidden');
    adminView?.classList.add('hidden');
    loginView?.classList.remove('hidden');
    const loginError = document.querySelector('#login-error');
    if (loginError) loginError.textContent = 'Your Platform Administration session expired. Sign in again to continue.';
  }

  function startSessionRecovery() {
    if (sessionRecoveryStarted) return;
    sessionRecoveryStarted = true;
    window.__sraAdminSessionExpired = true;
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
    document.querySelector('#sra-admin-sign-in-again')?.addEventListener('click', () => {
      notice.remove();
      document.querySelector('#email')?.focus();
    }, { once: true });
  }

  window.fetch = async (input, options = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const isAdminRequest = url.startsWith('/api/admin') || url.includes('/api/admin/');
    const isSessionProbe = url.includes('/api/admin/session') || url.includes('/api/admin/bootstrap-status');
    const controller = new AbortController();
    const externalSignal = options.signal;
    const timeout = window.setTimeout(() => controller.abort(new DOMException('Administration request timed out.', 'TimeoutError')), ADMIN_REQUEST_TIMEOUT_MS);
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
    }
    try {
      const response = await nativeFetch(input, {
        credentials: isAdminRequest ? 'include' : (options.credentials || 'same-origin'),
        cache: isAdminRequest ? 'no-store' : (options.cache || 'default'),
        ...options,
        signal: controller.signal
      });
      if (isAdminRequest && !isSessionProbe && response.status === 401) startSessionRecovery();
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
      if (controller.signal.aborted && !externalSignal?.aborted) throw new Error(`Administration request timed out after ${ADMIN_REQUEST_TIMEOUT_MS / 1000} seconds.`);
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 8 }).format(Number(value || 0));

  async function enhanceFundingInstrumentControl() {
    if (enhancing || sessionRecoveryStarted) return;
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

  const observer = new MutationObserver(inspectButtons);
  observer.observe(document.documentElement, { subtree: true, childList: true });
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', inspectButtons, { once: true });
  else inspectButtons();
})();
