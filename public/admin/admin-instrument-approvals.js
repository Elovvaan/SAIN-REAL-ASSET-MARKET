(() => {
  if (window.__sraInstrumentApprovalsInstalled) return;
  window.__sraInstrumentApprovalsInstalled = true;

  const pendingStates = new Set(['DRAFT','PENDING','PENDING_REVIEW','IN_REVIEW','REVIEW_REQUIRED','AWAITING_APPROVAL']);
  const instrumentTabs = new Set(['Overview','Pending Review']);
  const busy = new Set();

  async function approve(instrumentId, button) {
    if (!instrumentId || busy.has(instrumentId)) return;
    if (!window.confirm(`Approve instrument ${instrumentId}?`)) return;
    busy.add(instrumentId);
    button.disabled = true;
    button.textContent = 'Approving...';
    try {
      const response = await fetch('/api/admin/listing-readiness-batch/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ approval: 'APPROVE', instrumentId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Approval failed with ${response.status}.`);
      button.textContent = 'Approved';
      button.disabled = true;
      window.dispatchEvent(new CustomEvent('sra:admin-mutated', {
        detail: { source: 'instrument-approval', instrumentId },
      }));
      const refresh = document.querySelector('[data-workspace="instruments"] [data-refresh-workspace="instruments"]');
      if (refresh) refresh.click();
      else window.location.reload();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Approve';
      window.alert(error.message || 'Instrument approval failed.');
    } finally {
      busy.delete(instrumentId);
    }
  }

  function decorate() {
    const workspace = document.querySelector('[data-workspace="instruments"]');
    if (!workspace) return;
    const activeTab = workspace.dataset.activeTab || 'Overview';
    workspace.querySelectorAll('.admin-record-card').forEach((card) => {
      const state = String(card.querySelector('header em')?.textContent || '').trim().toUpperCase();
      const instrumentId = String(card.querySelector('header strong')?.textContent || '').trim();
      const existing = card.querySelector('[data-instrument-approve]');
      if (!instrumentTabs.has(activeTab) || !pendingStates.has(state)) {
        existing?.closest('.admin-instrument-action')?.remove();
        return;
      }
      if (existing || !instrumentId) return;
      const action = document.createElement('div');
      action.className = 'admin-instrument-action';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'primary';
      button.dataset.instrumentApprove = instrumentId;
      button.textContent = 'Approve';
      button.addEventListener('click', () => void approve(instrumentId, button));
      action.append(button);
      card.append(action);
    });
  }

  const style = document.createElement('style');
  style.textContent = '.admin-instrument-action{display:flex;justify-content:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid #242424}.admin-instrument-action button{min-width:110px;background:#d6a92f;color:#090909;border-color:#d6a92f;font-weight:800}';
  document.head.append(style);

  const observer = new MutationObserver(decorate);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-admin-tab],[data-admin-workspace],[data-refresh-workspace]')) {
      queueMicrotask(decorate);
    }
  });
  decorate();
})();