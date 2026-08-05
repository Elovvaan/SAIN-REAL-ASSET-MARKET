(() => {
  let preview = null;
  let timer = null;

  function number(value) {
    return Number(value || 0).toLocaleString();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
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
      .listing-authorization-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:13px}
      .listing-authorization-head h3{margin:0;font-size:15px}.listing-authorization-head p{margin:4px 0 0;color:#a3a3a3;font-size:12px;line-height:1.45}
      .movement-pill{display:flex;align-items:center;gap:7px;color:#72c78b;font-size:11px;white-space:nowrap}.movement-dot{width:8px;height:8px;border-radius:50%;background:#72c78b;box-shadow:0 0 0 0 rgba(114,199,139,.55);animation:sraPulse 1.7s infinite}
      @keyframes sraPulse{0%{box-shadow:0 0 0 0 rgba(114,199,139,.5)}70%{box-shadow:0 0 0 8px rgba(114,199,139,0)}100%{box-shadow:0 0 0 0 rgba(114,199,139,0)}}
      .authorization-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}.authorization-grid label{margin:0;color:#a3a3a3;font-size:10px}.authorization-grid input,.authorization-grid select{margin-top:5px;padding:9px;font-size:12px}
      .authorization-impact{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-top:13px}.authorization-impact div{padding:10px;border:1px solid #292929;border-radius:10px;background:#0b0b0b}.authorization-impact span{display:block;color:#a3a3a3;font-size:10px}.authorization-impact strong{display:block;margin-top:4px;font-size:16px}
      .authorization-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:13px}.authorization-actions p{margin:0;color:#a3a3a3;font-size:12px;flex:1;min-width:230px}.authorization-warning{margin-top:11px;padding:10px;border-radius:10px;background:#100d08;color:#d9c88d;font-size:11px;line-height:1.45}
      @media(max-width:1000px){.authorization-grid{grid-template-columns:repeat(2,1fr)}.authorization-impact{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:600px){.listing-authorization-head{display:grid}.authorization-grid,.authorization-impact{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function ensurePanel() {
    const blockers = document.querySelector('#listing-blockers');
    if (!blockers || document.querySelector('#listing-authorization')) return;
    blockers.insertAdjacentHTML('afterend', `
      <section id="listing-authorization" class="listing-authorization">
        <div class="listing-authorization-head">
          <div><h3>Instrument Authorization Cycle</h3><p>Apply one governed readiness policy to all currently eligible prepared listings.</p></div>
          <span class="movement-pill"><span class="movement-dot"></span><span id="market-cycle-state">CHECKING MOVEMENT</span></span>
        </div>
        <div class="authorization-grid">
          <label>Pricing method<select id="batch-price-method"><option value="RECORDED_TRANSACTION_VALUE">Recorded transaction value</option></select></label>
          <label>Participant access<select id="batch-access-rule"><option value="SRA_REGISTERED_PARTICIPANTS">SRA registered participants</option></select></label>
          <label>Minimum order<input id="batch-minimum-order" type="number" min="0.00000001" step="any" value="1"></label>
          <label>Transaction route<select id="batch-transaction-route"><option value="SRA_INTERNAL_MARKETPLACE">SRA internal marketplace</option></select></label>
          <label>Settlement route<select id="batch-settlement-route"><option value="SRA_INTERNAL_SETTLEMENT">SRA internal settlement</option></select></label>
        </div>
        <div id="authorization-impact" class="authorization-impact"></div>
        <div class="authorization-actions">
          <button id="preview-listing-batch">Preview authorization</button>
          <button id="approve-listing-batch" class="primary" disabled>Authorize eligible instruments</button>
          <p id="authorization-message">Loading the current authorization boundary.</p>
        </div>
        <div class="authorization-warning">This approval clears the five readiness controls and moves covered listings to <strong>READY FOR PUBLICATION APPROVAL</strong>. It does not publish, transact, allocate, settle, recognize ownership, or create export packages.</div>
      </section>
    `);
    document.querySelector('#preview-listing-batch')?.addEventListener('click', loadPreview);
    document.querySelector('#approve-listing-batch')?.addEventListener('click', approveBatch);
  }

  function policyInput() {
    return {
      askingPriceMethod: document.querySelector('#batch-price-method')?.value || 'RECORDED_TRANSACTION_VALUE',
      eligibilityRule: document.querySelector('#batch-access-rule')?.value || 'SRA_REGISTERED_PARTICIPANTS',
      minimumOrder: Number(document.querySelector('#batch-minimum-order')?.value || 1),
      transactionRouteId: document.querySelector('#batch-transaction-route')?.value || 'SRA_INTERNAL_MARKETPLACE',
      settlementRouteId: document.querySelector('#batch-settlement-route')?.value || 'SRA_INTERNAL_SETTLEMENT'
    };
  }

  function render(data) {
    preview = data.preview || null;
    const status = data.status || {};
    const eligible = Number(preview?.eligibleListingCount ?? status.eligibleForBatch ?? 0);
    const ready = Number(status.readyForPublicationApproval || 0);
    const approved = Number(status.approvedBatchCount || 0);
    const last = status.latestBatch?.approvedAt || null;
    const impact = document.querySelector('#authorization-impact');
    if (impact) impact.innerHTML = `
      <div><span>Eligible now</span><strong>${number(eligible)}</strong></div>
      <div><span>Ready for publication approval</span><strong>${number(ready)}</strong></div>
      <div><span>Approved batches</span><strong>${number(approved)}</strong></div>
      <div><span>Last authorization</span><strong style="font-size:12px">${escapeHtml(last ? new Date(last).toLocaleString() : 'None')}</strong></div>
    `;
    const approve = document.querySelector('#approve-listing-batch');
    if (approve) approve.disabled = eligible === 0;
    const message = document.querySelector('#authorization-message');
    if (message) message.textContent = eligible
      ? `${number(eligible)} prepared listings are waiting for this authorization.`
      : ready
        ? `${number(ready)} listings have cleared readiness and are waiting for the separate publication decision.`
        : 'No listing-readiness authorization is waiting right now.';
    const cycle = document.querySelector('#market-cycle-state');
    if (cycle) cycle.textContent = eligible > 0 ? 'AUTHORIZATION WAITING' : ready > 0 ? 'READY STAGE ACTIVE' : 'CYCLE CURRENT';
  }

  async function loadPreview() {
    ensureStyles();
    ensurePanel();
    const message = document.querySelector('#authorization-message');
    if (message) message.textContent = 'Reading the current eligible scope...';
    try {
      const query = new URLSearchParams(policyInput()).toString();
      render(await request(`/api/admin/listing-readiness-batch?${query}`));
    } catch (error) {
      if (message) message.textContent = error.message;
    }
  }

  async function approveBatch() {
    if (!preview?.eligibleListingCount) return;
    const count = Number(preview.eligibleListingCount || 0);
    if (!confirm(`Authorize the readiness policy for ${number(count)} eligible SRA instruments? This will not publish them.`)) return;
    const button = document.querySelector('#approve-listing-batch');
    const message = document.querySelector('#authorization-message');
    button.disabled = true;
    button.textContent = 'Authorizing...';
    if (message) message.textContent = 'SAIN is applying the approved readiness policy to the covered listings.';
    try {
      const result = await request('/api/admin/listing-readiness-batch/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...policyInput(), approval: 'APPROVE' })
      });
      if (typeof window.append === 'function') {
        window.append(`Listing readiness batch ${result.batchId} approved. ${number(result.updatedListingCount)} listings moved to READY_FOR_PUBLICATION_APPROVAL. Publication was not executed.`, 'agent');
      }
      if (typeof window.loadSummary === 'function') await window.loadSummary();
      await loadPreview();
    } catch (error) {
      if (message) message.textContent = error.message;
    } finally {
      button.textContent = 'Authorize eligible instruments';
    }
  }

  function startPulse() {
    clearInterval(timer);
    timer = setInterval(async () => {
      if (document.querySelector('#admin-view:not(.hidden)')) {
        try {
          if (typeof window.loadSummary === 'function') await window.loadSummary();
          await loadPreview();
        } catch {}
      }
    }, 15000);
  }

  window.addEventListener('DOMContentLoaded', () => {
    ensureStyles();
    const observer = new MutationObserver(() => {
      if (document.querySelector('#admin-view:not(.hidden)')) {
        ensurePanel();
        loadPreview();
        startPulse();
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    setTimeout(() => {
      ensurePanel();
      if (document.querySelector('#admin-view:not(.hidden)')) {
        loadPreview();
        startPulse();
      }
    }, 300);
  });
})();