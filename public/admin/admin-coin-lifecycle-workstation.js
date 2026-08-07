(() => {
  if (window.__sraAdminCoinLifecycleInstalled) return;
  window.__sraAdminCoinLifecycleInstalled = true;

  const mounted = new WeakSet();
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const qty = (value) => num(value).toLocaleString(undefined, { maximumFractionDigits: 8 });
  const usd = (value) => `$${num(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const terminalTabs = new Set(['Legacy Corrections']);

  async function requestJson(url) {
    const response = await fetch(url, { cache:'no-store', headers:{ Accept:'application/json', 'Cache-Control':'no-cache' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }
  function controls(workspace) { return workspace?.querySelector('.admin-workspace-controls') || null; }
  function removePanel(workspace) { controls(workspace)?.querySelector('[data-coin-lifecycle-workstation]')?.remove(); }
  function panel(workspace) {
    const root = controls(workspace); if (!root) return null;
    let node = root.querySelector('[data-coin-lifecycle-workstation]');
    if (!node) { node = document.createElement('section'); node.className='admin-record-card'; node.dataset.coinLifecycleWorkstation='true'; root.prepend(node); }
    return node;
  }
  function card(label,value,detail='') { return `<div style="border:1px solid #292929;border-radius:12px;padding:14px;background:#090909;min-width:0"><span style="display:block;color:#9a9a9a;font-size:10px;text-transform:uppercase">${esc(label)}</span><strong style="display:block;font-size:20px;margin-top:7px">${esc(value)}</strong>${detail?`<small style="display:block;color:#8f8f8f;margin-top:5px">${esc(detail)}</small>`:''}</div>`; }
  function rowsMarkup(rows=[]) {
    if (!rows.length) return '<p style="color:#9a9a9a;margin:14px 0 0">No independently represented SRA Coin Positions are currently stored.</p>';
    return `<div class="admin-record-list" style="margin-top:14px">${rows.map(row=>`<article class="admin-record-card" style="margin:0"><header><strong>${esc(row.coinPositionId||'Coin Position')}</strong><em>${esc(row.state||'UNKNOWN')}</em></header><div class="admin-record-grid"><div><span>Native source</span><strong>${esc(qty(row.sourceAmount))} ${esc(row.sourceUnit||'SOURCE')}</strong></div><div><span>Recognized USD</span><strong>${esc(row.recognizedUsd?usd(row.recognizedUsd):'Not established')}</strong></div><div><span>SRA represented</span><strong>${esc(qty(row.representedSra))} SRA</strong></div><div><span>Available</span><strong>${esc(qty(row.availableSra))} SRA</strong></div></div></article>`).join('')}</div>`;
  }

  function currentSupplyMarkup(data) {
    const s=data.supply||{}, r=data.reconciliation||{};
    return `<header><strong>Current SRA Supply</strong><em>STAGE 1</em></header><div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px;margin-top:12px">${card('Active supply',`${qty(s.activeSra)} SRA`,'independent representation only')}${card('Available',`${qty(s.availableSra)} SRA`,'includes segmented slices')}${card('Reserved',`${qty(s.reservedSra)} SRA`)}${card('Externalized',`${qty(s.externalizedSra)} SRA`)}${card('Retired',`${qty(s.retiredSra)} SRA`)}${card('Recognized value',usd(s.recognizedUsd),'USD representation basis')}${card('Account issuance',`${qty(s.accountIssuedSra)} SRA`,'Coin Account aggregate')}</div><p style="color:#9a9a9a;margin:14px 0 0">Supply is calculated from the complete persistent domain. Segmentation creates position slices, not new SRA issuance. ${numberText(r.derivativePositionCount)} derivative position${num(r.derivativePositionCount)===1?' is':'s are'} excluded from represented-supply issuance.</p>${rowsMarkup(data.sample||[])}`;
  }
  const numberText=(v)=>num(v).toLocaleString();
  function representedValueMarkup(data) {
    const s=data.supply||{}, r=data.reconciliation||{};
    return `<header><strong>Represented Value Reconciliation</strong><em>${num(r.missingUsdBasisCount)||num(r.mismatchCount)?'REVIEW':'AT PAR'}</em></header><div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-top:12px">${card('SRA represented',`${qty(s.activeSra)} SRA`)}${card('Recognized USD',usd(s.recognizedUsd))}${card('Par delta',`${qty(r.parDeltaSra)} SRA`)}${card('Missing USD basis',numberText(r.missingUsdBasisCount))}${card('Mismatches',numberText(r.mismatchCount))}${card('Derivative slices',numberText(r.derivativePositionCount),'excluded from par re-test')}</div><p style="color:#9a9a9a;margin:14px 0 0">Only independently represented/root positions are tested against recognized USD at 1 SRA = 1 USD. Segmented children inherit value lineage and do not create another representation basis.</p>${rowsMarkup(data.sample||[])}`;
  }
  function intelligenceMarkup(data) {
    const r=data.reconciliation||{}; const mix=data.sourceMix||{};
    const sources=Object.entries(mix).sort((a,b)=>b[1]-a[1]).map(([unit,count])=>`${unit}: ${count}`).join(' · ')||'No active root positions';
    return `<header><strong>Coin Intelligence</strong><em>STAGE 3</em></header><div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-top:12px">${card('Representation coverage',`${num(r.representationCoveragePct).toFixed(1)}%`)}${card('Root positions',numberText(r.activeRootPositionCount))}${card('Derivative slices',numberText(r.derivativePositionCount))}${card('Needs reconciliation',numberText(r.mismatchCount))}${card('Restricted roots',numberText(r.restrictedRootPositionCount))}${card('Source types',numberText(Object.keys(mix).length))}</div><p style="color:#9a9a9a;margin:14px 0 0"><strong style="color:#f5f5f5">Source mix:</strong> ${esc(sources)}</p><p style="color:#9a9a9a;margin:8px 0 0">Intelligence is computed over the complete domain rather than the Administration workspace display cap.</p>`;
  }
  function historyMarkup(data) { const h=data.history||{}, c=data.counts||{}; return `<header><strong>Representation / Mint History</strong><em>STAGE 4</em></header><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px">${card('Representation events',numberText(h.representationEventCount))}${card('Coin positions',numberText(c.coinPositionCount))}${card('Financial records',numberText(c.financialRecordCount))}</div><p style="color:#9a9a9a;margin:14px 0 0">Every supply increase should trace through Coin Position → Financial Record → recognized recorded value → source lineage. Segmentation events do not count as minting.</p>`; }
  function adjustmentsMarkup(data) { const h=data.history||{}, r=data.reconciliation||{}; return `<header><strong>Adjustments</strong><em>STAGE 5</em></header><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px">${card('Recorded adjustment events',numberText(h.adjustmentEventCount))}${card('Active root positions',numberText(r.activeRootPositionCount))}${card('Write controls','NOT ENABLED','Aggregate reconciliation required first')}</div><p style="color:#9a9a9a;margin:14px 0 0">This stage remains read-only until an adjustment atomically persists before/after quantity and reconciles the owning Coin Account aggregate.</p>`; }
  function retirementsMarkup(data) { const h=data.history||{}, s=data.supply||{}; return `<header><strong>Retirements</strong><em>STAGE 6</em></header><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px">${card('Retired quantity',`${qty(s.retiredSra)} SRA`)}${card('Retirement events',numberText(h.retirementEventCount))}${card('Write controls','NOT ENABLED','Atomic supply reduction required')}</div><p style="color:#9a9a9a;margin:14px 0 0">Retirement closes represented supply only when the Coin Position and Coin Account issuance aggregate can be reduced atomically with an audit trail.</p>`; }
  function markup(tab,data) {
    if(tab==='Current Supply') return currentSupplyMarkup(data);
    if(tab==='Represented Value') return representedValueMarkup(data);
    if(tab==='Coin Intelligence') return intelligenceMarkup(data);
    if(tab==='Mint History') return historyMarkup(data);
    if(tab==='Adjustments') return adjustmentsMarkup(data);
    if(tab==='Retirements') return retirementsMarkup(data);
    return '';
  }
  async function refresh(workspace) {
    const tab=workspace?.dataset.activeTab||'';
    if(!tab||terminalTabs.has(tab)){removePanel(workspace);return;}
    const node=panel(workspace); if(!node)return;
    node.innerHTML='<header><strong>Coin Position Lifecycle</strong><em>LOADING</em></header><p style="color:#9a9a9a">Reconciling the complete persistent Coin Position domain…</p>';
    try {
      const data=await requestJson(`/api/admin/coin-position-lifecycle?_=${Date.now()}`);
      if(!node.isConnected||workspace.dataset.activeTab!==tab)return;
      node.innerHTML=markup(tab,data);
    } catch(error) { node.innerHTML=`<header><strong>Coin Position Lifecycle</strong><em>UNAVAILABLE</em></header><p style="color:#d6a92f">${esc(error.message)}</p>`; }
  }
  function mount(workspace) {
    if(!workspace||mounted.has(workspace))return;
    mounted.add(workspace);
    workspace.addEventListener('click',event=>{if(event.target.closest('[data-admin-tab]'))queueMicrotask(()=>void refresh(workspace));});
    window.addEventListener('sra:admin-workspace-synchronized',event=>{if(event.detail?.workspaceId==='coin-positions')void refresh(workspace);});
    void refresh(workspace);
  }
  window.mountAdminCoinLifecycleWorkstation=mount;
})();