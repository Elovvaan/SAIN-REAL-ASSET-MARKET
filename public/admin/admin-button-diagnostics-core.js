(() => {
  if (window.__sraAdminDiagnosticsInstalled) return;
  window.__sraAdminDiagnosticsInstalled = true;

  let sessionRecoveryStarted = false;
  let enhancing = false;
  let inspectionScheduled = false;

  const adminView = () => document.querySelector('#admin-view');
  const dataClient = () => window.SRAAdminDataClient;

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
    document.querySelector('#sra-admin-session-expired')?.remove();
    unlockAdminWorkspace();
    window.setTimeout(() => {
      scheduleButtonInspection();
      void enhanceFundingInstrumentControl();
    }, 0);
  }

  const money = (value) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 8,
  }).format(Number(value || 0));

  async function enhanceFundingInstrumentControl() {
    if (enhancing || sessionRecoveryStarted || document.visibilityState !== 'visible') return;
    const current = document.querySelector('#funding-instrument-id');
    if (!current || current.dataset.canonicalSelector === 'true') return;
    const client = dataClient();
    if (!client) return;

    enhancing = true;
    try {
      const payload = await client.json('/api/admin/treasury/funding-instrument-deposits/eligible-instruments');
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

  window.addEventListener('sra-admin-session-expired', startSessionRecovery);
  window.addEventListener('sra-admin-session-restored', completeSessionRecovery);
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
