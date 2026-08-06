(() => {
  const WORKSPACES = [
    ['dashboard','Dashboard','Executive platform status'],
    ['operations','Unified Market Operations','Governed lifecycle and exceptions'],
    ['treasury','Treasury','Commercial instruments, cash, financing, and ledger'],
    ['native-asset','Native Platform Asset','Native instrument and export lifecycle'],
    ['marketplace','Marketplace Lifecycle','Prepared through settlement'],
    ['instruments','Instruments','Instrument registry and approvals'],
    ['records','Financial Records','Recognitions, evidence, and trace'],
    ['coin-positions','Coin Positions','Supply, representation, and intelligence'],
    ['transactions','Transactions','All transaction states'],
    ['settlement','Export & Settlement','External movement and confirmation'],
    ['agent','SAIN Administrative Agent','Administrative command center'],
    ['connections','Platform Connections','Market and settlement adapters'],
    ['users','Users & Permissions','Administrative access control'],
    ['system','System Health','Core services and diagnostics']
  ];
  const TABS = {
    operations:['Overview','Awaiting Actions','Exceptions','Settlement Queue','Exports','Imports','Transaction Router','Audit Trail','Operation History'],
    treasury:['Overview','Commercial Instruments','Cash Position','Available Financing','Funding Capacity','Journal Entries','Treasury Wallets','Ledger','Treasury Reports'],
    'native-asset':['Current Asset','Approval Status','Listing','Marketplace Status','Export Status','Ownership','Recognitions','Asset History','Publishing','Governance'],
    marketplace:['Prepared','Ready','Published','Orders','Reservations','Allocations','Settlement','Historical Listings'],
    instruments:['Overview','Pending Review','Approved','Published','History'],
    records:['Recognitions','Observations','Financial Records','Evidence','Origin Records','Trace','Audit'],
    'coin-positions':['Current Supply','Represented Value','Legacy Corrections','Coin Intelligence','Mint History','Retirements','Adjustments'],
    transactions:['All','Pending','Completed','Failed','Exported','Imported','Settlement','Search'],
    settlement:['Export Packages','Settlement Instructions','External Confirmation','Destination Verification','Export History','Settlement Logs'],
    agent:['Conversation','Suggested Actions','Workflow Approvals','Incomplete Workflows','Explain Record','Trace Instrument','Platform Questions','Diagnostics'],
    connections:['Coinbase','FedWire','ACH','Ethereum','Solana','Bitcoin','Export Adapters','Connector Logs','Synchronization'],
    users:['Overview','Administrators','Roles','Permissions','Sessions','Access History'],
    system:['Overview','Core Services','Diagnostics','Protected Actions','Alerts','Audit State']
  };
  const ROUTES = {
    '#asset-details':'native-asset','#connector-details':'connections','#listing-details':'marketplace','#protected-areas':'system','#chat-log':'agent'
  };
  const state = { mounted:false, current:'dashboard', routed:new WeakSet(), observer:null };
  const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const workspaceBody = id => document.querySelector(`[data-workspace="${id}"] .admin-workspace-body`);

  function loadStyle(){
    if(document.querySelector('link[data-admin-suite]')) return;
    const link=document.createElement('link'); link.rel='stylesheet'; link.href='/admin/admin-suite-shell.css'; link.dataset.adminSuite='true'; document.head.append(link);
  }

  function makeWorkspace([id,label,description]){
    const section=document.createElement('section');
    section.className='admin-workspace'; section.dataset.workspace=id;
    section.innerHTML=`<div class="admin-workspace-head"><div><p class="admin-eyebrow">SAIN PLATFORM ADMINISTRATION</p><h2>${esc(label)}</h2><p>${esc(description)}</p></div></div>${TABS[id]?`<div class="admin-workspace-tabs" role="tablist">${TABS[id].map((tab,i)=>`<button type="button" role="tab" aria-selected="${i===0}" class="${i===0?'active':''}" data-admin-tab="${esc(tab)}">${esc(tab)}</button>`).join('')}</div>`:''}<div class="admin-workspace-body"></div>`;
    section.querySelectorAll('[data-admin-tab]').forEach(button=>button.addEventListener('click',()=>{
      section.querySelectorAll('[data-admin-tab]').forEach(item=>{item.classList.remove('active');item.setAttribute('aria-selected','false');});
      button.classList.add('active'); button.setAttribute('aria-selected','true'); section.dataset.activeTab=button.dataset.adminTab;
    }));
    return section;
  }

  function dashboardMarkup(){
    const cards=[
      ['Treasury','Balanced','Treasury Balanced','treasury','HEALTHY'],
      ['Marketplace','Live','Marketplace Live','marketplace','LIVE'],
      ['Native Asset','Live','Native Asset Live','native-asset','LIVE'],
      ['Coin Engine','Healthy','Coin Engine Healthy','coin-positions','HEALTHY'],
      ['Settlement','Queue','Settlement Queue','settlement','OPEN'],
      ['Alerts','Review','Alerts','system','VIEW'],
      ['Activity','Current','Activity','operations','OPEN']
    ];
    return `<section class="admin-status-section"><div class="admin-section-label">PLATFORM STATUS</div><div class="admin-dashboard-grid">${cards.map(([label,value,caption,target,badge])=>`<button type="button" class="admin-dashboard-card" data-open-workspace="${target}" data-status-card="${target}"><div class="admin-card-top"><span>${esc(label)}</span><b>→</b></div><strong>${esc(value)}</strong><small>${esc(caption)}</small><em>${esc(badge)}</em></button>`).join('')}</div></section><section class="admin-command-map"><div class="admin-section-label">PLATFORM COMMAND MAP</div><div class="admin-command-grid">${WORKSPACES.filter(([id])=>id!=='dashboard').map(([id,label,description])=>`<button type="button" data-open-workspace="${id}"><strong>${esc(label)}</strong><span>${esc(description)}</span><b>→</b></button>`).join('')}</div></section>`;
  }

  function mount(){
    const admin=document.querySelector('#admin-view'); if(!admin || state.mounted) return;
    loadStyle(); state.mounted=true; document.body.classList.add('admin-suite-ready');
    const top=admin.querySelector('.top'); const oldLayout=admin.querySelector('.layout'); const metrics=admin.querySelector('#metrics');
    const suite=document.createElement('div'); suite.className='admin-suite';
    suite.innerHTML=`<aside class="admin-suite-rail"><div class="admin-suite-brand"><img src="/brand-logo" alt="SRA"><div><strong>SAIN Platform</strong><span>Administration</span></div></div><nav class="admin-suite-nav" aria-label="Administration workspaces">${WORKSPACES.map(([id,label],i)=>`<button type="button" data-admin-workspace="${id}" class="${i===0?'active':''}"><strong>${esc(label)}</strong></button>`).join('')}</nav></aside><main class="admin-suite-main"><header class="admin-suite-header"><div><h1 id="admin-suite-title">Dashboard</h1><p id="admin-suite-subtitle">Executive platform status</p></div><div id="admin-suite-account"></div></header><div class="admin-suite-content"></div></main>`;
    const content=suite.querySelector('.admin-suite-content'); WORKSPACES.forEach(def=>content.append(makeWorkspace(def)));
    admin.insertBefore(suite,admin.firstChild);
    workspaceBody('dashboard').innerHTML=dashboardMarkup();
    if(top){suite.querySelector('#admin-suite-account').append(top);top.classList.remove('card');}
    if(metrics){metrics.classList.add('admin-source-metrics');workspaceBody('dashboard').append(metrics);}
    if(oldLayout) oldLayout.classList.add('admin-source-layout');
    suite.addEventListener('click',event=>{const button=event.target.closest('[data-admin-workspace],[data-open-workspace]');if(button) open(button.dataset.adminWorkspace||button.dataset.openWorkspace);});
    routeKnownSections(); observe(); syncDashboard(); open(location.hash.replace('#admin-','')||'dashboard');
  }

  function nearestCard(node){ return node?.closest('section.card,article.card,.card'); }
  function move(node,id){
    const card=nearestCard(node), body=workspaceBody(id);
    if(!card||!body||state.routed.has(card)||card.closest('.admin-workspace')) return;
    state.routed.add(card); body.append(card);
  }

  function routeKnownSections(){
    Object.entries(ROUTES).forEach(([selector,id])=>document.querySelectorAll(selector).forEach(node=>move(node,id)));
    const mappings=[
      ['[id*="operations-queue"],[class*="operations-queue"]','operations'],
      ['[id*="treasury"],[class*="treasury"]','treasury'],
      ['[id*="listing-authorization"],[id*="listing-readiness"],[class*="listing-authorization"]','marketplace'],
      ['[id*="core-services"],[class*="core-services"]','system'],
      ['[id*="hybrid-liquidity"],[class*="hybrid-liquidity"]','marketplace']
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

  function placeholder(id){
    const body=workspaceBody(id); if(!body||body.children.length) return;
    const labels={instruments:'Instrument registry, approvals, terms, and lifecycle history will appear here.',records:'Recognitions, observations, evidence, origin records, and trace tools will appear here.','coin-positions':'Supply, represented value, mint history, corrections, and intelligence will appear here.',transactions:'Transaction search and state views will appear here.',settlement:'Export packages and external settlement controls will appear here.',users:'User roles, permissions, sessions, and administrator access will appear here.'};
    if(labels[id]) body.innerHTML=`<div class="admin-placeholder">${esc(labels[id])}</div>`;
  }

  function open(id){
    if(!WORKSPACES.some(item=>item[0]===id)) id='dashboard';
    state.current=id;
    document.querySelectorAll('.admin-workspace').forEach(section=>section.classList.toggle('active',section.dataset.workspace===id));
    document.querySelectorAll('[data-admin-workspace]').forEach(button=>button.classList.toggle('active',button.dataset.adminWorkspace===id));
    const def=WORKSPACES.find(item=>item[0]===id);
    document.querySelector('#admin-suite-title').textContent=def[1]; document.querySelector('#admin-suite-subtitle').textContent=def[2];
    placeholder(id); history.replaceState(null,'',`#admin-${id}`); document.querySelector('.admin-suite-main')?.scrollTo({top:0,behavior:'auto'});
  }

  function syncDashboard(){
    const status=(target,value)=>{const card=document.querySelector(`[data-status-card="${target}"] strong`);if(card&&value) card.textContent=value;};
    const asset=document.querySelector('#asset-state')?.textContent?.trim(); if(asset) status('native-asset',asset==='READY_FOR_EXPORT'?'Live':asset);
    const listing=document.querySelector('#listing-state')?.textContent?.trim(); if(listing) status('marketplace',listing==='ACTIVE'?'Live':listing);
    const connector=document.querySelector('#connector-state')?.textContent?.trim(); if(connector) status('connections',connector);
  }

  function observe(){
    const admin=document.querySelector('#admin-view');
    state.observer=new MutationObserver(()=>{routeKnownSections();syncDashboard();if(!admin.classList.contains('hidden')) document.body.classList.add('admin-suite-ready');});
    state.observer.observe(admin,{childList:true,subtree:true,characterData:true});
  }

  function initialize(){loadStyle();mount();if(!state.mounted){const observer=new MutationObserver(()=>{if(document.querySelector('#admin-view')){observer.disconnect();mount();}});observer.observe(document.body,{childList:true,subtree:true});}}
  window.addEventListener('hashchange',()=>open(location.hash.replace('#admin-','')||'dashboard'));
  if(document.readyState==='loading') window.addEventListener('DOMContentLoaded',initialize,{once:true}); else initialize();
})();