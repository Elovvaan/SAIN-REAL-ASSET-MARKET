(() => {
  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

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
    if (document.querySelector('#funding-value-model-desk-style')) return;
    const style = document.createElement('style');
    style.id = 'funding-value-model-desk-style';
    style.textContent = `
      .value-model-desk{padding:20px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.025)}
      .value-model-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}
      .value-model-card{padding:14px;border-radius:13px;background:rgba(255,255,255,.04)}
      .value-model-desk input,.value-model-desk select,.value-model-desk textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#101010;color:#fff}
      .value-model-desk textarea{min-height:72px}.value-model-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px}
      .model-assessment-list{display:grid;gap:8px;margin-top:10px}.model-assessment-row{display:grid;grid-template-columns:1fr auto;gap:10px;padding:11px;border-radius:10px;background:rgba(255,255,255,.035)}
      .value-model-result{margin-top:10px;font-size:13px}@media(max-width:800px){.value-model-grid,.model-assessment-row{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function selectedId(root) {
    return root.querySelector('#value-model-opportunity')?.value || '';
  }

  function numericValue(root, id) {
    const value = root.querySelector(id)?.value;
    return value === '' || value == null ? null : Number(value);
  }

  async function loadOpportunity(root) {
    const opportunityId = selectedId(root);
    const detailRoot = root.querySelector('#value-model-detail');
    if (!detailRoot) return;
    if (!opportunityId) {
      detailRoot.innerHTML = '<div class="funding-ops-empty">Select a verified or value-prepared opportunity.</div>';
      return;
    }

    detailRoot.innerHTML = '<div class="loading-state">Loading Verified Value workspace…</div>';
    try {
      const detail = await request(`/api/funding-operations/opportunities/${encodeURIComponent(opportunityId)}`);
      const opportunity = detail.opportunity;
      const preparations = detail.valuePreparation || [];
      const preparation = preparations[preparations.length - 1] || null;
      const assessments = detail.modelAssessments || [];
      const latestAssessment = assessments[assessments.length - 1] || null;
      const selections = detail.modelSelections || [];
      const selected = selections[selections.length - 1] || null;

      let liveAssessment = null;
      if (preparation) {
        liveAssessment = await request(`/api/funding-value/preparations/${encodeURIComponent(preparation.preparationId)}/model-assessment`).catch(() => null);
      }
      const assessmentItems = liveAssessment?.assessments || latestAssessment?.assessments || [];
      const modelOptions = assessmentItems.map((item) => `<option value="${esc(item.model)}">${esc(item.model.replaceAll('_', ' '))} · ${item.score}</option>`).join('');

      detailRoot.innerHTML = `
        <div class="value-model-grid">
          <section class="value-model-card"><p class="eyebrow">OPPORTUNITY</p><strong>${esc(opportunity.title || opportunity.opportunityId)}</strong><p>${esc(opportunity.status)} · ${esc(opportunity.fundingPhase || '')}</p><p>${money.format(Number(opportunity.requestedAmount || 0))} requested</p></section>
          <section class="value-model-card"><p class="eyebrow">CURRENT STATE</p><strong>${preparation ? esc(preparation.preparationId) : 'No value preparation'}</strong><p>${esc(preparation?.status || 'Not started')}</p><p>${selected ? `Selected: ${esc(selected.selectedModel)}` : 'Funding model not selected'}</p></section>
        </div>
        ${!preparation && opportunity.status === 'VERIFIED' ? `<section class="value-model-card" style="margin-top:12px"><p class="eyebrow">CREATE VERIFIED VALUE PREPARATION</p><div class="value-model-grid"><input id="vv-existing" type="number" min="0" step="0.01" placeholder="Existing verified value"><input id="vv-productive" type="number" min="0" step="0.01" placeholder="Productive capacity"><input id="vv-revenue" type="number" min="0" step="0.01" placeholder="Revenue capacity"><input id="vv-completion" type="number" min="0" step="0.01" placeholder="Completion capacity"><input id="vv-asset" type="number" min="0" step="0.01" placeholder="Asset support"><input id="vv-agreement" type="number" min="0" step="0.01" placeholder="Agreement support"><input id="vv-transaction" type="number" min="0" step="0.01" placeholder="Transaction support"><textarea id="vv-assumptions" placeholder="Assumptions, separated by line"></textarea><textarea id="vv-exclusions" placeholder="Exclusions, separated by line"></textarea></div><div class="value-model-actions"><button class="primary-button" data-vmaction="create-preparation">Create preparation</button></div></section>` : ''}
        ${preparation && preparation.status === 'PREPARATION_IN_PROGRESS' ? `<section class="value-model-card" style="margin-top:12px"><p class="eyebrow">UPDATE VALUE DIMENSIONS</p><div class="value-model-grid"><input id="vv-existing" type="number" min="0" step="0.01" value="${preparation.valueDimensions?.existingVerifiedValue ?? ''}" placeholder="Existing verified value"><input id="vv-productive" type="number" min="0" step="0.01" value="${preparation.valueDimensions?.productiveCapacity ?? ''}" placeholder="Productive capacity"><input id="vv-revenue" type="number" min="0" step="0.01" value="${preparation.valueDimensions?.revenueCapacity ?? ''}" placeholder="Revenue capacity"><input id="vv-completion" type="number" min="0" step="0.01" value="${preparation.valueDimensions?.completionCapacity ?? ''}" placeholder="Completion capacity"><input id="vv-asset" type="number" min="0" step="0.01" value="${preparation.valueDimensions?.collateralOrAssetSupport ?? ''}" placeholder="Asset support"><input id="vv-agreement" type="number" min="0" step="0.01" value="${preparation.valueDimensions?.agreementSupport ?? ''}" placeholder="Agreement support"><input id="vv-transaction" type="number" min="0" step="0.01" value="${preparation.valueDimensions?.transactionSupport ?? ''}" placeholder="Transaction support"><textarea id="vv-assumptions" placeholder="Assumptions, separated by line">${esc((preparation.assumptions || []).join('\n'))}</textarea><textarea id="vv-exclusions" placeholder="Exclusions, separated by line">${esc((preparation.exclusions || []).join('\n'))}</textarea></div><div class="value-model-actions"><button class="secondary-button" data-vmaction="save-preparation">Save preparation</button><button class="primary-button" data-vmaction="complete-preparation">Complete and assess models</button></div></section>` : ''}
        ${preparation ? `<section class="value-model-card" style="margin-top:12px"><p class="eyebrow">FUNDING MODEL ASSESSMENT</p><div class="model-assessment-list">${assessmentItems.length ? assessmentItems.map((item) => `<div class="model-assessment-row"><div><strong>${esc(item.model.replaceAll('_', ' '))}</strong><span>${esc((item.reasons || []).join(' · '))}</span></div><strong>${item.score}</strong></div>`).join('') : '<div class="funding-ops-empty">Complete preparation to produce a model assessment.</div>'}</div></section>` : ''}
        ${opportunity.status === 'VALUE_PREPARED' && !selected ? `<section class="value-model-card" style="margin-top:12px"><p class="eyebrow">SELECT FUNDING MODEL</p><select id="funding-model-choice">${modelOptions}</select><textarea id="funding-model-rationale" placeholder="Selection rationale"></textarea><div class="value-model-actions"><button class="primary-button" data-vmaction="select-model">Record model selection</button></div></section>` : ''}
        ${selected && !selected.instrumentSelectionRequestId ? `<section class="value-model-card" style="margin-top:12px"><p class="eyebrow">INSTRUMENT HANDOFF</p><strong>${esc(selected.selectedModel)}</strong><p>The funding model has been selected. Create the controlled instrument-selection request.</p><div class="value-model-actions"><button class="primary-button" data-vmaction="instrument-request">Create instrument selection request</button></div></section>` : ''}
        <div class="value-model-result" id="value-model-result"></div>`;

      const result = detailRoot.querySelector('#value-model-result');
      const valueDimensions = () => ({
        existingVerifiedValue: numericValue(detailRoot, '#vv-existing'),
        productiveCapacity: numericValue(detailRoot, '#vv-productive'),
        revenueCapacity: numericValue(detailRoot, '#vv-revenue'),
        completionCapacity: numericValue(detailRoot, '#vv-completion'),
        collateralOrAssetSupport: numericValue(detailRoot, '#vv-asset'),
        agreementSupport: numericValue(detailRoot, '#vv-agreement'),
        transactionSupport: numericValue(detailRoot, '#vv-transaction'),
      });
      const lines = (selector) => (detailRoot.querySelector(selector)?.value || '').split('\n').map((line) => line.trim()).filter(Boolean);

      detailRoot.querySelector('[data-vmaction="create-preparation"]')?.addEventListener('click', async () => {
        try {
          await request(`/api/funding-value/opportunities/${encodeURIComponent(opportunityId)}/preparations`, { method: 'POST', body: JSON.stringify({ valueDimensions: valueDimensions(), assumptions: lines('#vv-assumptions'), exclusions: lines('#vv-exclusions') }) });
          result.textContent = 'Verified Value preparation created.';
          setTimeout(() => loadOpportunity(root), 500);
        } catch (error) { result.textContent = error.message; }
      });
      detailRoot.querySelector('[data-vmaction="save-preparation"]')?.addEventListener('click', async () => {
        try {
          await request(`/api/funding-value/preparations/${encodeURIComponent(preparation.preparationId)}`, { method: 'PATCH', body: JSON.stringify({ valueDimensions: valueDimensions(), assumptions: lines('#vv-assumptions'), exclusions: lines('#vv-exclusions') }) });
          result.textContent = 'Verified Value preparation saved.';
          setTimeout(() => loadOpportunity(root), 500);
        } catch (error) { result.textContent = error.message; }
      });
      detailRoot.querySelector('[data-vmaction="complete-preparation"]')?.addEventListener('click', async () => {
        try {
          await request(`/api/funding-value/preparations/${encodeURIComponent(preparation.preparationId)}`, { method: 'PATCH', body: JSON.stringify({ valueDimensions: valueDimensions(), assumptions: lines('#vv-assumptions'), exclusions: lines('#vv-exclusions') }) });
          await request(`/api/funding-value/preparations/${encodeURIComponent(preparation.preparationId)}/complete`, { method: 'POST', body: '{}' });
          result.textContent = 'Verified Value preparation completed and funding models assessed.';
          setTimeout(() => loadOpportunity(root), 500);
        } catch (error) { result.textContent = error.message; }
      });
      detailRoot.querySelector('[data-vmaction="select-model"]')?.addEventListener('click', async () => {
        try {
          const model = detailRoot.querySelector('#funding-model-choice').value;
          const rationale = detailRoot.querySelector('#funding-model-rationale').value || null;
          await request(`/api/funding-model/opportunities/${encodeURIComponent(opportunityId)}/selections`, { method: 'POST', body: JSON.stringify({ selectedModel: model, selectionRationale: rationale }) });
          result.textContent = 'Funding model selection recorded.';
          setTimeout(() => loadOpportunity(root), 500);
        } catch (error) { result.textContent = error.message; }
      });
      detailRoot.querySelector('[data-vmaction="instrument-request"]')?.addEventListener('click', async () => {
        try {
          await request(`/api/funding-model/selections/${encodeURIComponent(selected.selectionId)}/instrument-request`, { method: 'POST', body: '{}' });
          result.textContent = 'Instrument selection request created.';
          setTimeout(() => loadOpportunity(root), 500);
        } catch (error) { result.textContent = error.message; }
      });
    } catch (error) {
      detailRoot.innerHTML = `<strong>Verified Value workspace could not load.</strong><p>${esc(error.message)}</p>`;
    }
  }

  async function mount(fundingRoot) {
    if (!fundingRoot || fundingRoot.querySelector('#funding-value-model-desk')) return;
    addStyle();
    try {
      const dashboard = await request('/api/funding-operations/dashboard');
      if (!fundingRoot.isConnected || fundingRoot.querySelector('#funding-value-model-desk')) return;
      const candidates = (dashboard.queue || []).filter((item) => ['VERIFIED', 'VALUE_PREPARED', 'FUNDING_MODEL_SELECTED'].includes(item.status));
      const section = document.createElement('section');
      section.className = 'value-model-desk';
      section.id = 'funding-value-model-desk';
      section.innerHTML = `<div class="funding-panel-head"><div><p class="eyebrow">PHASE 3–4 WORK DESK</p><h3>Verified Value and funding model</h3><p>Prepare the verified value dimensions, assess funding models, record the selection, and hand off to instrument selection.</p></div></div><select id="value-model-opportunity" style="margin-top:12px"><option value="">Select opportunity</option>${candidates.map((item) => `<option value="${esc(item.opportunityId)}">${esc(item.title || item.opportunityId)} · ${esc(item.status)}</option>`).join('')}</select><div id="value-model-detail" style="margin-top:12px"><div class="funding-ops-empty">Select a verified or value-prepared opportunity.</div></div>`;
      fundingRoot.append(section);
      section.querySelector('#value-model-opportunity')?.addEventListener('change', () => loadOpportunity(section));
    } catch (error) {
      const section = document.createElement('section');
      section.className = 'value-model-desk';
      section.id = 'funding-value-model-desk';
      section.innerHTML = `<strong>Verified Value and funding model desk could not load.</strong><p>${esc(error.message)}</p>`;
      fundingRoot.append(section);
    }
  }

  window.mountFundingValueModelDesk = mount;
  window.addEventListener('sra:funding-operations-rendered', (event) => {
    const fundingRoot = event.detail?.root?.querySelector?.('.funding-ops');
    if (fundingRoot) void mount(fundingRoot);
  });
})();