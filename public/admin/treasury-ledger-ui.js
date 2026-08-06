(() => {
  let initialized = false;
  let treasury = null;
  let correction = null;
  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 8 }).format(Number(value || 0));
  const number = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 8 });

  async function request(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed.');
    return payload;
  }

  function ensureStyles() {
    if (document.querySelector('#treasury-ledger-styles')) return;
    const style = document.createElement('style');
    style.id = 'treasury-ledger-styles';
    style.textContent = `.treasury-shell{margin:14px 0}.treasury-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.treasury-kpis div,.treasury-account{border:1px solid #292929;border-radius:12px;padding:12px;background:#080808}.treasury-kpis span,.treasury-account span{display:block;color:#999;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.treasury-kpis strong{display:block;font-size:20px;margin-top:4px}.treasury-layout{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.treasury-box{border:1px solid #292929;border-radius:14px;padding:14px;background:#070707}.treasury-box h3{margin:0 0 6px}.treasury-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.treasury-grid label{margin:0}.treasury-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.treasury-message{margin-top:10px;color:#d9c88d}.treasury-accounts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.treasury-account strong{display:block;margin-top:4px}.treasury-rule{padding:10px;border:1px solid #4a3c19;background:#151107;border-radius:10px;color:#e4d8ad;margin-top:10px}.treasury-preview{margin-top:10px;padding:10px;border:1px solid #29422f;background:#09110b;border-radius:10px;color:#bfe0c6}@media(max-width:900px){.treasury-layout,.treasury-kpis,.treasury-accounts,.treasury-grid{grid-template-columns:1fr}}`;
    document.head.append(style);
  }

  function ensurePanel() {
    const anchor = document.querySelector('#unified-operations-queue') || document.querySelector('#metrics');
    if (!anchor || document.querySelector('#sra-treasury-ledger')) return;
    anchor.insertAdjacentHTML('afterend', `<section id="sra-treasury-ledger" class="card treasury-shell">
      <div class="section-title"><div><h2>SRA Platform Treasury</h2><small style="color:#999">Balanced debit and credit administration for the platform treasury.</small></div><span id="treasury-state" class="status">LOADING</span></div>
      <div id="treasury-kpis" class="treasury-kpis"></div>
      <div class="treasury-layout">
        <section class="treasury-box"><h3>Post Balanced Entry</h3><p style="color:#999">Add funds or recognize treasury activity through equal debits and credits. No direct balance editing.</p>
          <div class="treasury-grid"><label>Debit account<select id="treasury-debit"></select></label><label>Credit account<select id="treasury-credit"></select></label><label>Amount (USD)<input id="treasury-amount" type="number" min="0.00000001" step="any" placeholder="0.00"></label><label>Reference<input id="treasury-reference" placeholder="Deposit, contribution, or record reference"></label></div>
          <label>Memo<input id="treasury-memo" placeholder="Explain the economic event"></label>
          <div class="treasury-actions"><button id="treasury-preview">Preview Entry</button><button id="treasury-post" class="primary" disabled>Post Balanced Entry</button><button id="treasury-refresh">Refresh</button></div>
          <div id="treasury-entry-preview" class="treasury-message">Enter both sides of the journal.</div>
        </section>
        <section class="treasury-box"><h3>Recorded Value Representation</h3><p style="color:#999">SRA quantity follows recognized recorded USD value at the fixed SRA/USD par reference.</p>
          <div id="recorded-value-status" class="treasury-rule">Loading representation status.</div>
          <div class="treasury-actions"><button id="correct-recorded-value" class="primary" disabled>Correct Legacy Positions</button></div>
          <div class="treasury-rule">Asset: SRA Coin · Native market: SRA/USD · Reference: 1 SRA = 1 USD. A source record count or source-asset quantity does not determine SRA supply.</div>
        </section>
      </div>
      <div id="treasury-accounts" class="treasury-accounts"></div>
    </section>`);
    document.querySelector('#treasury-refresh').addEventListener('click', () => void load());
    document.querySelector('#treasury-preview').addEventListener('click', () => void previewEntry());
    document.querySelector('#treasury-post').addEventListener('click', () => void postEntry());
    document.querySelector('#correct-recorded-value').addEventListener('click', () => void correctRecordedValue());
  }

  function entryInput() {
    const amount = Number(document.querySelector('#treasury-amount')?.value || 0);
    return {
      memo: document.querySelector('#treasury-memo')?.value || '',
      reference: document.querySelector('#treasury-reference')?.value || null,
      lines: [
        { accountId: document.querySelector('#treasury-debit')?.value, side: 'DEBIT', amount, currency: 'USD' },
        { accountId: document.querySelector('#treasury-credit')?.value, side: 'CREDIT', amount, currency: 'USD' }
      ]
    };
  }

  function render() {
    if (!treasury) return;
    const state = document.querySelector('#treasury-state');
    state.textContent = treasury.balanced ? 'BALANCED' : 'OUT OF BALANCE';
    state.classList.toggle('ok', treasury.balanced);
    document.querySelector('#treasury-kpis').innerHTML = [
      ['Treasury cash', money(treasury.cashBalanceUsd)], ['Recognized value', money(treasury.recognizedValueBalanceUsd)], ['SRA represented at par', money(treasury.sraRepresentedAtParUsd)], ['Posted journals', number(treasury.journalCount)]
    ].map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
    const options = treasury.accounts.map((item) => `<option value="${esc(item.accountId)}">${esc(item.code)} · ${esc(item.name)}</option>`).join('');
    const debit = document.querySelector('#treasury-debit');
    const credit = document.querySelector('#treasury-credit');
    const oldDebit = debit.value; const oldCredit = credit.value;
    debit.innerHTML = options; credit.innerHTML = options;
    debit.value = oldDebit || 'TRSY-1000-CASH-USD';
    credit.value = oldCredit || 'TRSY-3000-PLATFORM-CAPITAL';
    document.querySelector('#treasury-accounts').innerHTML = treasury.accounts.map((item) => `<div class="treasury-account"><span>${esc(item.code)} · ${esc(item.category)} · normal ${esc(item.normalSide)}</span><strong>${esc(item.name)}</strong><small>${money(item.balance)} · Debits ${money(item.totalDebits)} · Credits ${money(item.totalCredits)}</small></div>`).join('');
    const status = document.querySelector('#recorded-value-status');
    status.innerHTML = `<strong>${number(correction.correctablePositionCount)} legacy position(s) require correction</strong><br>Current represented: ${number(correction.currentRepresentedQuantity)} SRA<br>Recorded-value target: ${number(correction.targetRepresentedQuantity)} SRA`;
    document.querySelector('#correct-recorded-value').disabled = Number(correction.correctablePositionCount || 0) === 0;
  }

  async function load() {
    ensureStyles(); ensurePanel();
    if (!document.querySelector('#sra-treasury-ledger')) return;
    try {
      [treasury, correction] = await Promise.all([request('/api/admin/treasury'), request('/api/admin/recorded-value-representation')]);
      render();
    } catch (error) { document.querySelector('#treasury-state').textContent = 'UNAVAILABLE'; document.querySelector('#treasury-entry-preview').textContent = error.message; }
  }

  async function previewEntry() {
    const root = document.querySelector('#treasury-entry-preview');
    try {
      const result = await request('/api/admin/treasury/journals/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entryInput()) });
      root.className = 'treasury-preview';
      root.textContent = `Balanced: Debit ${money(result.totalDebits)} / Credit ${money(result.totalCredits)}. ${result.effect}`;
      document.querySelector('#treasury-post').disabled = false;
    } catch (error) { root.className = 'treasury-message'; root.textContent = error.message; document.querySelector('#treasury-post').disabled = true; }
  }

  async function postEntry() {
    const input = entryInput();
    if (!confirm(`Post a balanced treasury entry for ${money(input.lines[0].amount)}?`)) return;
    const root = document.querySelector('#treasury-entry-preview');
    try {
      const result = await request('/api/admin/treasury/journals/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, approval: 'APPROVE', idempotencyKey: input.reference || undefined }) });
      root.className = 'treasury-preview'; root.textContent = `Journal ${result.journal.entryId} posted with equal debits and credits.`;
      document.querySelector('#treasury-post').disabled = true;
      await window.loadSummary?.(); await load();
    } catch (error) { root.className = 'treasury-message'; root.textContent = error.message; }
  }

  async function correctRecordedValue() {
    const count = Number(correction?.correctablePositionCount || 0);
    if (!count || !confirm(`Correct ${number(count)} legacy SRA Coin Position(s) to their recognized recorded USD value at par?`)) return;
    const button = document.querySelector('#correct-recorded-value'); button.disabled = true; button.textContent = 'Correcting…';
    try {
      const result = await request('/api/admin/recorded-value-representation/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval: 'APPROVE' }) });
      window.append?.(`${number(result.correctedPositionCount)} SRA Coin Positions were aligned to recognized recorded USD value.`, 'agent');
      await window.loadSummary?.(); await load();
    } catch (error) { document.querySelector('#recorded-value-status').textContent = error.message; }
    finally { button.textContent = 'Correct Legacy Positions'; }
  }

  function initialize() {
    if (initialized) return; initialized = true;
    const observer = new MutationObserver(() => { if (document.querySelector('#admin-view:not(.hidden)')) { ensureStyles(); ensurePanel(); void load(); } });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    setTimeout(() => void load(), 0);
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initialize, { once: true }); else initialize();
})();
