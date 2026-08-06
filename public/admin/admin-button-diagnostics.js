(() => {
  if (window.__sraAdminDiagnosticsInstalled) return;
  window.__sraAdminDiagnosticsInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    const response = await nativeFetch(input, { credentials: 'same-origin', cache: 'no-store', ...options });
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
  };

  const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 8 }).format(Number(value || 0));
  let enhancing = false;

  async function enhanceFundingInstrumentControl() {
    if (enhancing) return;
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
      if (message) message.textContent = error.message;
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
