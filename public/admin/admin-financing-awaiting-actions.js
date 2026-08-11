(() => {
  if (window.__sraAdminFinancingAwaitingActionsInstalled) return;
  window.__sraAdminFinancingAwaitingActionsInstalled = true;

  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const money = (value) => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const LEGACY_STAGE_MAP = Object.freeze({
    DRAFT: 'APPLICATION', INTAKE_IN_PROGRESS: 'APPLICATION', INTAKE_COMPLETE: 'UNDERWRITING',
    PENDING_VERIFICATION: 'UNDERWRITING', VERIFICATION_IN_PROGRESS: 'UNDERWRITING', MORE_EVIDENCE_REQUIRED: 'UNDERWRITING', VERIFIED: 'UNDERWRITING',
    VALUE_PREPARED: 'UNDERWRITING', FUNDING_MODEL_SELECTED: 'UNDERWRITING', INSTRUMENT_REVIEWED: 'UNDERWRITING', ISSUANCE_REQUESTED: 'DECISION',
    APPROVED: 'CLOSING', READY_TO_FUND: 'READY_TO_FUND', FUNDED: 'FUNDED', ACTIVE: 'SERVICING', PAID_OFF: 'CLOSED', CLOSED: 'CLOSED', WITHDRAWN: 'CLOSED', VERIFICATION_CLOSED: 'CLOSED', REJECTED: 'CLOSED',
  });

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }

  function operationsRoot() {
    return document.querySelector('[data-workspace="operations"]');
  }

  function awaitingActive(root) {
    return root?.dataset.activeTab === 'Awaiting Actions';
  }

  function financingStage(record = {}) {
    const status = String(record.status || '').toUpperCase();
    if (['WITHDRAWN', 'CLOSED', 'PAID_OFF', 'VERIFICATION_CLOSED', 'REJECTED'].includes(status)) return 'CLOSED';
    const explicit = String(record.financingStage || '').toUpperCase();
    if (explicit === 'DOCUMENTATION' || explicit === 'VERIFICATION') return 'UNDERWRITING';
    if (['APPLICATION', 'UNDERWRITING', 'DECISION', 'CLOSING', 'READY_TO_FUND', 'FUNDED', 'SERVICING', 'CLOSED'].includes(explicit)) return explicit;
    return LEGACY_STAGE_MAP[status] || 'APPLICATION';
  }

  function ensureStyles() {
    if (document.querySelector('#admin-financing-awaiting-actions-style')) return;
    const style = document.createElement('style');
    style.id = 'admin-financing-awaiting-actions-style';
    style.textContent = `
      .financing-awaiting{display:grid;gap:12px}.financing-awaiting-card{border:1px solid #292929;border-radius:14px;padding:16px;background:#080808}.financing-awaiting-card header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.financing-awaiting-card header strong{font-size:15px}.financing-awaiting-card header em{font-style:normal;color:#d6a92f;font-size:11px;font-weight:800}.financing-awaiting-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.financing-awaiting-meta div{border:1px solid #242424;border-radius:10px;padding:10px}.financing-awaiting-meta span{display:block;color:#999;font-size:9px;text-transform:uppercase}.financing-awaiting-meta b{display:block;margin-top:4px}.financing-awaiting-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.financing-awaiting-actions input,.financing-awaiting-actions select,.financing-awaiting-actions button{width:100%;box-sizing:border-box}.financing-awaiting-message{margin-top:10px;color:#aaa;font-size:12px}.financing-awaiting-error{color:#d98b8b}.financing-awaiting-empty{border:1px dashed #4a3c19;border-radius:14px;padding:24px;color:#aaa}@media(max-width:900px){.financing-awaiting-meta,.financing-awaiting-actions{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function closingForOpportunity(closings, opportunityId) {
    return closings.find((record) => record.opportunityId === opportunityId && record.status !== 'CANCELLED') || null;
  }

  function actionCard(opportunity, closing, financing) {
    const stage = financingStage(opportunity);
    const approvedAmount = opportunity.creditDecision?.approvedAmount || opportunity.requestedAmount || closing?.approvedAmount || financing?.amount || 0;
    const id = opportunity.opportunityId;
    let action = '';
    let explanation = '';

    if (!closing) {
      if (financing) {
        action = `<button type="button" data-open-financing-closing="${esc(id)}" data-financing-id="${esc(financing.transactionId)}">Open closing</button>`;
        explanation = 'Credit decision is complete. Open the existing governed financing closing record.';
      } else {
        explanation = 'Credit decision is complete. A posted loan financing authorization is required before the existing closing service can open a closing record.';
      }
    } else if (closing.status === 'IN_PROGRESS') {
      action = `<div class="financing-awaiting-actions"><input data-closing-beneficiary="${esc(closing.closingId)}" value="${esc(closing.beneficiaryName || '')}" placeholder="Beneficiary name"><select data-closing-rail="${esc(closing.closingId)}"><option value="ACH"${closing.settlementMethod === 'ACH' ? ' selected' : ''}>ACH</option><option value="FEDWIRE"${closing.settlementMethod === 'FEDWIRE' ? ' selected' : ''}>Fedwire</option><option value="BANK_WIRE"${closing.settlementMethod === 'BANK_WIRE' ? ' selected' : ''}>Bank wire</option></select><button type="button" data-ready-financing-closing="${esc(closing.closingId)}" data-amount="${esc(closing.finalFundingAmount || closing.approvedAmount)}">Mark Ready to Fund</button></div>`;
      explanation = 'Complete closing conditions and confirm the beneficiary, funding amount, and settlement rail.';
    } else if (closing.status === 'READY_TO_FUND') {
      action = `<button type="button" data-authorize-financing-closing="${esc(closing.closingId)}">Authorize funding and create export package</button>`;
      explanation = 'Closing is ready to fund. Explicit administrator funding authorization creates the financing disbursement and export package.';
    } else if (closing.status === 'AUTHORIZED') {
      explanation = `Funding is authorized${closing.exportPackageId ? ` and export package ${closing.exportPackageId} is ready for settlement instructions` : ''}.`;
    } else if (closing.status === 'FUNDED') {
      explanation = 'External settlement has been recorded and the financing is funded.';
    } else {
      explanation = `Closing is currently ${closing.status}.`;
    }

    return `<article class="financing-awaiting-card" data-financing-awaiting="${esc(id)}"><header><strong>${esc(opportunity.title || opportunity.name || 'Financing opportunity')}</strong><em>${esc(closing?.status || stage)}</em></header><div class="financing-awaiting-meta"><div><span>Opportunity</span><b>${esc(id)}</b></div><div><span>Approved financing</span><b>${esc(money(approvedAmount))}</b></div><div><span>Closing</span><b>${esc(closing?.closingId || 'Not opened')}</b></div></div><div class="financing-awaiting-message">${esc(explanation)}</div>${action}<div class="financing-awaiting-message" data-financing-action-result="${esc(id)}"></div></article>`;
  }

  async function authorizationForOpportunity(opportunityId) {
    const payload = await request(`/api/financing-closing/authorizations?opportunityId=${encodeURIComponent(opportunityId)}`);
    return payload.record || null;
  }

  async function load() {
    const root = operationsRoot();
    if (!root || !awaitingActive(root)) return;
    ensureStyles();
    const recordsRoot = root.querySelector('.admin-workspace-records');
    if (!recordsRoot) return;
    recordsRoot.innerHTML = '<div class="financing-awaiting-empty">Loading financing actions…</div>';
    try {
      const [opportunitiesPayload, closingsPayload] = await Promise.all([
        request('/api/funding/opportunities'),
        request('/api/financing-closing/closings'),
      ]);
      const opportunities = (opportunitiesPayload.records || []).filter((record) => ['CLOSING', 'READY_TO_FUND'].includes(financingStage(record)));
      const closings = closingsPayload.records || [];
      const authorizations = new Map(await Promise.all(opportunities.map(async (opportunity) => [opportunity.opportunityId, await authorizationForOpportunity(opportunity.opportunityId)])));
      const cards = opportunities.map((opportunity) => actionCard(opportunity, closingForOpportunity(closings, opportunity.opportunityId), authorizations.get(opportunity.opportunityId)));
      const orphanClosings = closings.filter((closing) => ['IN_PROGRESS', 'READY_TO_FUND', 'AUTHORIZED'].includes(closing.status) && !opportunities.some((opportunity) => opportunity.opportunityId === closing.opportunityId));
      for (const closing of orphanClosings) {
        const financing = closing.opportunityId ? await authorizationForOpportunity(closing.opportunityId) : null;
        cards.push(actionCard({ opportunityId: closing.opportunityId || closing.financingTransactionId, title: 'Financing closing', financingStage: closing.status, requestedAmount: closing.approvedAmount }, closing, financing));
      }
      recordsRoot.innerHTML = cards.length ? `<div class="financing-awaiting">${cards.join('')}</div>` : '<div class="financing-awaiting-empty">No financing closing or funding authorization action is currently waiting.</div>';
    } catch (error) {
      recordsRoot.innerHTML = `<div class="financing-awaiting-empty financing-awaiting-error">${esc(error.message)}</div>`;
    }
  }

  async function act(button) {
    const card = button.closest('[data-financing-awaiting]');
    const result = card?.querySelector('[data-financing-action-result]');
    button.disabled = true;
    if (result) result.textContent = 'Processing…';
    try {
      if (button.matches('[data-open-financing-closing]')) {
        await request('/api/financing-closing/closings', { method: 'POST', body: JSON.stringify({ financingTransactionId: button.dataset.financingId }) });
      } else if (button.matches('[data-ready-financing-closing]')) {
        const closingId = button.dataset.readyFinancingClosing;
        const beneficiaryName = card.querySelector(`[data-closing-beneficiary="${CSS.escape(closingId)}"]`)?.value || '';
        const settlementMethod = card.querySelector(`[data-closing-rail="${CSS.escape(closingId)}"]`)?.value || '';
        await request(`/api/financing-closing/closings/${encodeURIComponent(closingId)}/ready`, { method: 'POST', body: JSON.stringify({ finalFundingAmount: Number(button.dataset.amount), beneficiaryName, settlementMethod }) });
      } else if (button.matches('[data-authorize-financing-closing]')) {
        const closingId = button.dataset.authorizeFinancingClosing;
        await request(`/api/financing-closing/closings/${encodeURIComponent(closingId)}/authorize`, { method: 'POST', body: JSON.stringify({ approval: 'APPROVE' }) });
      }
      window.dispatchEvent(new CustomEvent('sra:admin-refresh', { detail: { source: 'FINANCING_AWAITING_ACTION' } }));
      await load();
    } catch (error) {
      if (result) { result.textContent = error.message; result.classList.add('financing-awaiting-error'); }
      button.disabled = false;
    }
  }

  function mount(root = operationsRoot()) {
    if (!root || root.dataset.financingAwaitingActionsBound === 'true') return;
    root.dataset.financingAwaitingActionsBound = 'true';
    root.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-admin-tab="Awaiting Actions"]');
      if (tab) setTimeout(() => void load(), 0);
      const button = event.target.closest('[data-open-financing-closing],[data-ready-financing-closing],[data-authorize-financing-closing]');
      if (button) { event.preventDefault(); void act(button); }
    });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => {
      if (event.detail?.workspaceId === 'operations' && awaitingActive(root)) void load();
    });
    if (awaitingActive(root)) void load();
  }

  window.mountAdminFinancingAwaitingActions = mount;
  window.addEventListener('sra:admin-booted', () => mount());
})();
