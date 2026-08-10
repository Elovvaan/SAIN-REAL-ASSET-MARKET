(() => {
  if (window.__sraFundingIdentityEvidenceInstalled) return;
  window.__sraFundingIdentityEvidenceInstalled = true;

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  let session = null;
  let currentOpportunityId = null;

  async function loadSession() {
    if (session) return session;
    const response = await fetch('/api/access/session', { headers: { accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.authenticated || !payload.session) throw new Error('Sign in to identify the funding applicant.');
    session = payload.session;
    return session;
  }

  function identifyApplicant(root, activeSession) {
    const input = root.querySelector('#funding-opportunity-form [name="applicantParticipantId"]');
    if (!input) return;
    input.value = activeSession.id || '';
    input.readOnly = true;
    input.setAttribute('aria-readonly', 'true');
    input.title = 'SRA binds this opportunity to the authenticated participant account.';
    if (!input.nextElementSibling?.classList?.contains('funding-authenticated-applicant')) {
      const note = document.createElement('div');
      note.className = 'funding-authenticated-applicant';
      note.style.cssText = 'font-size:12px;opacity:.72;align-self:center';
      note.innerHTML = `<strong>${esc(activeSession.displayName || activeSession.email || 'Authenticated participant')}</strong><br>${esc(activeSession.id || '')} · verified from signed-in SRA session`;
      input.insertAdjacentElement('afterend', note);
    }
  }

  function evidenceUploader(root) {
    if (!currentOpportunityId) return;
    const panel = root.querySelector('#funding-detail.open');
    if (!panel || panel.querySelector('[data-funding-evidence-upload]')) return;
    const section = document.createElement('section');
    section.className = 'funding-ops-panel';
    section.dataset.fundingEvidenceUpload = 'true';
    section.innerHTML = `
      <p class="eyebrow">PRIVATE INTAKE EVIDENCE</p>
      <h4>Upload supporting documents</h4>
      <p>PDFs and other accepted evidence are retained privately with the opportunity, hashed for integrity, and assigned a retention-review date instead of being kept indefinitely without review.</p>
      <form data-funding-document-form style="display:grid;gap:10px">
        <select name="documentType" style="padding:10px;background:#101010;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:10px">
          <option value="GOVERNMENT_ID">Government-issued ID</option>
          <option value="ENTITY_RECORDS">Business / entity records</option>
          <option value="PURCHASE_AGREEMENT">Purchase agreement</option>
          <option value="FINANCIAL_STATEMENTS">Financial statements</option>
          <option value="LEASE_WORKSPACE">Lease / workspace records</option>
          <option value="FINANCING_SUPPORT">Other financing support</option>
        </select>
        <input name="documents" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.doc,.docx,.txt" multiple required>
        <button class="secondary-button" type="submit">Upload private evidence</button>
        <div data-funding-document-result style="font-size:12px"></div>
      </form>`;
    const evidencePanel = [...panel.querySelectorAll('.funding-ops-panel')].find((node) => node.textContent.includes('EVIDENCE & REFERENCES'));
    if (evidencePanel) evidencePanel.insertAdjacentElement('beforebegin', section); else panel.append(section);
    section.querySelector('[data-funding-document-form]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const result = section.querySelector('[data-funding-document-result]');
      const form = event.currentTarget;
      const files = form.querySelector('[name="documents"]')?.files || [];
      if (!files.length) return;
      const body = new FormData();
      const type = form.querySelector('[name="documentType"]')?.value || 'FINANCING_SUPPORT';
      [...files].forEach((file) => { body.append('documents', file); body.append('documentTypes', type); });
      if (result) result.textContent = 'Uploading private evidence…';
      try {
        const response = await fetch(`/api/funding/opportunities/${encodeURIComponent(currentOpportunityId)}/documents`, { method: 'POST', body });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
        if (result) result.textContent = `${payload.records?.length || 0} document(s) retained and linked to ${currentOpportunityId}.`;
        form.reset();
      } catch (error) {
        if (result) result.textContent = error.message;
      }
    });
  }

  async function enhance(root) {
    if (!root) return;
    try { identifyApplicant(root, await loadSession()); } catch (error) {
      const input = root.querySelector('#funding-opportunity-form [name="applicantParticipantId"]');
      if (input) { input.value = ''; input.readOnly = true; input.placeholder = error.message; }
    }
    if (root.dataset.fundingIdentityEvidenceBound === 'true') return;
    root.dataset.fundingIdentityEvidenceBound = 'true';
    root.addEventListener('click', (event) => {
      const row = event.target.closest('[data-opportunity-id]');
      if (row) currentOpportunityId = row.dataset.opportunityId || null;
      if (currentOpportunityId) setTimeout(() => evidenceUploader(root), 0);
    }, true);
    const observer = new MutationObserver(() => evidenceUploader(root));
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  window.addEventListener('sra:funding-operations-rendered', (event) => void enhance(event.detail?.root));
})();
