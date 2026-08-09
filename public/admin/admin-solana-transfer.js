(()=>{
  if(window.__sraAdminOnChainTransferInstalled)return;
  window.__sraAdminOnChainTransferInstalled=true;

  const mounted=new WeakSet();
  const operationId=()=>`OCT-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  async function req(url,o={}){
    const r=await fetch(url,{
      credentials:'same-origin',
      cache:'no-store',
      headers:{Accept:'application/json',...(o.headers||{})},
      ...o,
    });
    const p=await r.json().catch(()=>({}));
    if(!r.ok){
      const e=new Error(p.error||`HTTP ${r.status}`);
      e.transactionId=p.transactionId||null;
      throw e;
    }
    return p;
  }

  function networkOptions(status){
    return (status.networks||[])
      .map(({network})=>`<option value="${esc(network)}">${esc(network)}</option>`)
      .join('');
  }

  function clearOwnedCards(controls){
    controls?.querySelectorAll('[data-on-chain-transfer],[data-settlement-rail-connection]').forEach(node=>node.remove());
  }

  function railMarkup(rail,status){
    const normalized=rail==='FedWire'?'FEDWIRE':'ACH';
    const item=(status.rails||[]).find(candidate=>String(candidate.rail||'').toUpperCase()===normalized)||{};
    const label=normalized==='FEDWIRE'?'FedWire':'ACH';
    return `<section class="admin-record-card" data-settlement-rail-connection>
      <header><strong>${label} Connection</strong><em>${item.ready?'LIVE READY':'NOT READY'}</em></header>
      <div class="admin-record-grid">
        <div><span>Execution class</span><strong>PROVIDER SETTLEMENT RAIL</strong></div>
        <div><span>Execution mode</span><strong>${esc(item.mode||'DISABLED')}</strong></div>
        <div><span>Provider endpoint</span><strong>${item.endpointConfigured?'CONFIGURED':'NOT CONFIGURED'}</strong></div>
        <div><span>Credential</span><strong>${item.credentialConfigured?'CONFIGURED':'NOT CONFIGURED'}</strong></div>
        <div><span>Source account</span><strong>${item.accountConfigured?'CONFIGURED':'OPTIONAL / NOT CONFIGURED'}</strong></div>
        <div><span>Automatic push</span><strong>NO</strong></div>
      </div>
      <p style="color:#9a9a9a;margin:14px 0 0;line-height:1.5">Operation flow: authorized payment instruction → submit to configured ${label} provider → provider reference/status → receiving confirmation → reconcile and record. This rail is separate from direct blockchain execution.</p>
    </section>`;
  }

  async function render(workspace){
    if(!workspace)return;
    const controls=workspace.querySelector('.admin-workspace-controls');
    if(!controls)return;
    clearOwnedCards(controls);

    const tab=workspace.dataset.activeTab;
    if(tab==='ACH'||tab==='FedWire'){
      try{
        const status=await req('/api/admin/treasury-transfer-readiness/execution/status');
        if(!controls.isConnected||workspace.dataset.activeTab!==tab)return;
        controls.insertAdjacentHTML('afterbegin',railMarkup(tab,status));
      }catch(error){
        if(!controls.isConnected||workspace.dataset.activeTab!==tab)return;
        controls.insertAdjacentHTML('afterbegin',`<section class="admin-record-card" data-settlement-rail-connection><header><strong>${esc(tab)} Connection</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p></section>`);
      }
      return;
    }

    if(tab!=='Solana')return;
    try{
      const status=await req('/api/on-chain/status');
      if(!controls.isConnected||workspace.dataset.activeTab!=='Solana')return;
      controls.insertAdjacentHTML('afterbegin',`
        <section class="admin-record-card" data-on-chain-transfer>
          <header><strong>On-Chain Transfer</strong><em>Asset → Network</em></header>
          <form data-send-on-chain>
            <select name="network" required>${networkOptions(status)}</select>
            <input name="asset" required placeholder="Asset">
            <input name="amount" required inputmode="decimal" placeholder="Amount">
            <input name="destinationAddress" required placeholder="Destination address">
            <button>Send On Chain</button>
            <span data-result></span>
          </form>
          <p style="color:#9a9a9a;margin:14px 0 0;line-height:1.5">Operation flow: asset + amount + destination + network → build → sign → broadcast → transaction ID → confirm → record. Nothing is automatically pushed on-chain by this screen.</p>
        </section>`);
    }catch(error){
      if(!controls.isConnected||workspace.dataset.activeTab!=='Solana')return;
      controls.insertAdjacentHTML('afterbegin',`
        <section class="admin-record-card" data-on-chain-transfer>
          <strong>On-Chain Transfer</strong><p>${esc(error.message)}</p>
        </section>`);
    }
  }

  async function send(form){
    const values=Object.fromEntries(new FormData(form).entries());
    const button=form.querySelector('button');
    const result=form.querySelector('[data-result]');
    form.dataset.transferId||=operationId();
    button.disabled=true;
    result.textContent='Submitting…';

    try{
      const out=await req('/api/on-chain/transfers',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          transferId:form.dataset.transferId,
          network:values.network,
          asset:values.asset,
          amount:values.amount,
          destinationAddress:values.destinationAddress,
        }),
      });
      result.textContent=`${out.state} · ${out.transactionId}`;
      if(out.state==='CONFIRMED')delete form.dataset.transferId;
    }catch(error){
      result.textContent=error.transactionId
        ? `SUBMITTED · ${error.transactionId}`
        : error.message;
    }finally{
      button.disabled=false;
    }
  }

  function mount(workspace){
    if(!workspace||mounted.has(workspace))return;
    mounted.add(workspace);
    workspace.addEventListener('click',event=>{
      if(!event.target.closest('[data-admin-tab]'))return;
      queueMicrotask(()=>void render(workspace));
    });
    workspace.addEventListener('submit',event=>{
      const form=event.target.closest('[data-send-on-chain]');
      if(!form)return;
      event.preventDefault();
      void send(form);
    });
    window.addEventListener('sra:admin-workspace-synchronized',event=>{
      if(event.detail?.workspaceId==='connections')void render(workspace);
    });
    void render(workspace);
  }

  window.mountAdminSolanaTransfer=admin=>mount(admin?.querySelector('[data-workspace="connections"]'));
})();
