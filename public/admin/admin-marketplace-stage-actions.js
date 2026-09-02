(() => {
  if (window.__sraAdminMarketplaceStageActionsInstalled) return;
  window.__sraAdminMarketplaceStageActionsInstalled = true;

  const mounted = new WeakSet();
  const client = () => window.SRAAdminDataClient;
  const esc = (v) => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const text = (v) => String(v || '').toUpperCase();
  const list = (p) => Array.isArray(p?.records) ? p.records : [];
  const request = async (url, options = {}) => {
    if (client()) return client().json(url, options);
    const response = await fetch(url,{credentials:'same-origin',cache:'no-store',...options,headers:{Accept:'application/json','Content-Type':'application/json',...(options.headers||{})}});
    const payload = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };
  const post = (url, body = {}) => request(url,{method:'POST',body:JSON.stringify(body)});

  function host(workspace) {
    const controls = workspace?.querySelector('.admin-workspace-controls');
    if (!controls) return null;
    let node = controls.querySelector('[data-marketplace-stage-actions]');
    if (!node) {
      node = document.createElement('section');
      node.className = 'admin-record-card';
      node.dataset.marketplaceStageActions = 'true';
      const governance = controls.querySelector('[data-workstation-control="marketplace-governance"]');
      if (governance) controls.insertBefore(node, governance);
      else controls.append(node);
    }
    return node;
  }

  async function data() {
    const [listingPage, readiness, publication, windows, commitments, allocationReviews, positions, preparations, settlementReviews, authorizations, confirmations] = await Promise.all([
      request('/api/marketplace-listings?page=1&limit=100'),
      request('/api/admin/listing-readiness-batch?unitPrice=1&minimumOrder=1&askingPriceMethod=VERIFIED_RECORDED_USD_VALUE_AT_SRA_PAR&eligibilityRule=SRA_REGISTERED_PARTICIPANTS&transactionRouteId=SRA_INTERNAL_MARKETPLACE&settlementRouteId=SRA_INTERNAL_SETTLEMENT'),
      request('/api/admin/listing-publication-batch'),
      request('/api/funding-marketplace-commitment/windows'),
      request('/api/funding-marketplace-commitment/commitments'),
      request('/api/funding-marketplace-allocation/reviews'),
      request('/api/funding-marketplace-allocation/positions'),
      request('/api/funding-marketplace-allocation/settlement-preparations'),
      request('/api/funding-marketplace-settlement/reviews'),
      request('/api/funding-marketplace-settlement/authorizations'),
      request('/api/funding-marketplace-settlement/confirmations'),
    ]);
    return { listings:listingPage.listings||[], readiness, publication, windows:list(windows), commitments:list(commitments), allocationReviews:list(allocationReviews), positions:list(positions), preparations:list(preparations), settlementReviews:list(settlementReviews), authorizations:list(authorizations), confirmations:list(confirmations) };
  }

  function button(label, action, id, disabled = false) { return `<button type="button" data-stage-action="${esc(action)}" data-stage-id="${esc(id||'')}" ${disabled?'disabled':''}>${esc(label)}</button>`; }
  function row(title, state, body, actions='') { return `<article style="border-top:1px solid #292929;padding:12px 0"><div style="display:flex;justify-content:space-between;gap:12px"><strong>${esc(title)}</strong><em>${esc(state)}</em></div><p style="color:#9a9a9a;margin:7px 0">${esc(body)}</p>${actions?`<div style="display:flex;gap:8px;flex-wrap:wrap">${actions}</div>`:''}</article>`; }

  function published(data) { return data.listings.filter((l)=>['LIVE','ACTIVE','PUBLISHED','LISTED'].includes(text(l.state)) || ['LIVE','ACTIVE'].includes(text(l.status)) || text(l.publicationStatus)==='PUBLISHED'); }
  function prepared(data) { return data.listings.filter((l)=>!published(data).includes(l) && !['READY','READY_FOR_PUBLICATION_APPROVAL','PUBLICATION_AUTHORIZED'].includes(text(l.status)) && text(l.state)!=='READY' && !['CLOSED','CANCELLED','CANCELED','EXPIRED','WITHDRAWN','SUPERSEDED','RETIRED'].includes(text(l.state))); }
  function ready(data) { return data.listings.filter((l)=>!published(data).includes(l) && (['READY','READY_FOR_PUBLICATION_APPROVAL','PUBLICATION_AUTHORIZED'].includes(text(l.status)) || text(l.state)==='READY' || text(l.publicationDecision)==='AUTHORIZED_FOR_PUBLICATION')); }

  function renderPrepared(root, d) {
    const count = prepared(d).length;
    root.innerHTML = `<header><strong>Prepared</strong><em>${count} WAITING</em></header><p>Prepared listings advance only through recorded-value readiness authorization.</p><div>${button(`Authorize ${count} prepared listing${count===1?'':'s'}`,'authorize-readiness','batch',count===0)}</div>`;
  }
  function renderReady(root, d) {
    const count = ready(d).length;
    root.innerHTML = `<header><strong>Ready</strong><em>${count} READY</em></header><p>Ready listings have passed readiness and are waiting for publication authorization.</p><div>${button(`Publish ${count} ready listing${count===1?'':'s'}`,'publish-ready','batch',count===0)}</div>`;
  }
  function renderPublished(root, d) {
    const live = published(d);
    root.innerHTML = `<header><strong>Published</strong><em>${live.length} LIVE</em></header><p>Published listings accept marketplace commitments through an open commitment window.</p>${live.map((l)=>{const id=l.listingId||l.id;const win=d.windows.find((w)=>w.listingId===id&&text(w.status)==='OPEN');return row(id,win?'COMMITMENTS OPEN':'LIVE',win?`Window ${win.commitmentWindowId} is open with ${win.availableQuantity} available.`:'No commitment window is open.',win?'':button('Open commitment window','open-window',id));}).join('')||'<p>No published listings.</p>'}`;
  }
  function renderOrders(root, d) {
    root.innerHTML = `<header><strong>Orders</strong><em>${d.commitments.length} RECORDED</em></header><p>Participant commitments originate from the marketplace. Administration closes a window only after reserved commitments are resolved.</p>${d.windows.map((w)=>{const c=d.commitments.filter((x)=>x.windowId===w.commitmentWindowId);const reserved=c.filter((x)=>text(x.status)==='RESERVED').length;const confirmed=c.filter((x)=>text(x.status)==='CONFIRMED').length;const canClose=text(w.status)==='OPEN'&&reserved===0&&confirmed>0;return row(w.commitmentWindowId,w.status,`${confirmed} confirmed · ${reserved} reserved · ${w.availableQuantity} available`,button('Close window for allocation','close-window',w.commitmentWindowId,!canClose));}).join('')||'<p>No commitment windows yet.</p>'}`;
  }
  function renderReservations(root, d) {
    const reserved=d.commitments.filter((c)=>text(c.status)==='RESERVED');
    root.innerHTML=`<header><strong>Reservations</strong><em>${reserved.length} ACTIVE</em></header><p>A reserved commitment holds listing quantity until it is confirmed or cancelled.</p>${reserved.map((c)=>row(c.commitmentId,'RESERVED',`${c.participantId} · ${c.quantity} units · ${c.totalAmount} ${c.currency}`,`${button('Confirm commitment','confirm-commitment',c.commitmentId)}${button('Cancel commitment','cancel-commitment',c.commitmentId)}`)).join('')||'<p>No active reservations.</p>'}`;
  }
  function renderAllocations(root,d) {
    const closed=d.windows.filter((w)=>text(w.status)==='CLOSED');
    root.innerHTML=`<header><strong>Allocations</strong><em>${d.positions.length} POSITIONS</em></header><p>Closed commitment windows move through allocation review before positions are created.</p>${closed.map((w)=>{const review=d.allocationReviews.find((r)=>r.windowId===w.commitmentWindowId);let actions='';let state=review?.status||'REVIEW NOT STARTED';if(!review)actions=button('Start allocation review','start-allocation-review',w.commitmentWindowId);else if(text(review.status)==='IN_REVIEW')actions=button('Approve allocation','approve-allocation',review.allocationReviewId);else if(text(review.decision)==='APPROVED_FOR_ALLOCATION' || text(review.status)==='APPROVED_FOR_ALLOCATION')actions=button('Create allocated positions','create-positions',review.allocationReviewId);return row(w.commitmentWindowId,state,`${d.commitments.filter((c)=>c.windowId===w.commitmentWindowId&&text(c.status)==='CONFIRMED').length} confirmed commitments`,actions);}).join('')||'<p>No closed commitment windows awaiting allocation.</p>'}`;
  }
  function renderSettlement(root,d) {
    const unprepared=d.positions.filter((p)=>text(p.status)==='CREATED'&&text(p.settlementStatus)==='NOT_STARTED');
    const prepRows=d.preparations.map((p)=>{const review=d.settlementReviews.find((r)=>r.settlementPreparationId===p.settlementPreparationId);let actions='';if(text(p.status)==='PREPARED'&&!review)actions=button('Start settlement review','start-settlement-review',p.settlementPreparationId);else if(review&&text(review.status)==='IN_REVIEW')actions=button('Authorize settlement','authorize-settlement',review.settlementReviewId);return row(p.settlementPreparationId,p.status,`${p.amount} ${p.currency} · position ${p.positionId}`,actions);}).join('');
    const authRows=d.authorizations.map((a)=>{const confirmation=d.confirmations.find((c)=>c.settlementAuthorizationId===a.settlementAuthorizationId&&!['REJECTED','REVERSED'].includes(text(c.status)));let actions='';if(!confirmation&&text(a.status)==='AWAITING_CONFIRMATION')actions=button('Add internal ledger confirmation','show-internal-confirmation',a.settlementAuthorizationId);else if(confirmation&&text(confirmation.status)==='RECEIVED')actions=button('Verify confirmation','verify-confirmation',confirmation.settlementConfirmationId);else if(text(a.status)==='CONFIRMED')actions=button('Recognize ownership / settle','settle-authorization',a.settlementAuthorizationId);return row(a.settlementAuthorizationId,a.status,`${a.amount} ${a.currency} · position ${a.positionId}`,actions);}).join('');
    root.innerHTML=`<header><strong>Settlement</strong><em>${d.preparations.length} PREPARED</em></header><p>Allocation becomes settlement only after source/destination preparation, review, authorization, confirmation, verification, and final ownership recognition.</p>${unprepared.map((p)=>`<article style="border-top:1px solid #292929;padding:12px 0"><strong>${esc(p.positionId)}</strong><div class="admin-record-grid" style="margin-top:8px"><label><span>Payment source reference</span><input data-settle-source="${esc(p.positionId)}" placeholder="Treasury account, ledger source, or external source"></label><label><span>Destination reference</span><input data-settle-destination="${esc(p.positionId)}" placeholder="Receiving account / destination reference"></label></div><div style="margin-top:8px">${button('Prepare settlement','prepare-settlement',p.positionId)}</div></article>`).join('')}${prepRows}${authRows}${!unprepared.length&&!prepRows&&!authRows?'<p>No settlement activity yet.</p>':''}`;
  }
  function renderHistorical(root,d) {
    const historical=d.listings.filter((l)=>['CLOSED','CANCELLED','CANCELED','EXPIRED','WITHDRAWN','SUPERSEDED','RETIRED'].includes(text(l.state))||['CLOSED','CANCELLED','CANCELED','EXPIRED','WITHDRAWN','SUPERSEDED'].includes(text(l.status)));
    root.innerHTML=`<header><strong>Historical Listings</strong><em>${historical.length} CLOSED</em></header><p>This stage is read-only history after a listing leaves the active marketplace.</p>`;
  }

  async function render(workspace) {
    const root=host(workspace); if(!root)return;
    root.innerHTML='<header><strong>Marketplace Stage Actions</strong><em>READING</em></header><p>Reading the current lifecycle stage…</p>';
    try {
      const d=await data();
      const tab=workspace.dataset.activeTab||'Prepared';
      if(tab==='Investor Funding Flow') {
        root.innerHTML='<header><strong>Investor Funding Controls</strong><em>GOVERNED</em></header><p>The flow view reconciles existing records. State-changing controls remain in Prepared, Published, Orders, Reservations, Allocations, and Settlement.</p>';
      } else if(tab==='Prepared')renderPrepared(root,d);else if(tab==='Ready')renderReady(root,d);else if(tab==='Published')renderPublished(root,d);else if(tab==='Orders')renderOrders(root,d);else if(tab==='Reservations')renderReservations(root,d);else if(tab==='Allocations')renderAllocations(root,d);else if(tab==='Settlement')renderSettlement(root,d);else renderHistorical(root,d);
      bind(workspace,root,d);
    } catch(error) { root.innerHTML=`<header><strong>Marketplace Stage Actions</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`; }
  }

  async function mutate(workspace,root,fn) {
    const result=root.querySelector('[data-stage-result]')||document.createElement('span');
    if(!result.isConnected){result.dataset.stageResult='true';result.style.cssText='color:#d6a92f;font-size:12px;margin-left:8px';root.append(result);}
    result.textContent='Working…';
    try { await fn(); result.textContent='Recorded.'; client()?.refresh?.('marketplace-stage-action'); window.dispatchEvent(new CustomEvent('sra:admin-workspace-synchronized',{detail:{workspaceId:'marketplace',source:'marketplace-stage-action'}})); await render(workspace); }
    catch(error){result.textContent=error.message;}
  }

  function bind(workspace,root,d) {
    root.querySelectorAll('[data-stage-action]').forEach((button)=>button.addEventListener('click',()=>{
      const action=button.dataset.stageAction,id=button.dataset.stageId;
      void mutate(workspace,root,async()=>{
        if(action==='authorize-readiness')return post('/api/admin/listing-readiness-batch/approve',{unitPrice:1,minimumOrder:1,askingPriceMethod:'VERIFIED_RECORDED_USD_VALUE_AT_SRA_PAR',eligibilityRule:'SRA_REGISTERED_PARTICIPANTS',transactionRouteId:'SRA_INTERNAL_MARKETPLACE',settlementRouteId:'SRA_INTERNAL_SETTLEMENT',approval:'APPROVE'});
        if(action==='publish-ready')return post('/api/admin/listing-publication-batch/approve',{approval:'APPROVE'});
        if(action==='open-window')return post(`/api/funding-marketplace-commitment/listings/${encodeURIComponent(id)}/windows`,{});
        if(action==='close-window')return post(`/api/funding-marketplace-allocation/windows/${encodeURIComponent(id)}/close`,{});
        if(action==='confirm-commitment')return post(`/api/funding-marketplace-commitment/commitments/${encodeURIComponent(id)}/confirm`,{});
        if(action==='cancel-commitment')return post(`/api/funding-marketplace-commitment/commitments/${encodeURIComponent(id)}/cancel`,{reason:'ADMIN_CANCELLED'});
        if(action==='start-allocation-review')return post(`/api/funding-marketplace-allocation/windows/${encodeURIComponent(id)}/reviews`,{});
        if(action==='approve-allocation')return post(`/api/funding-marketplace-allocation/reviews/${encodeURIComponent(id)}/decision`,{decision:'APPROVED_FOR_ALLOCATION',rationale:'Administrator approved the recorded commitment allocation.'});
        if(action==='create-positions')return post(`/api/funding-marketplace-allocation/reviews/${encodeURIComponent(id)}/positions`,{});
        if(action==='prepare-settlement')return post(`/api/funding-marketplace-allocation/positions/${encodeURIComponent(id)}/settlement-preparation`,{paymentSourceReference:root.querySelector(`[data-settle-source="${CSS.escape(id)}"]`)?.value.trim(),destinationReference:root.querySelector(`[data-settle-destination="${CSS.escape(id)}"]`)?.value.trim()});
        if(action==='start-settlement-review')return post(`/api/funding-marketplace-settlement/preparations/${encodeURIComponent(id)}/reviews`,{});
        if(action==='authorize-settlement')return post(`/api/funding-marketplace-settlement/reviews/${encodeURIComponent(id)}/decision`,{decision:'AUTHORIZED',rationale:'Administrator authorized the prepared marketplace settlement.'});
        if(action==='verify-confirmation')return post(`/api/funding-marketplace-settlement/confirmations/${encodeURIComponent(id)}/verify`,{});
        if(action==='settle-authorization')return post(`/api/funding-marketplace-settlement/authorizations/${encodeURIComponent(id)}/settle`,{});
        if(action==='show-internal-confirmation') {
          const a=d.authorizations.find((x)=>x.settlementAuthorizationId===id); if(!a)throw new Error('Settlement authorization not found.');
          const ledgerEntryId=prompt('Internal ledger entry / settled transaction ID'); if(!ledgerEntryId)throw new Error('Internal ledger entry ID is required.');
          const providerReference=prompt('Confirmation reference'); if(!providerReference)throw new Error('Confirmation reference is required.');
          return post(`/api/funding-marketplace-settlement/authorizations/${encodeURIComponent(id)}/confirmations/internal-ledger`,{ledgerEntryId,providerReference,providerStatus:'SETTLED',confirmedAt:new Date().toISOString(),amount:a.amount,currency:a.currency,paymentSourceReference:a.paymentSourceReference,destinationReference:a.destinationReference});
        }
      });
    }));
  }

  function mount(workspace) {
    if(!workspace||mounted.has(workspace))return;
    mounted.add(workspace);
    workspace.addEventListener('click',(event)=>{if(event.target.closest('[data-admin-tab]'))queueMicrotask(()=>void render(workspace));});
    window.addEventListener('sra:admin-workspace-synchronized',(event)=>{if(event.detail?.workspaceId==='marketplace')void render(workspace);});
    void render(workspace);
  }

  window.mountAdminMarketplaceStageActions=mount;
})();
