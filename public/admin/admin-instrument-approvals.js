(() => {
  if (window.__sraInstrumentApprovalsInstalled) return;
  window.__sraInstrumentApprovalsInstalled = true;

  const pendingStates = new Set(['DRAFT','PENDING','PENDING_REVIEW','IN_REVIEW','REVIEW_REQUIRED','AWAITING_APPROVAL']);
  let busy = false;

  async function requestJson(url, options = {}) {
    if (window.SRAAdminDataClient) return window.SRAAdminDataClient.json(url, options);
    const response = await fetch(url, {
      ...options,
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }

  async function approvePending(button) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.textContent = 'Approving...';
    try {
      const workspace = await requestJson(`/api/admin/workspaces?limit=100&_=${Date.now()}`);
      const pending = Array.isArray(workspace?.records?.instruments)
        ? workspace.records.instruments.filter((instrument) => pendingStates.has(String(instrument?.state || instrument?.status || '').toUpperCase()))
        : [];

      if (!pending.length) {
        window.alert('There are no pending instruments to approve.');
        return;
      }
      if (!window.confirm(`Approve ${pending.length} pending instrument${pending.length === 1 ? '' : 's'}?`)) return;

      for (const instrument of pending) {
        const instrumentId = instrument.instrumentId || instrument.id;
        if (!instrumentId) continue;
        await requestJson('/api/admin/listing-readiness-batch/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approval: 'APPROVE', instrumentId }),
        });
      }

      window.SRAAdminDataClient?.refresh('instrument-approval');
      document.querySelector('[data-workspace="instruments"] [data-refresh-workspace="instruments"]')?.click();
    } catch (error) {
      window.alert(error.message || 'Instrument approval failed.');
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = 'Approve';
    }
  }

  function installButton() {
    const workspace = document.querySelector('[data-workspace="instruments"]');
    if (!workspace) return false;
    const tabs = workspace.querySelector('.admin-workspace-tabs');
    if (!tabs || tabs.querySelector('[data-instrument-approve-top]')) return Boolean(tabs);
    const history = [...tabs.querySelectorAll('[data-admin-tab]')].find((button) => button.dataset.adminTab === 'History');
    if (!history) return false;

    const approve = document.createElement('button');
    approve.type = 'button';
    approve.textContent = 'Approve';
    approve.dataset.instrumentApproveTop = 'true';
    approve.className = 'admin-instrument-approve-top';
    approve.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void approvePending(approve);
    });
    history.insertAdjacentElement('afterend', approve);
    return true;
  }

  const style = document.createElement('style');
  style.textContent = '.admin-instrument-approve-top{background:#d6a92f!important;color:#090909!important;border-color:#d6a92f!important;font-weight:800!important}';
  document.head.append(style);

  if (!installButton()) window.addEventListener('sra:admin-booted', installButton, { once: true });
})();
