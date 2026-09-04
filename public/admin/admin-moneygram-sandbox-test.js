(() => {
  if (window.__sraAdminMoneyGramSandboxTestInstalled) return;
  window.__sraAdminMoneyGramSandboxTestInstalled = true;

  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const api = async (url, options = {}) => {
    if (window.SRAAdminDataClient) return window.SRAAdminDataClient.json(url, options);
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error||`Request failed with ${response.status}.`);
    return payload;
  };
  const label = (value) => ({CASH_OUT:'Cash-out',CASH_OUT_REFUND:'Cash-out refund',CASH_IN:'Cash-in'}[value] || value);

  function recordsMarkup(tests=[]) {
    if(!tests.length) return '<p style="color:#9a9a9a;margin:0">No MoneyGram sandbox tests are recorded yet.</p>';
    return tests.map((item)=>`<article class="admin-record-card" style="margin-top:10px;padding:14px">
      <header><strong>${esc(label(item.testType))} · ${esc(item.amount)} USDC</strong><em>${esc(String(item.anchorStatus||'started').toUpperCase())}</em></header>
      <div class="admin-record-grid">
        <div><span>MoneyGram transaction ID</span><strong>${esc(item.transactionId||'Pending')}</strong></div>
        <div><span>Stellar transaction</span><strong>${esc(item.evidence?.stellarTransactionId||'Pending')}</strong></div>
        <div><span>External reference</span><strong>${esc(item.evidence?.externalTransactionId||'Pending')}</strong></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        ${item.interactiveUrl?`<a href="${esc(item.interactiveUrl)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;padding:10px 14px;border:1px solid #333;border-radius:10px;color:#fff;text-decoration:none">Open MoneyGram Test</a>`:''}
        <button type="button" data-mg-refresh="${esc(item.certificationTestId)}">Refresh Status</button>
      </div>
    </article>`).join('');
  }

  function mount(workspace=document.querySelector('[data-workspace="settlement"]')) {
    if(!workspace||workspace.querySelector('[data-moneygram-sandbox-test]')) return;
    const card=document.createElement('section');
    card.className='admin-record-card';
    card.dataset.moneygramSandboxTest='true';
    card.innerHTML=`
      <header><strong>MoneyGram Ramps Sandbox Certification</strong><em>SANDBOX · TESTNET</em></header>
      <p style="color:#9a9a9a;margin:0 0 14px;line-height:1.5">Run and document the three MoneyGram certification scenarios here. This workstation is isolated from production instruments and uses Stellar Testnet assets with no monetary value.</p>
      <div class="admin-record-grid">
        <div><span>SEP-24 anchor</span><strong data-mg-anchor>Checking…</strong></div>
        <div><span>Authentication</span><strong data-mg-auth>Checking…</strong></div>
        <div><span>Funding account</span><strong data-mg-funds>Checking…</strong></div>
        <div><span>Certification progress</span><strong data-mg-progress>0 / 3</strong></div>
      </div>
      <div style="display:grid;grid-template-columns:minmax(160px,240px) 1fr;gap:12px;align-items:end;margin-top:14px">
        <label><span style="display:block;color:#999;font-size:11px;text-transform:uppercase;margin-bottom:6px">Test amount (USDC)</span><input data-mg-amount type="number" min="0.01" step="0.01" value="25" style="width:100%;box-sizing:border-box;background:#050505;border:1px solid #292929;border-radius:10px;color:#fff;padding:12px"></label>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" data-mg-start="CASH_OUT">Start Cash-out</button><button type="button" data-mg-start="CASH_OUT_REFUND">Start Refund Test</button><button type="button" data-mg-start="CASH_IN">Start Cash-in</button><a href="/api/settlement-rails/stellar-usdc/sep24/sandbox-tests-evidence" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;padding:10px 14px;border:1px solid #333;border-radius:10px;color:#fff;text-decoration:none">Export Evidence</a></div>
      </div>
      <p data-mg-message style="color:#d6a92f;font-size:12px;margin:12px 0"></p>
      <div data-mg-records></div>`;
    const treasuryPrime=workspace.querySelector('[data-treasury-prime-connection-test]');
    if(treasuryPrime) treasuryPrime.insertAdjacentElement('afterend',card); else workspace.prepend(card);
    const records=card.querySelector('[data-mg-records]');
    const message=card.querySelector('[data-mg-message]');

    const render=async()=>{
      try{
        const payload=await api('/api/settlement-rails/stellar-usdc/sep24/sandbox-tests');
        card.querySelector('[data-mg-anchor]').textContent=payload.anchorDomain||'Not configured';
        card.querySelector('[data-mg-auth]').textContent=payload.authAccount?`${payload.authAccount.slice(0,8)}…${payload.authAccount.slice(-6)}`:'Not configured';
        card.querySelector('[data-mg-funds]').textContent=payload.fundsAccount?`${payload.fundsAccount.slice(0,8)}…${payload.fundsAccount.slice(-6)}`:'Not configured';
        card.querySelector('[data-mg-progress]').textContent=`${(payload.completedTests||[]).length} / 3`;
        records.innerHTML=recordsMarkup(payload.tests||[]);
        for(const button of records.querySelectorAll('[data-mg-refresh]')) button.addEventListener('click',async()=>{
          button.disabled=true; message.textContent='Refreshing MoneyGram sandbox status…';
          try{await api(`/api/settlement-rails/stellar-usdc/sep24/sandbox-tests/${encodeURIComponent(button.dataset.mgRefresh)}/refresh`,{method:'POST'});message.textContent='Status and evidence refreshed.';await render();}
          catch(error){message.textContent=error.message;} finally{button.disabled=false;}
        });
        if(!payload.ready) message.textContent='MoneyGram sandbox credentials are not ready.';
      }catch(error){message.textContent=error.message;records.innerHTML='';}
    };

    for(const button of card.querySelectorAll('[data-mg-start]')) button.addEventListener('click',async()=>{
      const amount=card.querySelector('[data-mg-amount]').value;
      button.disabled=true;message.textContent=`Starting ${label(button.dataset.mgStart)} sandbox test…`;
      try{
        const record=await api('/api/settlement-rails/stellar-usdc/sep24/sandbox-tests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({testType:button.dataset.mgStart,amount})});
        message.textContent=`MoneyGram transaction ${record.transactionId} created. Complete the hosted test, then refresh its status.`;
        if(record.interactiveUrl) window.open(record.interactiveUrl,'_blank','noopener');
        await render();
      }catch(error){message.textContent=error.message;} finally{button.disabled=false;}
    });
    render();
  }

  window.mountAdminMoneyGramSandboxTest=mount;
  window.addEventListener('sra:admin-booted',()=>mount());
  window.addEventListener('sra:admin-workspace-features-ready',(event)=>{if(event.detail?.workspaceId==='settlement')mount();});
  window.addEventListener('hashchange',()=>queueMicrotask(()=>mount()));
})();
