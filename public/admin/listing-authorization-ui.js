(() => {
  let readiness = null;
  let publication = null;
  let timer = null;

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

  function ensurePanel() {
    const anchor = document.querySelector('#listing-blockers');
    if (!anchor || document.querySelector('#listing-authorization')) return;
    anchor.insertAdjacentHTML('afterend', `<section id="listing-authorization" class="listing-authorization" style="margin-top:16px;padding:16px;border:1px solid #3f3519;border-radius:14px;background:#0b0905">
      <div style="display:flex;justify-content:space-between;gap:12px"><div><h3 style="margin:0">Instrument Authorization Cycle</h3><p style="margin:4px 0;color:#aaa">The preparation engine keeps working. These controls move the current eligible set through governed market stages.</p></div><strong id="market-cycle-state" style="color:#72c78b">CHECKING</strong></div>
      <div id="authorization-impact" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:12px"></div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid #3f3519"><h4>Market terms</h4><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px"><label>USD per SRA<input id="batch-unit-price" type="number" min="0.00000001" step="any" value="1"></label><label>Minimum order<input id="batch-minimum-order" type="number" min="0.00000001" step="any" value="1"></label></div></div>
      <div style="display:flex;flex-wrap:wrap;gap:9px;margin-top:14px"><button id="approve-listing-batch">Authorize readiness</button><button id="approve-publication-batch">Authorize publication</button><button id="authorize-current-market-cycle" class="primary">Authorize Current Market Cycle</button></div>
      <p id="authorization-message" style="color:#aaa">Loading current market state.</p>
      <div style="padding:10px;border-radius:10px;background:#100d08;color:#d9c88d;font-size:11px">The full-cycle control applies approved $1.00 SRA/USD terms and publishes the currently eligible set. It does not create orders, allocations, settlements, ownership recognition, or export packages.</div>
    </section>`);
    document.querySelector('#approve-listing-batch').addEventListener('click', approveReadiness);
    document.querySelector('#approve-publication-batch').addEventListener('click', approvePublication);
    document.querySelector('#authorize-current-market-cycle').addEventListener('click', authorizeFullCycle);
  }

  function render() {
    const eligible = Number(readiness?.preview?.eligibleListingCount || readiness?.status?.eligibleForBatch || 0);
    const ready = Number(publication?.preview?.eligibleListingCount || readiness?.status?.readyForPublicationApproval || 0);
    const live = Number(publication?.status?.liveListingCount || 0);
    const impact = document.querySelector('#authorization-impact');
    if (impact) impact.innerHTML = [
      ['Preparing / eligible', eligible], ['Ready for publication', ready], ['Live listings', live],
      ['Readiness batches', readiness?.status?.approvedBatchCount || 0], ['Publication batches', publication?.status?.approvedPublicationBatchCount || 0]
    ].map(([label, value]) => `<div style="padding:10px;border:1px solid #292929;border-radius:10px"><span style="display:block;color:#aaa;font-size:10px">${label}</span><strong style="font-size:17px">${number(value)}</strong></div>`).join('');
    document.querySelector('#approve-listing-batch').disabled = eligible === 0;
    document.querySelector('#approve-publication-batch').disabled = ready === 0;
    document.querySelector('#authorize-current-market-cycle').disabled = eligible === 0 && ready === 0;
    document.querySelector('#market-cycle-state').textContent = eligible ? 'READINESS WAITING' : ready ? 'PUBLICATION WAITING' : 'CYCLE CURRENT';
    document.querySelector('#authorization-message').textContent = eligible
      ? `${number(eligible)} prepared listings are waiting for readiness authorization.`
      : ready ? `${number(ready)} listings are waiting for publication authorization.`
      : `${number(live)} listings are verified LIVE; no current authorization is waiting.`;
  }

  async function load() {
    ensurePanel();
    if (!document.querySelector('#listing-authorization')) return;
    const query = new URLSearchParams(policy()).toString();
    [readiness, publication] = await Promise.all([
      request(`/api/admin/listing-readiness-batch?${query}`),
      request('/api/admin/listing-publication-batch')
    ]);
    render();
  }

  async function approveReadiness() {
    const count = Number(readiness?.preview?.eligibleListingCount || 0);
    if (!count || !confirm(`Authorize readiness for ${number(count)} SRA / USD listings at $${policy().unitPrice} per SRA?`)) return;
    const result = await request('/api/admin/listing-readiness-batch/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...policy(), approval: 'APPROVE' }) });
    window.append?.(`Readiness batch ${result.batchId}: ${number(result.updatedListingCount)} listings are ready for publication.`, 'agent');
    await window.loadSummary?.(); await load();
  }

  async function approvePublication() {
    const count = Number(publication?.preview?.eligibleListingCount || 0);
    if (!count || !confirm(`Publish ${number(count)} authorized SRA / USD listings?`)) return;
    const result = await request('/api/admin/listing-publication-batch/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval: 'APPROVE' }) });
    await load();
    const verified = Number(publication?.status?.liveListingCount || 0);
    const message = `Publication batch ${result.batchId}: ${number(result.publishedListingCount)} listings published. Verified LIVE total: ${number(verified)}.`;
    document.querySelector('#authorization-message').textContent = message;
    window.append?.(message, 'agent');
    await window.loadSummary?.();
  }

  async function authorizeFullCycle() {
    const eligible = Number(readiness?.preview?.eligibleListingCount || 0);
    const alreadyReady = Number(publication?.preview?.eligibleListingCount || 0);
    const total = eligible + alreadyReady;
    if (!total || !confirm(`Authorize the complete current market cycle for ${number(total)} listings? This applies readiness terms and publishes the eligible set.`)) return;
    const button = document.querySelector('#authorize-current-market-cycle');
    button.disabled = true; button.textContent = 'Authorizing cycle...';
    try {
      let madeReady = 0;
      if (eligible) {
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
      await load();
      const live = Number(publication?.status?.liveListingCount || 0);
      const message = `${number(madeReady)} listings passed readiness; ${number(published)} were published; ${number(live)} listings are verified LIVE.`;
      document.querySelector('#authorization-message').textContent = message;
      window.append?.(message, 'agent');
      await window.loadSummary?.();
    } catch (error) {
      document.querySelector('#authorization-message').textContent = error.message;
    } finally {
      button.disabled = false; button.textContent = 'Authorize Current Market Cycle';
    }
  }

  function loadAdminScript(source, marker) {
    if (document.querySelector(`script[${marker}]`)) return;
    const script = document.createElement('script');
    script.src = source;
    script.defer = true;
    script.setAttribute(marker, 'true');
    document.head.append(script);
  }

  const observer = new MutationObserver(() => { if (document.querySelector('#admin-view:not(.hidden)')) ensurePanel(); });
  window.addEventListener('DOMContentLoaded', () => {
    loadAdminScript('/admin/hybrid-liquidity-admin.js', 'data-hybrid-liquidity-admin');
    loadAdminScript('/admin/core-services-dashboard.js', 'data-sra-core-services-dashboard');
    loadAdminScript('/admin/operations-queue-ui.js', 'data-sra-operations-queue');
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    setTimeout(() => { ensurePanel(); void load(); }, 350);
    timer = setInterval(() => { if (document.querySelector('#admin-view:not(.hidden)')) void load(); }, 15000);
    timer.unref?.();
  });
})();