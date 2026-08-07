(() => {
  if (window.__sraListingAuthorizationInstalled) return;
  window.__sraListingAuthorizationInstalled = true;

  let readiness = null;
  let publication = null;
  let loading = false;

  const number = (value) => Number(value || 0).toLocaleString();
  const client = () => window.SRAAdminDataClient;

  async function request(url, options = {}) {
    if (client()) return client().json(url, options);
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}.`);
    return payload;
  }

  function policy() {
    return {
      unitPrice: 1,
      askingPriceMethod: 'VERIFIED_RECORDED_USD_VALUE_AT_SRA_PAR',
      eligibilityRule: 'SRA_REGISTERED_PARTICIPANTS',
      minimumOrder: Number(document.querySelector('#batch-minimum-order')?.value || 1),
      transactionRouteId: 'SRA_INTERNAL_MARKETPLACE',
      settlementRouteId: 'SRA_INTERNAL_SETTLEMENT',
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
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid #3f3519"><h4>Native market terms</h4><div class="market-terms"><label>USD per SRA<input id="batch-unit-price" type="number" value="1" readonly aria-readonly="true"></label><label>Minimum order<input id="batch-minimum-order" type="number" min="0.00000001" step="any" value="1"></label></div><p style="margin:8px 0 0;color:#d6a92f">Fixed par reference: 1 SRA = $1.00. The administrator authorizes readiness, not a different SRA price.</p></div>
      <div class="market-actions"><button id="approve-listing-batch" type="button">Authorize readiness</button><button id="approve-publication-batch" type="button">Publish ready listings</button><button id="authorize-current-market-cycle" type="button" class="primary">Advance Current Eligible Set</button></div>
      <p id="authorization-message" style="color:#aaa">Loading current market state.</p>
      <div class="market-note">This control uses the same canonical listing transition that produces <strong>state: PUBLISHED</strong> and <strong>status: LIVE</strong>. The user marketplace and order execution both use the fixed $1.00 SRA/USD terms. Publication does not create orders, settlement, ownership recognition, or export packages.</div>
    </section>`);
    document.querySelector('#approve-listing-batch').addEventListener('click', approveReadiness);
    document.querySelector('#approve-publication-batch').addEventListener('click', approvePublication);
    document.querySelector('#authorize-current-market-cycle').addEventListener('click', authorizeFullCycle);
  }

  function render() {
    if (!document.querySelector('#listing-authorization')) return;
    const prepared = Number(readiness?.preview?.eligibleListingCount || readiness?.status?.eligibleForBatch || 0);
    const invalid = Number(readiness?.preview?.invalidListingCount || 0);
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
      ['Settlement+', (counts.SETTLEMENT || 0) + (counts.EXPORT_PACKAGE || 0) + (counts.TRANSFER_INSTRUCTION || 0), ''],
    ];
    document.querySelector('#authorization-impact').innerHTML = stages.map(([label, value, state]) => `<div class="market-stage ${state}"><span>${label}</span><strong>${number(value)}</strong></div>`).join('');
    const readinessButton = document.querySelector('#approve-listing-batch');
    const publicationButton = document.querySelector('#approve-publication-batch');
    const cycleButton = document.querySelector('#authorize-current-market-cycle');
    readinessButton.disabled = prepared === 0 || invalid > 0;
    publicationButton.disabled = ready === 0;
    cycleButton.disabled = (prepared === 0 && ready === 0) || invalid > 0;
    readinessButton.hidden = prepared === 0;
    publicationButton.hidden = ready === 0;
    cycleButton.hidden = prepared === 0 && ready === 0;
    document.querySelector('#market-cycle-state').textContent = invalid ? 'VALUE REVIEW REQUIRED' : prepared ? 'READINESS REQUIRED' : ready ? 'PUBLICATION REQUIRED' : 'MARKET CURRENT';
    document.querySelector('#market-next-action').innerHTML = invalid
      ? `<strong>Next:</strong> correct ${number(invalid)} listing(s) that do not have a positive linked verified recorded USD value before authorizing the batch.`
      : prepared ? `<strong>Next:</strong> authorize readiness for ${number(prepared)} prepared listings at the fixed $1.00 SRA/USD par reference.`
      : ready ? `<strong>Next:</strong> publish ${number(ready)} authorized listings into the live SRA/USD market.`
      : `<strong>Next:</strong> participant order activity. ${number(live)} listings are currently LIVE.`;
    document.querySelector('#authorization-message').textContent = invalid
      ? `${number(invalid)} scoped listing(s) failed recorded-value validation. No readiness writes will be performed until the scope is valid.`
      : prepared ? `${number(prepared)} prepared listings are eligible for fixed-par readiness authorization.`
      : ready ? `${number(ready)} listings have approved terms and are waiting for publication.`
      : `${number(live)} listings are verified LIVE. New prepared records will appear after the next administration refresh.`;
  }

  async function load() {
    if (loading) return;
    ensurePanel();
    if (!document.querySelector('#listing-authorization')) return;
    loading = true;
    try {
      const query = new URLSearchParams(policy()).toString();
      [readiness, publication] = await Promise.all([
        request(`/api/admin/listing-readiness-batch?${query}`),
        request('/api/admin/listing-publication-batch'),
      ]);
      render();
    } catch (error) {
      const message = document.querySelector('#authorization-message');
      if (message) message.textContent = error.message;
    } finally {
      loading = false;
    }
  }

  async function approveReadiness() {
    const count = Number(readiness?.preview?.eligibleListingCount || 0);
    if (!count || !confirm(`Authorize readiness for ${number(count)} SRA/USD listings at the fixed par rate of $1.00 per SRA?`)) return;
    const result = await request('/api/admin/listing-readiness-batch/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...policy(), approval: 'APPROVE' }) });
    window.append?.(`Readiness batch ${result.batchId}: ${number(result.updatedListingCount)} listings are ready for publication at fixed SRA/USD par.`, 'agent');
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
    if (!total || !confirm(`Advance the complete eligible set of ${number(total)} listings through fixed-par readiness and publication?`)) return;
    const button = document.querySelector('#authorize-current-market-cycle');
    button.disabled = true;
    button.textContent = 'Advancing market cycle...';
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
      const message = `${number(madeReady)} listings passed fixed-par readiness; ${number(published)} changed to PUBLISHED / LIVE; ${number(live)} listings are now visible in SRA/USD.`;
      document.querySelector('#authorization-message').textContent = message;
      window.append?.(message, 'agent');
    } catch (error) {
      document.querySelector('#authorization-message').textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Advance Current Eligible Set';
    }
  }

  window.addEventListener('sra:admin-refresh', () => void load());
  window.addEventListener('sra:admin-mutated', () => void load());
  ensurePanel();
  void load();
})();
