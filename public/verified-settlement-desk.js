(() => {
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  async function request(path, options = {}) {
    const response = await fetch(path, { headers: { accept:'application/json','content-type':'application/json',...(options.headers||{}) }, credentials:'same-origin', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
    return payload;
  }
  function style() {
    if (document.querySelector('#verified-settlement-style')) return;
    const node = document.createElement('style'); node.id='verified-settlement-style';
    node.textContent='.verified-settlement{padding:20px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.025)}.verified-settlement-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.verified-settlement input,.verified-settlement select{width:100%;box-sizing:border-box;padding:10px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#101010;color:#fff}.verified-settlement-card{padding:13px;border-radius:12px;background:rgba(255,255,255,.04);margin-top:10px}.verified-settlement-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}@media(max-width:800px){.verified-settlement-grid{grid-template-columns:1fr}}';
    document.head.append(node);
  }
  async function render(section) {
    section.innerHTML='<div class="loading-state">Loading verified settlement controls…</div>';
    try {
      const response = await request('/api/funding-marketplace-settlement/authorizations');
      const records = (response.records||[]).filter((r)=>['AWAITING_CONFIRMATION','CONFIRMATION_RECEIVED','CONFIRMED'].includes(r.status));
      section.innerHTML=`<div class="funding-panel-head"><div><p class="eyebrow">PHASE 3 · VERIFIED SETTLEMENT</p><h3>Settlement confirmation and ownership gate</h3><p>Ownership cannot be recognized until a trusted confirmation matches the authorized amount, currency, source, and destination.</p></div><button class="secondary-button" id="vs-refresh">Refresh</button></div>${records.length?records.map((r)=>`<div class="verified-settlement-card" data-auth="${esc(r.settlementAuthorizationId)}"><strong>${esc(r.settlementAuthorizationId)}</strong><p>${esc(r.status)} · ${esc(r.amount)} ${esc(r.currency)} · Position ${esc(r.positionId)}</p>${r.status==='AWAITING_CONFIRMATION'?`<div class="verified-settlement-grid"><input data-field="ledgerEntryId" placeholder="Trusted ledger entry ID"><input data-field="providerReference" placeholder="Settlement reference"><input data-field="networkReference" placeholder="Network or ledger reference"><input data-field="confirmedAt" type="datetime-local"><input data-field="paymentSourceReference" value="${esc(r.paymentSourceReference||'')}" placeholder="Payment source"><input data-field="destinationReference" value="${esc(r.destinationReference||'')}" placeholder="Destination"></div><div class="verified-settlement-actions"><button class="primary-button" data-action="register">Register internal confirmation</button></div>`:''}${r.status==='CONFIRMATION_RECEIVED'?`<div class="verified-settlement-actions"><button class="primary-button" data-action="verify">Verify confirmation</button></div>`:''}${r.status==='CONFIRMED'?`<div class="verified-settlement-actions"><button class="primary-button" data-action="settle">Recognize ownership</button></div>`:''}<div data-result></div></div>`).join(''):'<div class="verified-settlement-card">No settlement authorizations are waiting for confirmation.</div>'}`;
      section.querySelector('#vs-refresh')?.addEventListener('click',()=>render(section));
      section.querySelectorAll('[data-auth]').forEach((card)=>{
        const authorizationId=card.dataset.auth, result=card.querySelector('[data-result]');
        card.querySelector('[data-action="register"]')?.addEventListener('click',async()=>{
          try {
            const field=(name)=>card.querySelector(`[data-field="${name}"]`)?.value||'';
            const auth=records.find((item)=>item.settlementAuthorizationId===authorizationId);
            await request(`/api/funding-marketplace-settlement/authorizations/${encodeURIComponent(authorizationId)}/confirmations/internal-ledger`,{method:'POST',body:JSON.stringify({ledgerEntryId:field('ledgerEntryId'),providerId:'SRA_INTERNAL_LEDGER',providerReference:field('providerReference'),networkReference:field('networkReference'),amount:auth.amount,currency:auth.currency,paymentSourceReference:field('paymentSourceReference'),destinationReference:field('destinationReference'),providerStatus:'SETTLED',confirmedAt:new Date(field('confirmedAt')).toISOString()})});
            result.textContent='Settlement confirmation registered.'; setTimeout(()=>render(section),400);
          } catch(error){result.textContent=error.message;}
        });
        card.querySelector('[data-action="verify"]')?.addEventListener('click',async()=>{
          try { const confirmations=await request(`/api/funding-marketplace-settlement/confirmations?authorizationId=${encodeURIComponent(authorizationId)}&status=RECEIVED`); const confirmation=confirmations.records?.[0]; if(!confirmation)throw new Error('Received confirmation was not found.'); await request(`/api/funding-marketplace-settlement/confirmations/${encodeURIComponent(confirmation.settlementConfirmationId)}/verify`,{method:'POST',body:'{}'}); result.textContent='Settlement confirmation verified.'; setTimeout(()=>render(section),400); } catch(error){result.textContent=error.message;}
        });
        card.querySelector('[data-action="settle"]')?.addEventListener('click',async()=>{
          try { await request(`/api/funding-marketplace-settlement/authorizations/${encodeURIComponent(authorizationId)}/settle`,{method:'POST',body:'{}'}); result.textContent='Ownership recognized from verified settlement.'; setTimeout(()=>render(section),400); } catch(error){result.textContent=error.message;}
        });
      });
    } catch(error){section.innerHTML=`<strong>Verified Settlement Desk could not load.</strong><p>${esc(error.message)}</p>`;}
  }
  function mount(){const root=document.querySelector('#view-root .funding-ops');if(!root||root.querySelector('#verified-settlement-desk'))return;const section=document.createElement('section');section.id='verified-settlement-desk';section.className='verified-settlement';root.append(section);render(section);}
  style(); new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true}); window.addEventListener('DOMContentLoaded',mount);
})();
