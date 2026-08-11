(() => {
  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  async function request(path, options = {}) {
    const response = await fetch(path, {
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
    return payload;
  }

  function addStyle() {
    if (document.querySelector('#funding-verification-desk-style')) return;
    const style = document.createElement('style');
    style.id = 'funding-verification-desk-style';
    style.textContent = `
      .verification-desk{padding:20px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.025)}
      .verification-desk-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
      .verification-desk input,.verification-desk select,.verification-desk textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#101010;color:#fff}
      .verification-desk textarea{min-height:70px}.verification-desk-card{padding:14px;border-radius:13px;background:rgba(255,255,255,.04)}
      .verification-desk-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px}.verification-desk-result{margin-top:10px;font-size:13px}
      .verification-findings{display:grid;gap:7px;margin-top:10px}.verification-finding{padding:10px;border-radius:10px;background:rgba(255,255,255,.035);font-size:12px}
      .verification-status{font-size:12px;opacity:.75;margin-top:6px}
      @media(max-width:800px){.verification-desk-grid{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function selectedId(root) {
    return root.querySelector('#verification-opportunity')?.value || '';
  }

  async function loadOpportunity(root) {
    const opportunityId = selectedId(root);
    const detailRoot = root.querySelector('#verification-detail');
    if (!detailRoot) return;
    if (!opportunityId) {
      detailRoot.innerHTML = '<div class="funding-ops-empty">Select a financing opportunity.</div>';
      return;
    }
    detailRoot.innerHTML = '<div class="loading-state">Loading underwriting…</div>';
    try {
      let detail = await request(`/api/funding-operations/opportunities/${encodeURIComponent(opportunityId)}`);
      const opportunity = detail.opportunity;
      let requests = detail.verification?.requests || [];
      let latestRequest = requests[requests.length - 1] || null;
      if (latestRequest && ['PENDING', 'MORE_EVIDENCE_REQUIRED'].includes(latestRequest.status)) {
        await request(`/api/funding-verification/requests/${encodeURIComponent(latestRequest.verificationRequestId)}/start`, { method: 'POST', body: '{}' });
        detail = await request(`/api/funding-operations/opportunities/${encodeURIComponent(opportunityId)}`);
        requests = detail.verification?.requests || [];
        latestRequest = requests[requests.length - 1] || latestRequest;
      }
      const findings = detail.verification?.findings || [];
      const evidence = detail.intake?.evidence || [];
      const requestedChecks = latestRequest?.requestedChecks || [];
      const completedChecks = new Set(findings.map((finding) => finding.checkType));
      const remainingChecks = requestedChecks.filter((check) => !completedChecks.has(check));
      const canComplete = latestRequest?.status === 'IN_REVIEW' && remainingChecks.length === 0;

      detailRoot.innerHTML = `
        <div class="verification-desk-grid">
          <section class="verification-desk-card"><p class="eyebrow">TRANSACTION</p><strong>${esc(opportunity.title || opportunity.opportunityId)}</strong><p>${esc(opportunity.opportunityType || '')} · ${esc(opportunity.status)}</p><p class="verification-status">${evidence.length} supporting records · ${findings.length}/${requestedChecks.length} checks completed</p></section>
          <section class="verification-desk-card"><p class="eyebrow">UNDERWRITING STATUS</p><strong>${remainingChecks.length ? `${remainingChecks.length} checks remaining` : canComplete ? 'Ready to complete' : esc(latestRequest?.status || 'Preparing review')}</strong><p class="verification-status">Internal verification steps are handled behind this workspace.</p></section>
        </div>
        <section class="verification-desk-card" style="margin-top:12px"><p class="eyebrow">SUPPORTING EVIDENCE</p><div class="verification-desk-grid"><select id="verification-evidence-type"><option value="DOCUMENT">Document</option><option value="AGREEMENT">Agreement</option><option value="TRANSACTION">Transaction</option><option value="ASSET">Asset</option><option value="PROJECT">Project</option></select><input id="verification-evidence-title" placeholder="Evidence title"><input id="verification-source-reference" placeholder="Source reference" required><input id="verification-document-id" placeholder="Document ID, when applicable"><textarea id="verification-provenance" placeholder="Source details or note"></textarea></div><div class="verification-desk-actions"><button class="secondary-button" data-vaction="register-evidence">Add evidence</button></div></section>
        ${latestRequest?.status === 'IN_REVIEW' && remainingChecks.length ? `<section class="verification-desk-card" style="margin-top:12px"><p class="eyebrow">UNDERWRITING REVIEW</p><div class="verification-desk-grid"><select id="verification-check-type">${remainingChecks.map((check) => `<option value="${esc(check)}">${esc(check.replaceAll('_', ' '))}</option>`).join('')}</select><select id="verification-result"><option value="VERIFIED">Verified</option><option value="PARTIALLY_VERIFIED">Partially verified</option><option value="UNVERIFIED">Unverified</option><option value="CONFLICT">Conflict</option><option value="NOT_APPLICABLE">Not applicable</option></select><textarea id="verification-note" placeholder="Finding / underwriting note"></textarea></div><div class="verification-desk-actions"><button class="primary-button" data-vaction="record-finding">Save finding</button></div></section>` : ''}
        <section class="verification-desk-card" style="margin-top:12px"><p class="eyebrow">REVIEW RECORD</p><div class="verification-findings">${findings.length ? findings.map((finding) => `<div class="verification-finding"><strong>${esc(finding.checkType.replaceAll('_', ' '))}</strong> · ${esc(finding.result)}<br>${esc(finding.note || '')}</div>`).join('') : '<div class="funding-ops-empty">No findings recorded yet.</div>'}</div></section>
        <div class="verification-desk-actions">${canComplete ? '<button class="primary-button" data-vaction="verify">Complete underwriting</button>' : ''}<button class="secondary-button" data-vaction="more-evidence">Need additional information</button></div>
        <div class="verification-desk-result" id="verification-result-message"></div>`;

      const message = detailRoot.querySelector('#verification-result-message');
      detailRoot.querySelector('[data-vaction="register-evidence"]')?.addEventListener('click', async () => {
        try {
          await request(`/api/funding/opportunities/${encodeURIComponent(opportunityId)}/evidence`, { method: 'POST', body: JSON.stringify({ evidenceType: detailRoot.querySelector('#verification-evidence-type').value, title: detailRoot.querySelector('#verification-evidence-title').value || null, sourceReference: detailRoot.querySelector('#verification-source-reference').value, documentId: detailRoot.querySelector('#verification-document-id').value || null, provenance: { note: detailRoot.querySelector('#verification-provenance').value || null } }) });
          message.textContent = 'Evidence added.';
          setTimeout(() => loadOpportunity(root), 350);
        } catch (error) { message.textContent = error.message; }
      });
      detailRoot.querySelector('[data-vaction="record-finding"]')?.addEventListener('click', async () => {
        try {
          await request(`/api/funding-verification/requests/${encodeURIComponent(latestRequest.verificationRequestId)}/findings`, { method: 'POST', body: JSON.stringify({ checkType: detailRoot.querySelector('#verification-check-type').value, result: detailRoot.querySelector('#verification-result').value, note: detailRoot.querySelector('#verification-note').value || null }) });
          message.textContent = 'Finding saved.';
          setTimeout(() => loadOpportunity(root), 350);
        } catch (error) { message.textContent = error.message; }
      });
      detailRoot.querySelector('[data-vaction="verify"]')?.addEventListener('click', async () => {
        try {
          await request(`/api/funding-verification/requests/${encodeURIComponent(latestRequest.verificationRequestId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'VERIFIED', rationale: 'Underwriting review completed with all requested checks recorded.' }) });
          message.textContent = 'Underwriting completed. The opportunity is advancing.';
          document.dispatchEvent(new CustomEvent('sra:funding-operations-refresh'));
          setTimeout(() => loadOpportunity(root), 350);
        } catch (error) { message.textContent = error.message; }
      });
      detailRoot.querySelector('[data-vaction="more-evidence"]')?.addEventListener('click', async () => {
        try {
          await request(`/api/funding-verification/requests/${encodeURIComponent(latestRequest.verificationRequestId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'MORE_EVIDENCE_REQUIRED', rationale: 'Additional supporting information is required to complete underwriting.' }) });
          message.textContent = 'Additional information requested.';
          document.dispatchEvent(new CustomEvent('sra:funding-operations-refresh'));
          setTimeout(() => loadOpportunity(root), 350);
        } catch (error) { message.textContent = error.message; }
      });
    } catch (error) {
      detailRoot.innerHTML = `<strong>Underwriting workspace could not load.</strong><p>${esc(error.message)}</p>`;
    }
  }

  async function mount(fundingRoot) {
    if (!fundingRoot || fundingRoot.querySelector('#funding-verification-desk')) return;
    addStyle();
    try {
      const dashboard = await request('/api/funding-operations/dashboard');
      if (!fundingRoot.isConnected || fundingRoot.querySelector('#funding-verification-desk')) return;
      const section = document.createElement('section');
      section.className = 'verification-desk';
      section.id = 'funding-verification-desk';
      section.innerHTML = `<div class="funding-panel-head"><div><p class="eyebrow">UNDERWRITING</p><h3>Review financing opportunity</h3><p>Evidence, findings, and the underwriting result stay together in one workspace.</p></div></div><select id="verification-opportunity" style="margin-top:12px"><option value="">Select financing opportunity</option>${(dashboard.queue || []).map((item) => `<option value="${esc(item.opportunityId)}">${esc(item.title || item.opportunityId)}</option>`).join('')}</select><div id="verification-detail" style="margin-top:12px"><div class="funding-ops-empty">Select a financing opportunity.</div></div>`;
      fundingRoot.append(section);
      section.querySelector('#verification-opportunity')?.addEventListener('change', () => loadOpportunity(section));
    } catch (error) {
      const section = document.createElement('section');
      section.className = 'verification-desk';
      section.id = 'funding-verification-desk';
      section.innerHTML = `<strong>Underwriting workspace could not load.</strong><p>${esc(error.message)}</p>`;
      fundingRoot.append(section);
    }
  }

  window.mountFundingVerificationDesk = mount;
})();