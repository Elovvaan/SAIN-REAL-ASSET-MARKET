const accessState={session:null,publicData:null,mode:'signin',capacityMessage:null};
window.accessState=accessState;
const accessEscape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const accessMoney=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});

const TIER_WORKSPACES={
  UNIVERSAL:{label:'Universal',title:'Universal Home',intro:'Browse, participate, and track positions from your free Universal Account.',nav:['marketplace','positions','activity'],actions:[['Browse opportunities','Open the marketplace and compare productive opportunities.','marketplace'],['My Positions','Track active, pending, and settled positions.','positions'],['Add Capability','Expand into Asset Provider or Market Professional tools.','capabilities']]},
  ASSET_PROVIDER:{label:'Asset Provider',title:'Provider Home',intro:'Bring productive assets into SRA and move them through V4V, projects, and marketplace publishing.',nav:['onboarding','assets','verified','projects','instruments','completion'],actions:[['Start V4V','Present a productive asset and private evidence.','onboarding'],['My Asset Accounts','Open permanent asset records connected to this provider.','assets'],['My Projects','Track projects, publishing, and completion activity.','projects']]},
  MARKET_PROFESSIONAL:{label:'Market Professional',title:'Professional Home',intro:'Offer capital, services, equipment, materials, or contract capacity inside the marketplace.',nav:['marketplace','projects','positions','verified','instruments'],actions:[['Open Opportunities','Find professional and capital participation openings.','marketplace'],['My Positions','Track professional participation and settlement positions.','positions'],['Due Diligence','Open authorized Verified Value summaries.','verified']]},
  INSTITUTIONAL_OPERATOR:{label:'Institutional',title:'Institution Home',intro:'Participate in authorized verified Home Projects while SRA retains verification, readiness, settlement orchestration, and closeout.',nav:['institution-participation','marketplace','custody','verified','projects','instruments','completion','participants','activity'],actions:[['Participation Opportunities','Review authorized Home Projects and decide whether to commit institutional capital.','institution-participation'],['Custody & Records','Open custody, settlement, and completed participation records.','custody'],['Institutional Activity','Review institutional lifecycle activity.','activity']]},
  PLATFORM_ADMIN:{label:'Platform Administration',title:'Platform Home',intro:'Manage the SRA platform account, parent-platform connection, treasury, and internal administration.',nav:['marketplace','participants','pools','activity','interoperability'],actions:[['Platform Account','Review the SRA parent-platform connection.','participants'],['Platform Funding','Open internal market pools and funding structures.','pools'],['Cross-Platform Activity','Review platform-level lifecycle and reporting.','activity']]}
};

function accessElements(){return{root:document.querySelector('#view-root'),title:document.querySelector('#page-title'),topActions:document.querySelector('.top-actions')}}
function currentWorkspace(){return TIER_WORKSPACES[accessState.session?.activeCapacity]||TIER_WORKSPACES.UNIVERSAL}
function ensureAccessControls(){const {topActions}=accessElements();if(!topActions||document.querySelector('#access-actions'))return;const holder=document.createElement('div');holder.id='access-actions';holder.className='access-actions';topActions.prepend(holder)}
function renderAccessControls(){
  ensureAccessControls();
  const holder=document.querySelector('#access-actions');
  if(!holder)return;
  if(!accessState.session){
    holder.innerHTML='<button class="secondary-button" id="access-signin">Sign in</button><button class="primary-button" id="access-signup">Create free account</button>';
    document.querySelector('#access-signin')?.addEventListener('click',()=>openAccessModal('signin'));
    document.querySelector('#access-signup')?.addEventListener('click',()=>openAccessModal('signup'));
    return;
  }
  const tiers=accessState.session.capacities.map(item=>`<option value="${accessEscape(item.id)}" ${item.id===accessState.session.activeCapacity?'selected':''}>${accessEscape(TIER_WORKSPACES[item.id]?.label||item.label)}</option>`).join('');
  holder.innerHTML=`<div class="account-control"><span>${accessEscape(accessState.session.displayName)}</span><label class="tier-control"><small>Current workspace</small><select class="role-select" id="tier-select">${tiers}</select></label><button class="secondary-button" id="capabilities-button">Capabilities</button><button class="secondary-button" id="access-signout">Sign out</button></div>`;
  document.querySelector('#tier-select')?.addEventListener('change',event=>switchTier(event.target.value));
  document.querySelector('#capabilities-button')?.addEventListener('click',renderCapabilities);
  document.querySelector('#access-signout')?.addEventListener('click',signout);
}
function ensureAccessModal(){
  if(document.querySelector('#access-modal'))return;
  document.body.insertAdjacentHTML('beforeend',`<div class="access-modal" id="access-modal"><section class="access-card"><div class="access-card-head"><div><p class="eyebrow">SRA UNIVERSAL ACCESS</p><h2 id="access-modal-title">Sign in</h2></div><button class="icon-button" id="access-close">×</button></div><div class="access-tabs"><button id="signin-tab" class="active">Sign in</button><button id="signup-tab">Create free account</button></div><form class="access-form" id="access-form"><label id="display-name-row" class="role-hidden">Display name<input name="displayName" autocomplete="name"></label><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" required></label><div class="access-error" id="access-error"></div><button class="primary-button" type="submit" id="access-submit">Sign in</button></form><p class="projection-note">One identity. One free Universal Account. Add capabilities and switch operating tiers later.</p></section></div>`);
  document.querySelector('#access-close').addEventListener('click',closeAccessModal);
  document.querySelector('#access-modal').addEventListener('click',event=>{if(event.target.id==='access-modal')closeAccessModal()});
  document.querySelector('#signin-tab').addEventListener('click',()=>setAccessMode('signin'));
  document.querySelector('#signup-tab').addEventListener('click',()=>setAccessMode('signup'));
  document.querySelector('#access-form').addEventListener('submit',submitAccessForm);
}
function setAccessMode(mode){accessState.mode=mode;const signup=mode==='signup';document.querySelector('#signin-tab').classList.toggle('active',!signup);document.querySelector('#signup-tab').classList.toggle('active',signup);document.querySelector('#display-name-row').classList.toggle('role-hidden',!signup);document.querySelector('#access-modal-title').textContent=signup?'Create free Universal Account':'Sign in';document.querySelector('#access-submit').textContent=signup?'Create free account':'Sign in';document.querySelector('#access-error').textContent=''}
function openAccessModal(mode='signin'){ensureAccessModal();setAccessMode(mode);document.querySelector('#access-modal').classList.add('open')}
function closeAccessModal(){document.querySelector('#access-modal')?.classList.remove('open')}
async function submitAccessForm(event){event.preventDefault();const form=new FormData(event.currentTarget);const body=Object.fromEntries(form.entries());const error=document.querySelector('#access-error');error.textContent='';try{const response=await fetch(`/api/access/${accessState.mode}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Access request failed.');accessState.session=payload.session;closeAccessModal();applyAccessShell()}catch(err){error.textContent=err.message}}
async function signout(){await fetch('/api/access/signout',{method:'POST'});accessState.session=null;applyAccessShell()}
async function switchTier(tier){const response=await fetch('/api/access/role',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:tier})});const payload=await response.json();if(response.ok){accessState.session=payload.session;applyAccessShell()}}
function flowLabel(value){return String(value||'').replaceAll('_',' ').replace(/\b\w/g,character=>character.toUpperCase())}
function capabilityById(capacity){return accessState.session?.capabilities?.find(item=>item.id===capacity)||null}
async function applyCapacity(capacity){
  accessState.capacityMessage=null;
  const response=await fetch('/api/access/capacity-upgrade/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({capacity})});
  const payload=await response.json().catch(()=>({}));
  if(payload.session)accessState.session=payload.session;
  if(!response.ok)accessState.capacityMessage={type:'error',capacity,text:payload.error||'Capability application could not be prepared.'};
  else accessState.capacityMessage={type:'success',capacity,text:'Application recorded. The current SRA fee schedule has been attached to this upgrade.'};
  renderCapabilities();
}
async function createCapacityPayment(capacity){
  accessState.capacityMessage=null;
  const capability=capabilityById(capacity);
  if(!capability?.invoiceId){accessState.capacityMessage={type:'error',capacity,text:'No fee invoice is attached to this capability yet.'};renderCapabilities();return}
  const response=await fetch('/api/access/funding/fee-instructions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invoiceId:capability.invoiceId,rail:'EXTERNAL_TRANSFER'})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){accessState.capacityMessage={type:'error',capacity,text:payload.error||'Payment instructions could not be created.'};renderCapabilities();return}
  accessState.capacityMessage={type:'success',capacity,text:`Payment instruction ${payload.instruction?.fundingInstructionId||''} created. Complete the external payment using that reference; the tier remains locked until settlement is confirmed.`};
  await refreshCapacityStatus(capacity,false);
}
async function refreshCapacityStatus(capacity,showMessage=true){
  const response=await fetch(`/api/access/capacity-upgrade/status/${encodeURIComponent(capacity)}`);
  const payload=await response.json().catch(()=>({}));
  if(response.ok&&payload.session){accessState.session=payload.session;if(showMessage)accessState.capacityMessage={type:'success',capacity,text:'Capability status refreshed from the authoritative fee and review records.'}}
  else if(showMessage)accessState.capacityMessage={type:'error',capacity,text:payload.error||'Capability status could not be refreshed.'};
  renderCapabilities();
}
function capabilityFlow(capability){
  const steps=Array.isArray(capability.upgradeFlow)?capability.upgradeFlow:[];
  if(!steps.length)return '';
  const activeIndex=capability.state==='ACTIVE'?steps.length-1:capability.state==='UNDER_REVIEW'?Math.max(0,steps.indexOf('REVIEW')):capability.billingState==='PAID'?Math.max(0,steps.indexOf('PAYMENT_SETTLEMENT')):capability.invoiceId?Math.max(0,steps.indexOf('FEE_SCHEDULE')):capability.state==='APPLICATION_STARTED'?0:-1;
  return `<div class="capability-upgrade-flow" style="display:grid;grid-template-columns:repeat(${Math.min(steps.length,5)},minmax(0,1fr));gap:6px;margin-top:12px">${steps.map((step,index)=>`<div style="border:1px solid ${index<=activeIndex?'#8a6d1d':'#303030'};border-radius:8px;padding:8px;min-width:0;opacity:${index<=activeIndex?'1':'.65'}"><small style="display:block;opacity:.65">${index+1}</small><span style="display:block;font-size:11px">${accessEscape(flowLabel(step))}</span></div>`).join('')}</div>`;
}
function capacityMessage(capability){const message=accessState.capacityMessage;if(!message||message.capacity!==capability.id)return '';return `<div style="margin-top:10px;border:1px solid ${message.type==='error'?'#7b3333':'#4f4422'};border-radius:8px;padding:9px 10px;font-size:12px">${accessEscape(message.text)}</div>`}
function feeSummary(capability){
  if(capability.tier!=='PAID')return '';
  if(capability.feeTotal!=null&&capability.invoiceId)return `<div style="margin-top:10px;border:1px solid #303030;border-radius:10px;padding:10px"><small style="display:block;opacity:.65">CURRENT FEE SCHEDULE</small><strong style="display:block;font-size:20px;margin-top:3px">${accessMoney.format(Number(capability.feeTotal||0))}</strong><span style="display:block;font-size:11px;opacity:.72;margin-top:3px">Invoice ${accessEscape(capability.invoiceId)} · ${accessEscape(capability.billingState||'INVOICED')}</span></div>`;
  if(capability.billingState==='FEE_SCHEDULE_UNAVAILABLE')return '<div style="margin-top:10px"><span class="badge">FEE SCHEDULE UNAVAILABLE</span></div>';
  if(capability.billingState==='FEE_RULE_REQUIRED')return '<div style="margin-top:10px"><span class="badge">ACTIVE FEE RULE REQUIRED</span></div>';
  return '';
}
function capabilityAction(capability){
  if(capability.state==='ACTIVE')return '<span class="badge open">ACTIVE</span>';
  if(!capability.selfService)return `<span class="badge">${accessEscape(flowLabel(capability.activation))}</span>`;
  if(capability.state==='NOT_ADDED')return `<button class="secondary-button" data-apply-capacity="${capability.id}">Start application</button>`;
  if(capability.state==='APPLICATION_STARTED'&&!capability.invoiceId)return `<button class="secondary-button" data-apply-capacity="${capability.id}">Load fee schedule</button>`;
  if(capability.state==='INFORMATION_REQUIRED'&&capability.invoiceId&&capability.billingState!=='PAID')return `<button class="primary-button" data-pay-capacity="${capability.id}">Create payment instructions · ${accessEscape(accessMoney.format(Number(capability.feeTotal||0)))}</button><button class="secondary-button" style="margin-left:6px" data-refresh-capacity="${capability.id}">Refresh payment status</button>`;
  if(capability.state==='UNDER_REVIEW')return `<span class="badge">PAYMENT CONFIRMED · REVIEW PENDING</span><button class="secondary-button" style="margin-left:6px" data-refresh-capacity="${capability.id}">Refresh</button>`;
  return `<span class="badge">${accessEscape(flowLabel(capability.state))}</span><button class="secondary-button" style="margin-left:6px" data-refresh-capacity="${capability.id}">Refresh</button>`;
}
function capabilityCard(cap){
  const paid=cap.tier==='PAID';
  const gate=paid?'The fee amount comes from the currently active SRA fee schedule. The tier remains locked until payment is confirmed and the required review is approved.':cap.tier==='AGREEMENT'?'Activation follows the institutional agreement and approval workflow.':cap.tier==='INTERNAL'?'Activation is controlled by internal platform authorization.':'This capability is active automatically with the Universal Account.';
  return `<article class="participant-action capability-card" style="align-items:stretch"><div style="width:100%"><span class="badge ${cap.tier==='FREE'?'open':''}">${accessEscape(cap.tier)}</span><strong>${accessEscape(cap.label)}</strong><span><b>Fee basis:</b> ${accessEscape(cap.feeBasis)}</span><small>Status: ${accessEscape(flowLabel(cap.state))}</small><small style="display:block;margin-top:6px">${accessEscape(gate)}</small>${feeSummary(cap)}${capabilityFlow(cap)}${capacityMessage(cap)}<div style="margin-top:12px">${capabilityAction(cap)}</div></div></article>`;
}
function renderCapabilities(){
  const {root,title}=accessElements();
  title.textContent='Capabilities';
  const capabilities=accessState.session?.capabilities||[];
  root.innerHTML=`<section class="participant-home"><div class="participant-welcome"><p class="eyebrow">V13 · OPERATING TIER ARCHITECTURE</p><h2>${accessEscape(accessState.session.displayName)}</h2><p>Your Universal Account remains the identity layer. Paid operating tiers become selectable only after the active fee schedule is invoiced, the payment is settled, and review is approved.</p><div class="review-grid"><div class="review-block"><span>Universal Account</span><strong>${accessEscape(accessState.session.universalAccountId)}</strong></div><div class="review-block"><span>Current operating tier</span><strong>${accessEscape(currentWorkspace().label)}</strong></div><div class="review-block"><span>Current account tier</span><strong>${accessEscape(accessState.session.accountTier||'FREE')}</strong></div></div><div class="review-block" style="margin-top:12px"><span>Paid-tier activation rule</span><strong>Application → Fee Schedule → Payment / Settlement → Review → Active</strong></div></div><div class="participant-actions capability-list">${capabilities.map(capabilityCard).join('')}</div></section>`;
  document.querySelectorAll('[data-apply-capacity]').forEach(button=>button.addEventListener('click',()=>applyCapacity(button.dataset.applyCapacity)));
  document.querySelectorAll('[data-pay-capacity]').forEach(button=>button.addEventListener('click',()=>createCapacityPayment(button.dataset.payCapacity)));
  document.querySelectorAll('[data-refresh-capacity]').forEach(button=>button.addEventListener('click',()=>refreshCapacityStatus(button.dataset.refreshCapacity)));
}
function publicOpportunityCard(item){return `<article class="public-opportunity"><div><span class="badge open">${accessEscape(item.stage)}</span><h3>${accessEscape(item.title)}</h3><p>${accessEscape(item.assetName)} · ${accessEscape(item.region)}</p></div><div class="public-opportunity-metrics"><div><span>Verified Value</span><strong>${accessMoney.format(item.verifiedValue)}</strong></div><div><span>Projected gain rate</span><strong class="gain-value">+${item.projectedGainRate}%</strong></div><div><span>Window</span><strong>${accessEscape(item.participationWindow)}</strong></div><div><span>Completion</span><strong>${accessEscape(item.completionState)}</strong></div></div><button class="primary-button public-engage">View opportunity</button></article>`}
function renderPublicShell(){
  const {root,title}=accessElements();
  document.body.classList.add('access-public');
  title.textContent='SAIN Real Assets';
  root.innerHTML=`<section class="public-hero"><div><p class="eyebrow">WHAT ARE YOU TRYING TO ACCOMPLISH?</p><h2>Start with one free Universal Account.</h2><p>Enter through your goal. Browse opportunities, bring an asset, offer professional capacity, or simply explore Verified Value.</p><div class="public-hero-actions"><button class="primary-button" id="public-create">Create free account</button><button class="secondary-button" id="public-signin">Sign in</button></div><div class="goal-grid"><button class="goal-card public-engage"><strong>Participate</strong><span>Put USD or another eligible contribution medium to work.</span></button><button class="goal-card public-engage"><strong>Bring an asset</strong><span>Start with Universal, then add Asset Provider capability.</span></button><button class="goal-card public-engage"><strong>Offer professional capacity</strong><span>Add Market Professional capability when ready.</span></button><button class="goal-card public-engage"><strong>Explore</strong><span>Browse productive opportunities before deciding.</span></button></div></div><div class="public-proof-card"><div><span>Universal Account</span><strong>FREE</strong></div><div><span>Verified market value</span><strong>${accessMoney.format(accessState.publicData?.verifiedValue||0)}</strong></div><div><span>Active projects</span><strong>${accessState.publicData?.activeProjects||0}</strong></div><div><span>Market status</span><strong class="gain-value">${accessEscape(accessState.publicData?.marketStatus||'LIVE')}</strong></div></div></section><section class="public-market"><div class="public-market-header"><div><p class="eyebrow">PUBLIC MARKETPLACE</p><h2>Productive opportunities</h2></div><p class="projection-note">Public summaries only. Private evidence and institutional records are never exposed here.</p></div><div class="public-opportunity-grid">${(accessState.publicData?.opportunities||[]).map(publicOpportunityCard).join('')}</div></section>`;
  document.querySelector('#public-create')?.addEventListener('click',()=>openAccessModal('signup'));
  document.querySelector('#public-signin')?.addEventListener('click',()=>openAccessModal('signin'));
  document.querySelectorAll('.public-engage').forEach(button=>button.addEventListener('click',()=>openAccessModal('signin')));
}
function renderTierHome(){
  const {root,title}=accessElements();
  const workspace=currentWorkspace();
  title.textContent=workspace.title;
  root.innerHTML=`<section class="participant-home"><div class="participant-welcome"><p class="eyebrow">V13 · ${accessEscape(workspace.label.toUpperCase())} WORKSPACE</p><h2>Welcome, ${accessEscape(accessState.session.displayName)}</h2><p>${accessEscape(workspace.intro)}</p><div class="review-grid"><div class="review-block"><span>Identity</span><strong>${accessEscape(accessState.session.displayName)}</strong></div><div class="review-block"><span>Operating tier</span><strong>${accessEscape(workspace.label)}</strong></div><div class="review-block"><span>Universal account</span><strong>${accessEscape(accessState.session.universalAccountId)}</strong></div></div></div><div class="participant-actions">${workspace.actions.map(([name,description,view])=>`<button class="participant-action" data-participant-view="${view}"><strong>${accessEscape(name)}</strong><span>${accessEscape(description)}</span></button>`).join('')}</div></section>`;
  document.querySelectorAll('[data-participant-view]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.participantView==='capabilities')renderCapabilities();else activateParticipantView(button.dataset.participantView)}));
}
function activateParticipantView(view){const button=document.querySelector(`.nav-item[data-view="${view}"]`);if(button){document.querySelectorAll('.nav-item').forEach(item=>item.classList.remove('active'));button.classList.add('active');button.click()}}
function configureNavigation(){const workspace=accessState.session?currentWorkspace():null;document.querySelectorAll('.nav-item').forEach(item=>{const visible=!workspace||workspace.nav.includes(item.dataset.view);item.classList.toggle('role-hidden',!visible)});document.querySelector('.system-card')?.classList.toggle('role-hidden',Boolean(accessState.session)&&!['INSTITUTIONAL_OPERATOR','PLATFORM_ADMIN'].includes(accessState.session.activeCapacity))}
function updateSaneContext(){const workspace=currentWorkspace();const context=document.querySelector('.chat-context');if(context)context.textContent=`Sane is operating in the ${workspace.label} tier and will interpret requests through this workspace.`}
function applyAccessShell(){renderAccessControls();configureNavigation();if(!accessState.session){renderPublicShell();return}document.body.classList.remove('access-public');updateSaneContext();renderTierHome()}
let accessInitialization=null;
async function initializeAccess(){
  if(accessInitialization)return accessInitialization;
  accessInitialization=(async()=>{
    ensureAccessModal();ensureAccessControls();
    try{
      const sessionResponse=await fetch('/api/access/session');
      const sessionPayload=await sessionResponse.json();
      accessState.session=sessionPayload.session;
      if(accessState.session)accessState.publicData={opportunities:[]};
      else{const publicResponse=await fetch('/api/access/public');accessState.publicData=await publicResponse.json()}
    }catch{accessState.session=null;accessState.publicData={opportunities:[]}}
    applyAccessShell();
    window.SRAPublicHome?.refreshNow?.();
    document.body.classList.remove('sra-access-resolving');
    window.dispatchEvent(new CustomEvent('sra:public-access-ready',{detail:{signedIn:Boolean(accessState.session)}}));
    return accessState;
  })();
  return accessInitialization;
}
window.initializeAccess=initializeAccess;
