(() => {
  if (window.__sraAdminTreasuryAchPaymentInstalled) return;
  window.__sraAdminTreasuryAchPaymentInstalled = true;

  const mounted = new WeakSet();
  const observers = new WeakMap();
  const request = async (url, options = {}) => {
    if (window.SRAAdminDataClient) return window.SRAAdminDataClient.json(url, options);
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };
  const money = (value) => Number(value || 0).toLocaleString(undefined,{ style:'currency', currency:'USD', minimumFractionDigits:2, maximumFractionDigits:2 });
  const digits = (value) => String(value || '').replace(/\D/g,'');
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  function paymentMarkup() {
    return `<form data-treasury-bank-payment-form autocomplete="off" style="margin-top:16px;border-top:1px solid #262626;padding-top:16px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <strong>Bank Payment</strong><span style="color:#9a9a9a;font-size:12px">Cash / Settlement USD</span>
      </div>
      <div data-treasury-bank-entry>
        <div class="admin-record-grid">
          <label><span>Payment rail</span><select name="rail" data-bank-rail style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="ACH">ACH</option><option value="WIRE">Wire</option></select></label>
          <label><span>Amount USD</span><input name="amountUsd" type="number" min="0.01" step="0.01" value="1.00" required></label>
          <label><span>Receiving bank</span><input name="bankName" type="text" placeholder="Receiving bank" required></label>
          <label data-ach-field><span>Account type</span><select name="accountType" style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="CHECKING">Checking</option><option value="SAVINGS">Savings</option></select></label>
          <label data-wire-field hidden><span>Beneficiary name</span><input name="beneficiaryName" type="text" placeholder="Beneficiary name"></label>
          <label><span data-routing-label>ACH routing number</span><input name="routingNumber" type="text" inputmode="numeric" maxlength="9" placeholder="9 digits" required></label>
          <label><span>Account number</span><input name="accountNumber" type="password" maxlength="34" placeholder="Account number" required></label>
          <label data-wire-field hidden><span>Beneficiary address</span><input name="beneficiaryAddress" type="text" placeholder="Optional"></label>
          <label data-wire-field hidden><span>Receiving bank address</span><input name="bankAddress" type="text" placeholder="Optional"></label>
          <label data-wire-field hidden><span>Further credit / instructions</span><input name="furtherCredit" type="text" placeholder="Optional"></label>
        </div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px">
          <button type="submit">Review Payment</button>
          <span style="color:#9a9a9a;font-size:12px">ACH and Wire use separate bank-rail instructions. On-chain transfers use the chain execution flow.</span>
        </div>
      </div>
      <div data-treasury-bank-review hidden></div>
      <div data-treasury-bank-result style="color:#d6a92f;font-size:12px;line-height:1.5;margin-top:12px"></div>
    </form>`;
  }

  function setRailFields(form) {
    const rail = String(form.elements.rail?.value || 'ACH').toUpperCase();
    form.querySelectorAll('[data-ach-field]').forEach((node) => { node.hidden = rail !== 'ACH'; });
    form.querySelectorAll('[data-wire-field]').forEach((node) => { node.hidden = rail !== 'WIRE'; });
    const routingLabel = form.querySelector('[data-routing-label]');
    if (routingLabel) routingLabel.textContent = rail === 'ACH' ? 'ACH routing number' : 'Wire routing number';
    if (form.elements.beneficiaryName) form.elements.beneficiaryName.required = rail === 'WIRE';
    if (form.elements.accountType) form.elements.accountType.required = rail === 'ACH';
  }

  function validate(values) {
    const rail = String(values.rail || 'ACH').toUpperCase();
    const amountUsd = Number(values.amountUsd);
    const routingNumber = digits(values.routingNumber);
    const bankName = String(values.bankName || '').trim();
    const accountNumber = String(values.accountNumber || '').trim();
    if (!['ACH','WIRE'].includes(rail)) throw new Error('Select ACH or Wire.');
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('Enter an amount greater than zero.');
    if (!bankName) throw new Error('Receiving bank is required.');
    if (routingNumber.length !== 9) throw new Error(`Enter a 9-digit ${rail === 'ACH' ? 'ACH' : 'wire'} routing number.`);
    if (!accountNumber) throw new Error('Account number is required.');
    if (rail === 'ACH') {
      const accountType = String(values.accountType || '').trim().toUpperCase();
      const achAccountNumber = digits(accountNumber);
      if (achAccountNumber.length < 4 || achAccountNumber.length > 17) throw new Error('Enter a valid ACH account number.');
      if (!['CHECKING','SAVINGS'].includes(accountType)) throw new Error('Select an account type.');
      return { rail, amountUsd, bankName, accountType, routingNumber, accountNumber:achAccountNumber };
    }
    const beneficiaryName = String(values.beneficiaryName || '').trim();
    if (!beneficiaryName) throw new Error('Beneficiary name is required for a wire.');
    return {
      rail, amountUsd, bankName, beneficiaryName, routingNumber, accountNumber,
      beneficiaryAddress:String(values.beneficiaryAddress || '').trim(),
      bankAddress:String(values.bankAddress || '').trim(),
      furtherCredit:String(values.furtherCredit || '').trim(),
    };
  }

  function showReview(form, payment) {
    const entry = form.querySelector('[data-treasury-bank-entry]');
    const review = form.querySelector('[data-treasury-bank-review]');
    const result = form.querySelector('[data-treasury-bank-result]');
    if (result) result.textContent = '';
    if (entry) entry.hidden = true;
    if (!review) return;
    review.hidden = false;
    review.innerHTML = `<div class="admin-record-grid">
      <div><span>Amount</span><strong>${esc(money(payment.amountUsd))}</strong></div>
      <div><span>Rail</span><strong>${esc(payment.rail)}</strong></div>
      <div><span>Receiving bank</span><strong>${esc(payment.bankName)}</strong></div>
      ${payment.rail === 'ACH' ? `<div><span>Account type</span><strong>${esc(payment.accountType)}</strong></div>` : `<div><span>Beneficiary</span><strong>${esc(payment.beneficiaryName)}</strong></div>`}
      <div><span>Routing</span><strong>•••••${esc(payment.routingNumber.slice(-4))}</strong></div>
      <div><span>Account</span><strong>••••${esc(payment.accountNumber.slice(-4))}</strong></div>
    </div>
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:14px">
      <button type="button" data-treasury-bank-send>Send ${esc(payment.rail === 'ACH' ? 'ACH' : 'Wire')}</button>
      <button type="button" data-treasury-bank-edit>Edit</button>
      <span style="color:#9a9a9a;font-size:12px">Treasury will create the ${esc(payment.rail)} instruction, check available cash, and hand it to the configured ${esc(payment.rail)} adapter.</span>
    </div>`;

    review.querySelector('[data-treasury-bank-edit]')?.addEventListener('click', () => {
      review.hidden = true;
      review.innerHTML = '';
      entry.hidden = false;
    });

    review.querySelector('[data-treasury-bank-send]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const edit = review.querySelector('[data-treasury-bank-edit]');
      button.disabled = true;
      if (edit) edit.disabled = true;
      if (result) result.textContent = `Sending ${payment.rail} payment…`;
      const pathRail = payment.rail === 'ACH' ? 'ach' : 'wire';
      try {
        const prepared = await request(`/api/admin/treasury-transfer-readiness/${pathRail}/prepare`, {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payment),
        });
        const instruction = prepared.transferInstruction || prepared.paymentInstruction || {};
        const transferInstructionId = instruction.transferInstructionId || instruction.transactionId;
        if (!transferInstructionId) throw new Error(`${payment.rail} instruction was not created.`);
        const execution = await request(`/api/admin/treasury-transfer-readiness/${pathRail}/execute`, {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ transferInstructionId, ...payment }),
        });
        payment.routingNumber = '';
        payment.accountNumber = '';
        const evidence = execution.executionEvidence || {};
        review.innerHTML = `<div class="admin-record-grid">
          <div><span>Amount</span><strong>${esc(money(payment.amountUsd))}</strong></div>
          <div><span>Rail</span><strong>${esc(payment.rail)}</strong></div>
          <div><span>Status</span><strong>${esc(evidence.providerStatus || execution.instruction?.state || 'SUBMITTED')}</strong></div>
          <div><span>Reference</span><strong>${esc(evidence.providerReference || transferInstructionId)}</strong></div>
          <div><span>Instruction</span><strong>${esc(transferInstructionId)}</strong></div>
        </div>`;
        if (result) result.textContent = `${payment.rail} payment submitted. Settlement status remains in the platform records.`;
        window.SRAAdminDataClient?.refresh?.(`treasury-${pathRail}-submitted`);
      } catch (error) {
        if (result) result.textContent = error.message || `${payment.rail} payment failed.`;
        button.disabled = false;
        if (edit) edit.disabled = false;
      }
    });
  }

  function enhance(workspace) {
    if (!workspace || workspace.dataset.activeTab !== 'Cash Position') return;
    const card = workspace.querySelector('[data-treasury-workstation-card]');
    if (!card) return;
    const oldForm = card.querySelector('[data-treasury-payment-form]');
    if (oldForm && !card.querySelector('[data-treasury-bank-payment-form]')) {
      const holder = document.createElement('div');
      holder.innerHTML = paymentMarkup();
      oldForm.replaceWith(holder.firstElementChild);
    }
    const form = card.querySelector('[data-treasury-bank-payment-form]');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';
    form.elements.rail?.addEventListener('change', () => setRailFields(form));
    setRailFields(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = form.querySelector('[data-treasury-bank-result]');
      try { showReview(form, validate(Object.fromEntries(new FormData(form).entries()))); }
      catch (error) { if (result) result.textContent = error.message; }
    });
  }

  function openCashPosition(workspace) {
    workspace?.querySelector('[data-admin-tab="Cash Position"]')?.click();
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click', (event) => {
      const start = event.target.closest('[data-treasury-start-payment]');
      if (start) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openCashPosition(workspace);
        queueMicrotask(() => enhance(workspace));
      }
    }, true);
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; enhance(workspace); });
    };
    workspace.addEventListener('click', (event) => { if (event.target.closest('[data-admin-tab]')) schedule(); });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => { if (event.detail?.workspaceId === 'treasury') schedule(); });
    const observer = new MutationObserver(schedule);
    observer.observe(workspace,{ childList:true, subtree:true });
    observers.set(workspace,observer);
    schedule();
  }

  window.mountAdminTreasuryAchPayment = mount;
})();
