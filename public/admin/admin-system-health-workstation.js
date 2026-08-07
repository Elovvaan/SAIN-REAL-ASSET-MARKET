(() => {
  if (window.__sraSystemHealthWorkstationInstalled) return;
  window.__sraSystemHealthWorkstationInstalled = true;

  const mounted = new WeakSet();
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const number = (value) => Number(value || 0).toLocaleString();
  const when = (value) => value ? new Date(value).toLocaleString() : 'Waiting';

  async function requestJson(url) {
    const response = await fetch(url, { cache:'no-store', headers:{ Accept:'application/json', 'Cache-Control':'no-cache' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }

  function controls(workspace) { return workspace?.querySelector('.admin-workspace-controls') || null; }
  function panel(workspace) {
    const root = controls(workspace);
    if (!root) return null;
    let node = root.querySelector('[data-system-health-lifecycle]');
    if (!node) {
      node = document.createElement('section');
      node.className = 'admin-record-card';
      node.dataset.systemHealthLifecycle = 'true';
      root.prepend(node);
    }
    return node;
  }
  function metric(label, value) { return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function stateText(value) { return String(value || 'UNKNOWN').replaceAll('_',' '); }

  function overview(brief) {
    const h = brief.heartbeat || {}; const m = brief.movement || {};
    return `<header><strong>System Operating State</strong><em>${esc(stateText(brief.state))}</em></header>
      <div class="admin-record-grid" style="margin-top:12px">${metric('Scheduler',h.schedulerState||'UNKNOWN')}${metric('Cycles',number(h.cycleCount))}${metric('Completed engines',number(h.completedEngines))}${metric('Failed engines',number(h.failedEngines))}${metric('Latest cycle',when(h.completedAt))}${metric('Observations',number(m.observations))}${metric('Coin Positions',number(m.coinPositions))}${metric('Instruments',number(m.instruments))}${metric('Live listings',number(m.liveListings))}</div>
      <p style="color:#d6d6d6;margin:14px 0 0">${esc(brief.reply || 'System status is available.')}</p><p style="color:#9a9a9a;margin:8px 0 0">${esc(brief.nextAction || '')}</p>`;
  }
  function coreServices(brief) {
    const engines = brief.engines || [];
    return `<header><strong>Core Service Engine Cycle</strong><em>${engines.some(e=>e.state==='FAILED')?'ATTENTION':'HEALTHY'}</em></header>
      <p style="color:#9a9a9a">Scheduler → engine cycle → persistent platform movement → next operating state.</p>
      <div class="admin-record-list" style="margin-top:12px">${engines.map(e=>`<article class="admin-record-card" style="margin:0"><header><strong>${esc(String(e.name||'ENGINE').replaceAll('_',' '))}</strong><em>${esc(e.state||'UNKNOWN')}</em></header><div class="admin-record-grid">${metric('Started',when(e.startedAt))}${metric('Completed',when(e.completedAt))}${e.error?metric('Error',e.error):''}</div></article>`).join('') || '<p style="color:#9a9a9a">Waiting for the first completed engine cycle.</p>'}</div>`;
  }
  function diagnostics(brief) {
    const h=brief.heartbeat||{}; const failed=(brief.engines||[]).filter(e=>e.state==='FAILED');
    return `<header><strong>Diagnostics</strong><em>${failed.length?'ACTION REQUIRED':'CLEAR'}</em></header><div class="admin-record-grid" style="margin-top:12px">${metric('Scheduler running now',h.runningNow?'YES':'NO')}${metric('Interval ms',number(h.intervalMs))}${metric('Latest cycle ID',h.latestCycleId||'Waiting')}${metric('Latest trigger',h.latestTrigger||'Waiting')}${metric('Latest state',h.latestState||'Waiting')}${metric('Failed engines',number(failed.length))}</div>${failed.map(e=>`<p style="color:#d6a92f">${esc(e.name)}: ${esc(e.error||'Engine cycle failed.')}</p>`).join('')}`;
  }
  function protectedActions() {
    return `<header><strong>Protected Action Boundary</strong><em>HUMAN IN THE LOOP</em></header><p style="color:#d6d6d6">SAIN may prepare, validate, explain, and stage work. A protected state change executes only through an authorized control.</p><div class="admin-record-grid" style="margin-top:12px">${metric('Preparation','AUTOMATED')}${metric('Validation','AUTOMATED')}${metric('State-changing execution','AUTHORIZED CONTROL')}${metric('Audit expectation','PERSISTED')}</div><p style="color:#9a9a9a;margin:12px 0 0">This boundary covers financial records, recognition, Coin Positions, instruments, marketplace listings, transactions, Treasury, settlement, ownership recognition, export packaging, connectors, account authority, and determinations.</p>`;
  }
  function alerts(brief) {
    const attention=brief.attention||[];
    return `<header><strong>Operational Alerts</strong><em>${attention.length?`${number(attention.length)} OPEN`:'CLEAR'}</em></header>${attention.length?`<div class="admin-record-list" style="margin-top:12px">${attention.map(item=>`<article class="admin-record-card" style="margin:0"><strong>${esc(item)}</strong></article>`).join('')}</div>`:'<p style="color:#9a9a9a;margin-top:12px">No core-services exception is currently reported.</p>'}<p style="color:#d6d6d6;margin-top:12px">${esc(brief.nextAction||'')}</p>`;
  }
  function audit(brief) {
    const h=brief.heartbeat||{};
    return `<header><strong>System Audit State</strong><em>${h.latestCycleId?'TRACE AVAILABLE':'WAITING'}</em></header><div class="admin-record-grid" style="margin-top:12px">${metric('Latest cycle ID',h.latestCycleId||'Waiting')}${metric('Trigger',h.latestTrigger||'Waiting')}${metric('Started',when(h.startedAt))}${metric('Completed',when(h.completedAt))}${metric('Completed engines',number(h.completedEngines))}${metric('Failed engines',number(h.failedEngines))}</div><p style="color:#9a9a9a;margin-top:12px">System Health reads the same persisted operating cycle used by SRA Core Services. It does not manufacture a second health state.</p>`;
  }

  async function refresh(workspace) {
    const node=panel(workspace); if(!node) return;
    node.innerHTML='<header><strong>System Health</strong><em>CHECKING</em></header><p style="color:#9a9a9a">Reading the latest SRA Core Services operating cycle…</p>';
    try {
      const brief=await requestJson('/api/sane/core-services/brief');
      if(!node.isConnected) return;
      const tab=workspace.dataset.activeTab || 'Overview';
      const renderers={Overview:overview,'Core Services':coreServices,Diagnostics:diagnostics,'Protected Actions':protectedActions,Alerts:alerts,'Audit State':audit};
      node.innerHTML=(renderers[tab]||overview)(brief);
    } catch(error) { node.innerHTML=`<header><strong>System Health</strong><em>UNAVAILABLE</em></header><p style="color:#d6a92f">${esc(error.message)}</p>`; }
  }

  function mount(workspace) {
    if(!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click',event=>{ if(event.target.closest('[data-admin-tab]')) queueMicrotask(()=>void refresh(workspace)); });
    window.addEventListener('sra:admin-workspace-synchronized',event=>{ if(event.detail?.workspaceId==='system') void refresh(workspace); });
    void refresh(workspace);
  }
  window.mountAdminSystemHealthWorkstation = mount;
})();