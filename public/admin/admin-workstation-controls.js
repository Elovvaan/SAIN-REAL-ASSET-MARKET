(() => {
  if (window.__sraAdminWorkstationControlsInstalled) return;
  window.__sraAdminWorkstationControlsInstalled = true;

  const client = () => window.SRAAdminDataClient;
  const request = async (url, options = {}) => {
    if (client()) return client().json(url, options);
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const number = (value) => Number(value || 0).toLocaleString();
  const money = (value) => Number(value || 0).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:8});
  const host = (workspace, key) => {
    const root = document.querySelector(`[data-workspace="${workspace}"] .admin-workspace-controls`);
    if (!root) return null;
    let section = root.querySelector(`[data-workstation-control="${key}"]`);
    if (!section) {
      section = document.createElement('section');
      section.className = 'admin-record-card';
      section.dataset.workstationControl = key;
      root.append(section);
    }
    return section;
  };
  const refreshWorkspace = (id, source) => {
    client()?.refresh(source || id);
    document.querySelector(`[data-workspace="${id}"] [data-refresh-workspace="${id}"]`)?.click();
  };
  const isWorkspaceActive = (id) => document.querySelector(`[data-workspace="${id}"]`)?.classList.contains('active') === true;

  async function renderMarketplace() {
    const root = host('marketplace','marketplace-governance');
    if (!root) return;
    root.innerHTML = `<header><strong>SRA / USD Market Governance</strong><em>CONTROLLED</em></header><div data-market-status>Loading market state…</div>`;
    try {
      const [readiness, publication, policy, hybrid] = await Promise.all([
        request('/api/admin/listing-readiness-batch?unitPrice=1&minimumOrder=1&askingPriceMethod=VERIFIED_RECORDED_USD_VALUE_AT_SRA_PAR&eligibilityRule=SRA_REGISTERED_PARTICIPANTS&transactionRouteId=SRA_INTERNAL_MARKETPLACE&settlementRouteId=SRA_INTERNAL_SETTLEMENT'),
        request('/api/admin/listing-publication-batch'),
        request('/api/sane/core-services/readiness-policy'),
        request('/api/sane/hybrid-liquidity/status'),
      ]);
      const prepared = Number(readiness?.preview?.eligibleListingCount || readiness?.status?.eligibleForBatch || 0);
      const invalid = Number(readiness?.preview?.invalidListingCount || 0);
      const ready = Number(publication?.preview?.eligibleListingCount || readiness?.status?.readyForPublicationApproval || 0);
      const live = Number(publication?.status?.liveListingCount || 0);
      root.innerHTML = `<header><strong>SRA / USD Market Governance</strong><em>${invalid ? 'VALUE REVIEW' : 'CURRENT'}</em></header>
        <div class="admin-record-grid"><div><span>Prepared</span><strong>${number(prepared)}</strong></div><div><span>Ready to publish</span><strong>${number(ready)}</strong></div><div><span>Live</span><strong>${number(live)}</strong></div><div><span>Standing readiness</span><strong>${policy?.status?.active ? 'ACTIVE' : 'INACTIVE'}</strong></div><div><span>Reference markets</span><strong>${number(hybrid?.marketCount)}</strong></div><div><span>Execution-enabled reference markets</span><strong>${number(hybrid?.executionEnabledMarkets)}</strong></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button data-market-ready ${prepared===0||invalid>0?'disabled':''}>Authorize readiness</button><button data-market-publish ${ready===0?'disabled':''}>Publish ready listings</button><button data-market-policy>${policy?.status?.active?'Disable':'Activate'} standing policy</button></div>
        <details style="margin-top:12px"><summary>Reference market definition</summary><div class="admin-record-grid" style="margin-top:12px"><label><span>Instrument ID</span><input data-hybrid-instrument placeholder="INS-..."></label><label><span>Mode</span><select data-hybrid-mode><option value="CONTINUOUS_REFERENCE">Continuous reference</option><option value="EVENT_REFERENCE">Event reference</option><option value="PERPETUAL_REFERENCE">Perpetual reference</option><option value="SPOT">Spot</option></select></label><label><span>Market identity</span><input data-hybrid-identity value="SRA / USD"></label><label><span>Index method</span><input data-hybrid-index value="VERIFIED_REFERENCE_COMPOSITE"></label></div><div style="display:flex;gap:8px;margin-top:10px"><button data-hybrid-preview>Preview</button><button data-hybrid-approve>Approve reference market</button></div><pre data-hybrid-result style="white-space:pre-wrap;max-height:220px;overflow:auto"></pre></details>`;
      root.querySelector('[data-market-ready]')?.addEventListener('click', async () => {
        if (!confirm(`Authorize readiness for ${number(prepared)} eligible listing(s) at fixed 1 SRA = $1.00?`)) return;
        await request('/api/admin/listing-readiness-batch/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({unitPrice:1,minimumOrder:1,askingPriceMethod:'VERIFIED_RECORDED_USD_VALUE_AT_SRA_PAR',eligibilityRule:'SRA_REGISTERED_PARTICIPANTS',transactionRouteId:'SRA_INTERNAL_MARKETPLACE',settlementRouteId:'SRA_INTERNAL_SETTLEMENT',approval:'APPROVE'})});
        refreshWorkspace('marketplace','market-readiness'); await renderMarketplace();
      });
      root.querySelector('[data-market-publish]')?.addEventListener('click', async () => {
        if (!confirm(`Publish ${number(ready)} ready listing(s)?`)) return;
        await request('/api/admin/listing-publication-batch/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approval:'APPROVE'})});
        refreshWorkspace('marketplace','market-publication'); await renderMarketplace();
      });
      root.querySelector('[data-market-policy]')?.addEventListener('click', async () => {
        if (policy?.status?.active) await request('/api/sane/core-services/readiness-policy/disable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approval:'DISABLE'})});
        else await request('/api/sane/core-services/readiness-policy/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({unitPrice:1,minimumOrder:1,askingPriceMethod:'VERIFIED_RECORDED_USD_VALUE_AT_SRA_PAR',eligibilityRule:'SRA_REGISTERED_PARTICIPANTS',transactionRouteId:'SRA_INTERNAL_MARKETPLACE',settlementRouteId:'SRA_INTERNAL_SETTLEMENT',approval:'APPROVE'})});
        await renderMarketplace();
      });
      const hybridInput = () => ({underlyingInstrumentId:root.querySelector('[data-hybrid-instrument]')?.value.trim(),mode:root.querySelector('[data-hybrid-mode]')?.value,marketIdentity:root.querySelector('[data-hybrid-identity]')?.value.trim()||'SRA / USD',referenceSources:['SRA_VERIFIED_VALUE','SRA_MARKET_ACTIVITY'],indexMethod:root.querySelector('[data-hybrid-index]')?.value.trim()||'VERIFIED_REFERENCE_COMPOSITE',staleAfterSeconds:300});
      root.querySelector('[data-hybrid-preview]')?.addEventListener('click', async () => { root.querySelector('[data-hybrid-result]').textContent = JSON.stringify(await request('/api/sane/hybrid-liquidity/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(hybridInput())}),null,2); });
      root.querySelector('[data-hybrid-approve]')?.addEventListener('click', async () => { const input=hybridInput(); if(!input.underlyingInstrumentId) return alert('Enter an SRA instrument ID.'); if(!confirm(`Approve ${input.mode} reference market for ${input.underlyingInstrumentId}?`)) return; root.querySelector('[data-hybrid-result]').textContent=JSON.stringify(await request('/api/sane/hybrid-liquidity/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,approval:'APPROVE'})}),null,2); });
    } catch (error) { root.innerHTML = `<header><strong>SRA / USD Market Governance</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`; }
  }

  async function renderOperations() {
    const root = host('operations','operations-queue'); if(!root) return;
    root.innerHTML='<header><strong>Unified Market Operations Queue</strong><em>LOADING</em></header>';
    try {
      const data = await request('/api/sane/operations-queue');
      const entries=[...(data.exceptions||[]).map(x=>({...x,exception:true})),...(data.queue||[])];
      root.innerHTML=`<header><strong>Unified Market Operations Queue</strong><em>${esc(data.state||'UNKNOWN')}</em></header><div class="admin-record-grid"><div><span>Awaiting action</span><strong>${number(data.totalAwaitingAction)}</strong></div><div><span>Exceptions</span><strong>${number(data.totalExceptions)}</strong></div><div><span>Coin positions</span><strong>${number(data.coinAgents?.coinAgentCount)}</strong></div><div><span>Need approval</span><strong>${number(data.coinAgents?.requiringHumanApproval)}</strong></div></div><p>${esc(data.nextRecommendedAction?.explanation||'No governed market operation is presently waiting.')}</p><div style="display:grid;gap:8px">${entries.slice(0,20).map(e=>`<article class="admin-record-card"><strong>${esc(e.stage||'Operation')}</strong><div>${esc(e.explanation||'')}</div><small>${esc(e.id||'')} · ${esc(e.nextAction||'')}</small></article>`).join('')||'<p>No waiting operations or exceptions.</p>'}</div><div style="display:flex;gap:8px;margin-top:12px"><input data-coin-position placeholder="Coin Position ID"><button data-coin-explain>Explain Coin Position</button></div><pre data-coin-result style="white-space:pre-wrap;max-height:220px;overflow:auto"></pre>`;
      root.querySelector('[data-coin-explain]')?.addEventListener('click',async()=>{const id=root.querySelector('[data-coin-position]').value.trim();if(!id)return;root.querySelector('[data-coin-result]').textContent=JSON.stringify(await request(`/api/sane/coin-agents/${encodeURIComponent(id)}`),null,2);});
    } catch(error){root.innerHTML=`<header><strong>Unified Market Operations Queue</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`;}
  }

  async function renderTreasury() {
    const root=host('treasury','treasury-controls'); if(!root)return;
    root.innerHTML='<header><strong>SRA Platform Treasury Controls</strong><em>LOADING</em></header>';
    try {
      const [treasury,correction]=await Promise.all([request('/api/admin/treasury'),request('/api/admin/recorded-value-representation')]);
      const accounts=treasury.accounts||[];
      const opts=accounts.map(a=>`<option value="${esc(a.accountId)}">${esc(a.code)} · ${esc(a.name)}</option>`).join('');
      root.innerHTML=`<header><strong>SRA Platform Treasury Controls</strong><em>${treasury.balanced?'BALANCED':'OUT OF BALANCE'}</em></header><div class="admin-record-grid"><div><span>Cash / settlement USD</span><strong>${money(treasury.cashBalanceUsd)}</strong></div><div><span>Commercial instrument USD</span><strong>${money(treasury.fundingInstrumentDeposits?.depositedInstrumentValueUsd)}</strong></div><div><span>Available financing</span><strong>${money(treasury.fundingInstrumentDeposits?.availableFinancingCapacityUsd)}</strong></div><div><span>Legacy corrections</span><strong>${number(correction.correctablePositionCount)}</strong></div></div>
      <details style="margin-top:12px"><summary>Deposit platform commercial instrument</summary><div class="admin-record-grid" style="margin-top:10px"><label><span>Instrument ID</span><input data-deposit-id></label><label><span>Face value USD</span><input data-deposit-value type="number" min="0.01" step="any"></label><label><span>Term months</span><input data-deposit-term type="number" min="1" value="36"></label><label><span>Reference</span><input data-deposit-ref></label></div><div style="display:flex;gap:8px;margin-top:10px"><button data-deposit-preview>Preview</button><button data-deposit-approve>Deposit & Establish USD Position</button></div><p data-deposit-result></p></details>
      <details style="margin-top:12px"><summary>Post balanced entry</summary><div class="admin-record-grid" style="margin-top:10px"><label><span>Debit</span><select data-journal-debit>${opts}</select></label><label><span>Credit</span><select data-journal-credit>${opts}</select></label><label><span>Amount USD</span><input data-journal-amount type="number" min="0.01" step="any"></label><label><span>Reference</span><input data-journal-ref></label></div><input data-journal-memo placeholder="Memo" style="margin-top:8px"><div style="display:flex;gap:8px;margin-top:10px"><button data-journal-preview>Preview</button><button data-journal-post>Post Balanced Entry</button><button data-correct ${Number(correction.correctablePositionCount||0)===0?'disabled':''}>Correct Legacy Positions</button></div><p data-journal-result></p></details>`;
      const depositInput=()=>({instrumentId:root.querySelector('[data-deposit-id]').value,faceValueUsd:Number(root.querySelector('[data-deposit-value]').value||0),termMonths:Number(root.querySelector('[data-deposit-term]').value||36),depositReference:root.querySelector('[data-deposit-ref]').value});
      root.querySelector('[data-deposit-preview]').addEventListener('click',async()=>{const p=await request('/api/admin/treasury/funding-instrument-deposits/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(depositInput())});root.querySelector('[data-deposit-result]').textContent=`${p.instrumentName}: ${money(p.faceValueUsd)} establishes ${money(p.financingCapacityUsd)} financing capacity.`;});
      root.querySelector('[data-deposit-approve]').addEventListener('click',async()=>{const p=await request('/api/admin/treasury/funding-instrument-deposits/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(depositInput())});if(!confirm(`Deposit ${p.instrumentName} at ${money(p.faceValueUsd)}?`))return;await request('/api/admin/treasury/funding-instrument-deposits/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...depositInput(),approval:'APPROVE'})});refreshWorkspace('treasury','treasury-deposit');await renderTreasury();});
      const journalInput=()=>{const amount=Number(root.querySelector('[data-journal-amount]').value||0);return{memo:root.querySelector('[data-journal-memo]').value,reference:root.querySelector('[data-journal-ref]').value||null,lines:[{accountId:root.querySelector('[data-journal-debit]').value,side:'DEBIT',amount,currency:'USD'},{accountId:root.querySelector('[data-journal-credit]').value,side:'CREDIT',amount,currency:'USD'}]};};
      root.querySelector('[data-journal-preview]').addEventListener('click',async()=>{const p=await request('/api/admin/treasury/journals/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(journalInput())});root.querySelector('[data-journal-result]').textContent=`Balanced: Debit ${money(p.totalDebits)} / Credit ${money(p.totalCredits)}. ${p.effect}`;});
      root.querySelector('[data-journal-post]').addEventListener('click',async()=>{const input=journalInput();await request('/api/admin/treasury/journals/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});if(!confirm(`Post balanced treasury entry for ${money(input.lines[0].amount)}?`))return;await request('/api/admin/treasury/journals/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,approval:'APPROVE',idempotencyKey:input.reference||undefined})});refreshWorkspace('treasury','treasury-journal');await renderTreasury();});
      root.querySelector('[data-correct]')?.addEventListener('click',async()=>{const count=Number(correction.correctablePositionCount||0);if(!count||!confirm(`Correct ${number(count)} legacy SRA Coin Position(s)?`))return;await request('/api/admin/recorded-value-representation/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approval:'APPROVE'})});refreshWorkspace('treasury','recorded-value-correction');await renderTreasury();});
    } catch(error){root.innerHTML=`<header><strong>SRA Platform Treasury Controls</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`;}
  }

  async function renderSystem() {
    const root=host('system','core-services');if(!root)return;
    root.innerHTML='<header><strong>SRA Core Services</strong><em>LOADING</em></header>';
    try{const [brief,queue]=await Promise.all([request('/api/sane/core-services/brief'),request('/api/sane/core-services/publication-queue')]);root.innerHTML=`<header><strong>SRA Core Services</strong><em>${esc(brief.state||'UNKNOWN')}</em></header><div class="admin-record-grid"><div><span>Scheduler</span><strong>${esc(brief.heartbeat?.schedulerState||'UNKNOWN')}</strong></div><div><span>Cycles</span><strong>${number(brief.heartbeat?.cycleCount)}</strong></div><div><span>Failed engines</span><strong>${number(brief.heartbeat?.failedEngines)}</strong></div><div><span>Ready listings</span><strong>${number(queue.eligibleListingCount)}</strong></div></div><p>${esc(brief.reply||'')}</p><p>${esc(brief.nextAction||'')}</p><div style="display:flex;gap:8px"><button data-core-run>Run cycle now</button><button data-core-publish ${Number(queue.eligibleListingCount||0)===0?'disabled':''}>Authorize current valid set</button></div>`;root.querySelector('[data-core-run]').addEventListener('click',async()=>{await request('/api/sane/core-services/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trigger:'ADMIN_WORKSTATION'})});await renderSystem();});root.querySelector('[data-core-publish]').addEventListener('click',async()=>{if(!confirm(`Publish ${number(queue.eligibleListingCount)} current valid listing(s)?`))return;await request('/api/admin/listing-publication-batch/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approval:'APPROVE'})});refreshWorkspace('marketplace','core-publication');await renderSystem();});}catch(error){root.innerHTML=`<header><strong>SRA Core Services</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`;}
  }

  async function renderInstruments() {
    if (!isWorkspaceActive('instruments')) return;
    const root=host('instruments','instrument-approvals');if(!root)return;
    root.innerHTML='<header><strong>Instrument & Representation Approval</strong><em>CHECKING</em></header>';
    try {
      const status=await request('/api/admin/instruments/approval-status');
      const pending=status.pending||[];
      const representationReady=status.representationReady||[];
      const awaitingRepresentation=representationReady.filter((item)=>!item.representationApproved);
      root.innerHTML=`<header><strong>Instrument & Representation Approval</strong><em>${number(pending.length + awaitingRepresentation.length)} ACTION${pending.length + awaitingRepresentation.length===1?'':'S'}</em></header>
        <p style="color:#9a9a9a;line-height:1.5">Instrument approval belongs here. Representation approval authorizes an issued/approved instrument to support SRA coin representation and later on-chain preparation. It does not mint, move, broadcast, or publish anything.</p>
        <div class="admin-record-grid"><div><span>Pending instrument approval</span><strong>${number(pending.length)}</strong></div><div><span>Representation ready</span><strong>${number(representationReady.length)}</strong></div><div><span>Representation approved</span><strong>${number(status.representationApprovalCount)}</strong></div><div><span>Awaiting representation approval</span><strong>${number(awaitingRepresentation.length)}</strong></div></div>
        <div style="display:grid;gap:10px;margin-top:14px">
          ${pending.map((instrument)=>{const id=instrument.instrumentId||instrument.id;return `<article class="admin-record-card"><header><strong>${esc(id||'Instrument')}</strong><em>${esc(instrument.state||instrument.status||'PENDING')}</em></header><div class="admin-record-grid"><div><span>Type</span><strong>${esc(instrument.instrumentType||instrument.type||'INSTRUMENT')}</strong></div><div><span>Amount / value</span><strong>${esc(instrument.amountUsd??instrument.faceValueUsd??instrument.faceValue??instrument.authorizedAmount??'—')}</strong></div></div><div style="margin-top:12px"><button data-approve-instrument="${esc(id)}">Approve Instrument</button></div></article>`;}).join('')}
          ${representationReady.map((item)=>{const instrument=item.instrument||{};const assessment=item.assessment||{};const id=instrument.instrumentId||instrument.id;const coinCount=(assessment.linkedCoinPositionIds||[]).length;return `<article class="admin-record-card"><header><strong>${esc(id||'Instrument')}</strong><em>${item.representationApproved?'REPRESENTATION APPROVED':'READY FOR APPROVAL'}</em></header><div class="admin-record-grid"><div><span>Instrument state</span><strong>${esc(instrument.state||instrument.status||'—')}</strong></div><div><span>Type</span><strong>${esc(instrument.instrumentType||instrument.type||'INSTRUMENT')}</strong></div><div><span>Linked coin positions</span><strong>${number(coinCount)}</strong></div><div><span>On-chain preparation</span><strong>${item.representationApproved?'AUTHORIZED':'NOT YET AUTHORIZED'}</strong></div></div>${item.representationApproved?'<p style="color:#9a9a9a;margin:12px 0 0">Approval is recorded. Coin Position remains the record view; any actual on-chain movement still starts later from Settlement Instructions.</p>':`<div style="margin-top:12px"><button data-approve-representation="${esc(id)}">Approve Coin / On-Chain Readiness</button></div>`}</article>`;}).join('')}
          ${pending.length===0&&representationReady.length===0?'<p>No instrument approval actions are currently available.</p>':''}
        </div>`;

      root.querySelectorAll('[data-approve-instrument]').forEach((button)=>button.addEventListener('click',async()=>{
        const id=button.dataset.approveInstrument;
        if(!id||!confirm(`Approve instrument ${id}?`))return;
        button.disabled=true;
        try {
          await request(`/api/admin/instruments/${encodeURIComponent(id)}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approval:'APPROVE'})});
          refreshWorkspace('instruments','instrument-approval');
          await renderInstruments();
        } catch(error) { alert(error.message); button.disabled=false; }
      }));

      root.querySelectorAll('[data-approve-representation]').forEach((button)=>button.addEventListener('click',async()=>{
        const id=button.dataset.approveRepresentation;
        if(!id||!confirm(`Approve ${id} for SRA coin representation and on-chain preparation? This does not mint or send anything.`))return;
        button.disabled=true;
        try {
          await request(`/api/admin/instruments/${encodeURIComponent(id)}/representation/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approval:'APPROVE'})});
          refreshWorkspace('instruments','instrument-representation-approval');
          refreshWorkspace('coin-positions','instrument-representation-approval');
          await renderInstruments();
        } catch(error) { alert(error.message); button.disabled=false; }
      }));
    } catch(error) {
      root.innerHTML=`<header><strong>Instrument & Representation Approval</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`;
    }
  }

  async function renderAll(){await Promise.allSettled([renderMarketplace(),renderOperations(),renderTreasury(),renderSystem(),renderInstruments()]);}
  window.addEventListener('sra:admin-refresh',()=>void renderAll());
  window.addEventListener('sra:admin-mutated',()=>void renderAll());
  window.addEventListener('sra:admin-booted',()=>void renderAll());
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void renderAll(),{once:true});else void renderAll();
})();
