const capacityCopy={
  UNIVERSAL:{label:'Universal Account',description:'Browse the marketplace, fund eligible positions, track activity, and use Sane.',actions:[['Marketplace','Browse compact productive opportunities.','marketplace'],['My Positions','Track active and settled participation positions.','positions'],['Account Capacities','Add asset-provider or professional capabilities.','account-capacities']]},
  ASSET_PROVIDER:{label:'Asset Provider',description:'Bring productive assets through V4V, manage Asset Accounts, and create projects.',actions:[['Start V4V','Present a productive asset and private evidence.','onboarding'],['My Asset Accounts','Open assets controlled by this identity.','assets'],['My Projects','Track projects, Verified Value, and completion.','projects']]},
  MARKET_PROFESSIONAL:{label:'Market Professional',description:'Offer capital, services, materials, equipment, or contract capacity.',actions:[['Marketplace','Find opportunities requiring your capacity.','marketplace'],['My Positions','Track commitments, deployment, and settlement.','positions'],['Projects','Review active work and milestones.','projects']]},
  INSTITUTIONAL_OPERATOR:{label:'Institutional Operator',description:'Operate V4V review, custody, Verified Value, settlement, setoff, and discharge.',actions:[]},
  PLATFORM_ADMIN:{label:'Platform Administration',description:'Operate SRA through SAIN, inspect live platform records, prepare changes, and approve state-changing actions.',actions:[]}
};

async function activateCapacity(capacity){
  const response=await fetch('/api/access/capacity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({capacity})});
  const payload=await response.json();
  if(response.ok){accessState.session=payload.session;applyAccessShell()}
}

function renderCapacityManager(){
  const root=document.querySelector('#view-root');
  document.querySelector('#page-title').textContent='Account Capacities';
  const owned=new Set(accessState.session.capacities.map(item=>item.id));
  root.innerHTML=`<section class="participant-home"><div class="participant-welcome"><p class="eyebrow">UNIVERSAL IDENTITY</p><h2>${accessEscape(accessState.session.displayName)}</h2><p>Universal Account ${accessEscape(accessState.session.universalAccountId)} is the permanent identity. Specialized capacities add tools without creating another login.</p></div><div class="participant-actions">
    <article class="participant-action capacity-owned"><strong>Universal Account</strong><span>Marketplace access, balances, positions, watchlist, activity, and Sane.</span><small>ACTIVE</small></article>
    <button class="participant-action" data-add-capacity="ASSET_PROVIDER"><strong>Asset Provider</strong><span>Start V4V, manage productive assets, create projects, and publish opportunities.</span><small>${owned.has('ASSET_PROVIDER')?'ACTIVE':'ADD CAPACITY'}</small></button>
    <button class="participant-action" data-add-capacity="MARKET_PROFESSIONAL"><strong>Market Professional</strong><span>Offer capital, services, materials, equipment, and contract capacity.</span><small>${owned.has('MARKET_PROFESSIONAL')?'ACTIVE':'ADD CAPACITY'}</small></button>
  </div></section>`;
  document.querySelectorAll('[data-add-capacity]').forEach(button=>button.addEventListener('click',()=>owned.has(button.dataset.addCapacity)?switchRole(button.dataset.addCapacity):activateCapacity(button.dataset.addCapacity)));
}

function renderPlatformAccount(){
  if(typeof window.renderPlatformAdminWorkspace==='function'){
    window.renderPlatformAdminWorkspace();
    return;
  }
  document.querySelector('#page-title').textContent='Platform Administration';
  document.querySelector('#view-root').innerHTML='<div class="loading-state">Loading SAIN Platform Administration…</div>';
}

function participantActions(capacity){return capacityCopy[capacity]?.actions||capacityCopy.UNIVERSAL.actions}
function renderParticipantHome(){
  const {root,title}=accessElements();
  const capacity=accessState.session.activeCapacity||accessState.session.activeRole;
  const copy=capacityCopy[capacity]||capacityCopy.UNIVERSAL;
  title.textContent=copy.label;
  root.innerHTML=`<section class="participant-home"><div class="participant-welcome"><p class="eyebrow">${accessEscape(copy.label.toUpperCase())}</p><h2>Welcome, ${accessEscape(accessState.session.displayName)}</h2><p>${accessEscape(copy.description)}</p><small>Universal ID: ${accessEscape(accessState.session.universalAccountId)}</small></div><div class="participant-actions">${participantActions(capacity).map(([name,description,view])=>`<button class="participant-action" data-participant-view="${view}"><strong>${accessEscape(name)}</strong><span>${accessEscape(description)}</span></button>`).join('')}</div></section>`;
  document.querySelectorAll('[data-participant-view]').forEach(button=>button.addEventListener('click',()=>button.dataset.participantView==='account-capacities'?renderCapacityManager():activateParticipantView(button.dataset.participantView)));
}

function configureNavigation(){
  const capacity=accessState.session?.activeCapacity||accessState.session?.activeRole;
  const institutional=['INSTITUTIONAL_OPERATOR','PLATFORM_ADMIN'].includes(capacity);
  const universal=capacity==='UNIVERSAL';
  const assetProvider=capacity==='ASSET_PROVIDER';
  const professional=capacity==='MARKET_PROFESSIONAL';
  document.querySelectorAll('.nav-item').forEach(item=>{
    const view=item.dataset.view;
    let visible=true;
    if(universal) visible=['marketplace','positions'].includes(view);
    if(assetProvider) visible=['marketplace','onboarding','assets','verified','projects','instruments','completion','positions'].includes(view);
    if(professional) visible=['marketplace','projects','verified','positions'].includes(view);
    if(institutional) visible=true;
    item.classList.toggle('role-hidden',!visible);
  });
  document.querySelector('.system-card')?.classList.toggle('role-hidden',!institutional);
}

function applyAccessShell(){
  renderAccessControls();configureNavigation();
  if(!accessState.session){renderPublicShell();return}
  document.body.classList.remove('access-public');
  const capacity=accessState.session.activeCapacity||accessState.session.activeRole;
  if(capacity==='INSTITUTIONAL_OPERATOR'){document.querySelector('#page-title').textContent='Institutional Operations';document.querySelector('.nav-item[data-view="marketplace"]')?.click();return}
  if(capacity==='PLATFORM_ADMIN'){renderPlatformAccount();return}
  renderParticipantHome();
}
