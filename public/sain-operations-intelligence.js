(() => {
  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  async function request(path, options = {}) {
    const response = await fetch(path, {
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
    return payload;
  }

  function addStyle() {
    if (document.querySelector('#sain-operations-intelligence-style')) return;
    const style = document.createElement('style');
    style.id = 'sain-operations-intelligence-style';
    style.textContent = `
      .sain-intel{padding:20px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:linear-gradient(145deg,rgba(215,166,42,.08),rgba(255,255,255,.02))}
      .sain-intel-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px}
      .sain-intel-card{padding:14px;border-radius:13px;background:rgba(255,255,255,.04)}.sain-intel-card strong{display:block;font-size:20px}.sain-intel-card span{font-size:12px;opacity:.72}
      .sain-intel-list{display:grid;gap:8px;margin-top:10px}.sain-intel-item{padding:11px;border-radius:10px;background:rgba(255,255,255,.035)}
      .sain-intel-ask{display:grid;grid-template-columns:1fr auto;gap:10px;margin-top:14px}.sain-intel-ask input{width:100%;box-sizing:border-box;padding:11px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#101010;color:#fff}
      .sain-intel-answer{margin-top:12px;padding:14px;border-radius:12px;background:rgba(255,255,255,.04);white-space:pre-wrap}.sain-health-good{color:#7de0a9}.sain-health-watch{color:#f1c66b}.sain-health-bad{color:#ff9d9d}
      @media(max-width:800px){.sain-intel-grid,.sain-intel-ask{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function stringifyAnswer(answer) {
    if (typeof answer === 'string') return answer;
    if (answer?.records) return answer.records.map((item) => `• ${item.recommendation || JSON.stringify(item)}`).join('\n');
    if (answer?.primary) return `Primary bottleneck: ${answer.primary.queue}\nWaiting: ${answer.primary.count}\nOldest age: ${answer.primary.oldestAgeHours} hours`;
    if (answer?.status && answer?.score != null) return `Operational status: ${answer.status}\nHealth score: ${answer.score}`;
    if (answer?.opportunityId) {
      return `${answer.title || answer.opportunityId}\nStatus: ${answer.status}\nPhase: ${answer.fundingPhase || ''}\nResponsible queue: ${answer.responsibleQueue}\nNext action: ${answer.nextAction}${answer.blockers?.length ? `\nBlockers: ${answer.blockers.join(' ')}` : ''}`;
    }
    return JSON.stringify(answer, null, 2);
  }

  async function render(section) {
    section.innerHTML = '<div class="loading-state">Loading SAIN operations intelligence…</div>';
    try {
      const summary = await request('/api/sain/intelligence/summary');
      const health = summary.health || {};
      const metrics = summary.metrics || {};
      const primary = summary.bottlenecks?.primary;
      const healthClass = health.status === 'HEALTHY' ? 'sain-health-good' : health.status === 'WATCH' ? 'sain-health-watch' : 'sain-health-bad';
      section.innerHTML = `
        <div class="funding-panel-head"><div><p class="eyebrow">SAIN OPERATIONS INTELLIGENCE</p><h3>Internal platform awareness</h3><p>SAIN is now grounded in SRA's live records, queues, and lifecycle states.</p></div><button class="secondary-button" id="sain-intel-refresh">Refresh</button></div>
        <div class="sain-intel-grid">
          <div class="sain-intel-card"><span>Operational health</span><strong class="${healthClass}">${esc(health.status || 'UNKNOWN')}</strong><span>Score ${esc(health.score ?? '—')}</span></div>
          <div class="sain-intel-card"><span>Funding opportunities</span><strong>${esc(metrics.opportunities?.total || 0)}</strong><span>${esc(metrics.opportunities?.requestedAmount || 0)} total requested</span></div>
          <div class="sain-intel-card"><span>Primary bottleneck</span><strong>${esc(primary?.queue || 'NONE')}</strong><span>${primary ? `${primary.count} waiting · ${primary.oldestAgeHours}h oldest` : 'No bottleneck detected'}</span></div>
          <div class="sain-intel-card"><span>Issued instruments</span><strong>${esc(metrics.instruments?.issued || 0)}</strong><span>${esc(metrics.instruments?.draft || 0)} drafts</span></div>
          <div class="sain-intel-card"><span>Live listings</span><strong>${esc(metrics.marketplace?.liveListings || 0)}</strong><span>${esc(metrics.marketplace?.confirmedCommitments || 0)} confirmed commitments</span></div>
          <div class="sain-intel-card"><span>Recognized positions</span><strong>${esc(metrics.positions?.recognized || 0)}</strong><span>${esc(metrics.positions?.pendingSettlement || 0)} pending settlement</span></div>
        </div>
        <section class="sain-intel-card" style="margin-top:12px"><p class="eyebrow">RECOMMENDATIONS</p><div class="sain-intel-list">${(summary.recommendations || []).map((item) => `<div class="sain-intel-item"><strong>${esc(item.priority)} · ${esc(item.queue)}</strong><span>${esc(item.recommendation)}</span></div>`).join('')}</div></section>
        <section class="sain-intel-card" style="margin-top:12px"><p class="eyebrow">ASK SAIN ABOUT THE PLATFORM</p><div class="sain-intel-ask"><input id="sain-intel-question" placeholder="What's slowing the platform? Why is FOP-1234 stuck? What needs attention?"><button class="primary-button" id="sain-intel-ask-button">Ask SAIN</button></div><div class="sain-intel-answer" id="sain-intel-answer">SAIN will answer from live SRA records.</div></section>`;
      section.querySelector('#sain-intel-refresh')?.addEventListener('click', () => render(section));
      section.querySelector('#sain-intel-ask-button')?.addEventListener('click', async () => {
        const answerRoot = section.querySelector('#sain-intel-answer');
        const question = section.querySelector('#sain-intel-question').value.trim();
        if (!question) return;
        answerRoot.textContent = 'SAIN is reviewing the platform records…';
        try {
          const response = await request('/api/sain/intelligence/ask', { method: 'POST', body: JSON.stringify({ question }) });
          answerRoot.textContent = stringifyAnswer(response.answer);
        } catch (error) {
          answerRoot.textContent = error.message;
        }
      });
    } catch (error) {
      section.innerHTML = `<strong>SAIN Operations Intelligence could not load.</strong><p>${esc(error.message)}</p>`;
    }
  }

  function mount() {
    const fundingRoot = document.querySelector('#view-root .funding-ops');
    if (!fundingRoot || fundingRoot.querySelector('#sain-operations-intelligence')) return;
    const section = document.createElement('section');
    section.className = 'sain-intel';
    section.id = 'sain-operations-intelligence';
    fundingRoot.prepend(section);
    render(section);
  }

  addStyle();
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('DOMContentLoaded', mount);
})();
