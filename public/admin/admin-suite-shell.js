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
  const state = { mounted:false, routed:new WeakSet(), observer:null, routeQueued:false };
  const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const workspaceBody = id => document.querySelector(`[data-workspace="${id}"] .admin-workspace-body`);

  function loadStyle(){
    if(document.querySelector('link[data-admin-suite]')) return;
    const link=document.createElement('link');
    link.rel='stylesheet'; link.href='/admin/admin-suite-shell.css'; link.dataset.adminSuite='true';
    document.head.append(link);
  }

  function makeWorkspace([id,label,description]){
    const section=document.createElement('section');
    section.className='admin-workspace'; section.dataset.workspace=id;
    section.innerHTML=`<div class="admin-workspace-head"><div><p class="admin-eyebrow">SAIN PLATFORM ADMINISTRATION</p><h2>${esc(label)}</h2><p>${esc(description)}</p></div></div>${TABS[id]?`<div class="admin-workspace-tabs" role="tablist">${TABS[id].map((tab,i)=>`<button type="button" role="tab" aria-selected="${i===0}" class="${i===0?'active':''}" data-admin-tab="${esc(tab)}">${esc(tab)}</button>`).join('')}</div>`:''}<div class="admin-workspace-body"></div>`;
    section.addEventListener('click',event=>{
      const button=event.target.closest('[data-admin-tab]'); if(!button) return;
      section.querySelectorAll('[data-admin-tab]').forEach(item=>{item.classList.remove('active');item.setAttribute('aria-selected','false');});
      button.classList.add('active'); button.setAttribute('aria-selected','true'); section.dataset.activeTab=button.dataset.adminTab;
    });
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

  function nearestCard(node){ return node?.closest?.('section.card,article.card,.card'); }
  function move(node,id){
    const card=nearestCard(node), body=workspaceBody(id);
    if(!card||!body||state.routed.has(card)||card.closest('.admin-workspace')) return false;
    state.routed.add(card); body.append(card); return true;
  }

  function routeCard(card){
    if(!card||state.routed.has(card)||card.closest('.admin-workspace')) return;
    const text=(card.querySelector('h2,h3,.section-title')?.textContent||card.textContent||'').toLowerCase();
    if(card.querySelector('#asset-details')||text.includes('native platform asset')) move(card,'native-asset');
    else if(card.querySelector('#connector-details')||text.includes('platform and market connections')) move(card,'connections');
    else if(card.querySelector('#listing-details')||text.includes('marketplace listing')||text.includes('sra/usd market lifecycle')) move(card,'marketplace');
    else if(text.includes('treasury')||text.includes('balanced entry')||text.includes('recorded value representation')) move(card,'treasury');
    else if(text.includes('unified market operations')||card.matches('[id*="operations-queue"],[class*="operations-queue"]')) move(card,'operations');
    else if(text.includes('administrative agent')||card.querySelector('#chat-log')) move(card,'agent');
    else if(text.includes('core services')||text.includes('protected actions')||card.querySelector('#protected-areas')) move(card,'system');
    else if(card.matches('[id*="listing-authorization"],[id*="listing-readiness"],[class*="listing-authorization"],[id*="hybrid-liquidity"],[class*="hybrid-liquidity"]')) move(card,'marketplace');
  }

  function routeKnownSections(root=document){
    const cards=[];
    if(root instanceof Element && root.matches('section.card,article.card,.card')) cards.push(root);
    if(root.querySelectorAll) cards.push(...root.querySelectorAll('#admin-view section.card,#admin-view article.card'));
    [...new Set(cards)].forEach(routeCard);
  }

  function queueRoute(root){
    if(state.routeQueued) return;
    state.routeQueued=true;
    requestAnimationFrame(()=>{state.routeQueued=false;routeKnownSections(root||document);syncDashboard();});
  }

  function placeholder(id){
    const body=workspaceBody(id); if(!body||body.children.length) return;
    const labels={instruments:'Instrument registry, approvals, terms, and lifecycle history will appear here.',records:'Recognitions, observations, evidence, origin records, and trace tools will appear here.','coin-positions':'Supply, represented value, mint history, corrections, and intelligence will appear here.',transactions:'Transaction search and state views will appear here.',settlement:'Export packages and external settlement controls will appear here.',users:'User roles, permissions, sessions, and administrator access will appear here.'};
    if(labels[id]) body.innerHTML=`<div class="admin-placeholder">${esc(labels[id])}</div>`;
  }

  function open(id){
    if(!WORKSPACES.some(item=>item[0]===id)) id='dashboard';
    document.querySelectorAll('.admin-workspace').forEach(section=>section.classList.toggle('active',section.dataset.workspace===id));
    document.querySelectorAll('[data-admin-workspace]').forEach(button=>button.classList.toggle('active',button.dataset.adminWorkspace===id));
    const def=WORKSPACES.find(item=>item[0]===id);
    const title=document.querySelector('#admin-suite-title'), subtitle=document.querySelector('#admin-suite-subtitle');
    if(title) title.textContent=def[1]; if(subtitle) subtitle.textContent=def[2];
    placeholder(id);
    const nextHash=`#admin-${id}`; if(location.hash!==nextHash) history.replaceState(null,'',nextHash);
    document.querySelector('.admin-suite-main')?.scrollTo({top:0,behavior:'auto'});
  }

  function syncDashboard(){
    const setStatus=(target,value)=>{
      if(!value) return;
      const node=document.querySelector(`[data-status-card="${target}"] strong`);
      if(node && node.textContent!==value) node.textContent=value;
    };
    const asset=document.querySelector('#asset-state')?.textContent?.trim();
    const listing=document.querySelector('#listing-state')?.textContent?.trim();
    if(asset) setStatus('native-asset',asset==='READY_FOR_EXPORT'?'Live':asset);
    if(listing) setStatus('marketplace',listing==='ACTIVE'?'Live':listing);
  }

  function observeSource(admin){
    if(state.observer) state.observer.disconnect();
    state.observer=new MutationObserver(records=>{
      let relevant=false;
      for(const record of records){
        for(const node of record.addedNodes){
          if(!(node instanceof Element)||node.closest('.admin-suite')) continue;
          relevant=true;
          queueRoute(node);
        }
      }
      if(relevant&&!admin.classList.contains('hidden')) document.body.classList.add('admin-suite-ready');
    });
    state.observer.observe(admin,{childList:true,subtree:true});
  }

  function mount(){
    const admin=document.querySelector('#admin-view'); if(!admin||state.mounted) return;
    state.mounted=true; loadStyle(); document.body.classList.add('admin-suite-ready');
    const top=admin.querySelector('.top'), oldLayout=admin.querySelector('.layout'), metrics=admin.querySelector('#metrics');
    const suite=document.createElement('div'); suite.className='admin-suite';
    suite.innerHTML=`<aside class="admin-suite-rail"><div class="admin-suite-brand"><img src="/brand-logo" alt="SRA"><div><strong>SAIN Platform</strong><span>Administration</span></div></div><nav class="admin-suite-nav" aria-label="Administration workspaces">${WORKSPACES.map(([id,label],i)=>`<button type="button" data-admin-workspace="${id}" class="${i===0?'active':''}"><strong>${esc(label)}</strong></button>`).join('')}</nav></aside><main class="admin-suite-main"><header class="admin-suite-header"><div><h1 id="admin-suite-title">Dashboard</h1><p id="admin-suite-subtitle">Executive platform status</p></div><div id="admin-suite-account"></div></header><div class="admin-suite-content"></div></main>`;
    const content=suite.querySelector('.admin-suite-content'); WORKSPACES.forEach(def=>content.append(makeWorkspace(def)));
    admin.insertBefore(suite,admin.firstChild);
    workspaceBody('dashboard').innerHTML=dashboardMarkup();
    if(top){suite.querySelector('#admin-suite-account').append(top);top.classList.remove('card');}
    if(metrics) metrics.classList.add('admin-source-metrics');
    if(oldLayout) oldLayout.classList.add('admin-source-layout');
    suite.addEventListener('click',event=>{const button=event.target.closest('[data-admin-workspace],[data-open-workspace]');if(button) open(button.dataset.adminWorkspace||button.dataset.openWorkspace);});
    routeKnownSections(admin); syncDashboard(); observeSource(admin); open(location.hash.replace('#admin-','')||'dashboard');
  }

  function initialize(){
    loadStyle(); mount();
    if(!state.mounted){
      const observer=new MutationObserver(()=>{if(document.querySelector('#admin-view')){observer.disconnect();mount();}});
      observer.observe(document.body,{childList:true,subtree:true});
    }
  }
  window.addEventListener('hashchange',()=>open(location.hash.replace('#admin-','')||'dashboard'));
  if(document.readyState==='loading') window.addEventListener('DOMContentLoaded',initialize,{once:true}); else initialize();
})();