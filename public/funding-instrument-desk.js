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
    if (document.querySelector('#funding-instrument-desk-style')) return;
    const style = document.createElement('style');
    style.id = 'funding-instrument-desk-style';
    style.textContent = `
      .instrument-desk{padding:20px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.025)}
      .instrument-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}
      .instrument-card{padding:14px;border-radius:13px;background:rgba(255,255,255,.04)}
      .instrument-desk input,.instrument-desk select,.instrument-desk textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#101010;color:#fff}
      .instrument-desk textarea{min-height:72px}.instrument-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px}
      .instrument-candidates{display:grid;gap:8px;margin-top:10px}.instrument-candidate{display:grid;grid-template-columns:1fr auto;gap:10px;padding:11px;border-radius:10px;background:rgba(255,255,255,.035)}
      .instrument-result{margin-top:10px;font-size:13px}@media(max-width:800px){.instrument-grid,.instrument-candidate{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  async function loadOpportunity(root) {
    const opportunityId = root.querySelector('#instrument-opportunity')?.value || '';
    const detailRoot = root.querySelector('#instrument-detail');
    if (!detailRoot) return;
    if (!opportunityId) {
      detailRoot.innerHTML = '<div class="funding-ops-empty">Select an opportunity in instrument selection, draft review, or issuance.</div>';
      return;
    }
    detailRoot.innerHTML = '<div class="loading-state">Loading instrument workspace…</div>';

    try {
      const detail = await request(`/api/funding-operations/opportunities/${encodeURIComponent(opportunityId)}`);
      const opportunity = detail.opportunity;
      const instrumentRequests = detail.instrumentRequests || [];
      const instrumentRequest = instrumentRequests[instrumentRequests.length - 1] || null;
      const instrumentSelections = detail.instrumentSelections || [];
      const instrumentSelection = instrumentSelections[instrumentSelections.length - 1] || null;
      const instruments = detail.instruments || [];
      const instrument = instruments[instruments.length - 1] || null;

      let assessment = null;
      if (instrumentRequest) {
        assessment = await request(`/api/funding-instrument/requests/${encodeURIComponent(instrumentRequest.instrumentSelectionRequestId)}/assessment`).catch(() => null);
      }
      let completeness = null;
      if (instrument) {
        completeness = await request(`/api/funding-instrument-review/instruments/${encodeURIComponent(instrument.instrumentId)}/completeness`).catch(() => null);
      }
      const reviews = instrument ? await request(`/api/funding-instrument-review/reviews?instrumentId=${encodeURIComponent(instrument.instrumentId)}`).catch(() => ({ records: [] })) : { records: [] };
      const draftReview = reviews.records?.[reviews.records.length - 1] || null;
      const issuanceRequests = instrument ? await request(`/api/funding-instrument-review/issuance-requests?instrumentId=${encodeURIComponent(instrument.instrumentId)}`).catch(() => ({ records: [] })) : { records: [] };
      const issuanceRequest = issuanceRequests.records?.[issuanceRequests.records.length - 1] || null;
      const issuanceReviews = issuanceRequest ? await request(`/api/funding-instrument-issuance/reviews?issuanceRequestId=${encodeURIComponent(issuanceRequest.issuanceRequestId)}`).catch(() => ({ records: [] })) : { records: [] };
      const issuanceReview = issuanceReviews.records?.[issuanceReviews.records.length - 1] || null;
      const authorizations = instrument ? await request(`/api/funding-instrument-issuance/authorizations?instrumentId=${encodeURIComponent(instrument.instrumentId)}`).catch(() => ({ records: [] })) : { records: [] };
      const authorization = authorizations.records?.find((item) => item.status === 'AUTHORIZED') || null;

      const candidateOptions = (assessment?.candidates || []).map((item) => `<option value="${esc(item.instrumentFamily)}">${esc(item.instrumentFamily.replaceAll('_', ' '))} · ${item.score}</option>`).join('');

      detailRoot.innerHTML = `
        <div class="instrument-grid">
          <section class="instrument-card"><p class="eyebrow">OPPORTUNITY</p><strong>${esc(opportunity.title || opportunity.opportunityId)}</strong><p>${esc(opportunity.status)} · ${esc(opportunity.fundingPhase || '')}</p><p>${money.format(Number(opportunity.requestedAmount || 0))}</p></section>
          <section class="instrument-card"><p class="eyebrow">INSTRUMENT STATE</p><strong>${esc(instrument?.instrumentId || 'No draft instrument')}</strong><p>${esc(instrument?.status || 'Not created')} · ${esc(instrument?.issuanceStatus || '')}</p><p>${esc(instrumentSelection?.selectedInstrumentFamily || instrumentRequest?.fundingModel || '')}</p></section>
        </div>
        ${instrumentRequest && !instrumentSelection ? `<section class="instrument-card" style="margin-top:12px"><p class="eyebrow">INSTRUMENT-FAMILY ASSESSMENT</p><div class="instrument-candidates">${(assessment?.candidates || []).map((item) => `<div class="instrument-candidate"><div><strong>${esc(item.instrumentFamily.replaceAll('_', ' '))}</strong><span>${esc((item.reasons || []).join(' · '))}</span></div><strong>${item.score}</strong></div>`).join('') || '<div class="funding-ops-empty">No candidates returned.</div>'}</div><select id="instrument-family-choice" style="margin-top:10px">${candidateOptions}</select><textarea id="instrument-selection-rationale" placeholder="Selection rationale"></textarea><div class="instrument-actions"><button class="primary-button" data-iaction="select-family">Select instrument family</button></div></section>` : ''}
        ${instrumentSelection && !instrument ? `<section class="instrument-card" style="margin-top:12px"><p class="eyebrow">CREATE DRAFT INSTRUMENT</p><div class="instrument-grid"><input id="draft-face-value" type="number" min="1" step="0.01" value="${Number(opportunity.requestedAmount || 0)}" placeholder="Face value"><input id="draft-denomination" placeholder="Denomination"><input id="draft-maturity" type="date"><select id="draft-transferability"><option value="RESTRICTED">Restricted</option><option value="NON_TRANSFERABLE">Non-transferable</option><option value="TRANSFERABLE">Transferable</option></select><input id="draft-settlement-rule" placeholder="Settlement rule"><input id="draft-governing-document" placeholder="Governing document ID"><input id="draft-value-package" placeholder="Verified Value package ID"></div><div class="instrument-actions"><button class="primary-button" data-iaction="create-draft">Create draft instrument</button></div></section>` : ''}
        ${instrument ? `<section class="instrument-card" style="margin-top:12px"><p class="eyebrow">DRAFT COMPLETENESS</p><strong>${completeness?.complete ? 'Complete' : 'Incomplete'}</strong><p>${completeness?.missingRequired?.length ? `Missing: ${esc(completeness.missingRequired.join(', '))}` : 'All required fields are present.'}</p><p>${completeness?.missingConditional?.length ? `Conditional: ${esc(completeness.missingConditional.join(', '))}` : ''}</p></section>` : ''}
        ${instrument && !draftReview ? `<section class="instrument-card" style="margin-top:12px"><p class="eyebrow">DRAFT REVIEW</p><div class="instrument-actions"><button class="primary-button" data-iaction="start-draft-review">Start draft review</button></div></section>` : ''}
        ${draftReview?.status === 'IN_REVIEW' ? `<section class="instrument-card" style="margin-top:12px"><p class="eyebrow">REVIEW FINDING</p><div class="instrument-grid"><select id="draft-check-type">${(draftReview.reviewScope || []).map((check) => `<option value="${esc(check)}">${esc(check.replaceAll('_', ' '))}</option>`).join('')}</select><select id="draft-finding-result"><option value="PASS">Pass</option><option value="CONDITION">Condition</option><option value="FAIL">Fail</option><option value="NOT_APPLICABLE">Not applicable</option></select><textarea id="draft-finding-note" placeholder="Finding note"></textarea><input id="draft-finding-condition" placeholder="Condition, when applicable"></div><div class="instrument-actions"><button class="secondary-button" data-iaction="record-draft-finding">Record finding</button><button class="primary-button" data-iaction="approve-draft">Approve for issuance request</button><button class="secondary-button" data-iaction="changes-draft">Require changes</button></div></section>` : ''}
        ${draftReview?.decision === 'APPROVED_FOR_ISSUANCE_REQUEST' && !issuanceRequest ? `<section class="instrument-card" style="margin-top:12px"><p class="eyebrow">ISSUANCE REQUEST</p><div class="instrument-grid"><input id="requested-issue-date" type="date"><input id="requested-maturity-date" type="date"></div><div class="instrument-actions"><button class="primary-button" data-iaction="create-issuance-request">Create issuance request</button></div></section>` : ''}
        ${issuanceRequest && !issuanceReview ? `<section class="instrument-card" style="margin-top:12px"><p class="eyebrow">ISSUANCE REVIEW</p><strong>${esc(issuanceRequest.issuanceRequestId)}</strong><p>${esc(issuanceRequest.status)}</p><div class="instrument-actions"><button class="primary-button" data-iaction="start-issuance-review">Start issuance review</button></div></section>` : ''}
        ${issuanceReview?.status === 'IN_REVIEW' ? `<section class="instrument-card" style="margin-top:12px"><p class="eyebrow">ISSUANCE AUTHORIZATION</p><div class="instrument-actions"><button class="primary-button" data-iaction="authorize-issuance">Authorize issuance</button><button class="secondary-button" data-iaction="changes-issuance">Require changes</button></div></section>` : ''}
        ${authorization ? `<section class="instrument-card" style="margin-top:12px"><p class="eyebrow">AUTHORIZED ISSUANCE</p><strong>${esc(authorization.issuanceAuthorizationId)}</strong><p>${esc(authorization.status)} · ${money.format(Number(authorization.authorizedFaceValue || 0))}</p><div class="instrument-actions"><button class="primary-button" data-iaction="issue-instrument">Issue instrument</button></div></section>` : ''}
        <div class="instrument-result" id="instrument-result"></div>`;

      const result = detailRoot.querySelector('#instrument-result');
      const act = async (callback, success) => {
        try { await callback(); result.textContent = success; setTimeout(() => loadOpportunity(root), 550); }
        catch (error) { result.textContent = error.message; }
      };

      detailRoot.querySelector('[data-iaction="select-family"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-instrument/requests/${encodeURIComponent(instrumentRequest.instrumentSelectionRequestId)}/selection`, { method: 'POST', body: JSON.stringify({ selectedInstrumentFamily: detailRoot.querySelector('#instrument-family-choice').value, selectionRationale: detailRoot.querySelector('#instrument-selection-rationale').value || null }) }),
        'Instrument family selected.'
      ));
      detailRoot.querySelector('[data-iaction="create-draft"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-instrument/selections/${encodeURIComponent(instrumentSelection.instrumentSelectionId)}/draft-instrument`, { method: 'POST', body: JSON.stringify({ faceValue: Number(detailRoot.querySelector('#draft-face-value').value), denomination: detailRoot.querySelector('#draft-denomination').value || null, maturityDate: detailRoot.querySelector('#draft-maturity').value || null, transferabilityStatus: detailRoot.querySelector('#draft-transferability').value, settlementRule: detailRoot.querySelector('#draft-settlement-rule').value || null, governingDocumentId: detailRoot.querySelector('#draft-governing-document').value || null, verifiedValuePackageId: detailRoot.querySelector('#draft-value-package').value || null }) }),
        'Draft instrument created.'
      ));
      detailRoot.querySelector('[data-iaction="start-draft-review"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-instrument-review/instruments/${encodeURIComponent(instrument.instrumentId)}/reviews`, { method: 'POST', body: '{}' }),
        'Draft review started.'
      ));
      detailRoot.querySelector('[data-iaction="record-draft-finding"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-instrument-review/reviews/${encodeURIComponent(draftReview.reviewId)}/findings`, { method: 'POST', body: JSON.stringify({ checkType: detailRoot.querySelector('#draft-check-type').value, result: detailRoot.querySelector('#draft-finding-result').value, note: detailRoot.querySelector('#draft-finding-note').value || null, condition: detailRoot.querySelector('#draft-finding-condition').value || null }) }),
        'Draft review finding recorded.'
      ));
      detailRoot.querySelector('[data-iaction="approve-draft"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-instrument-review/reviews/${encodeURIComponent(draftReview.reviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED_FOR_ISSUANCE_REQUEST', rationale: 'Draft instrument completed all required review checks.' }) }),
        'Draft approved for issuance request.'
      ));
      detailRoot.querySelector('[data-iaction="changes-draft"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-instrument-review/reviews/${encodeURIComponent(draftReview.reviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'CHANGES_REQUIRED', rationale: 'Draft instrument requires revision before issuance.' }) }),
        'Draft returned for changes.'
      ));
      detailRoot.querySelector('[data-iaction="create-issuance-request"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-instrument-review/reviews/${encodeURIComponent(draftReview.reviewId)}/issuance-request`, { method: 'POST', body: JSON.stringify({ requestedIssueDate: detailRoot.querySelector('#requested-issue-date').value || null, requestedMaturityDate: detailRoot.querySelector('#requested-maturity-date').value || null }) }),
        'Issuance request created.'
      ));
      detailRoot.querySelector('[data-iaction="start-issuance-review"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-instrument-issuance/requests/${encodeURIComponent(issuanceRequest.issuanceRequestId)}/reviews`, { method: 'POST', body: '{}' }),
        'Issuance review started.'
      ));
      detailRoot.querySelector('[data-iaction="authorize-issuance"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-instrument-issuance/reviews/${encodeURIComponent(issuanceReview.issuanceReviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'AUTHORIZED', rationale: 'Issuance request satisfies the controlled issuance requirements.' }) }),
        'Issuance authorized.'
      ));
      detailRoot.querySelector('[data-iaction="changes-issuance"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-instrument-issuance/reviews/${encodeURIComponent(issuanceReview.issuanceReviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'CHANGES_REQUIRED', rationale: 'Issuance request requires correction.' }) }),
        'Issuance request returned for changes.'
      ));
      detailRoot.querySelector('[data-iaction="issue-instrument"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-instrument-issuance/authorizations/${encodeURIComponent(authorization.issuanceAuthorizationId)}/issue`, { method: 'POST', body: '{}' }),
        'Instrument issued and authoritative issuance transaction recorded.'
      ));
    } catch (error) {
      detailRoot.innerHTML = `<strong>Instrument workspace could not load.</strong><p>${esc(error.message)}</p>`;
    }
  }

  async function mount(fundingRoot) {
    if (!fundingRoot || fundingRoot.querySelector('#funding-instrument-desk')) return;
    addStyle();
    try {
      const dashboard = await request('/api/funding-operations/dashboard');
      if (!fundingRoot.isConnected || fundingRoot.querySelector('#funding-instrument-desk')) return;
      const candidates = (dashboard.queue || []).filter((item) => ['FUNDING_MODEL_SELECTED', 'INSTRUMENT_DRAFTED', 'INSTRUMENT_REVIEWED', 'ISSUANCE_REQUESTED', 'INSTRUMENT_ISSUED'].includes(item.status));
      const section = document.createElement('section');
      section.className = 'instrument-desk';
      section.id = 'funding-instrument-desk';
      section.innerHTML = `<div class="funding-panel-head"><div><p class="eyebrow">PHASE 5–7 WORK DESK</p><h3>Instrument selection, review, and issuance</h3><p>Assess the instrument family, create the draft, complete review, authorize issuance, and record the authoritative issuance transaction.</p></div></div><select id="instrument-opportunity" style="margin-top:12px"><option value="">Select opportunity</option>${candidates.map((item) => `<option value="${esc(item.opportunityId)}">${esc(item.title || item.opportunityId)} · ${esc(item.status)}</option>`).join('')}</select><div id="instrument-detail" style="margin-top:12px"><div class="funding-ops-empty">Select an opportunity in instrument selection, draft review, or issuance.</div></div>`;
      fundingRoot.append(section);
      section.querySelector('#instrument-opportunity')?.addEventListener('change', () => loadOpportunity(section));
    } catch (error) {
      const section = document.createElement('section');
      section.className = 'instrument-desk';
      section.id = 'funding-instrument-desk';
      section.innerHTML = `<strong>Instrument desk could not load.</strong><p>${esc(error.message)}</p>`;
      fundingRoot.append(section);
    }
  }

  window.mountFundingInstrumentDesk = mount;
  window.addEventListener('sra:funding-operations-rendered', (event) => {
    const fundingRoot = event.detail?.root?.querySelector('.funding-ops');
    if (fundingRoot) void mount(fundingRoot);
  });
})();