(() => {
  async function request(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed.');
    return payload;
  }

  function ensurePanel() {
    const anchor = document.querySelector('#listing-authorization');
    if (!anchor || document.querySelector('#hybrid-liquidity-admin')) return;
    anchor.insertAdjacentHTML('afterend', `<section id="hybrid-liquidity-admin" style="margin-top:16px;padding:16px;border:1px solid #2d4160;border-radius:14px;background:#07101c">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><h3 style="margin:0">Hybrid Liquidity Markets</h3><p style="margin:4px 0;color:#9fb3cc">Create continuous reference, event-reference, or perpetual-reference price discovery around a verified SRA instrument.</p></div><strong id="hybrid-boundary" style="color:#70a7e8">REFERENCE ONLY</strong></div>
      <div id="hybrid-status" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0"></div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
        <label>Underlying instrument ID<input id="hybrid-instrument-id" placeholder="INS-..."></label>
        <label>Market mode<select id="hybrid-mode"><option value="CONTINUOUS_REFERENCE">Continuous reference</option><option value="EVENT_REFERENCE">Event reference</option><option value="PERPETUAL_REFERENCE">Perpetual reference</option><option value="SPOT">Spot</option></select></label>
        <label>Market identity<input id="hybrid-market-identity" value="SRA / USD"></label>
        <label>Reference sources<input id="hybrid-reference-sources" value="SRA_VERIFIED_VALUE,SRA_MARKET_ACTIVITY"></label>
        <label>Index method<input id="hybrid-index-method" value="VERIFIED_REFERENCE_COMPOSITE"></label>
        <label>Stale after seconds<input id="hybrid-stale-seconds" type="number" min="30" value="300"></label>
      </div>
      <div id="event-reference-fields" style="display:none;margin-top:10px;grid-template-columns:1fr;gap:10px">
        <label>Event question<input id="hybrid-event-question" placeholder="Will the defined verified event occur?"></label>
        <label>Resolution source<input id="hybrid-resolution-source" placeholder="SRA_RECOGNITION_RECORD"></label>
        <label>Resolution deadline<input id="hybrid-resolution-deadline" type="datetime-local"></label>
      </div>
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:14px"><button id="preview-hybrid-market">Preview definition</button><button id="approve-hybrid-market" class="primary">Approve reference market</button></div>
      <pre id="hybrid-preview" style="white-space:pre-wrap;color:#b8c9dc;background:#050a11;border:1px solid #1f3048;border-radius:10px;padding:10px;max-height:240px;overflow:auto">No hybrid market definition selected.</pre>
      <div style="padding:10px;border-radius:10px;background:#0b1522;color:#9fb3cc;font-size:11px">This phase records price-discovery methodology only. Leverage, funding payments, liquidations, participant execution, physical delivery, and settlement creation remain disabled.</div>
    </section>`);
    document.querySelector('#hybrid-mode').addEventListener('change', toggleEventFields);
    document.querySelector('#preview-hybrid-market').addEventListener('click', preview);
    document.querySelector('#approve-hybrid-market').addEventListener('click', approve);
    toggleEventFields();
    void loadStatus();
  }

  function toggleEventFields() {
    const isEvent = document.querySelector('#hybrid-mode')?.value === 'EVENT_REFERENCE';
    const fields = document.querySelector('#event-reference-fields');
    if (fields) fields.style.display = isEvent ? 'grid' : 'none';
  }

  function input() {
    const deadline = document.querySelector('#hybrid-resolution-deadline')?.value;
    return {
      underlyingInstrumentId: document.querySelector('#hybrid-instrument-id')?.value.trim(),
      mode: document.querySelector('#hybrid-mode')?.value,
      marketIdentity: document.querySelector('#hybrid-market-identity')?.value.trim() || 'SRA / USD',
      referenceSources: String(document.querySelector('#hybrid-reference-sources')?.value || '').split(',').map((item) => item.trim()).filter(Boolean),
      indexMethod: document.querySelector('#hybrid-index-method')?.value.trim(),
      staleAfterSeconds: Number(document.querySelector('#hybrid-stale-seconds')?.value || 300),
      eventQuestion: document.querySelector('#hybrid-event-question')?.value.trim(),
      resolutionSource: document.querySelector('#hybrid-resolution-source')?.value.trim(),
      resolutionDeadline: deadline ? new Date(deadline).toISOString() : undefined,
    };
  }

  async function loadStatus() {
    try {
      const status = await request('/api/sane/hybrid-liquidity/status');
      const target = document.querySelector('#hybrid-status');
      if (!target) return;
      target.innerHTML = [
        ['Market definitions', status.marketCount],
        ['Reference observations', status.referenceCount],
        ['Execution enabled', status.executionEnabledMarkets]
      ].map(([label, value]) => `<div style="padding:10px;border:1px solid #1f3048;border-radius:10px"><span style="display:block;color:#8ca4bf;font-size:10px">${label}</span><strong>${Number(value || 0).toLocaleString()}</strong></div>`).join('');
      document.querySelector('#hybrid-boundary').textContent = String(status.boundary || 'REFERENCE ONLY').replaceAll('_', ' ');
    } catch (error) {
      const preview = document.querySelector('#hybrid-preview');
      if (preview) preview.textContent = error.message;
    }
  }

  async function preview() {
    const result = await request('/api/sane/hybrid-liquidity/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input()) });
    document.querySelector('#hybrid-preview').textContent = JSON.stringify(result, null, 2);
  }

  async function approve() {
    const definition = input();
    if (!definition.underlyingInstrumentId) return alert('Enter an SRA instrument ID.');
    if (!confirm(`Approve a ${definition.mode} reference market for ${definition.underlyingInstrumentId}? No trading or settlement will be enabled.`)) return;
    const result = await request('/api/sane/hybrid-liquidity/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...definition, approval: 'APPROVE' }) });
    document.querySelector('#hybrid-preview').textContent = JSON.stringify(result, null, 2);
    window.append?.(`Hybrid market ${result.marketId} approved for reference-only price discovery. Execution remains disabled.`, 'agent');
    await loadStatus();
  }

  const observer = new MutationObserver(() => ensurePanel());
  window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(ensurePanel, 500);
  });
})();
