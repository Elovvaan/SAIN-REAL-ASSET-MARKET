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
    if (!opportunityId) {
      detailRoot.innerHTML = '<div class="funding-ops-empty">Select an opportunity in marketplace preparation, publication, commitments, allocation, or settlement.</div>';
      return;
    }
    detailRoot.innerHTML = '<div class="loading-state">Loading marketplace activation workspace…</div>';

    try {
      const detail = await request(`/api/funding-operations/opportunities/${encodeURIComponent(opportunityId)}`);
      const opportunity = detail.opportunity;
      const instrument = (detail.instruments || []).at(-1) || null;
      const listing = (detail.listings || []).at(-1) || null;
      const commitments = detail.commitments || [];
      const positions = detail.positions || [];
      const settlements = detail.settlements || [];

      const preparations = instrument ? await request(`/api/funding-marketplace/preparations?instrumentId=${encodeURIComponent(instrument.instrumentId)}`).catch(() => ({ records: [] })) : { records: [] };
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
      const settlementAuthorization = settlementAuthorizations.records?.find((item) => item.status === 'AUTHORIZED') || null;

      detailRoot.innerHTML = `
        <div class="market-activation-grid">
          <section class="market-activation-card"><p class="eyebrow">OPPORTUNITY</p><strong>${esc(opportunity.title || opportunity.opportunityId)}</strong><p>${esc(opportunity.status)} · ${esc(opportunity.fundingPhase || '')}</p><p>${money.format(Number(opportunity.requestedAmount || 0))}</p></section>
          <section class="market-activation-card"><p class="eyebrow">MARKET STATE</p><strong>${esc(listing?.listingId || 'No listing')}</strong><p>${esc(listing?.state || 'Not prepared')} · ${esc(listing?.publicationStatus || '')}</p><p>${commitments.length} commitments · ${positions.length} positions</p></section>
        </div>

        ${instrument && !preparation ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">LISTING PREPARATION</p><div class="market-activation-grid"><input id="ma-title" value="${esc(opportunity.title || '')}" placeholder="Listing title"><textarea id="ma-summary" placeholder="Public summary">${esc(opportunity.description || '')}</textarea><input id="ma-target" type="number" min="1" step="0.01" value="${Number(opportunity.requestedAmount || instrument.faceValue || 0)}" placeholder="Target amount"><input id="ma-price" type="number" min="0.01" step="0.01" placeholder="Listing price"><input id="ma-min" type="number" min="0.01" step="0.01" placeholder="Minimum participation"><input id="ma-max" type="number" min="0.01" step="0.01" placeholder="Maximum participation"><input id="ma-open" type="datetime-local"><input id="ma-close" type="datetime-local"><input id="ma-settlement-route" placeholder="Settlement route"><textarea id="ma-access-rules" placeholder="Market access rules"></textarea><textarea id="ma-transaction-route" placeholder="Transaction route"></textarea><textarea id="ma-disclosures" placeholder="Risk disclosures"></textarea></div><div class="market-activation-actions"><button class="primary-button" data-maction="create-preparation">Create marketplace preparation</button></div></section>` : ''}

        ${preparation && !listing ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">PREPARATION REVIEW</p><strong>${esc(preparation.preparationId)}</strong><p>${esc(preparation.status)}</p><div class="market-activation-actions"><button class="secondary-button" data-maction="review-preparation">Review preparation</button><button class="primary-button" data-maction="create-listing">Create prepared listing</button></div></section>` : ''}

        ${listing && !publicationReview ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">PUBLICATION REVIEW</p><strong>${esc(listing.listingId)}</strong><p>${esc(listing.state)} · ${esc(listing.publicationStatus || '')}</p><div class="market-activation-actions"><button class="primary-button" data-maction="start-publication-review">Start publication review</button></div></section>` : ''}

        ${publicationReview?.status === 'IN_REVIEW' ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">PUBLICATION DECISION</p><div class="market-activation-actions"><button class="primary-button" data-maction="authorize-publication">Authorize publication</button><button class="secondary-button" data-maction="publication-changes">Require changes</button></div></section>` : ''}

        ${publicationAuthorization && listing?.publicationStatus !== 'PUBLISHED' ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">PUBLISH LISTING</p><div class="market-activation-actions"><button class="primary-button" data-maction="publish-listing">Publish marketplace listing</button></div></section>` : ''}

        ${listing?.publicationStatus === 'PUBLISHED' && !windowRecord ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">OPEN PARTICIPATION WINDOW</p><div class="market-activation-grid"><input id="ma-window-open" type="datetime-local"><input id="ma-window-close" type="datetime-local"><input id="ma-window-capacity" type="number" min="1" step="0.01" value="${Number(listing.availableQuantity || listing.targetAmount || opportunity.requestedAmount || 0)}" placeholder="Available capacity"></div><div class="market-activation-actions"><button class="primary-button" data-maction="open-window">Open commitment window</button></div></section>` : ''}

        ${windowRecord?.status === 'OPEN' ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">CUSTOMER COMMITMENT</p><div class="market-activation-grid"><input id="ma-participant-id" placeholder="Participant ID"><input id="ma-quantity" type="number" min="0.01" step="0.01" placeholder="Requested quantity"></div><div class="market-activation-actions"><button class="secondary-button" data-maction="create-commitment">Create commitment</button><button class="primary-button" data-maction="close-window">Close participation window</button></div></section>` : ''}

        ${commitments.length ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">COMMITMENTS</p><div class="market-activation-list">${commitments.map((item) => `<div class="market-activation-row"><strong>${esc(item.commitmentId)} · ${esc(item.status)}</strong><span>${esc(item.participantId)} · ${esc(item.requestedQuantity || item.quantity || '')}</span>${item.status === 'PENDING' ? `<div class="market-activation-actions"><button class="secondary-button" data-confirm-commitment="${esc(item.commitmentId)}">Confirm</button></div>` : ''}</div>`).join('')}</div></section>` : ''}

        ${windowRecord?.status === 'CLOSED' && !allocationReview ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">ALLOCATION REVIEW</p><div class="market-activation-actions"><button class="primary-button" data-maction="start-allocation-review">Start allocation review</button></div></section>` : ''}

        ${allocationReview?.status === 'IN_REVIEW' ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">ALLOCATION DECISION</p><div class="market-activation-actions"><button class="primary-button" data-maction="approve-allocation">Approve allocations</button><button class="secondary-button" data-maction="allocation-changes">Require changes</button></div></section>` : ''}

        ${allocationReview?.decision === 'APPROVED' && !positions.length ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">CREATE POSITIONS</p><div class="market-activation-actions"><button class="primary-button" data-maction="create-positions">Create ownership positions</button></div></section>` : ''}

        ${position && !settlementPreparation ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">SETTLEMENT PREPARATION</p><strong>${esc(position.positionId)}</strong><div class="market-activation-grid"><input id="ma-settlement-route-final" placeholder="Settlement route"><input id="ma-settlement-reference" placeholder="Settlement reference"></div><div class="market-activation-actions"><button class="primary-button" data-maction="prepare-settlement">Prepare settlement</button></div></section>` : ''}

        ${settlementPreparation && !settlementReview ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">SETTLEMENT REVIEW</p><div class="market-activation-actions"><button class="primary-button" data-maction="start-settlement-review">Start settlement review</button></div></section>` : ''}

        ${settlementReview?.status === 'IN_REVIEW' ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">SETTLEMENT DECISION</p><div class="market-activation-actions"><button class="primary-button" data-maction="authorize-settlement">Authorize settlement</button><button class="secondary-button" data-maction="settlement-changes">Require changes</button></div></section>` : ''}

        ${settlementAuthorization && position?.ownershipStatus !== 'RECOGNIZED' ? `<section class="market-activation-card" style="margin-top:12px"><p class="eyebrow">RECOGNIZE OWNERSHIP</p><div class="market-activation-actions"><button class="primary-button" data-maction="settle-position">Settle and recognize position</button></div></section>` : ''}

        <div class="market-activation-result" id="market-activation-result"></div>`;

      const result = detailRoot.querySelector('#market-activation-result');
      const act = async (fn, success) => {
        try { await fn(); result.textContent = success; setTimeout(() => loadOpportunity(root), 600); }
        catch (error) { result.textContent = error.message; }
      };

      detailRoot.querySelector('[data-maction="create-preparation"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace/instruments/${encodeURIComponent(instrument.instrumentId)}/preparations`, { method: 'POST', body: JSON.stringify({
          listingTitle: detailRoot.querySelector('#ma-title').value,
          publicSummary: detailRoot.querySelector('#ma-summary').value,
          targetAmount: Number(detailRoot.querySelector('#ma-target').value),
          listingPrice: Number(detailRoot.querySelector('#ma-price').value),
          minimumParticipation: Number(detailRoot.querySelector('#ma-min').value),
          maximumParticipation: Number(detailRoot.querySelector('#ma-max').value),
          openAt: detailRoot.querySelector('#ma-open').value || null,
          closeAt: detailRoot.querySelector('#ma-close').value || null,
          settlementRoute: detailRoot.querySelector('#ma-settlement-route').value || null,
          marketAccessRules: detailRoot.querySelector('#ma-access-rules').value || null,
          transactionRoute: detailRoot.querySelector('#ma-transaction-route').value || null,
          riskDisclosures: detailRoot.querySelector('#ma-disclosures').value || null,
        }) }), 'Marketplace preparation created.'
      ));
      detailRoot.querySelector('[data-maction="review-preparation"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace/preparations/${encodeURIComponent(preparation.preparationId)}/review`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED', rationale: 'Marketplace preparation is complete and ready for listing creation.' }) }), 'Marketplace preparation reviewed.'
      ));
      detailRoot.querySelector('[data-maction="create-listing"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace/preparations/${encodeURIComponent(preparation.preparationId)}/listing`, { method: 'POST', body: '{}' }), 'Prepared listing created.'
      ));
      detailRoot.querySelector('[data-maction="start-publication-review"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-publication/listings/${encodeURIComponent(listing.listingId)}/reviews`, { method: 'POST', body: '{}' }), 'Publication review started.'
      ));
      detailRoot.querySelector('[data-maction="authorize-publication"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-publication/reviews/${encodeURIComponent(publicationReview.reviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'AUTHORIZED', rationale: 'Listing satisfies publication controls.' }) }), 'Publication authorized.'
      ));
      detailRoot.querySelector('[data-maction="publication-changes"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-publication/reviews/${encodeURIComponent(publicationReview.reviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'CHANGES_REQUIRED', rationale: 'Listing requires publication corrections.' }) }), 'Listing returned for changes.'
      ));
      detailRoot.querySelector('[data-maction="publish-listing"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-publication/authorizations/${encodeURIComponent(publicationAuthorization.publicationAuthorizationId)}/publish`, { method: 'POST', body: '{}' }), 'Listing published to the marketplace.'
      ));
      detailRoot.querySelector('[data-maction="open-window"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-commitment/listings/${encodeURIComponent(listing.listingId)}/windows`, { method: 'POST', body: JSON.stringify({ openAt: detailRoot.querySelector('#ma-window-open').value || null, closeAt: detailRoot.querySelector('#ma-window-close').value || null, availableQuantity: Number(detailRoot.querySelector('#ma-window-capacity').value) }) }), 'Participation window opened.'
      ));
      detailRoot.querySelector('[data-maction="create-commitment"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-commitment/windows/${encodeURIComponent(windowRecord.windowId)}/commitments`, { method: 'POST', body: JSON.stringify({ participantId: detailRoot.querySelector('#ma-participant-id').value, requestedQuantity: Number(detailRoot.querySelector('#ma-quantity').value) }) }), 'Customer commitment created.'
      ));
      detailRoot.querySelectorAll('[data-confirm-commitment]').forEach((button) => button.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-commitment/commitments/${encodeURIComponent(button.dataset.confirmCommitment)}/confirm`, { method: 'POST', body: '{}' }), 'Commitment confirmed.'
      )));
      detailRoot.querySelector('[data-maction="close-window"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-allocation/windows/${encodeURIComponent(windowRecord.windowId)}/close`, { method: 'POST', body: '{}' }), 'Participation window closed.'
      ));
      detailRoot.querySelector('[data-maction="start-allocation-review"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-allocation/windows/${encodeURIComponent(windowRecord.windowId)}/reviews`, { method: 'POST', body: '{}' }), 'Allocation review started.'
      ));
      detailRoot.querySelector('[data-maction="approve-allocation"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-allocation/reviews/${encodeURIComponent(allocationReview.reviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED', rationale: 'Confirmed commitments are ready for position creation.' }) }), 'Allocations approved.'
      ));
      detailRoot.querySelector('[data-maction="allocation-changes"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-allocation/reviews/${encodeURIComponent(allocationReview.reviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'CHANGES_REQUIRED', rationale: 'Allocation requires correction.' }) }), 'Allocation returned for changes.'
      ));
      detailRoot.querySelector('[data-maction="create-positions"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-allocation/reviews/${encodeURIComponent(allocationReview.reviewId)}/positions`, { method: 'POST', body: '{}' }), 'Ownership positions created.'
      ));
      detailRoot.querySelector('[data-maction="prepare-settlement"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-allocation/positions/${encodeURIComponent(position.positionId)}/settlement-preparation`, { method: 'POST', body: JSON.stringify({ settlementRoute: detailRoot.querySelector('#ma-settlement-route-final').value || null, settlementReference: detailRoot.querySelector('#ma-settlement-reference').value || null }) }), 'Settlement preparation created.'
      ));
      detailRoot.querySelector('[data-maction="start-settlement-review"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-settlement/preparations/${encodeURIComponent(settlementPreparation.settlementPreparationId)}/reviews`, { method: 'POST', body: '{}' }), 'Settlement review started.'
      ));
      detailRoot.querySelector('[data-maction="authorize-settlement"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-settlement/reviews/${encodeURIComponent(settlementReview.reviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'AUTHORIZED', rationale: 'Settlement preparation satisfies the ownership recognition controls.' }) }), 'Settlement authorized.'
      ));
      detailRoot.querySelector('[data-maction="settlement-changes"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-settlement/reviews/${encodeURIComponent(settlementReview.reviewId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'CHANGES_REQUIRED', rationale: 'Settlement preparation requires correction.' }) }), 'Settlement returned for changes.'
      ));
      detailRoot.querySelector('[data-maction="settle-position"]')?.addEventListener('click', () => act(
        () => request(`/api/funding-marketplace-settlement/authorizations/${encodeURIComponent(settlementAuthorization.settlementAuthorizationId)}/settle`, { method: 'POST', body: '{}' }), 'Position settled and ownership recognized.'
      ));
    } catch (error) {
      detailRoot.innerHTML = `<strong>Marketplace activation workspace could not load.</strong><p>${esc(error.message)}</p>`;
    }
  }

  async function mount() {
    const fundingRoot = document.querySelector('#view-root .funding-ops');
    if (!fundingRoot || fundingRoot.querySelector('#funding-market-activation-desk')) return;
    try {
      const dashboard = await request('/api/funding-operations/dashboard');
      const candidates = (dashboard.queue || []).filter((item) => ['INSTRUMENT_ISSUED', 'MARKETPLACE_LISTING_PREPARED', 'MARKETPLACE_LIVE', 'ALLOCATION_CREATED', 'POSITION_SETTLED'].includes(item.status));
      const section = document.createElement('section');
      section.className = 'market-activation-desk';
      section.id = 'funding-market-activation-desk';
      section.innerHTML = `<div class="funding-panel-head"><div><p class="eyebrow">PHASE 8–12 WORK DESK</p><h3>Marketplace activation and ownership</h3><p>Prepare and publish the listing, open participation, record commitments, allocate positions, settle, and recognize ownership.</p></div></div><select id="market-activation-opportunity" style="margin-top:12px"><option value="">Select opportunity</option>${candidates.map((item) => `<option value="${esc(item.opportunityId)}">${esc(item.title || item.opportunityId)} · ${esc(item.status)}</option>`).join('')}</select><div id="market-activation-detail" style="margin-top:12px"><div class="funding-ops-empty">Select an opportunity in marketplace preparation, publication, commitments, allocation, or settlement.</div></div>`;
      fundingRoot.append(section);
      section.querySelector('#market-activation-opportunity').addEventListener('change', () => loadOpportunity(section));
    } catch {
      // Funding Operations owns its own error state.
    }
  }

  addStyle();
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('DOMContentLoaded', mount);
})();
