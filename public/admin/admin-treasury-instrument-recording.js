(() => {
  if (window.__sraTreasuryInstrumentRecordingInstalled) return;
  window.__sraTreasuryInstrumentRecordingInstalled = true;

  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const money = (value) => Number(value || 0).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
  const client = () => window.SRAAdminDataClient;
  const request = async (url, options = {}) => {
    if (client()) return client().json(url, options);
    const response = await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };

  function workspace() { return document.querySelector('[data-workspace="treasury"]'); }
  function controls() { return workspace()?.querySelector('.admin-workspace-controls'); }
  function activeTab() { return workspace()?.dataset.activeTab || 'Overview'; }
  function visibleTab() { return ['Overview','Commercial Instruments'].includes(activeTab()); }

  function removeCard() { controls()?.querySelector('[data-treasury-platform-instrument-recorder]')?.remove(); }

  async function render() {
    const root = controls();
    if (!root) return;
    removeCard();
    if (!visibleTab()) return;

    const card = document.createElement('section');
    card.className = 'admin-record-card';
    card.dataset.treasuryPlatformInstrumentRecorder = 'true';
    card.innerHTML = `<header><strong>Record Platform Instrument</strong><em>GOVERNED TREASURY ENTRY</em></header>
      <p style="color:#9a9a9a;margin:10px 0 14px">Record an existing SRA platform instrument into Treasury. This uses the instrument already created by SRA and posts its recognized value into the Treasury workflow.</p>
      <div class="admin-record-grid">
        <label><span>Instrument ID</span><input data-treasury-record-instrument-id placeholder="SRI-..."></label>
        <label><span>Face value USD</span><input data-treasury-record-face-value type="number" min="0.01" step="any"></label>
        <label><span>Term months</span><input data-treasury-record-term type="number" min="1" value="36"></label>
        <label><span>Reference</span><input data-treasury-record-reference placeholder="Treasury recognition reference"></label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button type="button" data-treasury-record-preview>Preview</button><button type="button" data-treasury-record-approve>Record Instrument in Treasury</button></div>
      <p data-treasury-record-result style="color:#d6a92f;margin:10px 0 0"></p>`;
    root.prepend(card);

    const input = () => ({
      instrumentId: card.querySelector('[data-treasury-record-instrument-id]')?.value.trim(),
      faceValueUsd: Number(card.querySelector('[data-treasury-record-face-value]')?.value || 0),
      termMonths: Number(card.querySelector('[data-treasury-record-term]')?.value || 36),
      depositReference: card.querySelector('[data-treasury-record-reference]')?.value.trim(),
    });
    const result = () => card.querySelector('[data-treasury-record-result]');

    card.querySelector('[data-treasury-record-preview]')?.addEventListener('click', async () => {
      const out = result(); if (out) out.textContent = 'Checking instrument…';
      try {
        const preview = await request('/api/admin/treasury/funding-instrument-deposits/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input())});
        if (out) out.textContent = `${preview.instrumentName || preview.instrumentId}: ${money(preview.faceValueUsd)} establishes ${money(preview.financingCapacityUsd)} financing capacity.`;
      } catch (error) { if (out) out.textContent = error.message; }
    });

    card.querySelector('[data-treasury-record-approve]')?.addEventListener('click', async () => {
      const out = result();
      try {
        const payload = input();
        const preview = await request('/api/admin/treasury/funding-instrument-deposits/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        if (!confirm(`Record ${preview.instrumentName || payload.instrumentId} in Treasury at ${money(preview.faceValueUsd)}?`)) return;
        await request('/api/admin/treasury/funding-instrument-deposits/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,approval:'APPROVE'})});
        if (out) out.textContent = 'Platform instrument recorded in Treasury.';
        client()?.refresh?.('treasury-platform-instrument-recorded');
        document.querySelector('[data-workspace="treasury"] [data-refresh-workspace="treasury"]')?.click();
      } catch (error) { if (out) out.textContent = error.message; }
    });
  }

  function schedule() { queueMicrotask(() => void render()); }
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-workspace="treasury"] [data-admin-tab]')) schedule();
  }, true);
  window.addEventListener('sra:admin-visible', () => setTimeout(schedule,0));
  window.addEventListener('sra:admin-booted', schedule);
  window.addEventListener('sra:admin-workspace-features-ready', (event) => { if (event.detail?.workspaceId === 'treasury') schedule(); });
  window.addEventListener('sra:admin-workspace-synchronized', (event) => { if (event.detail?.workspaceId === 'treasury') schedule(); });
  window.addEventListener('hashchange', () => { if (location.hash === '#admin-treasury') schedule(); });

  if (document.readyState !== 'loading') setTimeout(schedule,0);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(schedule,0), { once:true });
})();
