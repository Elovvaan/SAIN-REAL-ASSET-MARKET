const interopMoney=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const interopEscape=(v)=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
function interopBar(label,value){return `<div class="health-bar"><span>${interopEscape(label)}</span><div class="mini-track"><div class="mini-fill" style="width:${value}%"></div></div><strong>${value}</strong></div>`}
async function renderInteroperability(){
  const root=document.querySelector('#view-root');
  const pageTitle=document.querySelector('#page-title');
  pageTitle.textContent='DeFi Interoperability';
  root.innerHTML='<div class="loading-state">Loading interoperability architecture…</div>';
  try{
    const response=await fetch('/api/interoperability');
    if(!response.ok)throw new Error();
    const d=await response.json();
    const metrics=[['Linked wallets',d.metrics.linkedWallets,'Wallets remain authorization contexts'],['Anchored proofs',d.metrics.anchoredProofs,'Deterministic lifecycle commitments'],['Active credentials',d.metrics.activeCredentials,'Machine-verifiable attestations'],['Pool utilization',`${d.metrics.productivePoolUtilization}%`,'Productive capacity currently deployed'],['Represented instruments',d.metrics.representedInstruments,'Optional external representations']];
    root.innerHTML=`
      <section class="interop-callout"><strong>Core policy:</strong> ${interopEscape(d.corePolicy)}</section>
      <section class="interop-metrics">${metrics.map(([l,v,n])=>`<article class="metric-card"><span>${interopEscape(l)}</span><strong>${interopEscape(v)}</strong><small>${interopEscape(n)}</small></article>`).join('')}</section>
      <section class="interop-grid">${d.layers.map(layer=>`<article class="interop-card"><span class="badge interop-state ${layer.state==='ACTIVE'?'open':layer.state==='SANDBOX'?'watch':''}">${interopEscape(layer.state)}</span><h3>${interopEscape(layer.name)}</h3><div class="interop-items">${layer.items.map(item=>`<span class="interop-item">${interopEscape(item)}</span>`).join('')}</div></article>`).join('')}</section>
      <section class="panel"><div class="panel-header"><div><h2>Completion Health</h2><p>Productive health replaces price-only liquidation logic.</p></div></div><div class="health-grid">${d.completionHealth.map(h=>`<article class="health-row"><div><strong>${interopEscape(h.title)}</strong><p>${interopEscape(h.projectId)} · ${interopEscape(h.state)}</p></div><div class="health-score">${h.score.toFixed(2)}</div><div class="health-bars">${interopBar('Verified coverage',h.verifiedCoverage)}${interopBar('Funding coverage',h.fundingCoverage)}${interopBar('Schedule stability',h.scheduleStability)}</div></article>`).join('')}</div></section>
      <section class="content-grid"><div class="panel"><div class="panel-header"><div><h2>Verifiable Credentials</h2><p>Proof of facts without converting every fact into a token.</p></div></div><div class="interop-table">${d.credentials.map(c=>`<div class="interop-table-row"><strong>${interopEscape(c.type)}</strong><span>${interopEscape(c.issuer)}</span><span>${interopEscape(c.subject)}</span><span class="badge open">${interopEscape(c.status)}</span></div>`).join('')}</div></div><div class="panel"><div class="panel-header"><div><h2>Productive Pools</h2><p>Capacity, deployment, and utilization.</p></div></div>${d.pools.map(p=>`<div class="pool-row"><div class="pool-head"><strong>${interopEscape(p.name)}</strong><span>${interopEscape(p.state)}</span></div><div class="progress-labels"><span>${interopMoney.format(p.deployed)} deployed of ${interopMoney.format(p.available)}</span><span>${p.utilization}%</span></div><div class="progress-track"><div class="progress-bar" style="width:${p.utilization}%"></div></div></div>`).join('')}</div></section>
      <section class="phase-strip">${d.phases.map(p=>`<article class="phase-card"><span>${interopEscape(p.phase)}</span><strong>${interopEscape(p.name)}</strong><small>${interopEscape(p.status)}</small></article>`).join('')}</section>`;
  }catch{root.innerHTML='<div class="empty-view"><h2>Interoperability view unavailable</h2><p>Check the API deployment and refresh.</p></div>'}
}
const oldButton=document.querySelector('[data-view="interoperability"]');
if(oldButton){
  const button=oldButton.cloneNode(true);
  oldButton.replaceWith(button);
  button.addEventListener('click',()=>{
    document.querySelectorAll('.nav-item').forEach(item=>item.classList.remove('active'));
    button.classList.add('active');
    renderInteroperability();
  });
}
