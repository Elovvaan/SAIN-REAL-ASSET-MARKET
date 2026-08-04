(() => {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  function ensureStyle() {
    if (document.querySelector('#funding-intake-style')) return;
    const style = document.createElement('style');
    style.id = 'funding-intake-style';
    style.textContent = `.funding-intake{margin:16px 0;padding:18px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.025)}.funding-intake-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.funding-intake-actions{display:flex;gap:10px;flex-wrap:wrap}.funding-intake-form{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;margin-top:16px}.funding-intake-form input,.funding-intake-form select{min-width:0;padding:12px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#101010;color:#fff}.funding-intake-result{margin-top:12px;padding:12px;border-radius:10px;background:rgba(32,129,226,.1);display:none}.funding-intake-result.open{display:block}.funding-intake-note{font-size:12px;opacity:.72;margin-top:10px}@media(max-width:800px){.funding-intake-head{display:block}.funding-intake-actions{margin-top:12px}.funding-intake-form{grid-template-columns:1fr}}`;
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
    </section>`;
  }

  function showResult(message, error = false) {
    const result = document.querySelector('#funding-intake-result');
    if (!result) return;
    result.classList.add('open');
    result.innerHTML = `<strong>${error ? 'Instruction not created' : 'Instruction created'}</strong><div>${esc(message)}</div>`;
  }

  async function submitInstruction(endpoint, body) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Instruction could not be created.');
    const instruction = payload.instruction;
    showResult(`${instruction.fundingInstructionId} · ${money.format(instruction.amount)} · ${instruction.rail} · ${instruction.state}. No balance has been credited yet.`);
  }

  function bindPanel(host) {
    host.querySelectorAll('[data-funding-mode]').forEach((button) => button.addEventListener('click', () => {
      const vault = host.querySelector('#vault-funding-form');
      const fee = host.querySelector('#fee-payment-form');
      vault.hidden = button.dataset.fundingMode !== 'vault';
      fee.hidden = button.dataset.fundingMode !== 'fee';
    }));
    host.querySelector('#vault-funding-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      try { await submitInstruction('/api/access/funding/vault-instructions', { amount: Number(data.amount), rail: data.rail }); event.currentTarget.reset(); }
      catch (error) { showResult(error.message, true); }
    });
    host.querySelector('#fee-payment-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      try { await submitInstruction('/api/access/funding/fee-instructions', { invoiceId: data.invoiceId, rail: data.rail }); event.currentTarget.reset(); }
      catch (error) { showResult(error.message, true); }
    });
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
