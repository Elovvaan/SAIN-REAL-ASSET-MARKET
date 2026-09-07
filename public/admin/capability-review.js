(() => {
  const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const money=value=>Number(value||0).toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
  let mounted=false;
  let loading=false;

  async function json(url,options={}){
    if(window.SRAAdminDataClient)return window.SRAAdminDataClient.json(url,options);
    const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||'Request failed.');
    return payload;
  }
  function target(){return document.querySelector('[data-workspace="users"] .admin-workspace-controls')}
  function card(item){
    const instruction=item.paymentInstruction;
    const invoice=item.invoice;
    const canConfirm=instruction&&instruction.state!=='CONFIRMED'&&invoice?.state!=='PAID';
    const canReview=invoice?.state==='PAID'&&item.state==='UNDER_REVIEW';
    return `<article class="admin-record-card" data-capability-review="${esc(item.participantId)}:${esc(item.capacity)}"><header><strong>${esc(item.displayName)} · ${esc(item.label)}</strong><em>${esc(item.state)}</em></header><div class="admin-record-grid"><div><span>Account</span><strong>${esc(item.universalAccountId)}</strong></div><div><span>Email</span><strong>${esc(item.email)}</strong></div><div><span>Invoice</span><strong>${esc(invoice?.invoiceId||'Not created')}</strong></div><div><span>Fee</span><strong>${invoice?money(invoice.total):'—'}</strong></div><div><span>Billing</span><strong>${esc(invoice?.state||item.billingState||'PENDING')}</strong></div><div><span>Review</span><strong>${esc(item.reviewState||'NOT STARTED')}</strong></div></div>${instruction?`<div style="margin-top:12px;border-top:1px solid #292929;padding-top:12px"><small style="display:block;color:#9a9a9a">PAYMENT INSTRUCTION</small><strong>${esc(instruction.fundingInstructionId)}</strong><span style="display:block;color:#9a9a9a;font-size:12px">${esc(instruction.state)} · ${esc(instruction.rail||'')}</span></div>`:''}${canConfirm?`<div style="display:flex;gap:8px;margin-top:12px"><input data-payment-reference placeholder="External settlement reference" style="flex:1;background:#050505;border:1px solid #292929;color:#f5f5f5;border-radius:8px;padding:9px"><button type="button" data-confirm-fee="${esc(instruction.fundingInstructionId)}">Confirm payment</button></div>`:''}${canReview?`<div style="margin-top:12px"><textarea data-review-notes rows="2" placeholder="Review notes" style="width:100%;background:#050505;border:1px solid #292929;color:#f5f5f5;border-radius:8px;padding:9px;resize:vertical"></textarea><div style="display:flex;gap:8px;margin-top:8px"><button type="button" data-review-decision="APPROVE" data-participant="${esc(item.participantId)}" data-capacity="${esc(item.capacity)}">Approve capability</button><button type="button" data-review-decision="RETURN" data-participant="${esc(item.participantId)}" data-capacity="${esc(item.capacity)}">Return for information</button></div></div>`:''}</article>`;
  }
  async function render(){
    const node=target();if(!node||loading)return;
    loading=true;
    if(!mounted){node.insertAdjacentHTML('afterbegin','<section data-capability-review-panel><div class="admin-section-label">PAID CAPABILITY REVIEW</div><div data-capability-review-body><div class="admin-placeholder">Loading paid capability applications…</div></div></section>');mounted=true}
    const body=node.querySelector('[data-capability-review-body]');
    try{
      const data=await json('/api/access/capacity-upgrade/admin-queue');
      const items=Array.isArray(data.applications)?data.applications:[];
      body.innerHTML=items.length?`<div class="admin-record-list">${items.map(card).join('')}</div>`:'<div class="admin-placeholder">No paid capability applications are awaiting payment or review.</div>';
    }catch(error){body.innerHTML=`<div class="admin-placeholder"><strong>Unable to load capability review.</strong><br>${esc(error.message)}</div>`}
    loading=false;
  }
  async function confirm(button){
    const cardNode=button.closest('[data-capability-review]');
    const reference=cardNode?.querySelector('[data-payment-reference]')?.value?.trim();
    if(!reference){window.alert('Enter the external settlement reference first.');return}
    button.disabled=true;
    try{await json('/api/access/capacity-upgrade/admin-confirm-payment',{method:'POST',body:JSON.stringify({fundingInstructionId:button.dataset.confirmFee,externalReference:reference})});await render()}
    catch(error){window.alert(error.message)}finally{button.disabled=false}
  }
  async function review(button){
    const cardNode=button.closest('[data-capability-review]');
    const notes=cardNode?.querySelector('[data-review-notes]')?.value?.trim()||'';
    button.disabled=true;
    try{await json('/api/access/capacity-upgrade/admin-review',{method:'POST',body:JSON.stringify({participantId:button.dataset.participant,capacity:button.dataset.capacity,decision:button.dataset.reviewDecision,notes})});await render()}
    catch(error){window.alert(error.message)}finally{button.disabled=false}
  }
  document.addEventListener('click',event=>{
    const confirmButton=event.target.closest('[data-confirm-fee]');if(confirmButton){void confirm(confirmButton);return}
    const reviewButton=event.target.closest('[data-review-decision]');if(reviewButton){void review(reviewButton);return}
    const usersButton=event.target.closest('[data-admin-workspace="users"],[data-open-workspace="users"]');if(usersButton)setTimeout(()=>void render(),0);
  });
  window.addEventListener('sra:admin-visible',()=>setTimeout(()=>void render(),100));
  const observer=new MutationObserver(()=>{if(target())void render()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>observer.observe(document.body,{childList:true,subtree:true}),{once:true});else observer.observe(document.body,{childList:true,subtree:true});
})();
