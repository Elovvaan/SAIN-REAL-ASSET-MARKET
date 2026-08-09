(()=>{
  if(window.__sraAdminOnChainTransferInstalled)return;
  window.__sraAdminOnChainTransferInstalled=true;

  const mounted=new WeakSet();
  const operationId=()=>`OCT-${crypto.randomUUID().split('-')[0].toUpperCase()}`;

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
      .map(({network})=>`<option value="${network}">${network}</option>`)
      .join('');
  }

  async function render(workspace){
    if(!workspace)return;
    const controls=workspace.querySelector('.admin-workspace-controls');
    if(!controls)return;
    controls.querySelectorAll('[data-on-chain-transfer]').forEach(node=>node.remove());

    try{
      const status=await req('/api/on-chain/status');
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
        </section>`);
    }catch(error){
      controls.insertAdjacentHTML('afterbegin',`
        <section class="admin-record-card" data-on-chain-transfer>
          <strong>On-Chain Transfer</strong><p>${error.message}</p>
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
