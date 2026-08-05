(() => {
  async function request(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed.');
    return payload;
  }

  function ensurePanel() {
    const anchor = document.querySelector('#sra-core-services-dashboard');
    if (!anchor || document.querySelector('#listing-readiness-policy-panel')) return;
    anchor.insertAdjacentHTML('afterend', `<section id="listing-readiness-policy-panel" style="margin-top:16px;padding:16px;border:1px solid #493d1f;border-radius:14px;background:#100c05">
      <div style="display:flex;justify-content:space-between;gap:12px"><div><h3 style="margin:0">Standing SRA / USD Readiness Policy</h3><p style="margin:4px 0;color:#b7aa88">Automatically applies approved readiness terms to newly formed eligible instruments during each heartbeat.</p></div><strong id="readiness-policy-state">CHECKING</strong></div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px"><label>USD per SRA<input id="policy-unit-price" type="number" min="0.00000001" step="any" value="1"></label><label>Minimum order<input id="policy-minimum-order" type="number" min="0.00000001" step="any" value="1"></label></div>
      <div id="readiness-policy-summary" style="margin-top:12px;color:#cfc19d"></div>
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:14px"><button id="activate-readiness-policy" class="primary">Activate standing policy</button><button id="disable-readiness-policy">Disable policy</button></div>
      <div style="margin-top:10px;padding:10px;border-radius:10px;background:#181207;color:#b7aa88;font-size:11px">Automatic readiness does not publish listings, create orders, settle value, recognize ownership, or create export packages. Publication remains an administrator decision.</div>
    </section>`);
    document.querySelector('#activate-readiness-policy').addEventListener('click', activate);
    document.querySelector('#disable-readiness-policy').addEventListener('click', disable);
    void load();
  }

  function terms() {
    return {
      unitPrice: Number(document.querySelector('#policy-unit-price')?.value || 1),
      minimumOrder: Number(document.querySelector('#policy-minimum-order')?.value || 1),
      askingPriceMethod: 'ADMIN_APPROVED_SRA_USD_UNIT_PRICE',
      eligibilityRule: 'SRA_REGISTERED_PARTICIPANTS',
      transactionRouteId: 'SRA_INTERNAL_MARKETPLACE',
      settlementRouteId: 'SRA_INTERNAL_SETTLEMENT'
    };
  }

  async function load() {
    if (!document.querySelector('#listing-readiness-policy-panel')) return;
    try {
      const result = await request('/api/sane/core-services/readiness-policy');
      const status = result.status || {};
      document.querySelector('#readiness-policy-state').textContent = status.active ? 'ACTIVE' : 'INACTIVE';
      document.querySelector('#readiness-policy-summary').textContent = status.active
        ? `Policy active. ${Number(status.eligibleListingCount || 0).toLocaleString()} listings remain eligible; ${Number(status.readyForPublicationApproval || 0).toLocaleString()} are waiting for publication approval.`
        : `Policy inactive. ${Number(status.eligibleListingCount || 0).toLocaleString()} eligible listings would receive the approved readiness terms.`;
      const policy = status.policy;
      if (policy?.terms) {
        document.querySelector('#policy-unit-price').value = policy.terms.unitPrice ?? 1;
        document.querySelector('#policy-minimum-order').value = policy.terms.minimumOrder ?? 1;
      }
      document.querySelector('#disable-readiness-policy').disabled = !status.active;
    } catch (error) {
      document.querySelector('#readiness-policy-summary').textContent = error.message;
    }
  }

  async function activate() {
    if (!confirm('Activate the standing SRA / USD readiness policy? New eligible listings will receive approved terms automatically, but will not be published.')) return;
    await request('/api/sane/core-services/readiness-policy/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...terms(), approval: 'APPROVE' }) });
    window.append?.('Standing SRA / USD readiness policy activated. Publication remains separately controlled.', 'agent');
    await load();
  }

  async function disable() {
    if (!confirm('Disable automatic readiness for newly formed listings?')) return;
    await request('/api/sane/core-services/readiness-policy/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval: 'DISABLE' }) });
    window.append?.('Standing readiness policy disabled.', 'agent');
    await load();
  }

  const observer = new MutationObserver(ensurePanel);
  window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(ensurePanel, 900);
    setInterval(() => { if (document.querySelector('#admin-view:not(.hidden)')) void load(); }, 15000);
  });
})();
