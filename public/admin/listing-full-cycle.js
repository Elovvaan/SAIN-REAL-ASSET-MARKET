(() => {
  async function request(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed.');
    return payload;
  }

  function policyInput() {
    return {
      unitPrice: Number(document.querySelector('#batch-unit-price')?.value || 1),
      askingPriceMethod: document.querySelector('#batch-price-method')?.value || 'ADMIN_APPROVED_SRA_USD_UNIT_PRICE',
      eligibilityRule: document.querySelector('#batch-access-rule')?.value || 'SRA_REGISTERED_PARTICIPANTS',
      minimumOrder: Number(document.querySelector('#batch-minimum-order')?.value || 1),
      transactionRouteId: document.querySelector('#batch-transaction-route')?.value || 'SRA_INTERNAL_MARKETPLACE',
      settlementRouteId: document.querySelector('#batch-settlement-route')?.value || 'SRA_INTERNAL_SETTLEMENT'
    };
  }

  function ensureButton() {
    const panel = document.querySelector('#listing-authorization');
    if (!panel || document.querySelector('#authorize-current-market-cycle')) return;
    const actions = document.createElement('div');
    actions.className = 'authorization-actions';
    actions.style.marginTop = '16px';
    actions.style.paddingTop = '14px';
    actions.style.borderTop = '1px solid #3f3519';
    actions.innerHTML = '<button id="authorize-current-market-cycle" class="primary publication-button">Authorize Current Market Cycle</button><p id="full-cycle-message">Moves every currently eligible prepared listing through readiness and publication, then verifies the live count.</p>';
    panel.append(actions);
    document.querySelector('#authorize-current-market-cycle')?.addEventListener('click', authorizeCycle);
  }

  async function authorizeCycle() {
    const button = document.querySelector('#authorize-current-market-cycle');
    const message = document.querySelector('#full-cycle-message');
    const readiness = await request(`/api/admin/listing-readiness-batch?${new URLSearchParams(policyInput())}`);
    const prepared = Number(readiness.preview?.eligibleListingCount || 0);
    const publicationBefore = await request('/api/admin/listing-publication-batch');
    const alreadyReady = Number(publicationBefore.preview?.eligibleListingCount || 0);
    if (!prepared && !alreadyReady) {
      message.textContent = 'No prepared or publication-ready listings are waiting right now.';
      return;
    }
    if (!confirm(`Authorize the current market cycle for ${prepared + alreadyReady} listings? This applies readiness terms and publishes eligible SRA / USD listings. It does not create orders or settlements.`)) return;
    button.disabled = true;
    button.textContent = 'Authorizing cycle...';
    try {
      let readinessResult = { updatedListingCount: 0 };
      if (prepared) readinessResult = await request('/api/admin/listing-readiness-batch/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...policyInput(), approval: 'APPROVE' }) });
      const publicationPreview = await request('/api/admin/listing-publication-batch');
      const ready = Number(publicationPreview.preview?.eligibleListingCount || 0);
      let publicationResult = { publishedListingCount: 0 };
      if (ready) publicationResult = await request('/api/admin/listing-publication-batch/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval: 'APPROVE' }) });
      const verification = await request('/api/admin/listing-publication-batch');
      const live = Number(verification.status?.liveListingCount || 0);
      message.textContent = `${Number(readinessResult.updatedListingCount || 0).toLocaleString()} listings passed readiness; ${Number(publicationResult.publishedListingCount || 0).toLocaleString()} were published. Verified live listings: ${live.toLocaleString()}.`;
      window.append?.(message.textContent, 'agent');
      await window.loadSummary?.();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Authorize Current Market Cycle';
    }
  }

  const observer = new MutationObserver(ensureButton);
  window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(ensureButton, 500);
  });
})();