(() => {
  if (window.__sraAdminFinancingEvidenceInstalled) return;
  window.__sraAdminFinancingEvidenceInstalled = true;

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  let currentOpportunityId = null;

  async function jsonRequest(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }

  function reopen(root) {
    const row = root.querySelector(`[data-opportunity-id="${CSS.escape(currentOpportunityId)}"]`);
    row?.click();
  }

  function detailReady(detail) {
    if (!detail) return false;
    return [...detail.querySelectorAll('.funding-ops-panel')]
      .some((node) => node.textContent.includes('EVIDENCE & REFERENCES'));
  }

  function removeDuplicateWorkflowPanels(detail) {
    const panels = [...detail.querySelectorAll('[data-admin-financing-workflow]')];
    panels.slice(1).forEach((panel) => panel.remove());
  }

  function mountEvidence(root, detail) {
    if (detail.querySelector('[data-admin-financing-evidence]')) return;
    const panel = document.createElement('section');
    panel.className = 'funding-ops-panel';
    panel.dataset.adminFinancingEvidence = 'true';
    panel.innerHTML = `
      <p class="eyebrow">SUPPORTING DOCUMENTS</p>
      <h4>Financing file</h4>
      <form data-admin-financing-evidence-form style="display:grid;gap:10px">
        <select name="documentType" style="padding:10px;background:#101010;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:10px">
          <option value="FINANCIAL_STATEMENTS">Financial statements</option>
          <option value="PROFIT_AND_LOSS">Profit and loss statement</option>
          <option value="BALANCE_SHEET">Balance sheet</option>
          <option value="BANK_STATEMENTS">Bank statements</option>
          <option value="TAX_RETURNS">Tax returns</option>
          <option value="PURCHASE_AGREEMENT">Purchase agreement</option>
          <option value="LEASE_RENT_ROLL">Lease / rent roll</option>
          <option value="APPRAISAL_VALUATION">Appraisal / valuation</option>
          <option value="ENTITY_RECORDS">Entity records</option>
          <option value="FINANCING_SUPPORT">Other financing support</option>
        </select>
        <input name="documents" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.doc,.docx,.txt" multiple required>
        <button class="secondary-button" type="submit">Attach supporting documents</button>
        <div data-admin-financing-evidence-result style="font-size:12px"></div>
      </form>`;
    const evidence = [...detail.querySelectorAll('.funding-ops-panel')].find((node) => node.textContent.includes('EVIDENCE & REFERENCES'));
    if (evidence) evidence.insertAdjacentElement('beforebegin', panel);
    else detail.append(panel);

    panel.querySelector('form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const result = panel.querySelector('[data-admin-financing-evidence-result]');
      const files = [...(form.querySelector('[name="documents"]')?.files || [])];
      if (!files.length) return;
      const body = new FormData();
      const documentType = form.querySelector('[name="documentType"]')?.value || 'FINANCING_SUPPORT';
      files.forEach((file) => { body.append('documents', file); body.append('documentTypes', documentType); });
      if (result) result.textContent = 'Attaching supporting documents…';
      try {
        const response = await fetch(`/api/funding/opportunities/${encodeURIComponent(currentOpportunityId)}/documents`, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'x-sra-idempotency-key': `admin-financing-evidence-${currentOpportunityId}-${crypto.randomUUID()}` }, body,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
        form.reset();
        reopen(root);
      } catch (error) {
        if (result) result.textContent = esc(error.message);
      }
    });
  }

  async function mountWorkflow(root, detail) {
    removeDuplicateWorkflowPanels(detail);
    if (detail.querySelector('[data-admin-financing-workflow]')) return;

    const opportunityId = currentOpportunityId;
    if (!opportunityId) return;
    if (detail.dataset.adminFinancingWorkflowMounting === opportunityId) return;
    detail.dataset.adminFinancingWorkflowMounting = opportunityId;

    try {
      const opportunity = await jsonRequest(`/api/funding/opportunities/${encodeURIComponent(opportunityId)}`);
      if (!detail.isConnected || currentOpportunityId !== opportunityId) return;

      removeDuplicateWorkflowPanels(detail);
      if (detail.querySelector('[data-admin-financing-workflow]')) return;

      const stage = String(opportunity.financingStage || 'APPLICATION').toUpperCase();
      const panel = document.createElement('section');
      panel.className = 'funding-ops-panel';
      panel.dataset.adminFinancingWorkflow = 'true';
      panel.dataset.opportunityId = opportunityId;

      if (stage === 'UNDERWRITING') {
        panel.innerHTML = `<p class="eyebrow">UNDERWRITING</p><h4>Underwriting review</h4>
          <form data-underwriting-form style="display:grid;gap:10px">
            <input name="recommendedAmount" type="number" min="1" max="${Number(opportunity.requestedAmount || 0)}" step="0.01" value="${Number(opportunity.requestedAmount || 0)}" required>
            <textarea name="conclusion" placeholder="Underwriting conclusion" style="min-height:90px"></textarea>
            <button class="primary-button" type="submit">Complete underwriting</button><div data-result style="font-size:12px"></div>
          </form>`;
        panel.querySelector('form')?.addEventListener('submit', async (event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget); const result = panel.querySelector('[data-result]');
          try {
            if (result) result.textContent = 'Completing underwriting…';
            await jsonRequest(`/api/funding/opportunities/${encodeURIComponent(opportunityId)}/underwriting`, { method: 'POST', body: JSON.stringify({ recommendedAmount: Number(data.get('recommendedAmount')), conclusion: data.get('conclusion') || null }) });
            reopen(root);
          } catch (error) { if (result) result.textContent = esc(error.message); }
        });
      } else if (stage === 'DECISION') {
        const amount = Number(opportunity.underwriting?.recommendedAmount || opportunity.requestedAmount || 0);
        panel.innerHTML = `<p class="eyebrow">CREDIT DECISION</p><h4>Record credit decision</h4>
          <form data-credit-decision-form style="display:grid;gap:10px">
            <select name="decision"><option value="APPROVE">Approve</option><option value="DECLINE">Decline</option></select>
            <input name="approvedAmount" type="number" min="1" max="${Number(opportunity.requestedAmount || 0)}" step="0.01" value="${amount}">
            <textarea name="rationale" placeholder="Decision rationale" style="min-height:90px"></textarea>
            <button class="primary-button" type="submit">Record credit decision</button><div data-result style="font-size:12px"></div>
          </form>`;
        panel.querySelector('form')?.addEventListener('submit', async (event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget); const result = panel.querySelector('[data-result]');
          try {
            if (result) result.textContent = 'Recording credit decision…';
            await jsonRequest(`/api/funding/opportunities/${encodeURIComponent(opportunityId)}/credit-decision`, { method: 'POST', body: JSON.stringify({ decision: data.get('decision'), approvedAmount: Number(data.get('approvedAmount')), rationale: data.get('rationale') || null }) });
            reopen(root);
          } catch (error) { if (result) result.textContent = esc(error.message); }
        });
      } else {
        const message = stage === 'CLOSING' ? 'Credit decision recorded. Financing is now in Closing.' : stage === 'CLOSED' ? 'Financing record is closed.' : `Current financing stage: ${stage}.`;
        panel.innerHTML = `<p class="eyebrow">FINANCING STATUS</p><h4>${esc(stage)}</h4><p>${esc(message)}</p>`;
      }

      const evidence = [...detail.querySelectorAll('.funding-ops-panel')].find((node) => node.textContent.includes('EVIDENCE & REFERENCES'));
      if (evidence) evidence.insertAdjacentElement('afterend', panel);
      else detail.append(panel);
      removeDuplicateWorkflowPanels(detail);
    } finally {
      if (detail.dataset.adminFinancingWorkflowMounting === opportunityId) {
        delete detail.dataset.adminFinancingWorkflowMounting;
      }
    }
  }

  function mountSoon(root, attempts = 30) {
    const detail = root?.querySelector('.funding-detail.open');
    if (!detail || !currentOpportunityId || !detailReady(detail)) {
      if (attempts > 0) setTimeout(() => mountSoon(root, attempts - 1), 100);
      return;
    }
    removeDuplicateWorkflowPanels(detail);
    mountEvidence(root, detail);
    void mountWorkflow(root, detail).catch(() => {});
  }

  function bind(root) {
    if (!root || root.dataset.adminFinancingEvidenceBound === 'true') return;
    root.dataset.adminFinancingEvidenceBound = 'true';
    root.addEventListener('click', (event) => {
      const row = event.target.closest('[data-opportunity-id]');
      if (!row) return;
      currentOpportunityId = row.dataset.opportunityId || null;
      if (currentOpportunityId) setTimeout(() => mountSoon(root), 0);
    }, true);
    const observer = new MutationObserver(() => {
      if (currentOpportunityId) mountSoon(root, 2);
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function init() { bind(document.querySelector('[data-workspace="operations"]')); }
  init();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  window.addEventListener('sra:funding-operations-rendered', (event) => bind(event.detail?.root));
})();
