(() => {
  let readiness = null;
  let publication = null;
  let timer = null;
  let initialized = false;

  const number = (value) => Number(value || 0).toLocaleString();
  async function request(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed.');
    return payload;
  }

  function policy() {
    return {
      unitPrice: Number(document.querySelector('#batch-unit-price')?.value || 1),
      askingPriceMethod: 'ADMIN_APPROVED_SRA_USD_UNIT_PRICE',
      eligibilityRule: 'SRA_REGISTERED_PARTICIPANTS',
      minimumOrder: Number(document.querySelector('#batch-minimum-order')?.value || 1),
      transactionRouteId: 'SRA_INTERNAL_MARKETPLACE',
      settlementRouteId: 'SRA_INTERNAL_SETTLEMENT'
    };
  }

  function ensureStyles() {
    if (document.querySelector('#market-lifecycle-styles')) return;
    const style = document.createElement('style');
    style.id = 'market-lifecycle-styles';
    style.textContent = `.market-cycle{margin-top:16px;padding:18px;border:1px solid #3f3519;border-radius:16px;background:linear-gradient(180deg,#100d07,#080706)}.market-cycle-head{display:flex;justify-content:space-between;gap:12px}.market-cycle-head h3{margin:0}.market-cycle-head p{margin:4px 0;color:#aaa}.market-pipeline{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px;margin-top:14px}.market-stage{padding:10px;border:1px solid #292929;border-radius:11px;background:#090909;min-width:0}.market-stage span{display:block;color:#999;font-size:9px;text-transform:uppercase}.market-stage strong{display:block;font-size:18px;margin-top:3px;word-break:break-word}.market-stage.current{border-color:#d6a92f;background:#171207}.market-stage.live{border-color:#31563b}.market-terms{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.market-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:14px}.market-note{padding:10px;border-radius:10px;background:#100d08;color:#d9c88d;font-size:11px}.market-next{margin:12px 0;color:#ddd}.market-next strong{color:#d6a92f}@media(max-width:1000px){.market-pipeline{grid-template-columns:repeat(3,1fr)}}@media(max-width:600px){.market-pipeline,.market-terms{grid-template-columns:1fr}}`;
    document.head.append(style);
  }

  function ensurePanel() {
    ensureStyles();
    const anchor = document.querySelector('#listing-blockers');
    if (!anchor || document.querySelector('#listing-authorization')) return;
    anchor.insertAdjacentHTML('afterend', `<section id="listing-authorization" class="market-cycle">
      <div class="market-cycle-head"><div><h3>SRA/USD Market Lifecycle</h3><p>One canonical flow moves eligible SRA Coin instruments from preparation to participant activity.</p></div><strong id="market-cycle-state" class="status">CHECKING</strong></div>
      <div id="authorization-impact" class="market-pipeline"></div>
      <div class="market-next" id="market-next-action">Reading the next valid governed action.</div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid #3f3519"><h4>Native market terms</h4><div class="market-terms"><label>USD per SRA<input id="batch-unit-price" type="number" min="0.00000001" step="any" value="1"></label><label>Minimum order<input id="batch-minimum-order" type="number" min="0.00000001" step="any" value="1"></label></div></div>
      <div class="market-actions"><button id="approve-listing-batch">Authorize readiness</button><button id="approve-publication-batch">Publish ready listings</button><button id="authorize-current-market-cycle" class="primary">Advance Current Eligible Set</button></div>
      <p id="authorization-message" style="color:#aaa">Loading current market state.</p>
      <div class="market-note">This control uses the same canonical listing transition that produces <strong>state: PUBLISHED</strong> and <strong>status: LIVE</strong>. The user marketplace reads that live state. Publication does not create orders, settlement, ownership recognition, or export packages.</div>
    </section>`);
    document.querySelector('#approve-listing-batch').addEventListener('click', approveReadiness);
    document.querySelector('#approve-publication-batch').addEventListener('click', approvePublication);
    document.querySelector('#authorize-current-market-cycle').addEventListener('click', authorizeFullCycle);
  }

  function render() {
    const prepared = Number(readiness?.preview?.eligibleListingCount || readiness?.status?.eligibleForBatch || 0);
    const ready = Number(publication?.preview?.eligibleListingCount || readiness?.status?.readyForPublicationApproval || 0);
    const live = Number(publication?.status?.liveListingCount || 0);
    const operations = window.__sraOperationsSnapshot || {};
    const counts = operations.counts || {};
    const stages = [
      ['Prepared', prepared, prepared > 0 ? 'current' : ''],
      ['Ready to publish', ready, !prepared && ready > 0 ? 'current' : ''],
      ['Live SRA/USD', live, 'live'],
      ['Orders', counts.ORDER_INTENT || 0, ''],
      ['Reservations', counts.RESERVATION || 0, ''],
      ['Allocation', counts.ALLOCATION || 0, ''],
      ['Settlement+', (counts.SETTLEMENT || 0) + (counts.EXPORT_PACKAGE || 0) + (counts.TRANSFER_INSTRUCTION || 0), '']
    ];
    document.querySelector('#authorization-impact').innerHTML = stages.map(([label, value, state]) => `<div class="market-stage ${state}"><span>${label}</span><strong>${number(value)}</strong></div>`).join('');
    const readinessButton = document.querySelector('#approve-listing-batch');
    const publicationButton = document.querySelector('#approve-publication-batch');
    const cycleButton = document.querySelector('#authorize-current-market-cycle');
    readinessButton.disabled = prepared === 0;
    publicationButton.disabled = ready === 0;
    cycleButton.disabled = prepared === 0 && ready === 0;
    readinessButton.hidden = prepared === 0;
    publicationButton.hidden = ready === 0;
    cycleButton.hidden = prepared === 0 && ready === 0;
    document.querySelector('#market-cycle-state').textContent = prepared ? 'READINESS REQUIRED' : ready ? 'PUBLICATION REQUIRED' : 'MARKET CURRENT';
    document.querySelector('#market-next-action').innerHTML = prepared
      ? `<strong>Next:</strong> authorize readiness for ${number(prepared)} prepared listings. The same control can then publish the resulting ready set.`
      : ready ? `<strong>Next:</strong> publish ${number(ready)} authorized listings into the live SRA/USD market.`
      : `<strong>Next:</strong> participant order activity. ${number(live)} listings are currently LIVE.`;
    document.querySelector('#authorization-message').textContent = prepared
      ? `${number(prepared)} prepared listings have not yet received market terms and readiness authorization.`
      : ready ? `${number(ready)} listings have approved terms and are waiting for publication.`
      : `${number(live)} listings are verified LIVE. New prepared records will appear here automatically.`;
  }

  async function load() {
    ensurePanel();
    if (!document.querySelector('#listing-authorization')) return;
    const query = new URLSearchParams(policy()).toString();
    [readiness, publication] = await Promise.all([request(`/api/admin/listing-readiness-batch?${query}`), request('/api/admin/listing-publication-batch')]);
    render();
  }

  async function approveReadiness() {
    const count = Number(readiness?.preview?.eligibleListingCount || 0);
    if (!count || !confirm(`Authorize readiness for ${number(count)} SRA/USD listings at $${policy().unitPrice} per SRA?`)) return;
    const result = await request('/api/admin/listing-readiness-batch/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...policy(), approval: 'APPROVE' }) });
    window.append?.(`Readiness batch ${result.batchId}: ${number(result.updatedListingCount)} listings are ready for publication.`, 'agent');
    await Promise.all([window.loadSummary?.(), load()]);
  }

  async function approvePublication() {
    const count = Number(publication?.preview?.eligibleListingCount || 0);
    if (!count || !confirm(`Publish ${number(count)} approved SRA/USD listings to the live market?`)) return;
    const result = await request('/api/admin/listing-publication-batch/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval: 'APPROVE' }) });
    await Promise.all([load(), window.loadSummary?.()]);
    const verified = Number(publication?.status?.liveListingCount || 0);
    const message = `Publication batch ${result.batchId}: ${number(result.publishedListingCount)} listings changed to PUBLISHED / LIVE. Verified LIVE total: ${number(verified)}.`;
    document.querySelector('#authorization-message').textContent = message;
    window.append?.(message, 'agent');
  }

  async function authorizeFullCycle() {
    const prepared = Number(readiness?.preview?.eligibleListingCount || 0);
    const alreadyReady = Number(publication?.preview?.eligibleListingCount || 0);
    const total = prepared + alreadyReady;
    if (!total || !confirm(`Advance the complete eligible set of ${number(total)} listings through readiness and publication?`)) return;
    const button = document.querySelector('#authorize-current-market-cycle');
    button.disabled = true; button.textContent = 'Advancing market cycle...';
    try {
      let madeReady = 0;
      if (prepared) {
        const result = await request('/api/admin/listing-readiness-batch/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...policy(), approval: 'APPROVE' }) });
        madeReady = Number(result.updatedListingCount || 0);
      }
      publication = await request('/api/admin/listing-publication-batch');
      const publishable = Number(publication?.preview?.eligibleListingCount || 0);
      let published = 0;
      if (publishable) {
        const result = await request('/api/admin/listing-publication-batch/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval: 'APPROVE' }) });
        published = Number(result.publishedListingCount || 0);
      }
      await Promise.all([load(), window.loadSummary?.()]);
      const live = Number(publication?.status?.liveListingCount || 0);
      const message = `${number(madeReady)} listings passed readiness; ${number(published)} changed to PUBLISHED / LIVE; ${number(live)} listings are now visible in SRA/USD.`;
      document.querySelector('#authorization-message').textContent = message;
      window.append?.(message, 'agent');
    } catch (error) { document.querySelector('#authorization-message').textContent = error.message; }
    finally { button.disabled = false; button.textContent = 'Advance Current Eligible Set'; }
  }

  function loadAdminScript(source, marker) {
    if (document.querySelector(`script[${marker}]`)) return;
    const script = document.createElement('script');
    script.src = source;
    script.async = false;
    script.setAttribute(marker, 'true');
    document.head.append(script);
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    loadAdminScript('/admin/hybrid-liquidity-admin.js', 'data-hybrid-liquidity-admin');
    loadAdminScript('/admin/core-services-dashboard.js', 'data-sra-core-services-dashboard');
    loadAdminScript('/admin/operations-queue-ui.js', 'data-sra-operations-queue');
    const observer = new MutationObserver(() => { if (document.querySelector('#admin-view:not(.hidden)')) { ensurePanel(); void load(); } });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    setTimeout(() => { ensurePanel(); void load(); }, 0);
    timer = setInterval(() => { if (document.querySelector('#admin-view:not(.hidden)')) void load(); }, 15000);
    timer.unref?.();
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
