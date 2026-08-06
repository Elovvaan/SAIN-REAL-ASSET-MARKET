(() => {
  let initialized = false;
  let treasury = null;
  let correction = null;
  let depositPreview = null;
  let entryPreview = null;
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 8 }).format(Number(value || 0));
  const number = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 8 });

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed with HTTP ${response.status}.`);
      error.code = payload.code;
      error.retryAfterMs = payload.retryAfterMs;
      throw error;
    }
    return payload;
  }

  function ensureStyles() {
    if ($('#treasury-ledger-styles')) return;
    const style = document.createElement('style');
    style.id = 'treasury-ledger-styles';
    style.textContent = `.treasury-shell{margin:14px 0}.treasury-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.treasury-kpis div,.treasury-account{border:1px solid #292929;border-radius:12px;padding:12px;background:#080808}.treasury-kpis span,.treasury-account span{display:block;color:#999;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.treasury-kpis strong{display:block;font-size:20px;margin-top:4px}.treasury-layout{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.treasury-box{border:1px solid #292929;border-radius:14px;padding:14px;background:#070707}.treasury-box h3{margin:0 0 6px}.treasury-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.treasury-grid label{margin:0}.treasury-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.treasury-message{margin-top:10px;color:#d9c88d}.treasury-accounts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.treasury-account strong{display:block;margin-top:4px}.treasury-rule{padding:10px;border:1px solid #4a3c19;background:#151107;border-radius:10px;color:#e4d8ad;margin-top:10px}.treasury-preview{margin-top:10px;padding:10px;border:1px solid #29422f;background:#09110b;border-radius:10px;color:#bfe0c6}.funding-instrument-box{margin-top:12px;border-color:#6b5318;background:linear-gradient(180deg,#120e06,#070707)}.treasury-actions .primary:not(:disabled){background:#d6a92f;color:#090909;border-color:#d6a92f;font-weight:800}@media(max-width:1000px){.treasury-kpis{grid-template-columns:repeat(2,1fr)}}@media(max-width:900px){.treasury-layout,.treasury-accounts,.treasury-grid{grid-template-columns:1fr}}`;
    document.head.append(style);
  }

  function ensurePanel() {
    const anchor = $('#unified-operations-queue') || $('#metrics');
    if (!anchor || $('#sra-treasury-ledger')) return;
    anchor.insertAdjacentHTML('afterend', `<section id="sra-treasury-ledger" class="card treasury-shell">
      <div class="section-title"><div><h2>SRA Platform Treasury</h2><small style="color:#999">The platform commercial instrument establishes the governed USD Treasury position used for financing.</small></div><span id="treasury-state" class="status">LOADING</span></div>
      <div id="treasury-kpis" class="treasury-kpis"></div>
      <section class="treasury-box funding-instrument-box"><h3>Deposit Platform Commercial Instrument</h3><p style="color:#aaa">Deposit the platform's commercial instrument into SRA, recognize its USD face value, and establish instrument-backed financing capacity. This is not owner-contributed capital.</p>
        <div class="treasury-grid"><label>Instrument ID<input id="funding-instrument-id" placeholder="INS-..."></label><label>Face value (USD)<input id="funding-instrument-value" type="number" min="0.00000001" step="any" value="18000000"></label><label>Term (months)<input id="funding-instrument-term" type="number" min="1" step="1" value="36"></label><label>Deposit reference<input id="funding-instrument-reference" placeholder="Platform instrument deposit reference"></label></div>
        <div class="treasury-actions"><button id="funding-instrument-preview" type="button">Preview Instrument Deposit</button><button id="funding-instrument-approve" type="button" class="primary">Deposit & Establish USD Position</button></div>
        <div id="funding-instrument-message" class="treasury-rule">The deposit action validates and previews automatically before asking for confirmation.</div>
      </section>
      <div class="treasury-layout">
        <section class="treasury-box"><h3>Post Balanced Entry</h3><p style="color:#999">Use for other governed treasury events. The commercial-instrument workflow above prepares its own journal automatically.</p>
          <div class="treasury-grid"><label>Debit account<select id="treasury-debit"></select></label><label>Credit account<select id="treasury-credit"></select></label><label>Amount (USD)<input id="treasury-amount" type="number" min="0.00000001" step="any" placeholder="0.00"></label><label>Reference<input id="treasury-reference" placeholder="Treasury event reference"></label></div>
          <label>Memo<input id="treasury-memo" placeholder="Explain the economic event"></label>
          <div class="treasury-actions"><button id="treasury-preview" type="button">Preview Entry</button><button id="treasury-post" type="button" class="primary">Post Balanced Entry</button><button id="treasury-refresh" type="button">Refresh</button></div>
          <div id="treasury-entry-preview" class="treasury-message">The posting action validates and previews automatically before asking for confirmation.</div>
        </section>
        <section class="treasury-box"><h3>Recorded Value Representation</h3><p style="color:#999">SRA quantity follows recognized recorded USD value at the fixed SRA/USD par reference.</p>
          <div id="recorded-value-status" class="treasury-rule">Loading representation status.</div>
          <div class="treasury-actions"><button id="correct-recorded-value" type="button" class="primary" disabled>Correct Legacy Positions</button></div>
          <div class="treasury-rule">Asset: SRA Coin · Native market: SRA/USD · Reference: 1 SRA = 1 USD.</div>
        </section>
      </div><div id="treasury-accounts" class="treasury-accounts"></div></section>`);
    $('#treasury-refresh').addEventListener('click', () => void load());
    $('#treasury-preview').addEventListener('click', () => void previewEntry());
    $('#treasury-post').addEventListener('click', () => void postEntry());
    $('#correct-recorded-value').addEventListener('click', () => void correctRecordedValue());
    $('#funding-instrument-preview').addEventListener('click', () => void previewFundingInstrument());
    $('#funding-instrument-approve').addEventListener('click', () => void approveFundingInstrument());
    ['#funding-instrument-id','#funding-instrument-value','#funding-instrument-term','#funding-instrument-reference'].forEach((s) => $(s)?.addEventListener('input', () => { depositPreview = null; }));
    ['#treasury-debit','#treasury-credit','#treasury-amount','#treasury-reference','#treasury-memo'].forEach((s) => $(s)?.addEventListener('input', () => { entryPreview = null; }));
  }

  function fundingInstrumentInput() { return { instrumentId: $('#funding-instrument-id')?.value || '', faceValueUsd: Number($('#funding-instrument-value')?.value || 0), termMonths: Number($('#funding-instrument-term')?.value || 36), depositReference: $('#funding-instrument-reference')?.value || '' }; }
  function entryInput() { const amount = Number($('#treasury-amount')?.value || 0); return { memo: $('#treasury-memo')?.value || '', reference: $('#treasury-reference')?.value || null, lines: [{ accountId: $('#treasury-debit')?.value, side: 'DEBIT', amount, currency: 'USD' }, { accountId: $('#treasury-credit')?.value, side: 'CREDIT', amount, currency: 'USD' }] }; }

  function render() {
    if (!treasury || !correction) return;
    const deposits = treasury.fundingInstrumentDeposits || {};
    $('#treasury-state').textContent = treasury.balanced ? 'BALANCED' : 'OUT OF BALANCE'; $('#treasury-state').classList.toggle('ok', treasury.balanced);
    $('#treasury-kpis').innerHTML = [['Treasury cash / settlement USD',money(treasury.cashBalanceUsd)],['Commercial instrument USD',money(deposits.depositedInstrumentValueUsd)],['Available financing capacity',money(deposits.availableFinancingCapacityUsd)],['SRA represented at par',money(treasury.sraRepresentedAtParUsd)],['Posted journals',number(treasury.journalCount)]].map(([l,v])=>`<div><span>${esc(l)}</span><strong>${esc(v)}</strong></div>`).join('');
    const options = (treasury.accounts || []).map((item)=>`<option value="${esc(item.accountId)}">${esc(item.code)} · ${esc(item.name)}</option>`).join('');
    const debit=$('#treasury-debit'), credit=$('#treasury-credit'), oldDebit=debit.value, oldCredit=credit.value; debit.innerHTML=options; credit.innerHTML=options; debit.value=oldDebit||'TRSY-1000-CASH-USD'; credit.value=oldCredit||'TRSY-2200-PLATFORM-INSTRUMENT-FUNDING';
    $('#treasury-accounts').innerHTML=(treasury.accounts||[]).map((item)=>`<div class="treasury-account"><span>${esc(item.code)} · ${esc(item.category)} · normal ${esc(item.normalSide)}</span><strong>${esc(item.name)}</strong><small>${money(item.balance)} · Debits ${money(item.totalDebits)} · Credits ${money(item.totalCredits)}</small></div>`).join('');
    $('#recorded-value-status').innerHTML=`<strong>${number(correction.correctablePositionCount)} legacy position(s) require correction</strong><br>Current represented: ${number(correction.currentRepresentedQuantity)} SRA<br>Recorded-value target: ${number(correction.targetRepresentedQuantity)} SRA`;
    $('#correct-recorded-value').disabled=Number(correction.correctablePositionCount||0)===0;
  }

  async function load(){ ensureStyles(); ensurePanel(); if(!$('#sra-treasury-ledger'))return; try{[treasury,correction]=await Promise.all([request('/api/admin/treasury'),request('/api/admin/recorded-value-representation')]);render();}catch(error){$('#treasury-state').textContent='UNAVAILABLE';$('#treasury-entry-preview').textContent=error.message;} }
  async function previewFundingInstrument(){const root=$('#funding-instrument-message');try{depositPreview=await request('/api/admin/treasury/funding-instrument-deposits/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fundingInstrumentInput())});root.className='treasury-preview';root.textContent=`${depositPreview.instrumentName}: ${money(depositPreview.faceValueUsd)} will establish ${money(depositPreview.financingCapacityUsd)} of instrument-backed Treasury financing capacity at 1 SRA = 1 USD.`;return depositPreview;}catch(error){depositPreview=null;root.className='treasury-rule';root.textContent=error.message;throw error;}}
  async function approveFundingInstrument(){const button=$('#funding-instrument-approve'),root=$('#funding-instrument-message');button.disabled=true;button.textContent='Validating…';try{const preview=depositPreview||await previewFundingInstrument();if(!confirm(`Deposit ${preview.instrumentName} at ${money(preview.faceValueUsd)} into the SRA Platform Treasury?`))return;button.textContent='Depositing…';const result=await request('/api/admin/treasury/funding-instrument-deposits/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fundingInstrumentInput(),approval:'APPROVE'})});root.className='treasury-preview';root.textContent=`Deposit ${result.deposit.transactionId} established ${money(result.deposit.faceValueUsd)} in platform commercial-instrument USD financing capacity.`;depositPreview=null;await window.loadSummary?.();await load();}catch(error){root.className='treasury-rule';root.textContent=error.message;}finally{button.disabled=false;button.textContent='Deposit & Establish USD Position';}}
  async function previewEntry(){const root=$('#treasury-entry-preview');try{entryPreview=await request('/api/admin/treasury/journals/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(entryInput())});root.className='treasury-preview';root.textContent=`Balanced: Debit ${money(entryPreview.totalDebits)} / Credit ${money(entryPreview.totalCredits)}. ${entryPreview.effect}`;return entryPreview;}catch(error){entryPreview=null;root.className='treasury-message';root.textContent=error.message;throw error;}}
  async function postEntry(){const button=$('#treasury-post'),root=$('#treasury-entry-preview'),input=entryInput();button.disabled=true;button.textContent='Validating…';try{await (entryPreview||previewEntry());if(!confirm(`Post a balanced treasury entry for ${money(input.lines[0].amount)}?`))return;button.textContent='Posting…';const result=await request('/api/admin/treasury/journals/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,approval:'APPROVE',idempotencyKey:input.reference||undefined})});root.className='treasury-preview';root.textContent=`Journal ${result.journal.entryId} posted with equal debits and credits.`;entryPreview=null;await window.loadSummary?.();await load();}catch(error){root.className='treasury-message';root.textContent=error.message;}finally{button.disabled=false;button.textContent='Post Balanced Entry';}}
  async function correctRecordedValue(){const count=Number(correction?.correctablePositionCount||0);if(!count||!confirm(`Correct ${number(count)} legacy SRA Coin Position(s) to their recognized recorded USD value at par?`))return;const button=$('#correct-recorded-value');button.disabled=true;button.textContent='Correcting…';try{const result=await request('/api/admin/recorded-value-representation/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approval:'APPROVE'})});window.append?.(`${number(result.correctedPositionCount)} SRA Coin Positions were aligned to recognized recorded USD value.`,'agent');await window.loadSummary?.();await load();}catch(error){$('#recorded-value-status').textContent=error.message;}finally{button.textContent='Correct Legacy Positions';button.disabled=Number(correction?.correctablePositionCount||0)===0;}}
  function initialize(){if(initialized)return;initialized=true;const observer=new MutationObserver(()=>{if($('#admin-view:not(.hidden)')){ensureStyles();ensurePanel();void load();}});observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']});setTimeout(()=>void load(),0);}
  if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})();
