(() => {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  let activeCryptoInstructionId = '';

  function ensureStyle() {
    if (document.querySelector('#funding-intake-style')) return;
    const style = document.createElement('style');
    style.id = 'funding-intake-style';
    style.textContent = `.funding-intake{margin:16px 0;padding:18px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.025)}.funding-intake-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.funding-intake-actions{display:flex;gap:10px;flex-wrap:wrap}.funding-intake-form{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;margin-top:16px}.funding-intake-form input,.funding-intake-form select{min-width:0;padding:12px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#101010;color:#fff}.funding-intake-result{margin-top:12px;padding:12px;border-radius:10px;background:rgba(215,166,42,.1);display:none;line-height:1.5}.funding-intake-result.open{display:block}.funding-intake-note{font-size:12px;opacity:.72;margin-top:10px}.crypto-address{word-break:break-all;font-family:ui-monospace,monospace}@media(max-width:800px){.funding-intake-head{display:block}.funding-intake-actions{margin-top:12px}.funding-intake-form{grid-template-columns:1fr}}`;
    document.head.append(style);
  }

  function panel() {
    return `<section class="funding-intake" id="funding-intake">
      <div class="funding-intake-head">
        <div><p class="eyebrow">ACCOUNT FUNDING</p><h2>Bring outside funds into SRA</h2><p>Create a funding instruction. Your Asset Vault is credited only after the selected external rail is confirmed and recorded.</p></div>
        <div class="funding-intake-actions"><button class="primary-button" data-funding-mode="crypto">Pay with Crypto</button><button class="secondary-button" data-funding-mode="vault">Bank transfer</button><button class="secondary-button" data-funding-mode="fee">Pay Platform Fee</button></div>
      </div>
      <form class="funding-intake-form" id="crypto-funding-form" hidden>
        <input name="amount" type="number" min="0.01" step="0.01" placeholder="USDC amount" required>
        <div><strong>USDC on Base</strong><div class="funding-intake-note">A receiving address is issued after the instruction is created.</div></div>
        <button class="primary-button" type="submit">Create crypto instruction</button>
      </form>
      <form class="funding-intake-form" id="crypto-verification-form" hidden>
        <input name="transactionHash" placeholder="Base transaction hash (0x...)" required>
        <div><strong>Verify transfer</strong><div class="funding-intake-note">The same blockchain transaction cannot be used twice.</div></div>
        <button class="primary-button" type="submit">Verify and credit vault</button>
      </form>
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
      <p class="funding-intake-note">Creating an instruction does not represent receipt, custody, settlement, or available balance. Crypto must be verified on Base before the Asset Vault is credited.</p>
    </section>`;
  }

  function showResult(message, error = false) {
    const result = document.querySelector('#funding-intake-result');
    if (!result) return;
    result.classList.add('open');
    result.innerHTML = `<strong>${error ? 'Action not completed' : 'Funding update'}</strong><div>${message}</div>`;
  }

  async function jsonRequest(endpoint, body) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok && response.status !== 202) throw new Error(payload.error || 'Request could not be completed.');
    return { response, payload };
  }

  async function submitInstruction(endpoint, body) {
    const { payload } = await jsonRequest(endpoint, body);
    const instruction = payload.instruction;
    showResult(`${esc(instruction.fundingInstructionId)} · ${money.format(instruction.amount)} · ${esc(instruction.rail)} · ${esc(instruction.state)}. No balance has been credited yet.`);
    return instruction;
  }

  function hideForms(host) {
    host.querySelectorAll('.funding-intake-form').forEach((form) => { form.hidden = true; });
  }

  function bindPanel(host) {
    host.querySelectorAll('[data-funding-mode]').forEach((button) => button.addEventListener('click', () => {
      hideForms(host);
      const map = { crypto: '#crypto-funding-form', vault: '#vault-funding-form', fee: '#fee-payment-form' };
      const form = host.querySelector(map[button.dataset.fundingMode]);
      if (form) form.hidden = false;
    }));
    host.querySelector('#crypto-funding-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      try {
        const instruction = await submitInstruction('/api/access/funding/crypto-instructions', { amount: Number(data.amount) });
        activeCryptoInstructionId = instruction.fundingInstructionId;
        const verificationForm = host.querySelector('#crypto-verification-form');
        verificationForm.hidden = false;
        showResult(`Send exactly <strong>${money.format(instruction.amount)} USDC</strong> on <strong>Base</strong> to <span class="crypto-address">${esc(instruction.receivingAddress)}</span>. Then enter the transaction hash below. No balance is credited until verification succeeds.`);
      } catch (error) { showResult(esc(error.message), true); }
    });
    host.querySelector('#crypto-verification-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!activeCryptoInstructionId) return showResult('Create a crypto funding instruction first.', true);
      const data = Object.fromEntries(new FormData(event.currentTarget));
      try {
        const { response, payload } = await jsonRequest(`/api/access/funding/crypto-instructions/${encodeURIComponent(activeCryptoInstructionId)}/verify`, { transactionHash: data.transactionHash });
        if (response.status === 202) {
          showResult(`Verification state: <strong>${esc(payload.verification.state)}</strong>. ${esc(payload.verification.reason || 'Waiting for confirmation')}. The Asset Vault has not been credited.`);
        } else {
          showResult(`USDC transfer verified. Receipt ${esc(payload.receipt.paymentReceiptId)} was recorded and ${money.format(payload.receipt.amount)} was credited to the Asset Vault.`);
          event.currentTarget.reset();
        }
      } catch (error) { showResult(esc(error.message), true); }
    });
    host.querySelector('#vault-funding-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      try { await submitInstruction('/api/access/funding/vault-instructions', { amount: Number(data.amount), rail: data.rail }); event.currentTarget.reset(); }
      catch (error) { showResult(esc(error.message), true); }
    });
    host.querySelector('#fee-payment-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      try { await submitInstruction('/api/access/funding/fee-instructions', { invoiceId: data.invoiceId, rail: data.rail }); event.currentTarget.reset(); }
      catch (error) { showResult(esc(error.message), true); }
    });
  }

  function enhanceVault() {
    const vault = document.querySelector('.asset-vault-view');
    if (!vault || vault.querySelector('#funding-intake')) return;
    vault.querySelector('.asset-vault-hero')?.insertAdjacentHTML('afterend', panel());
    bindPanel(vault);
  }

  ensureStyle();
  const observer = new MutationObserver(enhanceVault);
  window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(enhanceVault, 200);
  });
})();