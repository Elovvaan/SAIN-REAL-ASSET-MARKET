(() => {
  const WORKSPACES = [
    ['dashboard','Dashboard','Executive platform status'],
    ['operations','Unified Market Operations','Governed lifecycle and exceptions'],
    ['treasury','Treasury','Commercial instruments and ledger'],
    ['native-asset','Native Platform Asset','Native instrument and export lifecycle'],
    ['marketplace','Marketplace Lifecycle','Prepared through settlement'],
    ['instruments','Instruments','Instrument registry and approvals'],
    ['records','Financial Records','Recognitions, evidence, and trace'],
    ['coin-positions','Coin Positions','Supply, representation, and intelligence'],
    ['transactions','Transactions','All transaction states'],
    ['settlement','Export & Settlement','External movement and confirmation'],
    ['agent','SAIN Administrative Agent','Administrative copilot'],
    ['connections','Platform Connections','Market and settlement adapters'],
    ['users','Users & Permissions','Administrative access control'],
    ['system','System Health','Core services and diagnostics']
  ];
  const TABS = {
    operations:['Overview','Awaiting Actions','Exceptions','Settlement Queue','Exports','Imports','Transaction Router','Audit Trail','Operation History'],
    treasury:['Overview','Commercial Instruments','Cash Position','Available Financing','Funding Capacity','Journal Entries','Treasury Wallets','Ledger','Treasury Reports'],
    'native-asset':['Current Asset','Approval Status','Listing','Marketplace Status','Export Status','Ownership','Recognitions','Asset History','Publishing','Governance'],
    marketplace:['Prepared','Ready','Published','Orders','Reservations','Allocations','Settlement','Historical Listings'],
    records:['Recognitions','Observations','Financial Records','Evidence','Origin Records','Trace','Audit'],
    'coin-positions':['Current Supply','Represented Value','Legacy Corrections','Coin Intelligence','Mint History','Retirements','Adjustments'],
    transactions:['All','Pending','Completed','Failed','Exported','Imported','Settlement','Search'],
    settlement:['Export Packages','Settlement Instructions','External Confirmation','Destination Verification','Export History','Settlement Logs'],
    agent:['Conversation','Suggested Actions','Workflow Approvals','Incomplete Workflows','Explain Record','Trace Instrument','Platform Questions','Diagnostics'],
    connections:['Coinbase','FedWire','ACH','Ethereum','Solana','Bitcoin','Export Adapters','Connector Logs','Synchronization']
  };
  const state = { mounted:false, current:'dashboard', routed:new WeakSet() };
  const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  function loadStyle(){ if(document.querySelector('link[data-admin-suite]')) return; const link=document.createElement('link'); link.rel='stylesheet'; link.href='/admin/admin-suite-shell.css'; link.dataset.adminSuite='true'; document.head.append(link); }
  function makeWorkspace([id,label,description]){ const section=document.createElement('section'); section.className='admin-workspace'; section.dataset.workspace=id; section.innerHTML=`<div class="admin-workspace-head"><div><h2>${esc(label)}</h2><p>${esc(description)}</p></div></div>${TABS[id]?`<div class="admin-workspace-tabs">${TABS[id].map((tab,i)=>`<button type="button" class="${i===0?'active':''}" data-admin-tab="${esc(tab)}">${esc(tab)}</button>`).join('')}</div>`:''}<div class="admin-workspace-body"></div>`; section.querySelectorAll('[data-admin-tab]').forEach(button=>button.addEventListener('click',()=>{section.querySelectorAll('[data-admin-tab]').forEach(x=>x.classList.remove('active'));button.classList.add('active');section.dataset.activeTab=button.dataset.adminTab;})); return section; }
  function mount(){
    const admin=document.querySelector('#admin-view'); if(!admin || state.mounted) return;
    loadStyle(); state.mounted=true; document.body.classList.add('admin-suite-ready');
    const top=admin.querySelector('.top'); const metrics=admin.querySelector('#metrics'); const oldLayout=admin.querySelector('.layout');
    const suite=document.createElement('div'); suite.className='admin-suite';
    suite.innerHTML=`<aside class="admin-suite-rail"><div class="admin-suite-brand"><img src="/brand-logo" alt="SRA"><div><strong>SAIN Administration</strong><span>Private operating suite</span></div></div><nav class="admin-suite-nav">${WORKSPACES.map(([id,label,description],i)=>`<button type="button" data-admin-workspace="${id}" class="${i===0?'active':''}"><strong>${esc(label)}</strong><small>${esc(description)}</small></button>`).join('')}</nav></aside><main class="admin-suite-main"><header class="admin-suite-header"><div><h1 id="admin-suite-title">Dashboard</h1><p id="admin-suite-subtitle">Executive platform status</p></div><div id="admin-suite-account"></div></header><div class="admin-suite-content"></div></main>`;
    const content=suite.querySelector('.admin-suite-content'); WORKSPACES.forEach(def=>content.append(makeWorkspace(def)));
    admin.insertBefore(suite,admin.firstChild);
    const dashboard=content.querySelector('[data-workspace="dashboard"] .admin-workspace-body');
    dashboard.innerHTML=`<div class="admin-dashboard-grid">${[
      ['Treasury','Treasury Balanced','treasury'],['Marketplace','Marketplace Live','marketplace'],['Native Asset','Native Asset Live','native-asset'],['Coin Engine','Coin Engine Healthy','coin-positions'],['Settlement','Settlement Queue','settlement'],['Alerts','Operational Alerts','operations'],['Activity','Platform Activity','transactions'],['Connections','Platform Connections','connections'],['System','System Health','system']
    ].map(([label,status,target])=>`<button type="button" class="admin-dashboard-card" data-open-workspace="${target}"><span>${label}</span><strong>${status}</strong><small>Open dedicated workspace</small><div class="admin-dashboard-status">View →</div></button>`).join('')}</div>`;
    if(top){ suite.querySelector('#admin-suite-account').append(top); top.classList.remove('card'); }
    if(metrics) dashboard.prepend(metrics);
    if(oldLayout) oldLayout.classList.add('admin-source-layout');
    suite.querySelectorAll('[data-admin-workspace],[data-open-workspace]').forEach(button=>button.addEventListener('click',()=>open(button.dataset.adminWorkspace||button.dataset.openWorkspace)));
    routeKnownSections(); observe(); open(location.hash.replace('#admin-','')||'dashboard');
  }
  function workspaceBody(id){ return document.querySelector(`[data-workspace="${id}"] .admin-workspace-body`); }
  function nearestCard(node){ return node?.closest('section.card,section,article.card,.card'); }
  function move(node,id){ const card=nearestCard(node); const body=workspaceBody(id); if(!card||!body||state.routed.has(card)||card.closest('.admin-workspace')) return; state.routed.add(card); body.append(card); }
  function routeKnownSections(){
    const mappings=[
      ['#asset-details','native-asset'],['#connector-details','connections'],['#listing-details','marketplace'],['#protected-areas','system'],['#chat-log','agent'],
      ['[id*="operations-queue"]','operations'],['[class*="operations-queue"]','operations'],['[id*="treasury"]','treasury'],['[class*="treasury"]','treasury'],
      ['[id*="listing-authorization"]','marketplace'],['[id*="listing-readiness"]','marketplace'],['[class*="listing-authorization"]','marketplace'],
      ['[id*="core-services"]','system'],['[class*="core-services"]','system'],['[id*="hybrid-liquidity"]','marketplace'],['[class*="hybrid-liquidity"]','marketplace']
    ];
    mappings.forEach(([selector,id])=>document.querySelectorAll(selector).forEach(node=>move(node,id)));
    document.querySelectorAll('#admin-view section.card,#admin-view article.card').forEach(card=>{
      if(state.routed.has(card)||card.closest('.admin-workspace')) return;
      const text=(card.querySelector('h2,h3,.section-title')?.textContent||card.textContent||'').toLowerCase();
      if(text.includes('native platform asset')) move(card,'native-asset');
      else if(text.includes('platform and market connections')) move(card,'connections');
      else if(text.includes('marketplace listing')||text.includes('sra/usd market lifecycle')) move(card,'marketplace');
      else if(text.includes('treasury')||text.includes('balanced entry')||text.includes('recorded value representation')) move(card,'treasury');
      else if(text.includes('unified market operations')) move(card,'operations');
      else if(text.includes('administrative agent')) move(card,'agent');
      else if(text.includes('core services')||text.includes('protected actions')) move(card,'system');
    });
  }
  function placeholder(id){ const body=workspaceBody(id); if(!body||body.children.length) return; const labels={instruments:'Instrument registry, approvals, terms, and lifecycle history will appear here.',records:'Recognitions, observations, evidence, origin records, and trace tools will appear here.','coin-positions':'Supply, represented value, mint history, corrections, and intelligence will appear here.',transactions:'Transaction search and state views will appear here.',settlement:'Export packages and external settlement controls will appear here.',users:'User roles, permissions, and administrator access will appear here.'}; if(labels[id]) body.innerHTML=`<div class="admin-placeholder">${esc(labels[id])}</div>`; }
  function open(id){ if(!WORKSPACES.some(x=>x[0]===id)) id='dashboard'; state.current=id; document.querySelectorAll('.admin-workspace').forEach(x=>x.classList.toggle('active',x.dataset.workspace===id)); document.querySelectorAll('[data-admin-workspace]').forEach(x=>x.classList.toggle('active',x.dataset.adminWorkspace===id)); const def=WORKSPACES.find(x=>x[0]===id); document.querySelector('#admin-suite-title').textContent=def[1]; document.querySelector('#admin-suite-subtitle').textContent=def[2]; placeholder(id); history.replaceState(null,'',`#admin-${id}`); document.querySelector('.admin-suite-main')?.scrollTo({top:0,behavior:'smooth'}); }
  function observe(){ const admin=document.querySelector('#admin-view'); const observer=new MutationObserver(()=>{routeKnownSections(); if(!admin.classList.contains('hidden')) document.body.classList.add('admin-suite-ready');}); observer.observe(admin,{childList:true,subtree:true}); }
  const rootObserver=new MutationObserver(()=>{ const admin=document.querySelector('#admin-view'); if(admin&&!state.mounted) mount(); });
  window.addEventListener('DOMContentLoaded',()=>{loadStyle(); rootObserver.observe(document.body,{childList:true,subtree:true}); mount();});
})();