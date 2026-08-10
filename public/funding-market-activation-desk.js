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
    if (document.querySelector('#funding-market-activation-style')) return;
    const style = document.createElement('style');
    style.id = 'funding-market-activation-style';
    style.textContent = `
      .market-activation-desk{padding:20px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.025)}
      .market-activation-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}
      .market-activation-card{padding:14px;border-radius:13px;background:rgba(255,255,255,.04)}
      .market-activation-desk input,.market-activation-desk select,.market-activation-desk textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#101010;color:#fff}
      .market-activation-desk textarea{min-height:72px}.market-activation-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px}
      .market-activation-list{display:grid;gap:8px;margin-top:10px}.market-activation-row{padding:11px;border-radius:10px;background:rgba(255,255,255,.035)}
      .market-activation-result{margin-top:10px;font-size:13px}@media(max-width:800px){.market-activation-grid{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  async function loadOpportunity(root) {
    const opportunityId = root.querySelector('#market-activation-opportunity')?.value || '';
    const detailRoot = root.querySelector('#market-activation-detail');
    if (!detailRoot) return;
    if (!opportunityId) {
      detailRoot.innerHTML = '<div class="funding-ops-empty">Select a funded opportunity or position distribution.</div>';
      return;
    }
    detailRoot.innerHTML = '<div class="loading-state">Loading funded position workspace…</div>';

    try {
      const detail = await request(`/api/funding-operations/opportunities/${encodeURIComponent(opportunityId)}`);
      const opportunity = detail.opportunity;
      const instrument = (detail.instruments || []).at(-1) || null;
      const listing = (detail.listings || []).at(-1) || null;
      const commitments = detail.commitments || [];
      const positions = detail.positions || [];
      const settlements = detail.settlements || [];
      const financedPositions = await request(`/api/financing-closing/positions?opportunityId=${encodeURIComponent(opportunityId)}`).catch(() => ({ records: [] }));
      const financedPosition = financedPositions.records?.at(-1) || null;
      const financedPositionDetail = financedPosition ? await request(`/api/financing-closing/positions/${encodeURIComponent(financedPosition.positionId)}`).catch(() => null) : null;
      const distributionAuthorization = financedPositionDetail?.distributionAuthorizations?.find((item) => ['AUTHORIZED','IN_MARKET'].includes(item.status)) || null;
      const preparations = financedPosition ? await request(`/api/funding-marketplace/preparations?positionId=${encodeURIComponent(financedPosition.positionId)}`).catch(() => ({ records: [] })) : { records: [] };
      const preparation = preparations.records?.at(-1) || null;
      const publicationReviews = listing ? await request(`/api/funding-marketplace-publication/reviews?listingId=${encodeURIComponent(listing.listingId)}`).catch(() => ({ records: [] })) : { records: [] };
      const publicationReview = publicationReviews.records?.at(-1) || null;
      const publicationAuthorizations = listing ? await request(`/api/funding-marketplace-publication/authorizations?listingId=${encodeURIComponent(listing.listingId)}`).catch(() => ({ records: [] })) : { records: [] };
      const publicationAuthorization = publicationAuthorizations.records?.find((item) => item.status === 'AUTHORIZED') || null;
      const windows = listing ? await request(`/api/funding-marketplace-commitment/windows?listingId=${encodeURIComponent(listing.listingId)}`).catch(() => ({ records: [] })) : { records: [] };
      const windowRecord = windows.records?.at(-1) || null;
      const allocationReviews = windowRecord ? await request(`/api/funding-marketplace-allocation/reviews?windowId=${encodeURIComponent(windowRecord.windowId)}`).catch(() => ({ records: [] })) : { records: [] };
      const allocationReview = allocationReviews.records?.at(-1) || null;
      const position = positions.at(-1) || null;
      const settlementPreparation = settlements.at(-1) || null;
      const settlementReviews = settlementPreparation ? await request(`/api/funding-marketplace-settlement/reviews?preparationId=${encodeURIComponent(settlementPreparation.settlementPreparationId)}`).catch(() => ({ records: [] })) : { records: [] };
      const settlementReview = settlementReviews.records?.at(-1) || null;
      const settlementAuthorizations = position ? await request(`/api/funding-marketplace-settlement/authorizations?positionId=${encodeURIComponent(position.positionId)}`).catch(() => ({ records: [] })) : { records: [] };
      const settlementAuthorization = settlementAuthorizations.records?.find((item) => ['AWAITING_CONFIRMATION','CONFIRMATION_RECEIVED','CONFIRMED'].includes(item.status)) || null;

      detailRoot.innerHTML = `
        <div class="market-activation-grid">
          <section class="market-activation-card"><p class="eyebrow">FINANCING</p><strong>${esc(opportunity.title || opportunity.opportunityId)}</strong><p>${esc(opportunity.status)} · ${esc(opportunity.fundingPhase || '')}</p><p>${money.format(Number(opportunity.requestedAmount || 0))}</p></section>
          <section class="market-activation-card"><p class="eyebrow">FUNDED POSITION</p><strong>${esc(financedPosition?.positionId || 'No funded position')}</strong><p>${esc(financedPosition?.positionStatus || 'Financing not funded')} · ${esc(financedPosition?.distributionStatus || 'Not available')}</p><p>${financedPosition ? `${money.format(Number(financedPosition.retainedAmount || 0))} retained · ${money.format(Number(financedPosition.offeredAmount || financedPosition.availableAmount || 0))} offered/available` : 'Participant demand is not required for financing.'}</p></section>
        </div>
        ${!financedPosition ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">FINANCING FIRST</p><strong>No funded position exists yet.</strong><p>Complete financing and external settlement before any marketplace distribution is available.</p></section>` : ''}
        ${financedPosition && financedPosition.distributionStatus === 'RETAINED' ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">POST-FINANCING DISTRIBUTION</p><strong>SRA currently retains the entire funded position.</strong><p>Making a position available is optional and does not affect the completed financing.</p><div class="market-activation-grid"><input id="ma-offered-amount" type="number" min="0.01" step="0.01" max="${Number(financedPosition.currentPrincipal || 0)}" placeholder="Amount of position to make available"><textarea id="ma-transfer-restrictions" placeholder="Transfer restrictions, one per line"></textarea></div><div class="market-activation-actions"><button class="primary-button" data-maction="make-position-available">Make Position Available</button></div></section>` : ''}
        ${financedPosition && distributionAuthorization && !preparation ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">LISTING PREPARATION</p><p>Authorized position amount: ${money.format(Number(distributionAuthorization.offeredAmount || 0))}. SRA retains ${money.format(Number(distributionAuthorization.retainedAmount || 0))}.</p><div class="market-activation-grid"><input id="ma-title" value="${esc(opportunity.title || '')}" placeholder="Listing title"><textarea id="ma-summary" placeholder="Public summary">${esc(opportunity.description || instrument?.purpose || '')}</textarea><input id="ma-target" type="number" min="0.01" step="0.01" max="${Number(distributionAuthorization.offeredAmount || 0)}" value="${Number(distributionAuthorization.offeredAmount || 0)}" placeholder="Position amount offered"><input id="ma-price" type="number" min="0.01" step="0.01" placeholder="Asking price per unit"><input id="ma-min" type="number" min="0.01" step="0.01" placeholder="Minimum participation"><input id="ma-max" type="number" min="0.01" step="0.01" placeholder="Maximum participation"><input id="ma-settlement-route" placeholder="Settlement route ID"><textarea id="ma-access-rules" placeholder="Eligibility rule"></textarea><textarea id="ma-transaction-route" placeholder="Transaction route ID"></textarea><textarea id="ma-disclosures" placeholder="Risk disclosures, one per line"></textarea></div><div class="market-activation-actions"><button class="primary-button" data-maction="create-preparation">Create marketplace preparation</button></div></section>` : ''}
        ${preparation && !listing ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">PREPARATION REVIEW</p><strong>${esc(preparation.marketplacePreparationId)}</strong><p>${esc(preparation.status)}</p><div class="market-activation-actions"><button class="secondary-button" data-maction="review-preparation">Review preparation</button><button class="primary-button" data-maction="create-listing">Create prepared listing</button></div></section>` : ''}
        ${listing && !publicationReview ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">PUBLICATION REVIEW</p><strong>${esc(listing.listingId)}</strong><p>${esc(listing.state)} · ${esc(listing.publicationStatus || '')}</p><div class="market-activation-actions"><button class="primary-button" data-maction="start-publication-review">Start publication review</button></div></section>` : ''}
        ${publicationReview?.status === 'IN_REVIEW' ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">PUBLICATION DECISION</p><div class="market-activation-actions"><button class="primary-button" data-maction="authorize-publication">Authorize publication</button><button class="secondary-button" data-maction="publication-changes">Require changes</button></div></section>` : ''}
        ${publicationAuthorization && listing?.publicationStatus !== 'PUBLISHED' ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">PUBLISH LISTING</p><div class="market-activation-actions"><button class="primary-button" data-maction="publish-listing">Publish marketplace listing</button></div></section>` : ''}
        ${listing?.publicationStatus === 'PUBLISHED' && !windowRecord ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">OPEN PARTICIPATION WINDOW</p><div class="market-activation-grid"><input id="ma-window-open" type="datetime-local"><input id="ma-window-close" type="datetime-local"><input id="ma-window-capacity" type="number" min="1" step="0.01" value="${Number(listing.quantity || 0)}" placeholder="Available capacity"></div><div class="market-activation-actions"><button class="primary-button" data-maction="open-window">Open commitment window</button></div></section>` : ''}
        ${windowRecord?.status === 'OPEN' ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">PARTICIPANT COMMITMENT</p><div class="market-activation-grid"><input id="ma-participant-id" placeholder="Participant ID"><input id="ma-quantity" type="number" min="0.01" step="0.01" placeholder="Requested quantity"></div><div class="market-activation-actions"><button class="secondary-button" data-maction="create-commitment">Create commitment</button><button class="primary-button" data-maction="close-window">Close participation window</button></div></section>` : ''}
        ${commitments.length ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">COMMITMENTS</p><div class="market-activation-list">${commitments.map((item) => `<div class="market-activation-row"><strong>${esc(item.commitmentId)} · ${esc(item.status)}</strong><span>${esc(item.participantId)} · ${esc(item.requestedQuantity || item.quantity || '')}</span>${item.status === 'PENDING' ? `<div class="market-activation-actions"><button class="secondary-button" data-confirm-commitment="${esc(item.commitmentId)}">Confirm</button></div>` : ''}</div>`).join('')}</div></section>` : ''}
        ${windowRecord?.status === 'CLOSED' && !allocationReview ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">ALLOCATION REVIEW</p><div class="market-activation-actions"><button class="primary-button" data-maction="start-allocation-review">Start allocation review</button></div></section>` : ''}
        ${allocationReview?.status === 'IN_REVIEW' ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">ALLOCATION DECISION</p><div class="market-activation-actions"><button class="primary-button" data-maction="approve-allocation">Approve allocations</button><button class="secondary-button" data-maction="allocation-changes">Require changes</button></div></section>` : ''}
        ${allocationReview?.decision === 'APPROVED_FOR_ALLOCATION' && !positions.length ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">CREATE POSITIONS</p><div class="market-activation-actions"><button class="primary-button" data-maction="create-positions">Create participant positions</button></div></section>` : ''}
        ${position && !settlementPreparation ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">SETTLEMENT PREPARATION</p><strong>${esc(position.positionId)}</strong><div class="market-activation-grid"><input id="ma-payment-source" placeholder="Payment source reference"><input id="ma-destination-reference" placeholder="Destination reference"></div><div class="market-activation-actions"><button class="primary-button" data-maction="prepare-settlement">Prepare settlement</button></div></section>` : ''}
        ${settlementPreparation && !settlementReview ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">SETTLEMENT REVIEW</p><div class="market-activation-actions"><button class="primary-button" data-maction="start-settlement-review">Start settlement review</button></div></section>` : ''}
        ${settlementReview?.status === 'IN_REVIEW' ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">SETTLEMENT DECISION</p><div class="market-activation-actions"><button class="primary-button" data-maction="authorize-settlement">Authorize settlement</button><button class="secondary-button" data-maction="settlement-changes">Require changes</button></div></section>` : ''}
        ${settlementAuthorization ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">TRANSFER SETTLEMENT</p><strong>${esc(settlementAuthorization.status)}</strong><p>Verified settlement confirmation is required before participant ownership can be recognized.</p></section>` : ''}
        <div class="market-activation-result" id="market-activation-result"></div>`;

      const result = detailRoot.querySelector('#market-activation-result');
      const act = async (fn, success) => {
        try { await fn(); result.textContent = success; setTimeout(() => loadOpportunity(root), 600); }
        catch (error) { result.textContent = error.message; }
      };
      detailRoot.querySelector('[data-maction="make-position-available"]')?.addEventListener('click', () => act(
        () => request(`/api/financing-closing/positions/${encodeURIComponent(financedPosition.positionId)}/make-available`, { method: 'POST', body: JSON.stringify({ offeredAmount: Number(detailRoot.querySelector('#ma-offered-amount').value), transferRestrictions: String(detailRoot.querySelector('#ma-transfer-restrictions').value || '').split('\n').map((item) => item.trim()).filter(Boolean) }) }),
        'Funded position is now eligible for marketplace preparation.'
      ));
      detailRoot.querySelector('[data-maction="create-preparation"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace/positions/${encodeURIComponent(financedPosition.positionId)}/preparations`, { method: 'POST', body: JSON.stringify({
          distributionAuthorizationId: distributionAuthorization.distributionAuthorizationId,
          title: detailRoot.querySelector('#ma-title').value,
          summary: detailRoot.querySelector('#ma-summary').value,
          offeredQuantity: Number(detailRoot.querySelector('#ma-target').value),
          pricing: { method: 'ASK', askingPrice: Number(detailRoot.querySelector('#ma-price').value), currency: financedPosition.currency },
          accessRules: { eligibilityRule: detailRoot.querySelector('#ma-access-rules').value || null, minimumOrder: Number(detailRoot.querySelector('#ma-min').value), maximumOrder: Number(detailRoot.querySelector('#ma-max').value) },
          transactionRouteId: detailRoot.querySelector('#ma-transaction-route').value || null,
          settlementRouteId: detailRoot.querySelector('#ma-settlement-route').value || null,
          disclosures: String(detailRoot.querySelector('#ma-disclosures').value || '').split('\n').map((item) => item.trim()).filter(Boolean),
        }) }), 'Marketplace preparation created from the funded position.'
      ));
      detailRoot.querySelector('[data-maction="review-preparation"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace/preparations/${encodeURIComponent(preparation.marketplacePreparationId)}/review`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED_FOR_LISTING_CREATION', rationale: 'Funded position preparation is complete and ready for listing creation.' }) }), 'Marketplace preparation reviewed.'));
      detailRoot.querySelector('[data-maction="create-listing"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace/preparations/${encodeURIComponent(preparation.marketplacePreparationId)}/listing`, { method: 'POST', body: '{}' }), 'Prepared position listing created.'));
      detailRoot.querySelector('[data-maction="start-publication-review"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-publication/listings/${encodeURIComponent(listing.listingId)}/reviews`, { method: 'POST', body: '{}' }), 'Publication review started.'));
      detailRoot.querySelector('[data-maction="authorize-publication"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-publication/reviews/${encodeURIComponent(publicationReview.publicationReviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'AUTHORIZED_FOR_PUBLICATION', rationale: 'Funded position listing satisfies publication controls.' }) }), 'Publication authorized.'));
      detailRoot.querySelector('[data-maction="publication-changes"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-publication/reviews/${encodeURIComponent(publicationReview.publicationReviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'CHANGES_REQUIRED', rationale: 'Listing requires publication corrections.' }) }), 'Listing returned for changes.'));
      detailRoot.querySelector('[data-maction="publish-listing"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-publication/authorizations/${encodeURIComponent(publicationAuthorization.publicationAuthorizationId)}/publish`, { method: 'POST', body: '{}' }), 'Funded position listing published to the marketplace.'));
      detailRoot.querySelector('[data-maction="open-window"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-commitment/listings/${encodeURIComponent(listing.listingId)}/windows`, { method: 'POST', body: JSON.stringify({ openAt: detailRoot.querySelector('#ma-window-open').value || null, closeAt: detailRoot.querySelector('#ma-window-close').value || null, availableQuantity: Number(detailRoot.querySelector('#ma-window-capacity').value) }) }), 'Participation window opened.'));
      detailRoot.querySelector('[data-maction="create-commitment"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-commitment/windows/${encodeURIComponent(windowRecord.windowId)}/commitments`, { method: 'POST', body: JSON.stringify({ participantId: detailRoot.querySelector('#ma-participant-id').value, requestedQuantity: Number(detailRoot.querySelector('#ma-quantity').value) }) }), 'Participant commitment created.'));
      detailRoot.querySelectorAll('[data-confirm-commitment]').forEach((button) => button.addEventListener('click', () => act(() => request(`/api/funding-marketplace-commitment/commitments/${encodeURIComponent(button.dataset.confirmCommitment)}/confirm`, { method: 'POST', body: '{}' }), 'Commitment confirmed.')));
      detailRoot.querySelector('[data-maction="close-window"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-allocation/windows/${encodeURIComponent(windowRecord.windowId)}/close`, { method: 'POST', body: '{}' }), 'Participation window closed.'));
      detailRoot.querySelector('[data-maction="start-allocation-review"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-allocation/windows/${encodeURIComponent(windowRecord.windowId)}/reviews`, { method: 'POST', body: '{}' }), 'Allocation review started.'));
      detailRoot.querySelector('[data-maction="approve-allocation"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-allocation/reviews/${encodeURIComponent(allocationReview.allocationReviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED_FOR_ALLOCATION', rationale: 'Confirmed commitments are ready for participant position creation.' }) }), 'Allocations approved.'));
      detailRoot.querySelector('[data-maction="allocation-changes"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-allocation/reviews/${encodeURIComponent(allocationReview.allocationReviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'CHANGES_REQUIRED', rationale: 'Allocation requires correction.' }) }), 'Allocation returned for changes.'));
      detailRoot.querySelector('[data-maction="create-positions"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-allocation/reviews/${encodeURIComponent(allocationReview.allocationReviewId)}/positions`, { method: 'POST', body: '{}' }), 'Participant positions created.'));
      detailRoot.querySelector('[data-maction="prepare-settlement"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-allocation/positions/${encodeURIComponent(position.positionId)}/settlement-preparation`, { method: 'POST', body: JSON.stringify({ paymentSourceReference: detailRoot.querySelector('#ma-payment-source').value || null, destinationReference: detailRoot.querySelector('#ma-destination-reference').value || null }) }), 'Transfer settlement preparation created.'));
      detailRoot.querySelector('[data-maction="start-settlement-review"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-settlement/preparations/${encodeURIComponent(settlementPreparation.settlementPreparationId)}/reviews`, { method: 'POST', body: '{}' }), 'Settlement review started.'));
      detailRoot.querySelector('[data-maction="authorize-settlement"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-settlement/reviews/${encodeURIComponent(settlementReview.settlementReviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'AUTHORIZED', rationale: 'Transfer settlement preparation satisfies the ownership recognition controls.' }) }), 'Settlement authorized; confirmation is now required.'));
      detailRoot.querySelector('[data-maction="settlement-changes"]')?.addEventListener('click', () => act(() => request(`/api/funding-marketplace-settlement/reviews/${encodeURIComponent(settlementReview.settlementReviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'CHANGES_REQUIRED', rationale: 'Settlement preparation requires correction.' }) }), 'Settlement returned for changes.'));
    } catch (error) {
      detailRoot.innerHTML = `<strong>Funded position marketplace workspace could not load.</strong><p>${esc(error.message)}</p>`;
    }
  }

  async function mount(fundingRoot) {
    if (!fundingRoot || fundingRoot.querySelector('#funding-market-activation-desk')) return;
    addStyle();
    try {
      const dashboard = await request('/api/funding-operations/dashboard');
      if (!fundingRoot.isConnected || fundingRoot.querySelector('#funding-market-activation-desk')) return;
      const candidates = dashboard.queue || [];
      const section = document.createElement('section');
      section.className = 'market-activation-desk';
      section.id = 'funding-market-activation-desk';
      section.innerHTML = `<div class="funding-panel-head"><div><p class="eyebrow">POST-FINANCING DISTRIBUTION</p><h3>Funded positions and marketplace</h3><p>Financing creates the position first. SRA may retain it, make part of it available, or make the entire position available. Participant activity begins only after that decision.</p></div></div><select id="market-activation-opportunity" style="margin-top:12px"><option value="">Select opportunity</option>${candidates.map((item) => `<option value="${esc(item.opportunityId)}">${esc(item.title || item.opportunityId)} · ${esc(item.status)}</option>`).join('')}</select><div id="market-activation-detail" style="margin-top:12px"><div class="funding-ops-empty">Select an opportunity to inspect its funded position and optional distribution state.</div></div>`;
      fundingRoot.append(section);
      section.querySelector('#market-activation-opportunity')?.addEventListener('change', () => loadOpportunity(section));
    } catch (error) {
      const section = document.createElement('section');
      section.className = 'market-activation-desk';
      section.id = 'funding-market-activation-desk';
      section.innerHTML = `<strong>Funded position marketplace desk could not load.</strong><p>${esc(error.message)}</p>`;
      fundingRoot.append(section);
    }
  }

  window.mountFundingMarketActivationDesk = mount;
  window.addEventListener('sra:funding-operations-rendered', (event) => {
    const fundingRoot = event.detail?.root?.querySelector('.funding-ops');
    if (fundingRoot) void mount(fundingRoot);
  });
})();