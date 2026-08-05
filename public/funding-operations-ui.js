(() => {
  const PHASES = [
    ['Opportunity Intake', '/api/funding/status'],
    ['Verification', '/api/funding-verification/status'],
    ['Value Preparation', '/api/funding-value/status'],
    ['Model Selection', '/api/funding-model/status'],
    ['Instrument Selection', '/api/funding-instrument/status'],
    ['Instrument Review', '/api/funding-instrument-review/status'],
    ['Issuance', '/api/funding-instrument-issuance/status'],
    ['Marketplace Preparation', '/api/funding-marketplace/status'],
    ['Publication', '/api/funding-marketplace-publication/status'],
    ['Commitments', '/api/funding-marketplace-commitment/status'],
    ['Allocation', '/api/funding-marketplace-allocation/status'],
    ['Settlement', '/api/funding-marketplace-settlement/status'],
    ['On-Chain Projection', '/api/on-chain/status'],
  ];

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  function style() {
    if (document.querySelector('#funding-operations-style')) return;
    const node = document.createElement('style');
    node.id = 'funding-operations-style';
    node.textContent = `
      .funding-ops{display:grid;gap:16px}.funding-ops-hero{padding:22px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:linear-gradient(145deg,rgba(255,255,255,.05),rgba(255,255,255,.015))}.funding-ops-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.funding-phase-card{padding:16px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.025)}.funding-phase-head{display:flex;justify-content:space-between;gap:12px}.funding-phase-card small{display:block;opacity:.7;margin-top:8px}.funding-phase-state{font-size:11px;padding:5px 8px;border-radius:999px;background:rgba(255,255,255,.08)}.funding-phase-state.good{background:rgba(45,190,120,.15);color:#7de0a9}.funding-phase-state.bad{background:rgba(220,80,80,.15);color:#ff9d9d}.funding-ops-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.funding-ops-table{padding:18px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(255,255,255,.02)}.funding-ops-list{display:grid;gap:10px;margin-top:12px}.funding-ops-row{display:grid;grid-template-columns:1fr auto;gap:12px;padding:12px;border-radius:12px;background:rgba(255,255,255,.035)}.funding-ops-row span{opacity:.72}.funding-ops-empty{padding:16px;opacity:.7}@media(max-width:800px){.funding-ops-grid{grid-template-columns:1fr}}`;
    document.head.append(node);
  }

  async function getJson(path) {
    const response = await fetch(path, { headers: { accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
    return payload;
  }

  async function loadPhaseStatuses() {
    return Promise.all(PHASES.map(async ([label, path], index) => {
      const started = performance.now();
      try {
        const body = await getJson(path);
        return { index: index + 1, label, path, ok: true, ms: Math.round(performance.now() - started), body };
      } catch (error) {
        return { index: index + 1, label, path, ok: false, ms: Math.round(performance.now() - started), error: error.message };
      }
    }));
  }

  async function loadOpportunities() {
    try {
      const payload = await getJson('/api/funding/opportunities');
      return payload.records || [];
    } catch {
      return [];
    }
  }

  function phaseCard(item) {
    const count = item.ok
      ? Object.entries(item.body || {}).find(([key, value]) => key !== 'service' && key !== 'purpose' && typeof value === 'number')?.[1]
      : null;
    return `<article class="funding-phase-card">
      <div class="funding-phase-head"><div><p class="eyebrow">PHASE ${item.index}</p><strong>${esc(item.label)}</strong></div><span class="funding-phase-state ${item.ok ? 'good' : 'bad'}">${item.ok ? 'READY' : 'CHECK'}</span></div>
      <small>${item.ok ? `${esc(item.body?.purpose || item.body?.service || 'Operational')} · ${item.ms}ms${count == null ? '' : ` · ${count} records`}` : esc(item.error)}</small>
    </article>`;
  }

  function opportunityRow(record) {
    return `<div class="funding-ops-row"><div><strong>${esc(record.title || record.opportunityId)}</strong><span>${esc(record.opportunityId)} · ${esc(record.opportunityType || 'Opportunity')}</span></div><div><strong>${esc(record.status || 'UNKNOWN')}</strong><span>${esc(record.fundingPhase || '')}</span></div></div>`;
  }

  async function render(root) {
    root.innerHTML = `<div class="loading-state">Loading funding operations…</div>`;
    const [phases, opportunities] = await Promise.all([loadPhaseStatuses(), loadOpportunities()]);
    const ready = phases.filter((item) => item.ok).length;
    root.innerHTML = `<section class="funding-ops">
      <div class="funding-ops-hero"><p class="eyebrow">FUNDING ENGINE OPERATIONS</p><h2>One lifecycle, twelve controlled phases</h2><p>${ready} of ${phases.length} service boundaries are responding. This workspace turns the engine into one operational view instead of separate backend routes.</p><div class="funding-ops-actions"><button class="primary-button" id="funding-ops-refresh">Refresh engine</button><button class="secondary-button" id="funding-ops-new">Start opportunity intake</button></div></div>
      <div class="funding-ops-grid">${phases.map(phaseCard).join('')}</div>
      <section class="funding-ops-table"><div><p class="eyebrow">ACTIVE WORK</p><h3>Funding opportunities</h3></div><div class="funding-ops-list">${opportunities.length ? opportunities.map(opportunityRow).join('') : '<div class="funding-ops-empty">No funding opportunities have been created yet.</div>'}</div></section>
    </section>`;
    root.querySelector('#funding-ops-refresh')?.addEventListener('click', () => render(root));
    root.querySelector('#funding-ops-new')?.addEventListener('click', () => {
      document.querySelector('[data-view="projects"]')?.click();
      window.dispatchEvent(new CustomEvent('sra:funding-opportunity-intake'));
    });
  }

  function activate() {
    const button = document.querySelector('[data-view="funding-operations"]');
    if (!button || button.dataset.bound) return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      const title = document.querySelector('#page-title');
      const contextTitle = document.querySelector('#context-title');
      const status = document.querySelector('#context-status');
      const root = document.querySelector('#view-root');
      if (title) title.textContent = 'Funding Operations';
      if (contextTitle) contextTitle.textContent = 'Funding Operations';
      if (status) { status.textContent = 'LIVE'; status.className = 'badge open'; }
      if (root) render(root);
    });
  }

  style();
  window.addEventListener('DOMContentLoaded', activate);
  new MutationObserver(activate).observe(document.documentElement, { childList: true, subtree: true });
})();
