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
  const state = { mounted:false, routed:new WeakSet(), observer:null, routeQueued:false, workspaceData:null, loading:null, lastError:null };
  const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const workspaceBody = id => document.querySelector(`[data-workspace="${id}"] .admin-workspace-body`);
  const firstId = record => record?.instrumentId || record?.listingId || record?.financialRecordId || record?.recognitionId || record?.observationId || record?.coinPositionId || record?.transactionId || record?.exportPackageId || record?.instructionId || record?.settlementId || record?.adapterId || record?.id || record?.userId || record?.email || 'Unidentified record';
  const recordState = record => String(record?.state || record?.status || record?.lifecycleState || 'UNKNOWN').toUpperCase();
  const dateValue = record => record?.updatedAt || record?.createdAt || record?.occurredAt || record?.recordedAt || record?.issuedAt || record?.publishedAt || record?.confirmedAt || record?.settledAt || null;
  const money = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : null;

  function loadStyle(){
    if(document.querySelector('link[data-admin-suite]')) return;
    const link=document.createElement('link');
    link.rel='stylesheet'; link.href='/admin/admin-suite-shell.css'; link.dataset.adminSuite='true';
    document.head.append(link);
  }

  async function requestJson(url, options={}){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(url,{...options,signal:controller.signal,headers:{Accept:'application/json',...(options.headers||{})}});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(payload.error||`Request failed with ${response.status}.`);
      return payload;
    }catch(error){
      if(error?.name==='AbortError') throw new Error('The platform did not respond within 10 seconds.');
      throw error;
    }finally{clearTimeout(timer);}
  }

  function makeWorkspace([id,label,description]){
    const section=document.createElement('section');
    section.className='admin-workspace'; section.dataset.workspace=id; section.dataset.activeTab=TABS[id]?.[0]||'';
    section.innerHTML=`<div class="admin-workspace-head"><div><p class="admin-eyebrow">SAIN PLATFORM ADMINISTRATION</p><h2>${esc(label)}</h2><p>${esc(description)}</p></div><button type="button" data-refresh-workspace="${id}">Refresh</button></div>${TABS[id]?`<div class="admin-workspace-tabs" role="tablist">${TABS[id].map((tab,i)=>`<button type="button" role="tab" aria-selected="${i===0}" class="${i===0?'active':''}" data-admin-tab="${esc(tab)}">${esc(tab)}</button>`).join('')}</div>`:''}<div class="admin-workspace-body"></div>`;
    section.addEventListener('click',event=>{
      const refresh=event.target.closest('[data-refresh-workspace]');
      if(refresh){void refreshWorkspace(refresh.dataset.refreshWorkspace);return;}
      const button=event.target.closest('[data-admin-tab]'); if(!button) return;
      section.querySelectorAll('[data-admin-tab]').forEach(item=>{item.classList.remove('active');item.setAttribute('aria-selected','false');});
      button.classList.add('active'); button.setAttribute('aria-selected','true'); section.dataset.activeTab=button.dataset.adminTab;
      renderWorkspace(section.dataset.workspace);
    });
    return section;
  }

  function dashboardMarkup(){
    const cards=[
      ['Treasury','Checking','Treasury records','treasury','STATUS'],
      ['Marketplace','Checking','Marketplace records','marketplace','STATUS'],
      ['Native Asset','Checking','Native asset lifecycle','native-asset','STATUS'],
      ['Coin Engine','Checking','Coin records','coin-positions','STATUS'],
      ['Settlement','Checking','Export and settlement records','settlement','STATUS'],
      ['Alerts','Checking','Health and exceptions','system','STATUS'],
      ['Activity','Checking','Lifecycle activity','operations','STATUS']
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

  function emptyState(label){return `<div class="admin-placeholder">No ${esc(label)} records are currently stored.</div>`;}
  function errorState(message){return `<div class="admin-placeholder"><strong>Unable to load this workspace.</strong><br>${esc(message)}</div>`;}
  function loadingState(){return '<div class="admin-placeholder">Loading current platform records…</div>';}
  function field(label,value){if(value===undefined||value===null||value==='')return '';return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;}
  function recordCard(record){
    const amount=money(record.amount ?? record.value ?? record.verifiedValue ?? record.totalAmount ?? record.quantity);
    return `<article class="admin-record-card"><header><strong>${esc(firstId(record))}</strong><em>${esc(recordState(record))}</em></header><div class="admin-record-grid">${field('Type',record.instrumentType||record.transactionType||record.recordType||record.rail||record.classification||record.type)}${field('Amount',amount ? `${amount} ${record.currency||''}`.trim() : null)}${field('Participant',record.participantId||record.ownerId||record.holderId||record.accountId)}${field('Linked asset',record.assetId||record.platformAssetId||record.sourceAssetId)}${field('Linked instrument',record.instrumentId)}${field('Listing',record.listingId)}${field('Export package',record.exportPackageId)}${field('Settlement',record.settlementId||record.settlementAuthorizationId)}${field('Destination',record.destinationReference||record.receivingAccountReference||record.receivingInstitutionReference)}${field('Updated',dateValue(record))}</div><details><summary>Record details</summary><pre>${esc(JSON.stringify(record,null,2))}</pre></details></article>`;
  }
  function recordsMarkup(records,label){return records?.length?`<div class="admin-record-list">${records.map(recordCard).join('')}</div>`:emptyState(label);}
  function stateFilter(records,values){const states=new Set(values);return (records||[]).filter(record=>states.has(recordState(record)));}
  function includesState(records,fragment){return (records||[]).filter(record=>recordState(record).includes(fragment));}
  function combined(...groups){return groups.flat().filter(Boolean);}

  function workspaceRecords(id,tab){
    const r=state.workspaceData?.records||{};
    if(id==='instruments'){
      if(tab==='Pending Review')return stateFilter(r.instruments,['DRAFT','PENDING','PENDING_REVIEW','IN_REVIEW','REVIEW_REQUIRED','AWAITING_APPROVAL']);
      if(tab==='Approved')return stateFilter(r.instruments,['APPROVED','AUTHORIZED','ISSUED']);
      if(tab==='Published')return stateFilter(r.instruments,['PUBLISHED','ACTIVE','LISTED']);
      if(tab==='History')return combined(r.instruments,r.lifecycleEvents.filter(event=>String(event.objectType||'').includes('INSTRUMENT')));
      return r.instruments;
    }
    if(id==='records'){
      if(tab==='Recognitions')return combined(r.recognitions,r.ownershipRecognitions);
      if(tab==='Observations')return r.observations;
      if(tab==='Financial Records')return r.financialRecords;
      if(tab==='Evidence')return r.evidencePackages;
      if(tab==='Origin Records')return r.financialHistory;
      if(tab==='Trace')return combined(r.financialHistory,r.lifecycleEvents);
      if(tab==='Audit')return r.lifecycleEvents;
    }
    if(id==='coin-positions'){
      if(tab==='Current Supply'||tab==='Represented Value')return combined(r.coinAccounts,r.coinPositions);
      if(tab==='Legacy Corrections')return includesState(r.coinPositions,'CORRECT');
      if(tab==='Coin Intelligence')return combined(r.coinPositions,r.observations,r.recognitions);
      if(tab==='Mint History')return r.lifecycleEvents.filter(event=>String(event.eventType||'').includes('MINT'));
      if(tab==='Retirements')return r.lifecycleEvents.filter(event=>String(event.eventType||'').includes('RETIR'));
      if(tab==='Adjustments')return r.lifecycleEvents.filter(event=>/ADJUST|CORRECT/i.test(String(event.eventType||'')));
    }
    if(id==='transactions'){
      if(tab==='Pending')return stateFilter(r.transactions,['PENDING','READY','AUTHORIZED','PROCESSING','DISPATCHED','ACCEPTED']);
      if(tab==='Completed')return stateFilter(r.transactions,['COMPLETED','SETTLED','RECONCILED','EXECUTED','POSTED']);
      if(tab==='Failed')return stateFilter(r.transactions,['FAILED','REJECTED','RETURNED','EXCEPTION','REVERSED']);
      if(tab==='Exported')return r.transactions.filter(record=>/EXPORT/i.test(String(record.transactionType||record.type||recordState(record))));
      if(tab==='Imported')return r.transactions.filter(record=>/IMPORT/i.test(String(record.transactionType||record.type||recordState(record))));
      if(tab==='Settlement')return r.transactions.filter(record=>/SETTLE/i.test(String(record.transactionType||record.type||recordState(record))));
      return r.transactions;
    }
    if(id==='settlement'){
      if(tab==='Export Packages')return r.exportPackages;
      if(tab==='Settlement Instructions')return r.settlementInstructions;
      if(tab==='External Confirmation')return combined(r.paymentReceipts,r.settlementRecords,r.settlements);
      if(tab==='Destination Verification')return r.settlementInstructions.filter(record=>record.destinationReference||record.receivingAccountReference);
      if(tab==='Export History')return combined(r.exportPackages,r.lifecycleEvents.filter(event=>/EXPORT/i.test(String(event.eventType||''))));
      if(tab==='Settlement Logs')return combined(r.settlements,r.settlementRecords,r.settlementInstructions,r.lifecycleEvents.filter(event=>/SETTLE|RAIL/i.test(String(event.eventType||''))));
    }
    if(id==='connections'){
      if(tab==='Coinbase')return combined((r.settlementAdapters||[]).filter(item=>/COINBASE/i.test(JSON.stringify(item))),r.treasuryWallets);
      if(tab==='FedWire')return (r.settlementAdapters||[]).filter(item=>/FEDWIRE|WIRE/i.test(String(item.rail||'')));
      if(tab==='ACH')return (r.settlementAdapters||[]).filter(item=>String(item.rail||'').toUpperCase()==='ACH');
      if(['Ethereum','Solana','Bitcoin'].includes(tab))return combined(r.treasuryWallets.filter(item=>new RegExp(tab,'i').test(JSON.stringify(item))),r.settlementAdapters.filter(item=>new RegExp(tab,'i').test(JSON.stringify(item))));
      if(tab==='Export Adapters')return r.settlementAdapters;
      if(tab==='Connector Logs')return r.lifecycleEvents.filter(event=>/CONNECT|ADAPTER|RAIL|COINBASE/i.test(String(event.eventType||'')));
      if(tab==='Synchronization')return combined(r.settlementInstructions,r.lifecycleEvents.filter(event=>/SYNC|RECONCIL/i.test(String(event.eventType||''))));
    }
    if(id==='users'){
      if(tab==='Administrators')return r.users.filter(user=>(user.capacities||[]).some(capacity=>String(typeof capacity==='string'?capacity:capacity.id)==='PLATFORM_ADMIN'));
      if(tab==='Roles'||tab==='Permissions')return r.users;
      if(tab==='Sessions'||tab==='Access History')return r.lifecycleEvents.filter(event=>/SESSION|SIGNIN|ACCESS|ADMIN/i.test(String(event.eventType||'')));
      return r.users;
    }
    if(id==='operations'){
      if(tab==='Awaiting Actions')return combined(stateFilter(r.transactions,['PENDING','READY','AWAITING_APPROVAL']),stateFilter(r.settlementInstructions,['READY']),stateFilter(r.instruments,['PENDING_REVIEW','AWAITING_APPROVAL']));
      if(tab==='Exceptions')return combined(stateFilter(r.transactions,['FAILED','REJECTED','EXCEPTION','RETURNED']),stateFilter(r.settlementInstructions,['REJECTED','EXCEPTION','RETURNED']));
      if(tab==='Settlement Queue')return r.settlementInstructions;
      if(tab==='Exports')return r.exportPackages;
      if(tab==='Imports')return r.transactions.filter(record=>/IMPORT/i.test(JSON.stringify(record)));
      if(tab==='Transaction Router')return r.transactions;
      if(tab==='Audit Trail'||tab==='Operation History')return r.lifecycleEvents;
      return combined(r.instruments,r.marketplaceListings,r.transactions,r.exportPackages,r.settlementInstructions);
    }
    if(id==='marketplace'){
      if(tab==='Prepared')return stateFilter(r.marketplaceListings,['PREPARED']);
      if(tab==='Ready')return r.marketplaceListings.filter(record=>/READY/i.test(recordState(record)));
      if(tab==='Published')return stateFilter(r.marketplaceListings,['PUBLISHED','ACTIVE','LISTED']);
      if(tab==='Orders'||tab==='Reservations'||tab==='Allocations')return r.transactions.filter(record=>new RegExp(tab.replace(/s$/,''),'i').test(JSON.stringify(record)));
      if(tab==='Settlement')return combined(r.settlements,r.settlementInstructions);
      if(tab==='Historical Listings')return combined(r.marketplaceListings,r.lifecycleEvents.filter(event=>/LISTING|MARKETPLACE/i.test(String(event.eventType||''))));
      return r.marketplaceListings;
    }
    if(id==='system'){
      if(tab==='Alerts')return combined(stateFilter(r.transactions,['FAILED','REJECTED','EXCEPTION','RETURNED']),stateFilter(r.settlementInstructions,['REJECTED','EXCEPTION','RETURNED']));
      if(tab==='Audit State')return r.lifecycleEvents;
      return [];
    }
    return [];
  }

  function renderWorkspace(id){
    const body=workspaceBody(id); if(!body)return;
    if(['dashboard','treasury','native-asset','agent'].includes(id))return;
    if(state.loading){body.innerHTML=loadingState();return;}
    if(state.lastError){body.innerHTML=errorState(state.lastError);return;}
    const section=body.closest('.admin-workspace');
    const tab=section?.dataset.activeTab||TABS[id]?.[0]||'';
    if(id==='system'&&['Overview','Core Services','Diagnostics','Protected Actions'].includes(tab)){
      const original=[...body.children].filter(child=>!child.classList.contains('admin-generated-status'));
      if(original.length)return;
      body.innerHTML='<div class="admin-placeholder">System health data is displayed by the connected core-services component. Use Refresh to reload current platform records.</div>';
      return;
    }
    const records=workspaceRecords(id,tab);
    body.innerHTML=recordsMarkup(records,`${tab||id}`);
  }

  async function loadWorkspaceData(force=false){
    if(state.workspaceData&&!force)return state.workspaceData;
    if(state.loading)return state.loading;
    state.lastError=null;
    state.loading=requestJson('/api/admin/workspaces?limit=500').then(data=>{state.workspaceData=data;return data;}).catch(error=>{state.lastError=error.message;throw error;}).finally(()=>{state.loading=null;});
    return state.loading;
  }
  async function refreshWorkspace(id){
    const body=workspaceBody(id); if(body)body.innerHTML=loadingState();
    try{await loadWorkspaceData(true);renderWorkspace(id);syncDashboard();}catch{renderWorkspace(id);}
  }

  function open(id){
    if(!WORKSPACES.some(item=>item[0]===id)) id='dashboard';
    document.querySelectorAll('.admin-workspace').forEach(section=>section.classList.toggle('active',section.dataset.workspace===id));
    document.querySelectorAll('[data-admin-workspace]').forEach(button=>button.classList.toggle('active',button.dataset.adminWorkspace===id));
    const def=WORKSPACES.find(item=>item[0]===id);
    const title=document.querySelector('#admin-suite-title'), subtitle=document.querySelector('#admin-suite-subtitle');
    if(title) title.textContent=def[1]; if(subtitle) subtitle.textContent=def[2];
    if(!['dashboard','treasury','native-asset','agent'].includes(id)){
      const body=workspaceBody(id); if(body&&!body.children.length)body.innerHTML=loadingState();
      void loadWorkspaceData().then(()=>renderWorkspace(id)).catch(()=>renderWorkspace(id));
    }
    const nextHash=`#admin-${id}`; if(location.hash!==nextHash) history.replaceState(null,'',nextHash);
    document.querySelector('.admin-suite-main')?.scrollTo({top:0,behavior:'auto'});
  }

  function syncDashboard(){
    const setStatus=(target,value,badge='CURRENT')=>{
      const node=document.querySelector(`[data-status-card="${target}"] strong`);
      const badgeNode=document.querySelector(`[data-status-card="${target}"] em`);
      if(node)node.textContent=value;
      if(badgeNode)badgeNode.textContent=badge;
    };
    const r=state.workspaceData?.records;
    if(r){
      setStatus('marketplace',String(r.marketplaceListings.length),r.marketplaceListings.length?'RECORDS':'EMPTY');
      setStatus('coin-positions',String(r.coinPositions.length),r.coinPositions.length?'RECORDS':'EMPTY');
      setStatus('settlement',String(r.exportPackages.length+r.settlementInstructions.length),r.exportPackages.length?'ACTIVE DATA':'EMPTY');
      setStatus('operations',String(r.lifecycleEvents.length),r.lifecycleEvents.length?'EVENTS':'EMPTY');
      const exceptions=combined(stateFilter(r.transactions,['FAILED','REJECTED','EXCEPTION','RETURNED']),stateFilter(r.settlementInstructions,['FAILED','REJECTED','EXCEPTION','RETURNED']));
      setStatus('system',String(exceptions.length),exceptions.length?'ATTENTION':'CLEAR');
    }
    const asset=document.querySelector('#asset-state')?.textContent?.trim();
    if(asset)setStatus('native-asset',asset,asset==='READY_FOR_EXPORT'?'READY':'CURRENT');
  }

  function observeSource(admin){
    if(state.observer) state.observer.disconnect();
    state.observer=new MutationObserver(records=>{
      let relevant=false;
      for(const record of records){
        for(const node of record.addedNodes){
          if(!(node instanceof Element)||node.closest('.admin-suite')) continue;
          relevant=true;queueRoute(node);
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
    routeKnownSections(admin); observeSource(admin); open(location.hash.replace('#admin-','')||'dashboard');
    void loadWorkspaceData().then(()=>syncDashboard()).catch(()=>syncDashboard());
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