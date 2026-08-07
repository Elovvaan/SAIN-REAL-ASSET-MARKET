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
    settlement:['Export Packages','Settlement Instructions','External Confirmation','Destination Verification','Export History','Settlement Logs','Workflow'],
    agent:['Conversation','Suggested Actions','Workflow Approvals','Incomplete Workflows','Explain Record','Trace Instrument','Platform Questions','Diagnostics'],
    connections:['Coinbase','FedWire','ACH','Ethereum','Solana','Bitcoin','Export Adapters','Connector Logs','Synchronization'],
    users:['Overview','Administrators','Roles','Permissions','Sessions','Access History'],
    system:['Overview','Core Services','Diagnostics','Protected Actions','Alerts','Audit State']
  };
  const state = { mounted:false, routed:new WeakSet(), observer:null, workspaceData:null, loading:null, lastError:null };
  const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const recordsBody = id => document.querySelector(`[data-workspace="${id}"] .admin-workspace-records`);
  const controlsBody = id => document.querySelector(`[data-workspace="${id}"] .admin-workspace-controls`);
  const firstId = record => record?.instrumentId || record?.listingId || record?.financialRecordId || record?.recognitionId || record?.observationId || record?.coinPositionId || record?.transactionId || record?.exportPackageId || record?.instructionId || record?.settlementId || record?.adapterId || record?.entryId || record?.accountId || record?.paymentOrderId || record?.statementId || record?.walletId || record?.connectionId || record?.eventId || record?.id || record?.userId || record?.email || 'Unidentified record';
  const recordState = record => String(record?.state || record?.status || record?.lifecycleState || record?.financingState || record?.treasuryState || 'UNKNOWN').toUpperCase();
  const dateValue = record => record?.updatedAt || record?.createdAt || record?.occurredAt || record?.recordedAt || record?.issuedAt || record?.publishedAt || record?.confirmedAt || record?.settledAt || record?.postedAt || null;
  const money = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : null;
  const list = value => Array.isArray(value) ? value : [];
  const combined = (...groups) => groups.flatMap(list).filter(Boolean);
  const byState = (records,states) => { const set = new Set(states); return list(records).filter(record => set.has(recordState(record))); };
  const contains = (records,pattern) => list(records).filter(record => pattern.test(JSON.stringify(record)));

  function loadStyle(){
    if(document.querySelector('link[data-admin-suite]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/admin/admin-suite-shell.css?v=${Date.now()}`;
    link.dataset.adminSuite = 'true';
    document.head.append(link);
  }
  async function requestJson(url,options={}){
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),10000);
    try {
      const response = await fetch(url,{...options,cache:'no-store',signal:controller.signal,headers:{Accept:'application/json','Cache-Control':'no-cache',...(options.headers||{})}});
      const payload = await response.json().catch(() => ({}));
      if(!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
      return payload;
    } catch(error) {
      if(error?.name === 'AbortError') throw new Error('The platform did not respond within 10 seconds.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  function achDestinationControlMarkup(){
    return `<section class="admin-record-card" data-ach-destination-control data-native-ach-destination-control>
      <header><strong>Manual ACH Destination</strong><em>PREPARE</em></header>
      <form data-native-ach-destination-form autocomplete="off">
        <div class="admin-record-grid">
          <label><span>Bank / destination label</span><input name="bankName" type="text" placeholder="Receiving bank" required></label>
          <label><span>Account type</span><select name="accountType" required style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="CHECKING">Checking</option><option value="SAVINGS">Savings</option></select></label>
          <label><span>Routing number</span><input name="routingNumber" type="text" inputmode="numeric" pattern="[0-9]{9}" maxlength="9" placeholder="9 digits" required></label>
          <label><span>Account number</span><input name="accountNumber" type="password" inputmode="numeric" pattern="[0-9]{4,17}" maxlength="17" placeholder="4–17 digits" required></label>
          <label><span>Amount USD</span><input name="amountUsd" type="number" min="0.01" step="0.01" value="1.00" required></label>
        </div>
        <p style="color:#9a9a9a;font-size:12px;line-height:1.45;margin:12px 0">Routing and account numbers are used only for this preparation request. SRA stores an opaque destination reference and masked display label, not the full bank details.</p>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button type="submit">Verify & Prepare Instruction</button><span data-native-ach-result style="color:#d6a92f;font-size:12px"></span></div>
      </form>
    </section>`;
  }

  function renderSettlementControls(tab){
    const controls = controlsBody('settlement');
    if(!controls) return;
    const existing = controls.querySelector('[data-native-ach-destination-control]');
    if(tab !== 'Destination Verification') { existing?.remove(); return; }
    if(!existing) controls.insertAdjacentHTML('afterbegin',achDestinationControlMarkup());
  }

  async function prepareAchDestination(form){
    const button = form.querySelector('button[type="submit"]');
    const result = form.querySelector('[data-native-ach-result]');
    const values = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    result.textContent = 'Preparing…';
    try {
      const prepared = await requestJson('/api/admin/treasury-transfer-readiness/ach/prepare',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          bankName:values.bankName,
          accountType:values.accountType,
          routingNumber:values.routingNumber,
          accountNumber:values.accountNumber,
          amountUsd:Number(values.amountUsd),
        }),
      });
      form.elements.routingNumber.value = '';
      form.elements.accountNumber.value = '';
      result.textContent = `Ready: ${prepared.transferInstruction?.transferInstructionId || 'ACH instruction'} · $${Number(prepared.transferInstruction?.amountUsd || values.amountUsd).toFixed(2)}`;
      try { await loadWorkspaceData(true); } catch {}
      renderWorkspace('settlement');
    } catch(error) {
      result.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function makeWorkspace([id,label,description]){
    const section = document.createElement('section');
    section.className = 'admin-workspace';
    section.dataset.workspace = id;
    section.dataset.activeTab = TABS[id]?.[0] || '';
    section.innerHTML = `<div class="admin-workspace-head"><div><p class="admin-eyebrow">SAIN PLATFORM ADMINISTRATION</p><h2>${esc(label)}</h2><p>${esc(description)}</p></div><button type="button" data-refresh-workspace="${id}">Refresh</button></div>${TABS[id]?`<div class="admin-workspace-tabs" role="tablist">${TABS[id].map((tab,index)=>`<button type="button" role="tab" aria-selected="${index===0}" class="${index===0?'active':''}" data-admin-tab="${esc(tab)}">${esc(tab)}</button>`).join('')}</div>`:''}<div class="admin-workspace-body"><div class="admin-workspace-controls"></div><div class="admin-workspace-records"></div></div>`;
    section.addEventListener('click',event => {
      const refresh = event.target.closest('[data-refresh-workspace]');
      if(refresh){ void refreshWorkspace(refresh.dataset.refreshWorkspace); return; }
      const button = event.target.closest('[data-admin-tab]');
      if(!button) return;
      section.querySelectorAll('[data-admin-tab]').forEach(item => { item.classList.remove('active'); item.setAttribute('aria-selected','false'); });
      button.classList.add('active');
      button.setAttribute('aria-selected','true');
      section.dataset.activeTab = button.dataset.adminTab;
      renderWorkspace(id);
    });
    section.addEventListener('submit',event => {
      const form = event.target.closest('[data-native-ach-destination-form]');
      if(!form) return;
      event.preventDefault();
      void prepareAchDestination(form);
    });
    return section;
  }
  function dashboardMarkup(){
    return `<section class="admin-status-section"><div class="admin-section-label">PLATFORM STATUS</div><div class="admin-dashboard-grid">${[['Treasury','treasury'],['Marketplace','marketplace'],['Native Asset','nativeAsset'],['Coin Engine','coinPositions'],['Settlement','settlement'],['System','system'],['Operations','operations']].map(([label,key])=>`<button type="button" class="admin-dashboard-card" data-open-workspace="${key==='nativeAsset'?'native-asset':key==='coinPositions'?'coin-positions':key}"><div class="admin-card-top"><span>${esc(label)}</span><b>→</b></div><strong data-workspace-status="${key}">Checking</strong><small>Current persistent-domain records</small><em>STATUS</em></button>`).join('')}</div></section><section class="admin-command-map"><div class="admin-section-label">PLATFORM COMMAND MAP</div><div class="admin-command-grid">${WORKSPACES.filter(([id])=>id!=='dashboard').map(([id,label,description])=>`<button type="button" data-open-workspace="${id}"><strong>${esc(label)}</strong><span>${esc(description)}</span><b>→</b></button>`).join('')}</div></section>`;
  }
  function emptyState(label){ return `<div class="admin-placeholder">No ${esc(label)} records are currently stored.</div>`; }
  function errorState(message){ return `<div class="admin-placeholder"><strong>Unable to load this workspace.</strong><br>${esc(message)}</div>`; }
  function loadingState(){ return '<div class="admin-placeholder">Loading current platform records…</div>'; }
  function field(label,value){ if(value===undefined || value===null || value==='') return ''; return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function recordCard(record){
    const amount = money(record.amount ?? record.value ?? record.faceValueUsd ?? record.verifiedValue ?? record.totalAmount ?? record.quantity ?? record.balance ?? record.principalQuantity);
    return `<article class="admin-record-card"><header><strong>${esc(firstId(record))}</strong><em>${esc(recordState(record))}</em></header><div class="admin-record-grid">${field('Type',record.instrumentType||record.transactionType||record.recordType||record.rail||record.classification||record.type||record.eventType||record.journalType)}${field('Amount',amount?`${amount} ${record.currency||'USD'}`:null)}${field('Participant',record.participantId||record.ownerId||record.holderId||record.accountId)}${field('Instrument',record.instrumentId)}${field('Listing',record.listingId)}${field('Export package',record.exportPackageId)}${field('Settlement',record.settlementId||record.settlementAuthorizationId)}${field('Connection',record.connectionId||record.adapterId)}${field('Updated',dateValue(record))}</div><details><summary>Record details</summary><pre>${esc(JSON.stringify(record,null,2))}</pre></details></article>`;
  }
  function recordsMarkup(records,label){ return list(records).length ? `<div class="admin-record-list">${records.map(recordCard).join('')}</div>` : emptyState(label); }
  function settlementWorkflowMarkup(){
    const r = state.workspaceData?.records || {};
    const destinations = list(r.settlementInstructions).filter(item=>item.destinationReference||item.receivingAccountReference||item.receivingInstitutionReference);
    const confirmations = combined(r.paymentReceipts,r.settlementRecords,r.settlements);
    const logs = combined(r.settlements,r.settlementRecords,r.settlementInstructions,contains(r.lifecycleEvents,/SETTLE|RAIL/i));
    const stages = [
      ['Export Packages',list(r.exportPackages).length],
      ['Destinations',destinations.length],
      ['Settlement Instructions',list(r.settlementInstructions).length],
      ['External Confirmations',confirmations.length],
      ['Settlement Logs',logs.length]
    ];
    return `<section class="admin-record-card"><header><strong>Export & Settlement Workflow</strong><em>LIVE</em></header><div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:12px">${stages.map(([label,count],index)=>`<div style="border:1px solid #292929;border-radius:12px;padding:14px;background:#090909;min-width:0"><span style="display:block;color:#9a9a9a;font-size:10px;text-transform:uppercase">Stage ${index+1}</span><strong style="display:block;margin-top:5px">${esc(label)}</strong><b style="display:block;font-size:22px;margin-top:8px">${Number(count).toLocaleString()}</b></div>`).join('')}</div><p style="color:#9a9a9a;margin:14px 0 0">Export Package → Destination → Settlement Instruction → External Confirmation → Settlement Log</p></section>`;
  }

  function nearestCard(node){ return node?.closest?.('section.card,article.card,.card'); }
  function moveCard(node,id){
    const card = nearestCard(node);
    const destination = controlsBody(id);
    if(!card || !destination || state.routed.has(card) || card.closest('.admin-workspace')) return false;
    state.routed.add(card);
    destination.append(card);
    return true;
  }
  function routeCard(card){
    if(!card || state.routed.has(card) || card.closest('.admin-workspace')) return;
    const text = (card.querySelector('h2,h3,.section-title')?.textContent || card.textContent || '').toLowerCase();
    if(card.querySelector('#asset-details') || text.includes('native platform asset')) moveCard(card,'native-asset');
    else if(card.querySelector('#connector-details') || text.includes('platform and market connections')) moveCard(card,'connections');
    else if(card.querySelector('#listing-details') || text.includes('marketplace listing') || text.includes('sra/usd market lifecycle')) moveCard(card,'marketplace');
    else if(text.includes('treasury') || text.includes('balanced entry') || text.includes('recorded value representation')) moveCard(card,'treasury');
    else if(text.includes('unified market operations') || card.matches('[id*="operations-queue"],[class*="operations-queue"]')) moveCard(card,'operations');
    else if(text.includes('administrative agent') || card.querySelector('#chat-log')) moveCard(card,'agent');
    else if(text.includes('core services') || text.includes('protected actions') || card.querySelector('#protected-areas')) moveCard(card,'system');
    else if(card.matches('[id*="listing-authorization"],[id*="listing-readiness"],[class*="listing-authorization"],[id*="hybrid-liquidity"],[class*="hybrid-liquidity"]')) moveCard(card,'marketplace');
  }
  function routeKnownSections(root=document){
    const cards = [];
    if(root instanceof Element && root.matches('section.card,article.card,.card')) cards.push(root);
    if(root.querySelectorAll) cards.push(...root.querySelectorAll('#admin-view section.card,#admin-view article.card'));
    [...new Set(cards)].forEach(routeCard);
  }
  function observeSource(admin){
    if(state.observer) state.observer.disconnect();
    state.observer = new MutationObserver(records => {
      for(const record of records){
        for(const node of record.addedNodes){
          if(node instanceof Element && !node.closest('.admin-suite')) routeKnownSections(node);
        }
      }
    });
    state.observer.observe(admin,{childList:true,subtree:true});
  }

  function workspaceRecords(id,tab){
    const r = state.workspaceData?.records || {};
    if(id==='operations'){
      if(tab==='Awaiting Actions') return combined(byState(r.transactions,['PENDING','READY','AUTHORIZED','PROCESSING']),byState(r.settlementInstructions,['DRAFT','READY','EXCEPTION']),byState(r.treasuryPaymentOrders,['PENDING','READY','AUTHORIZED']));
      if(tab==='Exceptions') return combined(r.treasuryExceptions,byState(r.transactions,['FAILED','REJECTED','RETURNED','EXCEPTION','REVERSED']),byState(r.settlementInstructions,['REJECTED','RETURNED','EXCEPTION']));
      if(tab==='Settlement Queue') return combined(r.settlementInstructions,r.marketplaceSettlementPreparations,r.marketplaceSettlementReviews,r.marketplaceSettlementAuthorizations);
      if(tab==='Exports') return combined(r.exportPackages,contains(r.transactions,/EXPORT/i));
      if(tab==='Imports') return contains(r.transactions,/IMPORT/i);
      if(tab==='Transaction Router') return combined(r.transactions,r.fundingInstructions,r.treasuryPaymentOrders);
      if(tab==='Audit Trail'||tab==='Operation History') return r.lifecycleEvents;
      return combined(r.transactions,r.fundingInstructions,r.exportPackages,r.settlementInstructions,r.treasuryPaymentOrders,r.treasuryExceptions);
    }
    if(id==='treasury'){
      if(tab==='Commercial Instruments') return combined(list(r.instruments).filter(item=>/FUNDING|COMMERCIAL|TREASURY/i.test(JSON.stringify(item))),list(r.transactions).filter(item=>/PLATFORM_FUNDING_INSTRUMENT_DEPOSIT/i.test(String(item.transactionType||''))));
      if(tab==='Cash Position') return list(r.ledgerAccounts).filter(item=>/CASH|SETTLEMENT|USD/i.test(JSON.stringify(item)));
      if(tab==='Available Financing'||tab==='Funding Capacity') return combined(r.treasuryProfiles,r.treasuryForecasts,list(r.instruments).filter(item=>item.financingState||item.treasuryState));
      if(tab==='Journal Entries') return r.ledgerEntries;
      if(tab==='Treasury Wallets') return combined(r.treasuryWallets,r.treasuryCryptoActivity);
      if(tab==='Ledger') return combined(r.ledgerAccounts,r.ledgerEntries,r.accountingPeriods);
      if(tab==='Treasury Reports') return combined(r.financialStatementSnapshots,r.treasuryStatements,r.treasuryForecasts,r.treasuryExceptions);
      return combined(r.treasuryProfiles,r.ledgerAccounts,r.ledgerEntries,r.treasuryBankConnections,r.treasuryPaymentOrders,r.treasuryStatements,r.treasuryWallets,r.treasuryForecasts,r.treasuryExceptions);
    }
    if(id==='native-asset'){
      const nativeInstrument = list(r.instruments).filter(item=>/SRA_PLATFORM_ASSET|NATIVE|PLATFORM/i.test(JSON.stringify(item)));
      if(tab==='Current Asset'||tab==='Approval Status') return nativeInstrument;
      if(tab==='Listing'||tab==='Marketplace Status') return list(r.marketplaceListings).filter(item=>nativeInstrument.some(ins=>ins.instrumentId===item.instrumentId)||/SRA_PLATFORM_ASSET|NATIVE/i.test(JSON.stringify(item)));
      if(tab==='Export Status') return list(r.exportPackages).filter(item=>/SRA_PLATFORM_ASSET|NATIVE/i.test(JSON.stringify(item)));
      if(tab==='Ownership') return list(r.ownershipRecognitions).filter(item=>/SRA_PLATFORM_ASSET|NATIVE/i.test(JSON.stringify(item)));
      if(tab==='Recognitions') return combined(r.recognitions,r.ownershipRecognitions).filter(item=>/SRA_PLATFORM_ASSET|NATIVE/i.test(JSON.stringify(item)));
      if(tab==='Asset History'||tab==='Publishing'||tab==='Governance') return list(r.lifecycleEvents).filter(item=>/SRA_PLATFORM_ASSET|NATIVE|PLATFORM_ASSET/i.test(JSON.stringify(item)));
      return nativeInstrument;
    }
    if(id==='marketplace'){
      if(tab==='Prepared') return byState(r.marketplaceListings,['PREPARED']);
      if(tab==='Ready') return byState(r.marketplaceListings,['READY','READY_FOR_PUBLICATION_APPROVAL']);
      if(tab==='Published') return byState(r.marketplaceListings,['PUBLISHED','ACTIVE','LISTED']);
      if(tab==='Orders') return combined(r.marketplaceCommitments,list(r.transactions).filter(item=>/ORDER/i.test(JSON.stringify(item))));
      if(tab==='Reservations') return combined(r.marketplaceCommitmentWindows,list(r.marketplaceCommitments).filter(item=>/RESERV/i.test(JSON.stringify(item))));
      if(tab==='Allocations') return combined(r.marketplaceAllocations,r.marketplacePositions);
      if(tab==='Settlement') return combined(r.marketplaceSettlementPreparations,r.marketplaceSettlementReviews,r.marketplaceSettlementAuthorizations,r.settlements);
      if(tab==='Historical Listings') return combined(r.marketplaceListings,list(r.lifecycleEvents).filter(item=>/LISTING|MARKETPLACE/i.test(JSON.stringify(item))));
    }
    if(id==='instruments'){
      if(tab==='Pending Review') return byState(r.instruments,['DRAFT','PENDING','PENDING_REVIEW','IN_REVIEW','REVIEW_REQUIRED','AWAITING_APPROVAL']);
      if(tab==='Approved') return byState(r.instruments,['APPROVED','AUTHORIZED','ISSUED','DEPOSITED_RECOGNIZED_USD']);
      if(tab==='Published') return byState(r.instruments,['PUBLISHED','ACTIVE','LISTED']);
      if(tab==='History') return combined(r.instruments,r.protectionInstruments,list(r.lifecycleEvents).filter(item=>/INSTRUMENT/i.test(JSON.stringify(item))));
      return combined(r.instruments,r.protectionInstruments);
    }
    if(id==='records'){
      if(tab==='Recognitions') return combined(r.recognitions,r.ownershipRecognitions);
      if(tab==='Observations') return r.observations;
      if(tab==='Financial Records') return combined(r.financialRecords,r.financialRecordAccounts,r.verifiedValueRecords);
      if(tab==='Evidence') return r.evidencePackages;
      if(tab==='Origin Records') return r.financialHistory;
      if(tab==='Trace') return combined(r.assetRelationships,r.financialHistory,r.lifecycleEvents);
      if(tab==='Audit') return r.lifecycleEvents;
    }
    if(id==='coin-positions'){
      if(tab==='Current Supply'||tab==='Represented Value') return combined(r.coinAccounts,r.coinPositions);
      if(tab==='Legacy Corrections') return contains(r.coinPositions,/CORRECT|LEGACY/i);
      if(tab==='Coin Intelligence') return combined(r.coinPositions,r.observations,r.recognitions);
      if(tab==='Mint History') return contains(r.lifecycleEvents,/MINT/i);
      if(tab==='Retirements') return contains(r.lifecycleEvents,/RETIR/i);
      if(tab==='Adjustments') return contains(r.lifecycleEvents,/ADJUST|CORRECT/i);
    }
    if(id==='transactions'){
      if(tab==='Pending') return byState(r.transactions,['PENDING','READY','AUTHORIZED','PROCESSING','DISPATCHED','ACCEPTED']);
      if(tab==='Completed') return byState(r.transactions,['COMPLETED','SETTLED','RECONCILED','EXECUTED','POSTED','DEPOSITED_RECOGNIZED_USD']);
      if(tab==='Failed') return byState(r.transactions,['FAILED','REJECTED','RETURNED','EXCEPTION','REVERSED']);
      if(tab==='Exported') return contains(r.transactions,/EXPORT/i);
      if(tab==='Imported') return contains(r.transactions,/IMPORT/i);
      if(tab==='Settlement') return combined(contains(r.transactions,/SETTLE/i),r.settlements,r.settlementRecords);
      return combined(r.transactions,r.fundingInstructions,r.paymentReceipts);
    }
    if(id==='settlement'){
      if(tab==='Export Packages') return r.exportPackages;
      if(tab==='Settlement Instructions') return r.settlementInstructions;
      if(tab==='External Confirmation') return combined(r.paymentReceipts,r.settlementRecords,r.settlements);
      if(tab==='Destination Verification') return list(r.settlementInstructions).filter(item=>item.destinationReference||item.receivingAccountReference||item.receivingInstitutionReference);
      if(tab==='Export History') return combined(r.exportPackages,contains(r.lifecycleEvents,/EXPORT/i));
      if(tab==='Settlement Logs') return combined(r.settlements,r.settlementRecords,r.settlementInstructions,contains(r.lifecycleEvents,/SETTLE|RAIL/i));
      if(tab==='Workflow') return [];
    }
    if(id==='connections'){
      if(tab==='Coinbase') return combined(contains(r.settlementAdapters,/COINBASE/i),list(r.treasuryWallets).filter(item=>/COINBASE/i.test(JSON.stringify(item))),list(r.enterpriseConnections).filter(item=>/COINBASE/i.test(JSON.stringify(item))));
      if(tab==='FedWire') return combined(list(r.settlementAdapters).filter(item=>/FEDWIRE|WIRE/i.test(String(item.rail||''))),list(r.treasuryBankConnections).filter(item=>/FEDWIRE|WIRE/i.test(JSON.stringify(item))));
      if(tab==='ACH') return combined(list(r.settlementAdapters).filter(item=>String(item.rail||'').toUpperCase()==='ACH'),list(r.treasuryBankConnections).filter(item=>/ACH/i.test(JSON.stringify(item))));
      if(['Ethereum','Solana','Bitcoin'].includes(tab)) return combined(list(r.treasuryWallets).filter(item=>new RegExp(tab,'i').test(JSON.stringify(item))),list(r.settlementAdapters).filter(item=>new RegExp(tab,'i').test(JSON.stringify(item))));
      if(tab==='Export Adapters') return combined(r.settlementAdapters,r.connectorDefinitions,r.enterpriseConnections);
      if(tab==='Connector Logs') return combined(r.extractionRequests,r.extractionResults,r.outboundEvents,contains(r.lifecycleEvents,/CONNECT|ADAPTER|RAIL|COINBASE/i));
      if(tab==='Synchronization') return combined(r.enterpriseConnections,r.extractionRequests,r.extractionResults,r.outboundEvents);
    }
    if(id==='users'){
      if(tab==='Administrators') return list(r.users).filter(item=>JSON.stringify(item.capacities||[]).includes('PLATFORM_ADMIN'));
      if(tab==='Roles'||tab==='Permissions') return r.users;
      if(tab==='Sessions') return emptyStateRecords('session');
      if(tab==='Access History') return contains(r.lifecycleEvents,/ACCESS|SIGNIN|SIGNOUT|SESSION|AUTH/i);
      return combined(r.users,r.participants);
    }
    if(id==='system'){
      if(tab==='Core Services') return Object.entries(state.workspaceData?.workspaces||{}).map(([id,status])=>({id,recordType:'WORKSPACE_HEALTH',state:status.state,recordCount:status.recordCount,missingSources:status.missingSources}));
      if(tab==='Diagnostics') return combined(r.treasuryExceptions,list(r.outboundEvents).filter(item=>/ERROR|FAILED|EXCEPTION/i.test(recordState(item))),contains(r.lifecycleEvents,/ERROR|FAILED|EXCEPTION|DIAGNOSTIC/i));
      if(tab==='Protected Actions') return contains(r.lifecycleEvents,/APPROV|AUTHOR|PROTECT/i);
      if(tab==='Alerts') return combined(r.treasuryExceptions,contains(r.lifecycleEvents,/ALERT|WARN|ERROR|EXCEPTION/i));
      if(tab==='Audit State') return r.lifecycleEvents;
      return combined(r.treasuryExceptions,r.outboundEvents,r.lifecycleEvents);
    }
    if(id==='agent'){
      if(tab==='Diagnostics') return contains(r.lifecycleEvents,/AGENT|QUERY|DIAGNOSTIC|ERROR/i);
      if(tab==='Workflow Approvals') return contains(r.lifecycleEvents,/APPROV|AUTHOR/i);
      if(tab==='Incomplete Workflows') return combined(byState(r.transactions,['PENDING','READY','EXCEPTION']),byState(r.settlementInstructions,['DRAFT','READY','EXCEPTION']),r.treasuryExceptions);
      return list(r.lifecycleEvents).filter(item=>/AGENT|ADMIN/i.test(JSON.stringify(item)));
    }
    return [];
  }
  function emptyStateRecords(kind){ return [{id:`NO_${kind.toUpperCase()}_SOURCE`,recordType:'NOT_IMPLEMENTED',state:'NOT_IMPLEMENTED',description:`No persistent ${kind} record source is implemented.`}]; }
  function labelFor(id,tab){ return `${WORKSPACES.find(item=>item[0]===id)?.[1]||id} ${tab||''}`.trim().toLowerCase(); }
  function marketplaceDisplayedCount(){
    const r = state.workspaceData?.records || {};
    return combined(r.marketplaceListings,r.marketplaceCommitmentWindows,r.marketplaceCommitments,r.marketplacePositions,r.marketplaceAllocations,r.marketplaceSettlementPreparations,r.marketplaceSettlementReviews,r.marketplaceSettlementAuthorizations,r.transactions,r.settlements,r.lifecycleEvents).length;
  }
  function effectiveWorkspaceStatuses(){
    const statuses = {...(state.workspaceData?.workspaces || {})};
    if(statuses.marketplace) statuses.marketplace = {...statuses.marketplace,recordCount:marketplaceDisplayedCount()};
    return statuses;
  }
  function renderWorkspace(id){
    const node = recordsBody(id);
    if(!node) return;
    if(id==='dashboard'){ node.innerHTML = dashboardMarkup(); syncDashboard(); return; }
    const section = document.querySelector(`[data-workspace="${id}"]`);
    const tab = section?.dataset.activeTab || TABS[id]?.[0] || '';
    if(id==='settlement') renderSettlementControls(tab);
    if(state.loading){ node.innerHTML = loadingState(); return; }
    if(state.lastError){ node.innerHTML = errorState(state.lastError); return; }
    if(id==='settlement' && tab==='Workflow'){ node.innerHTML = settlementWorkflowMarkup(); return; }
    node.innerHTML = recordsMarkup(workspaceRecords(id,tab),labelFor(id,tab));
  }
  async function loadWorkspaceData(force=false){
    if(state.loading && !force) return state.loading;
    state.lastError = null;
    const request = requestJson(`/api/admin/workspaces?limit=1000&_=${Date.now()}`)
      .then(data => { state.workspaceData = data; return data; })
      .catch(error => { state.lastError = error.message; throw error; })
      .finally(() => { if(state.loading === request) state.loading = null; });
    state.loading = request;
    return request;
  }
  async function refreshWorkspace(id){
    const node = recordsBody(id);
    if(node) node.innerHTML = loadingState();
    try { await loadWorkspaceData(true); } catch {}
    renderWorkspace(id);
    syncDashboard();
  }
  function syncDashboard(){
    if(!state.workspaceData) return;
    for(const [key,status] of Object.entries(effectiveWorkspaceStatuses())){
      const node = document.querySelector(`[data-workspace-status="${key}"]`);
      if(node) node.textContent = `${status.state} · ${Number(status.recordCount||0).toLocaleString()}`;
    }
  }
  function activeWorkspaceId(){ return document.querySelector('.admin-workspace.active')?.dataset.workspace || 'dashboard'; }
  function open(id){
    if(!WORKSPACES.some(item=>item[0]===id)) id='dashboard';
    document.querySelectorAll('.admin-workspace').forEach(section=>section.classList.toggle('active',section.dataset.workspace===id));
    document.querySelectorAll('[data-admin-workspace]').forEach(button=>button.classList.toggle('active',button.dataset.adminWorkspace===id));
    const def = WORKSPACES.find(item=>item[0]===id);
    document.querySelector('#admin-suite-title').textContent = def[1];
    document.querySelector('#admin-suite-subtitle').textContent = def[2];
    const hash = `#admin-${id}`;
    if(location.hash!==hash) history.replaceState(null,'',hash);
    renderWorkspace(id);
    if(!state.workspaceData){
      const pending = loadWorkspaceData(false);
      void pending.catch(()=>{}).finally(() => {
        const active = activeWorkspaceId();
        renderWorkspace(active);
        syncDashboard();
      });
    }
    document.querySelector('.admin-suite-main')?.scrollTo({top:0,behavior:'auto'});
  }
  function mount(){
    const admin = document.querySelector('#admin-view');
    if(!admin || state.mounted) return;
    state.mounted = true;
    loadStyle();
    document.body.classList.add('admin-suite-ready');
    const top = admin.querySelector('.top');
    const oldLayout = admin.querySelector('.layout');
    if(oldLayout) oldLayout.classList.add('admin-legacy-source-root');
    const suite = document.createElement('div');
    suite.className = 'admin-suite';
    suite.innerHTML = `<aside class="admin-suite-rail"><div class="admin-suite-brand"><img src="/brand-logo" alt="SRA"><div><strong>SAIN Platform</strong><span>Administration</span></div></div><nav class="admin-suite-nav">${WORKSPACES.map(([id,label],index)=>`<button type="button" data-admin-workspace="${id}" class="${index===0?'active':''}"><strong>${esc(label)}</strong></button>`).join('')}</nav></aside><main class="admin-suite-main"><header class="admin-suite-header"><div><h1 id="admin-suite-title">Dashboard</h1><p id="admin-suite-subtitle">Executive platform status</p></div><div id="admin-suite-account"></div></header><div class="admin-suite-content"></div></main>`;
    const content = suite.querySelector('.admin-suite-content');
    WORKSPACES.forEach(def=>content.append(makeWorkspace(def)));
    admin.insertBefore(suite,admin.firstChild);
    if(top){ suite.querySelector('#admin-suite-account').append(top); top.classList.remove('card'); }
    admin.querySelector('#metrics')?.classList.add('admin-source-metrics');
    routeKnownSections(oldLayout || admin);
    observeSource(admin);
    if(oldLayout) oldLayout.classList.add('admin-source-layout');
    suite.addEventListener('click',event=>{
      const button = event.target.closest('[data-admin-workspace],[data-open-workspace]');
      if(button) open(button.dataset.adminWorkspace||button.dataset.openWorkspace);
    });
    open(location.hash.replace('#admin-','')||'dashboard');
  }
  function initialize(){
    loadStyle();
    mount();
    if(!state.mounted){
      const observer = new MutationObserver(()=>{ if(document.querySelector('#admin-view')){ observer.disconnect(); mount(); } });
      observer.observe(document.body,{childList:true,subtree:true});
    }
  }
  window.addEventListener('hashchange',()=>open(location.hash.replace('#admin-','')||'dashboard'));
  if(document.readyState==='loading') window.addEventListener('DOMContentLoaded',initialize,{once:true}); else initialize();
})();