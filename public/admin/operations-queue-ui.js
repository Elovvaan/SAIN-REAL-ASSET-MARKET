(() => {
  let timer = null;
  let latest = null;

  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const number = (value) => Number(value || 0).toLocaleString();
  const friendly = (value) => String(value || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

  async function request(url) {
    const response = await fetch(url);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed.');
    return payload;
  }

  function ensureStyles() {
    if (document.querySelector('#operations-queue-styles')) return;
    const style = document.createElement('style');
    style.id = 'operations-queue-styles';
    style.textContent = `
      .ops-shell{margin-top:14px}.ops-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.ops-summary article{border:1px solid #292929;border-radius:12px;padding:12px;background:#080808}.ops-summary span{display:block;color:#9f9f9f;font-size:10px;text-transform:uppercase;letter-spacing:.08em}.ops-summary strong{display:block;font-size:22px;margin-top:3px}.ops-layout{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(300px,.8fr);gap:12px;margin-top:12px}.ops-list,.coin-agent-panel{border:1px solid #292929;border-radius:14px;background:#070707;min-height:240px}.ops-list-header,.coin-agent-header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px;border-bottom:1px solid #292929}.ops-list-header h3,.coin-agent-header h3{margin:0;font-size:14px}.ops-items{max-height:520px;overflow:auto;padding:8px}.ops-item{border:1px solid #242424;border-radius:12px;padding:12px;margin:7px 0;background:linear-gradient(180deg,#101010,#090909);cursor:pointer}.ops-item:hover,.ops-item.active{border-color:#6d5722;background:#151107}.ops-item-top{display:flex;justify-content:space-between;gap:8px}.ops-item b{font-size:12px}.ops-item small{display:block;color:#999;margin-top:5px}.ops-item .action{color:#d6a92f;font-size:10px;font-weight:800}.ops-empty{padding:22px;color:#999}.ops-exception{border-color:#653333}.coin-agent-body{padding:14px}.coin-agent-search{display:flex;gap:8px;margin-bottom:12px}.coin-agent-search input{margin:0}.coin-agent-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.coin-agent-grid div{padding:10px;border:1px solid #242424;border-radius:10px}.coin-agent-grid span{display:block;color:#999;font-size:9px;text-transform:uppercase}.coin-agent-grid strong{display:block;margin-top:4px;word-break:break-word}.coin-agent-explanation{margin-top:10px;border:1px solid #4a3c19;background:#151107;border-radius:12px;padding:12px;color:#e4d8ad}.coin-agent-boundary{margin-top:10px;color:#999;font-size:11px}.coin-agent-blockers{margin:10px 0 0;padding-left:18px;color:#d98b8b}.ops-pulse{margin-top:12px;padding:12px;border:1px solid #292929;border-radius:12px;color:#aaa}.ops-pulse strong{color:#72c78b}.ops-next{margin-top:12px;padding:12px;border:1px solid #4a3c19;border-radius:12px;background:#151107}.ops-next b{color:#d6a92f}.ops-refresh{padding:7px 10px;font-size:11px}@media(max-width:1000px){.ops-summary{grid-template-columns:repeat(2,1fr)}.ops-layout{grid-template-columns:1fr}}@media(max-width:600px){.ops-summary,.coin-agent-grid{grid-template-columns:1fr}.coin-agent-search{flex-direction:column}}
    `;
    document.head.append(style);
  }

  function ensurePanel() {
    const anchor = document.querySelector('#metrics');
    if (!anchor || document.querySelector('#unified-operations-queue')) return;
    anchor.insertAdjacentHTML('afterend', `<section id="unified-operations-queue" class="card ops-shell">
      <div class="section-title"><div><h2>Unified Market Operations Queue</h2><small style="color:#999">Governed work waiting across orders, reservations, allocation, settlement, export, and external transfer.</small></div><span id="ops-state" class="status">LOADING</span></div>
      <div id="ops-summary" class="ops-summary"></div>
      <div id="ops-next" class="ops-next">Loading the next governed action.</div>
      <div class="ops-layout">
        <section class="ops-list"><div class="ops-list-header"><h3>Waiting and Exceptions</h3><button id="ops-refresh" class="ops-refresh">Refresh</button></div><div id="ops-items" class="ops-items"><div class="ops-empty">Loading operations.</div></div></section>
        <section class="coin-agent-panel"><div class="coin-agent-header"><h3>SRA Coin Agent</h3><span style="color:#d6a92f">EXPLAIN & PREPARE</span></div><div class="coin-agent-body"><div class="coin-agent-search"><input id="coin-agent-search" placeholder="Coin Position ID"><button id="coin-agent-find">Explain</button></div><div id="coin-agent-result"><div class="ops-empty">Select a queue item with a Coin Position, or enter a Coin Position ID currently represented in the queue.</div></div></div></section>
      </div>
      <div id="ops-pulse" class="ops-pulse">Loading Core Services pulse.</div>
    </section>`);
    document.querySelector('#ops-refresh').addEventListener('click', () => void load());
    document.querySelector('#coin-agent-find').addEventListener('click', findCoinAgent);
    document.querySelector('#coin-agent-search').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); findCoinAgent(); } });
  }

  function renderCoinAgent(agent) {
    const root = document.querySelector('#coin-agent-result');
    if (!root) return;
    if (!agent) {
      root.innerHTML = '<div class="ops-empty">No Coin Agent explanation is attached to that current operation.</div>';
      return;
    }
    root.innerHTML = `<div class="coin-agent-grid">
      <div><span>Agent</span><strong>${esc(agent.agentId)}</strong></div>
      <div><span>Coin Position</span><strong>${esc(agent.positionId)}</strong></div>
      <div><span>Current state</span><strong>${esc(friendly(agent.currentState))}</strong></div>
      <div><span>Next eligible action</span><strong>${esc(friendly(agent.nextEligibleAction))}</strong></div>
      <div><span>Human approval</span><strong>${agent.humanApprovalRequired ? 'REQUIRED' : 'NOT CURRENTLY REQUIRED'}</strong></div>
      <div><span>Blockers</span><strong>${number(agent.blockers?.length || 0)}</strong></div>
    </div>
    <div class="coin-agent-explanation">${esc(agent.explanation || 'No explanation was returned.')}</div>
    ${agent.blockers?.length ? `<ul class="coin-agent-blockers">${agent.blockers.map((item) => `<li>${esc(friendly(item))}</li>`).join('')}</ul>` : ''}
    <div class="coin-agent-boundary">The Coin Agent may explain, trace lineage, identify the next action, and prepare governed work. It cannot self-approve, move value, change ownership, or bypass policy.</div>`;
    document.querySelector('#coin-agent-search').value = agent.positionId || '';
  }

  function findCoinAgent() {
    const value = String(document.querySelector('#coin-agent-search')?.value || '').trim().toUpperCase();
    if (!value || !latest) return;
    const entries = [...(latest.exceptions || []), ...(latest.queue || [])];
    const match = entries.find((entry) => String(entry.coinAgent?.positionId || '').toUpperCase() === value);
    renderCoinAgent(match?.coinAgent || null);
  }

  function render(data) {
    latest = data;
    const state = document.querySelector('#ops-state');
    state.textContent = data.state || 'UNKNOWN';
    state.classList.toggle('ok', data.state === 'CURRENT');
    const agentStatus = data.coinAgents || {};
    document.querySelector('#ops-summary').innerHTML = [
      ['Awaiting action', data.totalAwaitingAction],
      ['Exceptions', data.totalExceptions],
      ['Coin agents', agentStatus.coinAgentCount],
      ['Need approval', agentStatus.requiringHumanApproval]
    ].map(([label, value]) => `<article><span>${esc(label)}</span><strong>${number(value)}</strong></article>`).join('');

    const next = data.nextRecommendedAction;
    document.querySelector('#ops-next').innerHTML = next
      ? `<b>Next recommended action: ${esc(friendly(next.action))}</b><div>${esc(next.explanation || '')}</div><small>${esc(next.stage)} · ${esc(next.id)}</small>`
      : '<b>Queue current.</b><div>No governed market operation is presently waiting.</div>';

    const entries = [
      ...(data.exceptions || []).map((entry) => ({ ...entry, exception: true })),
      ...(data.queue || [])
    ];
    document.querySelector('#ops-items').innerHTML = entries.length ? entries.map((entry, index) => `<article class="ops-item ${entry.exception ? 'ops-exception' : ''}" data-ops-index="${index}">
      <div class="ops-item-top"><b>${esc(friendly(entry.stage))}</b><span class="action">${esc(friendly(entry.nextAction))}</span></div>
      <small>${esc(entry.explanation || '')}</small>
      <small>${esc(entry.id)}${entry.coinAgent?.positionId ? ` · ${esc(entry.coinAgent.positionId)}` : ''}</small>
    </article>`).join('') : '<div class="ops-empty">No waiting operations or exceptions.</div>';

    document.querySelectorAll('[data-ops-index]').forEach((element) => element.addEventListener('click', () => {
      document.querySelectorAll('.ops-item').forEach((item) => item.classList.remove('active'));
      element.classList.add('active');
      renderCoinAgent(entries[Number(element.dataset.opsIndex)]?.coinAgent || null);
    }));

    const pulse = data.platformPulse;
    document.querySelector('#ops-pulse').innerHTML = pulse
      ? `<strong>Core Services ${esc(friendly(pulse.schedulerState || 'active'))}</strong> · ${number(pulse.completedCycles)} cycles · ${number(pulse.failedEngines)} failed engines in latest cycle`
      : 'Core Services pulse is not available.';
  }

  async function load() {
    ensureStyles();
    ensurePanel();
    if (!document.querySelector('#unified-operations-queue')) return;
    try {
      render(await request('/api/sane/operations-queue'));
    } catch (error) {
      document.querySelector('#ops-state').textContent = 'UNAVAILABLE';
      document.querySelector('#ops-items').innerHTML = `<div class="ops-empty">${esc(error.message)}</div>`;
    }
  }

  const observer = new MutationObserver(() => {
    if (document.querySelector('#admin-view:not(.hidden)')) { ensureStyles(); ensurePanel(); }
  });

  window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    setTimeout(() => void load(), 500);
    timer = setInterval(() => { if (document.querySelector('#admin-view:not(.hidden)')) void load(); }, 15000);
    timer.unref?.();
  });
})();
