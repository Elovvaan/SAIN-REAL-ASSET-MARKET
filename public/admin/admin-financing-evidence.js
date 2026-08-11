(() => {
  if (window.__sraAdminFinancingEvidenceInstalled) return;
  window.__sraAdminFinancingEvidenceInstalled = true;

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  let currentOpportunityId = null;

  function evidencePanel(root) {
    const detail = root?.querySelector('.funding-detail.open');
    if (!detail || !currentOpportunityId) return;
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

    const existing = [...detail.querySelectorAll('.funding-ops-panel')]
      .find((node) => node.textContent.includes('EVIDENCE & REFERENCES'));
    if (existing) existing.insertAdjacentElement('beforebegin', panel);
    else detail.append(panel);

    panel.querySelector('[data-admin-financing-evidence-form]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const result = panel.querySelector('[data-admin-financing-evidence-result]');
      const files = [...(form.querySelector('[name="documents"]')?.files || [])];
      if (!files.length) return;
      const body = new FormData();
      const documentType = form.querySelector('[name="documentType"]')?.value || 'FINANCING_SUPPORT';
      files.forEach((file) => {
        body.append('documents', file);
        body.append('documentTypes', documentType);
      });
      if (result) result.textContent = 'Attaching supporting documents…';
      try {
        const response = await fetch(`/api/funding/opportunities/${encodeURIComponent(currentOpportunityId)}/documents`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'x-sra-idempotency-key': `admin-financing-evidence-${currentOpportunityId}-${crypto.randomUUID()}` },
          body,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
        if (result) result.textContent = `${payload.records?.length || 0} supporting document(s) attached.`;
        form.reset();
        const row = root.querySelector(`[data-opportunity-id="${CSS.escape(currentOpportunityId)}"]`);
        row?.click();
      } catch (error) {
        if (result) result.textContent = esc(error.message);
      }
    });
  }

  function bind(root) {
    if (!root || root.dataset.adminFinancingEvidenceBound === 'true') return;
    root.dataset.adminFinancingEvidenceBound = 'true';
    root.addEventListener('click', (event) => {
      const row = event.target.closest('[data-opportunity-id]');
      if (row) currentOpportunityId = row.dataset.opportunityId || null;
      if (currentOpportunityId) setTimeout(() => evidencePanel(root), 0);
    }, true);
    const observer = new MutationObserver(() => evidencePanel(root));
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  window.addEventListener('sra:funding-operations-rendered', (event) => bind(event.detail?.root));
})();
