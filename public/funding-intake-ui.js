(() => {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const dateTime = (value) => value ? new Date(value).toLocaleString() : '—';

  function ensureStyle() {
    if (document.querySelector('#funding-intake-style')) return;
    const style = document.createElement('style');
    style.id = 'funding-intake-style';
    style.textContent = `.funding-intake{margin:16px 0;padding:18px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.025)}.funding-intake-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.funding-intake-actions{display:flex;gap:10px;flex-wrap:wrap}.funding-intake-form{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;margin-top:16px}.funding-intake-form input,.funding-intake-form select{min-width:0;padding:12px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#101010;color:#fff}.funding-intake-result{margin-top:12px;padding:12px;border-radius:10px;background:rgba(32,129,226,.1);display:none}.funding-intake-result.open{display:block}.funding-intake-note{font-size:12px;opacity:.72;margin-top:10px}.funding-instruction-list{margin-top:18px}.funding-instruction-list-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.funding-instruction-items{display:grid;gap:10px;margin-top:12px}.funding-instruction-item{padding:14px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.02)}.funding-instruction-item-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.funding-instruction-meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;font-size:12px;opacity:.75}.funding-instruction-empty,.funding-instruction-error{padding:14px;border:1px dashed rgba(255,255,255,.14);border-radius:12px;opacity:.75}@media(max-width:800px){.funding-intake-head{display:block}.funding-intake-actions{margin-top:12px}.funding-intake-form{grid-template-columns:1fr}.funding-instruction-item-top{display:block}}`;
    document.head.append(style);
  }

  function panel() {
    return `<section class="funding-intake" id="funding-intake">
      <div class="funding-intake-head">
        <div><p class="eyebrow">ACCOUNT FUNDING</p><h2>Bring outside funds into SRA</h2><p>Create an instruction for outside funds. Your Asset Vault is credited only after the external transfer is confirmed and recorded.</p></div>
        <div class="funding-intake-actions"><button class="primary-button" data-funding-mode="vault">Add Outside Funds</button><button class="secondary-button" data-funding-mode="fee">Pay Platform Fee</button></div>
      </div>
      <form class="funding-intake-form" id="vault-funding-form" hidden>
        <input name="amount" type="number" min="0.01" step="0.01" placeholder="Amount in USD" required>
        <select name="rail"><option value="ACH">ACH</option><option value="WIRE">Wire</option><option value="EXTERNAL_TRANSFER">External transfer</option></select>
        <button class="primary-button" type="submit">Create funding instruction</button>
      </form>
      <form class="funding-intake-form" id="fee-payment-form" hidden>
        <input name="invoiceId" placeholder="Fee invoice ID" required>
        <select name="rail"><option value="ACH">ACH</option><option value="WIRE">Wire</option><option value="CARD">Card</option><option value="EXTERNAL_TRANSFER">External transfer</option></select>
        <button class="primary-button" type="submit">Create payment instruction</button>
      </form>
      <div class="funding-intake-result" id="funding-intake-result"></div>
      <p class="funding-intake-note">Creating an instruction does not represent receipt, custody, settlement, or available balance. An authorized external confirmation is required.</p>
      <section class="funding-instruction-list" aria-labelledby="funding-instruction-title">
        <div class="funding-instruction-list-head"><div><p class="eyebrow">SAVED RECORDS</p><h3 id="funding-instruction-title">Funding Instructions</h3></div><button class="secondary-button" type="button" id="refresh-funding-instructions">Refresh</button></div>
        <div class="funding-instruction-items" id="funding-instruction-items"><div class="funding-instruction-empty">Loading funding instructions…</div></div>
      </section>
    </section>`;
  }

  function showResult(message, error = false) {
    const result = document.querySelector('#funding-intake-result');
    if (!result) return;
    result.classList.add('open');
    result.innerHTML = `<strong>${error ? 'Instruction not created' : 'Instruction created'}</strong><div>${esc(message)}</div>`;
  }

  function renderInstructions(host, instructions) {
    const target = host.querySelector('#funding-instruction-items');
    if (!target) return;
    if (!instructions.length) {
      target.innerHTML = '<div class="funding-instruction-empty">No funding instructions have been recorded for this account.</div>';
      return;
    }
    target.innerHTML = instructions.map((instruction) => `<article class="funding-instruction-item">
      <div class="funding-instruction-item-top"><div><strong>${esc(instruction.fundingInstructionId)}</strong><div>${esc(instruction.purpose === 'PLATFORM_FEE_PAYMENT' ? 'Platform fee payment' : 'Asset Vault funding')}</div></div><strong>${money.format(Number(instruction.amount || 0))}</strong></div>
      <div class="funding-instruction-meta"><span>${esc(instruction.rail)}</span><span>${esc(instruction.state)}</span><span>Created ${esc(dateTime(instruction.createdAt))}</span>${instruction.invoiceId ? `<span>Invoice ${esc(instruction.invoiceId)}</span>` : ''}${instruction.externalReference ? `<span>External ref ${esc(instruction.externalReference)}</span>` : ''}</div>
    </article>`).join('');
  }

  async function loadInstructions(host) {
    const target = host.querySelector('#funding-instruction-items');
    if (target) target.innerHTML = '<div class="funding-instruction-empty">Loading funding instructions…</div>';
    try {
      const response = await fetch('/api/access/funding/instructions', { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Funding instructions could not be loaded.');
      renderInstructions(host, Array.isArray(payload.instructions) ? payload.instructions : []);
    } catch (error) {
      if (target) target.innerHTML = `<div class="funding-instruction-error">${esc(error.message)}</div>`;
    }
  }

  async function submitInstruction(host, endpoint, body) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Instruction could not be created.');
    const instruction = payload.instruction;
    showResult(`${instruction.fundingInstructionId} · ${money.format(instruction.amount)} · ${instruction.rail} · ${instruction.state}. No balance has been credited yet.`);
    await loadInstructions(host);
  }

  function bindPanel(host) {
    host.querySelectorAll('[data-funding-mode]').forEach((button) => button.addEventListener('click', () => {
      const vault = host.querySelector('#vault-funding-form');
      const fee = host.querySelector('#fee-payment-form');
      vault.hidden = button.dataset.fundingMode !== 'vault';
      fee.hidden = button.dataset.fundingMode !== 'fee';
    }));
    host.querySelector('#refresh-funding-instructions')?.addEventListener('click', () => loadInstructions(host));
    host.querySelector('#vault-funding-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      try { await submitInstruction(host, '/api/access/funding/vault-instructions', { amount: Number(data.amount), rail: data.rail }); event.currentTarget.reset(); }
      catch (error) { showResult(error.message, true); }
    });
    host.querySelector('#fee-payment-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      try { await submitInstruction(host, '/api/access/funding/fee-instructions', { invoiceId: data.invoiceId, rail: data.rail }); event.currentTarget.reset(); }
      catch (error) { showResult(error.message, true); }
    });
    loadInstructions(host);
  }

  function enhanceVault() {
    const vault = document.querySelector('.asset-vault-view');
    if (!vault || vault.querySelector('#funding-intake')) return;
    const hero = vault.querySelector('.asset-vault-hero');
    hero?.insertAdjacentHTML('afterend', panel());
    bindPanel(vault);
  }

  ensureStyle();
  const observer = new MutationObserver(() => enhanceVault());
  window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(enhanceVault, 200);
  });
})();
