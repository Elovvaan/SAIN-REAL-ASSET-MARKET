(() => {
  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function style() {
    if (document.querySelector('#funding-operations-style')) return;
    const node = document.createElement('style');
    node.id = 'funding-operations-style';
    node.textContent = `
      .funding-ops{display:grid;gap:16px}.funding-ops-hero,.funding-ops-panel,.funding-detail{padding:20px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.025)}
      .funding-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}.funding-metric{padding:14px;border-radius:13px;background:rgba(255,255,255,.04)}.funding-metric strong{display:block;font-size:21px}.funding-metric span{font-size:12px;opacity:.7}
      .funding-ops-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.funding-phase-card{padding:15px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.025)}
      .funding-phase-head,.funding-panel-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.funding-phase-card small{display:block;opacity:.7;margin-top:8px}.funding-phase-state{font-size:11px;padding:5px 8px;border-radius:999px;background:rgba(45,190,120,.15);color:#7de0a9}
      .funding-ops-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.funding-ops-list{display:grid;gap:10px;margin-top:12px}.funding-ops-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:13px;border-radius:12px;background:rgba(255,255,255,.035);cursor:pointer}.funding-ops-row:hover{background:rgba(255,255,255,.06)}.funding-ops-row span{display:block;opacity:.72;font-size:12px;margin-top:4px}.funding-next{font-size:12px;text-align:right}
      .funding-intake-modal,.funding-detail{display:none}.funding-intake-modal.open,.funding-detail.open{display:block}.funding-intake-modal{padding:18px;border:1px solid rgba(215,166,42,.35);border-radius:16px;background:rgba(215,166,42,.06)}
      .funding-intake-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.funding-intake-grid input,.funding-intake-grid select,.funding-intake-grid textarea{width:100%;box-sizing:border-box;padding:11px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#101010;color:#fff}.funding-intake-grid textarea{grid-column:1/-1;min-height:86px}
      .funding-intake-result{margin-top:10px;font-size:13px}.funding-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.funding-detail-card{padding:14px;border-radius:13px;background:rgba(255,255,255,.04)}.funding-detail-card span{display:block;font-size:12px;opacity:.7;margin-top:5px}.funding-evidence-list{display:grid;gap:7px;margin-top:10px}.funding-evidence-item{padding:10px;border-radius:10px;background:rgba(255,255,255,.035);font-size:12px}.funding-ops-empty{padding:16px;opacity:.7}
      @media(max-width:800px){.funding-ops-grid,.funding-metrics,.funding-intake-grid,.funding-detail-grid{grid-template-columns:1fr}.funding-ops-row{grid-template-columns:1fr}.funding-next{text-align:left}}
    `;
    document.head.append(node);
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
    return payload;
  }

  function phaseCard(item) {
    const statuses = Object.entries(item.statusCounts || {}).slice(0, 3).map(([key, count]) => `${key}: ${count}`).join(' · ');
    return `<article class="funding-phase-card"><div class="funding-phase-head"><div><p class="eyebrow">PHASE ${item.phaseNumber}</p><strong>${esc(String(item.phase || '').replaceAll('_', ' '))}</strong></div><span class="funding-phase-state">READY</span></div><small>${item.count || 0} records${statuses ? ` · ${esc(statuses)}` : ''}</small></article>`;
  }

  function queueRow(item) {
    const amount = Number(item.requestedAmount || 0);
    return `<div class="funding-ops-row" data-opportunity-id="${esc(item.opportunityId)}"><div><strong>${esc(item.title || item.opportunityId)}</strong><span>${esc(item.opportunityId)} · ${esc(item.opportunityType || 'Opportunity')} · ${amount ? money.format(amount) : 'Amount pending'}</span><span>${esc(item.status || 'UNKNOWN')} · ${esc(item.fundingPhase || '')}</span></div><div class="funding-next"><strong>${esc(item.nextAction?.label || 'Review')}</strong><span>${esc(item.nextAction?.queue || '')}</span></div></div>`;
  }

  function intakeForm() {
    return `<section class="funding-intake-modal" id="funding-intake-modal"><div class="funding-panel-head"><div><p class="eyebrow">REAL WORKFLOW</p><h3>Start a funding opportunity</h3><p>Capture the customer request directly into Phase 1.</p></div><button class="secondary-button" type="button" id="funding-intake-close">Close</button></div><form id="funding-opportunity-form" class="funding-intake-grid"><input name="applicantParticipantId" placeholder="Applicant participant ID" required><input name="title" placeholder="Opportunity title" required><select name="opportunityType" required><option value="">Opportunity type</option><option value="PLATFORM">Platform</option><option value="PROJECT">Project</option><option value="CONSTRUCTION">Construction</option><option value="EQUIPMENT">Equipment</option><option value="WORKING_CAPITAL">Working capital</option><option value="INVOICE">Invoice</option></select><select name="purpose" required><option value="">Purpose</option><option value="BUILD">Build</option><option value="DEVELOP">Develop</option><option value="EXPAND">Expand</option><option value="PURCHASE">Purchase</option><option value="WORKING_CAPITAL">Working capital</option><option value="REFINANCE">Refinance</option></select><input name="requestedAmount" type="number" min="1" step="0.01" placeholder="Requested amount" required><select name="currency"><option value="USD">USD</option></select><textarea name="description" placeholder="Describe what is being funded and the expected result."></textarea><button class="primary-button" type="submit">Create opportunity record</button><div class="funding-intake-result" id="funding-intake-result"></div></form></section>`;
  }

  async function openDetail(root, opportunityId) {
    const panel = root.querySelector('#funding-detail');
    if (!panel) return;
    panel.classList.add('open');
    panel.innerHTML = '<div class="loading-state">Loading opportunity…</div>';
    try {
      const detail = await request(`/api/funding-operations/opportunities/${encodeURIComponent(opportunityId)}`);
      const record = detail.opportunity || {};
      const evidence = detail.intake?.evidence || [];
      const completeness = await request(`/api/funding/opportunities/${encodeURIComponent(opportunityId)}/completeness`).catch(() => null);
      const actions = [];
      if (record.status === 'INTAKE_IN_PROGRESS' && completeness?.intakeComplete) actions.push('<button class="primary-button" data-action="complete-intake">Complete intake</button>');
      if (['INTAKE_COMPLETE', 'PENDING_VERIFICATION'].includes(record.status)) actions.push('<button class="primary-button" data-action="create-verification">Create verification request</button>');
      panel.innerHTML = `<div class="funding-panel-head"><div><p class="eyebrow">OPPORTUNITY WORKSPACE</p><h3>${esc(record.title || record.opportunityId)}</h3><p>${esc(record.opportunityId)} · ${esc(record.status)} · ${esc(record.fundingPhase || '')}</p></div><button class="secondary-button" data-action="close-detail">Close</button></div><div class="funding-detail-grid"><div class="funding-detail-card"><strong>${money.format(Number(record.requestedAmount || 0))}</strong><span>Requested funding · ${esc(record.currency || '')}</span></div><div class="funding-detail-card"><strong>${esc(record.applicantParticipantId || 'Not linked')}</strong><span>Applicant participant</span></div><div class="funding-detail-card"><strong>${esc(record.opportunityType || '')}</strong><span>Opportunity type</span></div><div class="funding-detail-card"><strong>${esc(detail.nextAction?.label || 'Review')}</strong><span>Next controlled action</span></div></div><div class="funding-ops-actions">${actions.join('') || '<span>No Phase 1 action is currently available from this screen.</span>'}</div><section class="funding-ops-panel"><p class="eyebrow">INTAKE COMPLETENESS</p><strong>${completeness?.intakeComplete ? 'Ready to complete' : 'Additional intake information required'}</strong><p>${completeness?.missingRequired?.length ? `Missing required: ${esc(completeness.missingRequired.join(', '))}` : 'All required intake fields are present.'}</p></section><section class="funding-ops-panel"><p class="eyebrow">EVIDENCE & REFERENCES</p><div class="funding-evidence-list">${evidence.length ? evidence.map((item) => `<div class="funding-evidence-item"><strong>${esc(item.title || item.evidenceType)}</strong><span>${esc(item.sourceReference || '')} · ${esc(item.verificationStatus || 'NOT_STARTED')}</span></div>`).join('') : '<div class="funding-ops-empty">No evidence records have been registered yet.</div>'}</div></section><div class="funding-intake-result" id="funding-detail-result"></div>`;
      panel.querySelector('[data-action="close-detail"]')?.addEventListener('click', () => panel.classList.remove('open'));
      panel.querySelector('[data-action="complete-intake"]')?.addEventListener('click', async () => {
        const result = panel.querySelector('#funding-detail-result');
        try {
          await request(`/api/funding/opportunities/${encodeURIComponent(opportunityId)}/complete-intake`, { method: 'POST', body: '{}' });
          if (result) result.textContent = 'Intake completed. Opportunity is ready for verification.';
          setTimeout(() => render(root), 700);
        } catch (error) { if (result) result.textContent = error.message; }
      });
      panel.querySelector('[data-action="create-verification"]')?.addEventListener('click', async () => {
        const result = panel.querySelector('#funding-detail-result');
        try {
          const created = await request(`/api/funding/opportunities/${encodeURIComponent(opportunityId)}/verification-requests`, { method: 'POST', body: '{}' });
          if (result) result.textContent = `Verification request ${created.verificationRequestId} created.`;
          setTimeout(() => render(root), 700);
        } catch (error) { if (result) result.textContent = error.message; }
      });
    } catch (error) {
      panel.innerHTML = `<strong>Opportunity could not load.</strong><p>${esc(error.message)}</p>`;
    }
  }

  async function render(root) {
    if (!root) return;
    style();
    root.innerHTML = '<div class="loading-state">Loading funding operations…</div>';
    try {
      const dashboard = await request('/api/funding-operations/dashboard');
      const metrics = dashboard.metrics || {};
      root.innerHTML = `<section class="funding-ops"><div class="funding-ops-hero"><p class="eyebrow">FUNDING ENGINE OPERATIONS</p><h2>Move each opportunity through one controlled lifecycle</h2><p>The operations queue identifies the next real action and opens the working opportunity workspace inside Financing.</p><div class="funding-metrics"><div class="funding-metric"><strong>${metrics.opportunities || 0}</strong><span>Funding opportunities</span></div><div class="funding-metric"><strong>${money.format(metrics.totalRequested || 0)}</strong><span>Total requested</span></div><div class="funding-metric"><strong>${metrics.activeQueueItems || 0}</strong><span>Active queue items</span></div><div class="funding-metric"><strong>${metrics.liveListings || 0}</strong><span>Live listings</span></div><div class="funding-metric"><strong>${metrics.confirmedCommitments || 0}</strong><span>Confirmed commitments</span></div><div class="funding-metric"><strong>${metrics.recognizedPositions || 0}</strong><span>Recognized positions</span></div></div><div class="funding-ops-actions"><button class="primary-button" id="funding-ops-new">Start opportunity intake</button><button class="secondary-button" id="funding-ops-refresh">Refresh operations</button></div></div>${intakeForm()}<section class="funding-detail" id="funding-detail"></section><div class="funding-ops-grid">${(dashboard.phases || []).map(phaseCard).join('')}</div><section class="funding-ops-panel"><div class="funding-panel-head"><div><p class="eyebrow">OPERATIONS QUEUE</p><h3>What needs to happen next</h3></div><span>${dashboard.queue?.length || 0} records</span></div><div class="funding-ops-list">${dashboard.queue?.length ? dashboard.queue.map(queueRow).join('') : '<div class="funding-ops-empty">No funding opportunities have been created yet.</div>'}</div></section></section>`;
      const modal = root.querySelector('#funding-intake-modal');
      root.querySelector('#funding-ops-new')?.addEventListener('click', () => modal?.classList.add('open'));
      root.querySelector('#funding-intake-close')?.addEventListener('click', () => modal?.classList.remove('open'));
      root.querySelector('#funding-ops-refresh')?.addEventListener('click', () => render(root));
      root.querySelectorAll('[data-opportunity-id]').forEach((row) => row.addEventListener('click', () => openDetail(root, row.dataset.opportunityId)));
      root.querySelector('#funding-opportunity-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const result = root.querySelector('#funding-intake-result');
        const values = Object.fromEntries(new FormData(event.currentTarget));
        try {
          const record = await request('/api/funding/opportunities', { method: 'POST', body: JSON.stringify({ ...values, requestedAmount: Number(values.requestedAmount), relatedParticipantIds: [values.applicantParticipantId] }) });
          if (result) result.innerHTML = `<strong>Created ${esc(record.opportunityId)}</strong> · ${esc(record.status)}.`;
          event.currentTarget.reset();
          setTimeout(() => render(root), 900);
        } catch (error) { if (result) result.textContent = error.message; }
      });
      window.dispatchEvent(new CustomEvent('sra:funding-operations-rendered', { detail: { root } }));
    } catch (error) {
      root.innerHTML = `<div class="funding-ops-panel"><strong>Funding Operations could not load.</strong><p>${esc(error.message)}</p></div>`;
    }
  }

  window.renderParticipantFundingOperations = render;
})();