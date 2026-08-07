(() => {
  if (window.__sraInstrumentApprovalsInstalled) return;
  window.__sraInstrumentApprovalsInstalled = true;

  const pendingStates = new Set(['DRAFT','PENDING','PENDING_REVIEW','IN_REVIEW','REVIEW_REQUIRED','AWAITING_APPROVAL']);
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
      button.classList.remove('primary');
      button.disabled = true;
      window.dispatchEvent(new CustomEvent('sra:admin-mutated', { detail: { source: 'instrument-approval', instrumentId } }));
      if (typeof window.sraRefreshAdministration === 'function') await window.sraRefreshAdministration();
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
    const activeTab = workspace.dataset.activeTab || '';
    workspace.querySelectorAll('.admin-record-card').forEach((card) => {
      const state = String(card.querySelector('header em')?.textContent || '').trim().toUpperCase();
      const instrumentId = String(card.querySelector('header strong')?.textContent || '').trim();
      const existing = card.querySelector('[data-instrument-approve]');
      if (activeTab !== 'Pending Review' || !pendingStates.has(state)) {
        existing?.remove();
        return;
      }
      if (existing || !instrumentId) return;
      const action = document.createElement('div');
      action.className = 'admin-instrument-action';
      action.innerHTML = `<button type="button" class="primary" data-instrument-approve="${instrumentId.replaceAll('"','&quot;')}">Approve</button>`;
      action.querySelector('button').addEventListener('click', (event) => void approve(instrumentId, event.currentTarget));
      card.append(action);
    });
  }

  const style = document.createElement('style');
  style.textContent = '.admin-instrument-action{display:flex;justify-content:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid #242424}.admin-instrument-action button{min-width:96px}';
  document.head.append(style);

  const observer = new MutationObserver(decorate);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-admin-tab],[data-admin-workspace],[data-refresh-workspace]')) queueMicrotask(decorate);
  });
  decorate();
})();
