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
      detailRoot.innerHTML = '<div class="funding-ops-empty">Select a funding opportunity.</div>';
      return;
    }
    detailRoot.innerHTML = '<div class="loading-state">Loading verification workspace…</div>';
    try {
      const detail = await request(`/api/funding-operations/opportunities/${encodeURIComponent(opportunityId)}`);
      const opportunity = detail.opportunity;
      const requests = detail.verification?.requests || [];
      const latestRequest = requests[requests.length - 1] || null;
      const findings = detail.verification?.findings || [];
      const evidence = detail.intake?.evidence || [];
      detailRoot.innerHTML = `
        <div class="verification-desk-grid">
          <section class="verification-desk-card"><p class="eyebrow">OPPORTUNITY</p><strong>${esc(opportunity.title || opportunity.opportunityId)}</strong><p>${esc(opportunity.status)} · ${esc(opportunity.fundingPhase || '')}</p><p>${evidence.length} evidence records · ${requests.length} verification requests</p></section>
          <section class="verification-desk-card"><p class="eyebrow">CURRENT REQUEST</p><strong>${esc(latestRequest?.verificationRequestId || 'Not created')}</strong><p>${esc(latestRequest?.status || 'No verification request')}</p><div class="verification-desk-actions">${latestRequest?.status === 'PENDING' || latestRequest?.status === 'MORE_EVIDENCE_REQUIRED' ? '<button class="primary-button" data-vaction="start-review">Start review</button>' : ''}${latestRequest?.status === 'IN_REVIEW' ? '<button class="primary-button" data-vaction="verify">Record verified decision</button><button class="secondary-button" data-vaction="more-evidence">Require more evidence</button>' : ''}</div></section>
        </div>
        <section class="verification-desk-card" style="margin-top:12px"><p class="eyebrow">REGISTER EVIDENCE</p><div class="verification-desk-grid"><select id="verification-evidence-type"><option value="DOCUMENT">Document</option><option value="AGREEMENT">Agreement</option><option value="TRANSACTION">Transaction</option><option value="ASSET">Asset</option><option value="PROJECT">Project</option></select><input id="verification-evidence-title" placeholder="Evidence title"><input id="verification-source-reference" placeholder="Source reference" required><input id="verification-document-id" placeholder="Document ID, when applicable"><textarea id="verification-provenance" placeholder="Provenance note or source details"></textarea></div><div class="verification-desk-actions"><button class="primary-button" data-vaction="register-evidence">Register evidence</button></div></section>
        ${latestRequest?.status === 'IN_REVIEW' ? `<section class="verification-desk-card" style="margin-top:12px"><p class="eyebrow">RECORD FINDING</p><div class="verification-desk-grid"><select id="verification-check-type">${(latestRequest.requestedChecks || []).map((check) => `<option value="${esc(check)}">${esc(check.replaceAll('_', ' '))}</option>`).join('')}</select><select id="verification-result"><option value="VERIFIED">Verified</option><option value="PARTIALLY_VERIFIED">Partially verified</option><option value="UNVERIFIED">Unverified</option><option value="CONFLICT">Conflict</option><option value="NOT_APPLICABLE">Not applicable</option></select><textarea id="verification-note" placeholder="Finding note"></textarea></div><div class="verification-desk-actions"><button class="primary-button" data-vaction="record-finding">Record finding</button></div></section>` : ''}
        <section class="verification-desk-card" style="margin-top:12px"><p class="eyebrow">FINDINGS</p><div class="verification-findings">${findings.length ? findings.map((finding) => `<div class="verification-finding"><strong>${esc(finding.checkType)}</strong> · ${esc(finding.result)}<br>${esc(finding.note || '')}</div>`).join('') : '<div class="funding-ops-empty">No findings recorded.</div>'}</div></section>
        <div class="verification-desk-result" id="verification-result-message"></div>`;

      const message = detailRoot.querySelector('#verification-result-message');
      detailRoot.querySelector('[data-vaction="register-evidence"]')?.addEventListener('click', async () => {
        try {
          await request(`/api/funding/opportunities/${encodeURIComponent(opportunityId)}/evidence`, { method: 'POST', body: JSON.stringify({
            evidenceType: detailRoot.querySelector('#verification-evidence-type').value,
            title: detailRoot.querySelector('#verification-evidence-title').value || null,
            sourceReference: detailRoot.querySelector('#verification-source-reference').value,
            documentId: detailRoot.querySelector('#verification-document-id').value || null,
            provenance: { note: detailRoot.querySelector('#verification-provenance').value || null },
          }) });
          message.textContent = 'Evidence registered and linked to the opportunity.';
          setTimeout(() => loadOpportunity(root), 500);
        } catch (error) { message.textContent = error.message; }
      });
      detailRoot.querySelector('[data-vaction="start-review"]')?.addEventListener('click', async () => {
        try { await request(`/api/funding-verification/requests/${encodeURIComponent(latestRequest.verificationRequestId)}/start`, { method: 'POST', body: '{}' }); message.textContent = 'Verification review started.'; setTimeout(() => loadOpportunity(root), 500); }
        catch (error) { message.textContent = error.message; }
      });
      detailRoot.querySelector('[data-vaction="record-finding"]')?.addEventListener('click', async () => {
        try { await request(`/api/funding-verification/requests/${encodeURIComponent(latestRequest.verificationRequestId)}/findings`, { method: 'POST', body: JSON.stringify({ checkType: detailRoot.querySelector('#verification-check-type').value, result: detailRoot.querySelector('#verification-result').value, note: detailRoot.querySelector('#verification-note').value || null }) }); message.textContent = 'Verification finding recorded.'; setTimeout(() => loadOpportunity(root), 500); }
        catch (error) { message.textContent = error.message; }
      });
      detailRoot.querySelector('[data-vaction="verify"]')?.addEventListener('click', async () => {
        try { await request(`/api/funding-verification/requests/${encodeURIComponent(latestRequest.verificationRequestId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'VERIFIED', rationale: 'All requested verification checks completed through the Funding Operations verification desk.' }) }); message.textContent = 'Opportunity verified and handed to Verified Value preparation.'; setTimeout(() => loadOpportunity(root), 500); }
        catch (error) { message.textContent = error.message; }
      });
      detailRoot.querySelector('[data-vaction="more-evidence"]')?.addEventListener('click', async () => {
        try { await request(`/api/funding-verification/requests/${encodeURIComponent(latestRequest.verificationRequestId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'MORE_EVIDENCE_REQUIRED', rationale: 'Additional supporting evidence is required before verification can be completed.' }) }); message.textContent = 'Opportunity returned for additional evidence.'; setTimeout(() => loadOpportunity(root), 500); }
        catch (error) { message.textContent = error.message; }
      });
    } catch (error) {
      detailRoot.innerHTML = `<strong>Verification workspace could not load.</strong><p>${esc(error.message)}</p>`;
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
      section.innerHTML = `<div class="funding-panel-head"><div><p class="eyebrow">PHASE 1–2 WORK DESK</p><h3>Evidence and verification</h3><p>Register supporting evidence, begin review, record findings, and make the verification decision.</p></div></div><select id="verification-opportunity" style="margin-top:12px"><option value="">Select opportunity</option>${(dashboard.queue || []).map((item) => `<option value="${esc(item.opportunityId)}">${esc(item.title || item.opportunityId)} · ${esc(item.status)}</option>`).join('')}</select><div id="verification-detail" style="margin-top:12px"><div class="funding-ops-empty">Select a funding opportunity.</div></div>`;
      fundingRoot.append(section);
      section.querySelector('#verification-opportunity')?.addEventListener('change', () => loadOpportunity(section));
    } catch (error) {
      const section = document.createElement('section');
      section.className = 'verification-desk';
      section.id = 'funding-verification-desk';
      section.innerHTML = `<strong>Verification desk could not load.</strong><p>${esc(error.message)}</p>`;
      fundingRoot.append(section);
    }
  }

  window.mountFundingVerificationDesk = mount;
})();