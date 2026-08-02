const participationState={opportunities:[],selected:null,positions:[],ticket:null,configuration:null};
const pEsc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const pMoney=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});

function opportunityCard(item){return `<button class="compact-opportunity market-opportunity-card" data-open-opportunity="${pEsc(item.id)}"><div class="market-card-top"><span class="badge open">${pEsc(item.stage.replaceAll('_',' '))}</span><span class="market-card-arrow">›</span></div><div><h3>${pEsc(item.title)}</h3><p>${pEsc(item.assetName)} · ${pEsc(item.region)}</p></div><div class="compact-metrics"><span><small>Verified Value</small><strong>${pMoney.format(item.verifiedValue)}</strong></span><span><small>Potential Gain</small><strong class="gain-value">+${item.projectedGainRate}%</strong></span><span><small>Projected Window</small><strong>${pEsc(item.participationWindow)}</strong></span><span><small>Project Status</small><strong>${pEsc(item.completionState)}</strong></span></div><small class="projection-note">Market signal only. Not yet realized.</small></button>`}

function bindMarketPrompts(){
  document.querySelector('#market-talk-sane')?.addEventListener('click',()=>document.querySelector('#open-sane')?.click());
  document.querySelectorAll('[data-market-prompt]').forEach(button=>button.addEventListener('click',()=>{
    document.querySelector('#open-sane')?.click();
    const input=document.querySelector('#sane-input');
    if(input){input.value=button.dataset.marketPrompt;input.focus()}
  }));
}

function renderPublicMarketplace(){
  const root=document.querySelector('#view-root');
  document.querySelector('#page-title').textContent='Living Marketplace';
  const totalVerified=participationState.opportunities.reduce((sum,item)=>sum+Number(item.verifiedValue||0),0);
  root.innerHTML=`<section class="marketplace-experience public-sane-first">
    <div class="marketplace-summary-strip">
      <div><span>Verified opportunities</span><strong>${participationState.opportunities.length}</strong></div>
      <div><span>Verified Value represented</span><strong>${pMoney.format(totalVerified)}</strong></div>
      <div><span>Marketplace</span><strong class="gain-value">LIVE</strong></div>
    </div>
    <section class="sane-market-center public-sane-center">
      <div class="sane-orb"><span class="status-dot"></span><strong>Sane</strong></div>
      <p class="eyebrow">YOUR MARKETPLACE GUIDE</p>
      <h2>What are you trying to accomplish?</h2>
      <p>Start with the conversation. Sane separates what is verified today from what the market is only signaling may happen.</p>
      <button class="primary-button sane-center-open" id="market-talk-sane">Talk to Sane</button>
      <div class="sane-center-prompts">
        <button data-market-prompt="Show me opportunities that fit someone who is just exploring.">Find opportunities</button>
        <button data-market-prompt="Compare the current projects by verified value, timing, and potential market signals.">Compare projects</button>
        <button data-market-prompt="I only have a small amount. Help me understand how I could begin.">Start small</button>
      </div>
    </section>
    <section class="public-decision-canvas" id="public-decision-canvas" hidden aria-live="polite"></section>
  </section>`;
  bindMarketPrompts();
}

function renderSignedInMarketplace(){
  const root=document.querySelector('#view-root');
  document.querySelector('#page-title').textContent='Living Marketplace';
  const totalVerified=participationState.opportunities.reduce((sum,item)=>sum+Number(item.verifiedValue||0),0);
  root.innerHTML=`<section class="marketplace-experience">
    <div class="marketplace-summary-strip">
      <div><span>Verified opportunities</span><strong>${participationState.opportunities.length}</strong></div>
      <div><span>Verified Value represented</span><strong>${pMoney.format(totalVerified)}</strong></div>
      <div><span>Marketplace</span><strong class="gain-value">LIVE</strong></div>
    </div>
    <div class="marketplace-stage">
      <section class="sane-market-center">
        <div class="sane-orb"><span class="status-dot"></span><strong>Sane</strong></div>
        <p class="eyebrow">YOUR MARKETPLACE GUIDE</p>
        <h2>What are you trying to accomplish?</h2>
        <p>Ask Sane to find, compare, explain, or help you enter an opportunity. Verified Value and market signals remain separate throughout the process.</p>
        <button class="primary-button sane-center-open" id="market-talk-sane">Talk to Sane</button>
        <div class="sane-center-prompts">
          <button data-market-prompt="Show me the strongest opportunities available right now.">Find opportunities</button>
          <button data-market-prompt="Compare these projects by verified value, timing, and potential market signals.">Compare projects</button>
          <button data-market-prompt="Show me opportunities I can enter with a small USD contribution.">Start small</button>
        </div>
      </section>
      <aside class="market-opportunity-rail">
        <div class="market-rail-head"><div><p class="eyebrow">LIVE MARKET</p><h2>Opportunities</h2></div><button class="secondary-button" id="open-my-positions">My Positions</button></div>
        <div class="compact-opportunity-list">${participationState.opportunities.map(opportunityCard).join('')}</div>
      </aside>
    </div>
  </section>`;
  document.querySelectorAll('[data-open-opportunity]').forEach(button=>button.addEventListener('click',()=>openOpportunity(button.dataset.openOpportunity)));
  document.querySelector('#open-my-positions')?.addEventListener('click',renderMyPositions);
  bindMarketPrompts();
}

function renderV10Marketplace(){
  if(!window.accessState?.session) renderPublicMarketplace();
  else renderSignedInMarketplace();
}

function positionOptions(item){return item.openPositions.map(position=>`<div class="position-option"><div><strong>${pEsc(position.type.replaceAll('_',' '))}</strong><span>${position.remaining===null?'Open project need':`${pMoney.format(position.remaining)} remaining`}</span></div><button class="primary-button" data-start-position="${pEsc(position.type)}">Participate</button></div>`).join('')}
function renderOpportunity(){const item=participationState.selected;const root=document.querySelector('#view-root');document.querySelector('#page-title').textContent=item.title;root.innerHTML=`<section class="opportunity-workspace"><button class="secondary-button" id="back-to-market">← Marketplace</button><div class="opportunity-hero"><div><p class="eyebrow">${pEsc(item.assetName.toUpperCase())}</p><h2>${pEsc(item.title)}</h2><p>${pEsc(item.region)} · ${pEsc(item.stage)}</p></div><button class="primary-button" id="participate-main">Participate</button></div><div class="opportunity-summary"><div><span>Verified Value</span><strong>${pMoney.format(item.verifiedValue)}</strong></div><div><span>Projected Completion Value</span><strong>${pMoney.format(item.projectedCompletedValue)}</strong><small>Market signal</small></div><div><span>Potential Gain</span><strong class="gain-value">+${pMoney.format(item.projectedGain)} · +${item.projectedGainRate}%</strong><small>Not yet realized</small></div><div><span>Projected Participation Window</span><strong>${pEsc(item.participationWindow)}</strong></div></div><p class="projection-note">Signals inform action. Completed events establish evidence. Verified Value records the supported state.</p><div class="opportunity-progress"><span>Project progress</span><strong>${item.progress}%</strong><div class="progress-track"><div class="progress-bar" style="width:${item.progress}%"></div></div></div><section class="panel"><div class="panel-header"><div><h2>Open participation positions</h2><p>Choose the position that matches what you are bringing into the project.</p></div></div><div class="position-options">${positionOptions(item)}</div></section></section>`;document.querySelector('#back-to-market')?.addEventListener('click',renderV10Marketplace);document.querySelector('#participate-main')?.addEventListener('click',()=>startTicket('CAPITAL'));document.querySelectorAll('[data-start-position]').forEach(button=>button.addEventListener('click',()=>startTicket(button.dataset.startPosition)))}
function mediaFor(type){const open=participationState.selected.openPositions.find(item=>item.type===type);return open?.acceptedMedia||[]}
function startTicket(type){participationState.ticket={participationType:type,medium:mediaFor(type)[0]||'',amount:'',description:''};renderTicket()}
function renderTicket(){const t=participationState.ticket;const media=mediaFor(t.participationType);const root=document.querySelector('#view-root');document.querySelector('#page-title').textContent='Participation Ticket';root.innerHTML=`<section class="ticket-shell"><button class="secondary-button" id="ticket-back">← Opportunity</button><div class="ticket-card"><div><p class="eyebrow">PARTICIPATION TICKET</p><h2>${pEsc(participationState.selected.title)}</h2><p>${pEsc(participationState.selected.assetName)}</p></div><div class="form-grid"><div class="form-field"><label>Participation type</label><select id="ticket-type">${participationState.selected.openPositions.map(item=>`<option value="${item.type}" ${item.type===t.participationType?'selected':''}>${item.type.replaceAll('_',' ')}</option>`).join('')}</select></div><div class="form-field"><label>Contribution medium</label><select id="ticket-medium">${media.map(item=>`<option value="${item}" ${item===t.medium?'selected':''}>${item.replaceAll('_',' ')}</option>`).join('')}</select></div>${t.participationType==='CAPITAL'?'<div class="form-field full"><label>Contribution amount</label><input id="ticket-amount" type="number" min="1" step="1" placeholder="10000" value="'+pEsc(t.amount)+'"></div>':''}<div class="form-field full"><label>Contribution description</label><textarea id="ticket-description" rows="4" placeholder="Describe the contribution, source, equipment, material, service, or contract right.">${pEsc(t.description)}</textarea></div></div><div class="ticket-review"><div><span>Verified Value</span><strong>${pMoney.format(participationState.selected.verifiedValue)}</strong></div><div><span>Projected Window</span><strong>${pEsc(participationState.selected.participationWindow)}</strong></div><div><span>Project Status</span><strong>${pEsc(participationState.selected.completionState)}</strong></div></div><div id="ticket-error"></div><button class="primary-button" id="authorize-position">Authorize participation</button></div></section>`;document.querySelector('#ticket-back')?.addEventListener('click',renderOpportunity);document.querySelector('#ticket-type')?.addEventListener('change',event=>{t.participationType=event.target.value;t.medium=mediaFor(t.participationType)[0]||'';renderTicket()});document.querySelector('#authorize-position')?.addEventListener('click',authorizePosition)}
async function authorizePosition(){const error=document.querySelector('#ticket-error');const body={projectId:participationState.selected.id,participationType:document.querySelector('#ticket-type').value,medium:document.querySelector('#ticket-medium').value,amount:document.querySelector('#ticket-amount')?.value||null,description:document.querySelector('#ticket-description').value};try{const response=await fetch('/api/participation/positions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Unable to create position.');participationState.positions.unshift(payload.position);renderPositionCreated(payload.position,payload.nextAction)}catch(err){error.innerHTML=`<div class="wizard-error">${pEsc(err.message)}</div>`}}
function renderPositionCreated(position,nextAction){const root=document.querySelector('#view-root');document.querySelector('#page-title').textContent='Position Created';root.innerHTML=`<section class="created-state"><div class="created-symbol">✓</div><p class="eyebrow">PARTICIPATION POSITION</p><h2>Position created</h2><div class="created-id">${pEsc(position.id)}</div><div class="created-summary"><div class="review-block"><span>Opportunity</span><strong>${pEsc(position.opportunityTitle)}</strong></div><div class="review-block"><span>Position</span><strong>${pEsc(position.participationType)}</strong></div><div class="review-block"><span>Contribution</span><strong>${pEsc(position.contribution.medium)}</strong></div><div class="review-block"><span>Status</span><strong>${pEsc(position.state)}</strong></div><div class="review-block"><span>Verification</span><strong>${pEsc(position.contribution.verificationStatus)}</strong></div><div class="review-block"><span>Next action</span><strong>${pEsc(nextAction)}</strong></div></div><button class="primary-button" id="created-my-positions">View My Positions</button></section>`;document.querySelector('#created-my-positions')?.addEventListener('click',renderMyPositions)}
async function renderMyPositions(){const root=document.querySelector('#view-root');document.querySelector('#page-title').textContent='My Positions';try{const response=await fetch('/api/participation/positions');const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Unable to load positions.');participationState.positions=payload.positions;root.innerHTML=`<section class="panel"><div class="panel-header"><div><p class="eyebrow">YOUR MARKETPLACE ACTIVITY</p><h2>My Positions</h2><p>Track commitments, contribution verification, deployment, settlement, and closure.</p></div><button class="secondary-button" id="positions-market">Marketplace</button></div><div class="position-portfolio">${participationState.positions.length?participationState.positions.map(position=>`<article class="portfolio-position"><div><span class="badge open">${pEsc(position.state)}</span><h3>${pEsc(position.opportunityTitle)}</h3><p>${pEsc(position.assetName)} · ${pEsc(position.participationType)}</p></div><div><span>Contribution</span><strong>${pEsc(position.contribution.medium)}${position.contribution.statedAmount?` · ${pMoney.format(position.contribution.statedAmount)}`:''}</strong><small>${pEsc(position.contribution.verificationStatus)}</small></div></article>`).join(''):'<div class="empty-view"><h2>No positions yet</h2><p>Open an opportunity and select Participate.</p></div>'}</div></section>`;document.querySelector('#positions-market')?.addEventListener('click',renderV10Marketplace)}catch(err){root.innerHTML=`<div class="empty-view"><h2>Sign in required</h2><p>${pEsc(err.message)}</p></div>`}}
async function openOpportunity(id){if(!window.accessState?.session){document.querySelector('#access-signup')?.click();return}const response=await fetch(`/api/participation/opportunities/${encodeURIComponent(id)}`);const payload=await response.json();if(response.ok){participationState.selected=payload.opportunity;renderOpportunity()}}
async function initializeParticipation(){try{const [opportunities,configuration]=await Promise.all([fetch('/api/participation/opportunities'),fetch('/api/participation/configuration')]);participationState.opportunities=(await opportunities.json()).opportunities||[];participationState.configuration=await configuration.json()}catch{}const marketplace=document.querySelector('[data-view="marketplace"]');if(marketplace){const clone=marketplace.cloneNode(true);marketplace.replaceWith(clone);clone.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(item=>item.classList.remove('active'));clone.classList.add('active');renderV10Marketplace()})}const nav=document.querySelector('.nav-list');if(nav&&!document.querySelector('[data-view="positions"]')){const button=document.createElement('button');button.className='nav-item';button.dataset.view='positions';button.innerHTML='<span>◈</span> My Positions';button.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(item=>item.classList.remove('active'));button.classList.add('active');renderMyPositions()});nav.insertBefore(button,document.querySelector('[data-view="verified"]'))}if(document.querySelector('.nav-item[data-view="marketplace"]')?.classList.contains('active'))renderV10Marketplace()}
window.addEventListener('DOMContentLoaded',()=>setTimeout(initializeParticipation,140));
