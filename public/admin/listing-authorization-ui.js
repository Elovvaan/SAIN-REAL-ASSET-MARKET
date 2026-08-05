(() => {
  let readinessPreview = null;
  let publicationPreview = null;
  let timer = null;

  function number(value) { return Number(value || 0).toLocaleString(); }
  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  async function request(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed.');
    return payload;
  }

  function ensureStyles() {
    if (document.querySelector('#listing-authorization-styles')) return;
    const style = document.createElement('style');
    style.id = 'listing-authorization-styles';
    style.textContent = `
      .listing-authorization{margin-top:16px;padding:16px;border:1px solid #3f3519;border-radius:14px;background:linear-gradient(180deg,#151207,#0b0905)}
      .listing-authorization-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:13px}.listing-authorization-head h3{margin:0;font-size:15px}.listing-authorization-head p{margin:4px 0 0;color:#a3a3a3;font-size:12px;line-height:1.45}
      .movement-pill{display:flex;align-items:center;gap:7px;color:#72c78b;font-size:11px;white-space:nowrap}.movement-dot{width:8px;height:8px;border-radius:50%;background:#72c78b;box-shadow:0 0 0 0 rgba(114,199,139,.55);animation:sraPulse 1.7s infinite}@keyframes sraPulse{0%{box-shadow:0 0 0 0 rgba(114,199,139,.5)}70%{box-shadow:0 0 0 8px rgba(114,199,139,0)}100%{box-shadow:0 0 0 0 rgba(114,199,139,0)}}
      .authorization-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:9px}.authorization-grid label{margin:0;color:#a3a3a3;font-size:10px}.authorization-grid input,.authorization-grid select{margin-top:5px;padding:9px;font-size:12px}
      .authorization-impact{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin-top:13px}.authorization-impact div{padding:10px;border:1px solid #292929;border-radius:10px;background:#0b0b0b}.authorization-impact span{display:block;color:#a3a3a3;font-size:10px}.authorization-impact strong{display:block;margin-top:4px;font-size:16px}
      .authorization-stage{margin-top:14px;padding-top:14px;border-top:1px solid #3f3519}.authorization-stage h4{margin:0 0 4px;font-size:13px}.authorization-stage>p{margin:0 0 10px;color:#a3a3a3;font-size:11px}
      .authorization-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:13px}.authorization-actions p{margin:0;color:#a3a3a3;font-size:12px;flex:1;min-width:230px}.authorization-warning{margin-top:11px;padding:10px;border-radius:10px;background:#100d08;color:#d9c88d;font-size:11px;line-height:1.45}.publication-button{background:#1f7a58!important;border-color:#2b9c72!important;color:#fff!important}
      @media(max-width:1100px){.authorization-grid{grid-template-columns:repeat(3,1fr)}.authorization-impact{grid-template-columns:repeat(2,1fr)}}@media(max-width:600px){.listing-authorization-head{display:grid}.authorization-grid,.authorization-impact{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function ensurePanel() {
    const blockers = document.querySelector('#listing-blockers');
    if (!blockers || document.querySelector('#listing-authorization')) return;
    blockers.insertAdjacentHTML('afterend', `
      <section id="listing-authorization" class="listing-authorization">
        <div class="listing-authorization-head">
          <div><h3>Instrument Authorization Cycle</h3><p>The market keeps preparing records automatically. You control the two protected transitions below.</p></div>
          <span class="movement-pill"><span class="movement-dot"></span><span id="market-cycle-state">CHECKING MOVEMENT</span></span>
        </div>
        <div class="authorization-impact" id="authorization-impact"></div>
        <div class="authorization-stage">
          <h4>1. Readiness authorization</h4>
          <p>Approve the USD unit price, access policy, transaction route, and settlement route for all currently eligible prepared listings.</p>
          <div class="authorization-grid">
            <label>USD unit price<input id="batch-unit-price" type="number" min="0.00000001" step="any" value="1"></label>
            <label>Pricing method<select id="batch-price-method"><option value="ADMIN_APPROVED_SRA_USD_UNIT_PRICE">Approved SRA / USD unit price</option></select></label>
            <label>Participant access<select id="batch-access-rule"><option value="SRA_REGISTERED_PARTICIPANTS">SRA registered participants</option></select></label>
            <label>Minimum order<input id="batch-minimum-order" type="number" min="0.00000001" step="any" value="1"></label>
            <label>Transaction route<select id="batch-transaction-route"><option value="SRA_INTERNAL_MARKETPLACE">SRA internal marketplace</option></select></label>
            <label>Settlement route<select id="batch-settlement-route"><option value="SRA_INTERNAL_SETTLEMENT">SRA internal settlement</option></select></label>
          </div>
          <div class="authorization-actions"><button id="preview-listing-batch">Preview readiness</button><button id="approve-listing-batch" class="primary" disabled>Authorize readiness</button><p id="authorization-message">Loading the current readiness boundary.</p></div>
          <div class="authorization-warning">This stage clears the five readiness controls. It does not make the listings live.</div>
        </div>
        <div class="authorization-stage">
          <h4>2. Publication authorization</h4>
          <p>Publish only listings that already passed readiness authorization. This makes them visible as LIVE SRA / USD inventory.</p>
          <div class="authorization-actions"><button id="preview-publication-batch">Preview publication</button><button id="approve-publication-batch" class="primary publication-button" disabled>Authorize publication</button><p id="publication-message">Loading the current publication boundary.</p></div>
          <div class="authorization-warning">Publication does not create an order, transaction, allocation, settlement, ownership recognition, or export package. Participant confirmation remains required.</div>
        </div>
      </section>`);
    document.querySelector('#preview-listing-batch')?.addEventListener('click', loadReadiness);
    document.querySelector('#approve-listing-batch')?.addEventListener('click', approveReadiness);
    document.querySelector('#preview-publication-batch')?.addEventListener('click', loadPublication);
    document.querySelector('#approve-publication-batch')?.addEventListener('click', approvePublication);
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

  function render() {
    const readinessStatus = readinessPreview?.status || {};
    const readiness = readinessPreview?.preview || {};
    const publicationStatus = publicationPreview?.status || {};
    const publication = publicationPreview?.preview || {};
    const eligible = Number(readiness.eligibleListingCount ?? readinessStatus.eligibleForBatch ?? 0);
    const ready = Number(publication.eligibleListingCount ?? readinessStatus.readyForPublicationApproval ?? 0);
    const live = Number(publicationStatus.liveListingCount || 0);
    const approvedReadiness = Number(readinessStatus.approvedBatchCount || 0);
    const approvedPublication = Number(publicationStatus.approvedPublicationBatchCount || 0);
    const impact = document.querySelector('#authorization-impact');
    if (impact) impact.innerHTML = `
      <div><span>Preparing / eligible</span><strong>${number(eligible)}</strong></div>
      <div><span>Ready for publication</span><strong>${number(ready)}</strong></div>
      <div><span>Live listings</span><strong>${number(live)}</strong></div>
      <div><span>Readiness batches</span><strong>${number(approvedReadiness)}</strong></div>
      <div><span>Publication batches</span><strong>${number(approvedPublication)}</strong></div>`;
    const readinessButton = document.querySelector('#approve-listing-batch');
    const publicationButton = document.querySelector('#approve-publication-batch');
    if (readinessButton) readinessButton.disabled = eligible === 0;
    if (publicationButton) publicationButton.disabled = ready === 0;
    const readinessMessage = document.querySelector('#authorization-message');
    const publicationMessage = document.querySelector('#publication-message');
    if (readinessMessage) readinessMessage.textContent = eligible ? `${number(eligible)} prepared listings are waiting for readiness authorization at $${Number(readiness.policy?.unitPrice || policyInput().unitPrice).toLocaleString()} per SRA.` : 'No readiness authorization is waiting right now.';
    if (publicationMessage) publicationMessage.textContent = ready ? `${number(ready)} authorized listings are waiting for your publication decision.` : 'No publication authorization is waiting right now.';
    const cycle = document.querySelector('#market-cycle-state');
    if (cycle) cycle.textContent = eligible ? 'READINESS WAITING' : ready ? 'PUBLICATION WAITING' : 'MARKET CYCLE CURRENT';
  }

  async function loadReadiness() {
    ensureStyles(); ensurePanel();
    try {
      const query = new URLSearchParams(policyInput()).toString();
      readinessPreview = await request(`/api/admin/listing-readiness-batch?${query}`);
      render();
    } catch (error) { const message = document.querySelector('#authorization-message'); if (message) message.textContent = error.message; }
  }
  async function loadPublication() {
    ensureStyles(); ensurePanel();
    try { publicationPreview = await request('/api/admin/listing-publication-batch'); render(); }
    catch (error) { const message = document.querySelector('#publication-message'); if (message) message.textContent = error.message; }
  }
  async function loadAll() { await Promise.all([loadReadiness(), loadPublication()]); }

  async function approveReadiness() {
    const count = Number(readinessPreview?.preview?.eligibleListingCount || 0);
    if (!count) return;
    const unitPrice = Number(policyInput().unitPrice || 0);
    if (!confirm(`Authorize readiness for ${number(count)} SRA / USD instruments at $${unitPrice} per SRA? This will not publish them.`)) return;
    const button = document.querySelector('#approve-listing-batch');
    button.disabled = true; button.textContent = 'Authorizing readiness...';
    try {
      const result = await request('/api/admin/listing-readiness-batch/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...policyInput(), approval: 'APPROVE' }) });
      window.append?.(`Readiness batch ${result.batchId} approved. ${number(result.updatedListingCount)} listings moved to READY_FOR_PUBLICATION_APPROVAL at $${result.policy?.unitPrice} per SRA.`, 'agent');
      await window.loadSummary?.(); await loadAll();
    } catch (error) { document.querySelector('#authorization-message').textContent = error.message; }
    finally { button.textContent = 'Authorize readiness'; }
  }

  async function approvePublication() {
    const count = Number(publicationPreview?.preview?.eligibleListingCount || 0);
    if (!count) return;
    if (!confirm(`Publish ${number(count)} authorized SRA / USD listings to the live marketplace? No orders or settlements will be created.`)) return;
    const button = document.querySelector('#approve-publication-batch');
    button.disabled = true; button.textContent = 'Publishing...';
    try {
      const result = await request('/api/admin/listing-publication-batch/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval: 'APPROVE' }) });
      window.append?.(`Publication batch ${result.batchId} approved. ${number(result.publishedListingCount)} SRA / USD listings are now LIVE. Transactions created: 0.`, 'agent');
      await window.loadSummary?.(); await loadAll();
    } catch (error) { document.querySelector('#publication-message').textContent = error.message; }
    finally { button.textContent = 'Authorize publication'; }
  }

  function startPulse() {
    clearInterval(timer);
    timer = setInterval(async () => {
      if (document.querySelector('#admin-view:not(.hidden)')) {
        try { await window.loadSummary?.(); await loadAll(); } catch {}
      }
    }, 15000);
  }

  window.addEventListener('DOMContentLoaded', () => {
    ensureStyles();
    const observer = new MutationObserver(() => {
      if (document.querySelector('#admin-view:not(.hidden)')) { ensurePanel(); loadAll(); startPulse(); }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    setTimeout(() => { ensurePanel(); if (document.querySelector('#admin-view:not(.hidden)')) { loadAll(); startPulse(); } }, 300);
  });
})();