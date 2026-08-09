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
  const money = (value) => Number(value || 0).toLocaleString(undefined, { style:'currency', currency:'USD', minimumFractionDigits:2, maximumFractionDigits:2 });
  const digits = (value) => String(value || '').replace(/\D/g, '');
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  function paymentMarkup() {
    return `<form data-treasury-ach-payment-form autocomplete="off" style="margin-top:16px;border-top:1px solid #262626;padding-top:16px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <strong>ACH Payment</strong><span style="color:#9a9a9a;font-size:12px">Cash / Settlement USD</span>
      </div>
      <div data-treasury-ach-entry>
        <div class="admin-record-grid">
          <label><span>Amount USD</span><input name="amountUsd" type="number" min="0.01" step="0.01" value="1.00" required></label>
          <label><span>Receiving bank</span><input name="bankName" type="text" placeholder="Receiving bank" required></label>
          <label><span>Account type</span><select name="accountType" required style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="CHECKING">Checking</option><option value="SAVINGS">Savings</option></select></label>
          <label><span>Routing number</span><input name="routingNumber" type="text" inputmode="numeric" pattern="[0-9]{9}" maxlength="9" placeholder="9 digits" required></label>
          <label><span>Account number</span><input name="accountNumber" type="password" inputmode="numeric" pattern="[0-9]{4,17}" maxlength="17" placeholder="4–17 digits" required></label>
        </div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px">
          <button type="submit">Review Payment</button>
          <span style="color:#9a9a9a;font-size:12px">Review and send without leaving Treasury.</span>
        </div>
      </div>
      <div data-treasury-ach-review hidden></div>
      <div data-treasury-ach-result style="color:#d6a92f;font-size:12px;line-height:1.5;margin-top:12px"></div>
    </form>`;
  }

  function validate(values) {
    const amountUsd = Number(values.amountUsd);
    const routingNumber = digits(values.routingNumber);
    const accountNumber = digits(values.accountNumber);
    const bankName = String(values.bankName || '').trim();
    const accountType = String(values.accountType || '').trim().toUpperCase();
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('Enter an amount greater than zero.');
    if (!bankName) throw new Error('Receiving bank is required.');
    if (routingNumber.length !== 9) throw new Error('Enter a 9-digit ACH routing number.');
    if (accountNumber.length < 4 || accountNumber.length > 17) throw new Error('Enter a valid account number.');
    if (!['CHECKING','SAVINGS'].includes(accountType)) throw new Error('Select an account type.');
    return { amountUsd, bankName, accountType, routingNumber, accountNumber };
  }

  function showReview(form, payment) {
    const entry = form.querySelector('[data-treasury-ach-entry]');
    const review = form.querySelector('[data-treasury-ach-review]');
    const result = form.querySelector('[data-treasury-ach-result]');
    if (result) result.textContent = '';
    if (entry) entry.hidden = true;
    if (!review) return;
    review.hidden = false;
    review.innerHTML = `<div class="admin-record-grid">
      <div><span>Amount</span><strong>${esc(money(payment.amountUsd))}</strong></div>
      <div><span>Rail</span><strong>ACH</strong></div>
      <div><span>Receiving bank</span><strong>${esc(payment.bankName)}</strong></div>
      <div><span>Account type</span><strong>${esc(payment.accountType)}</strong></div>
      <div><span>Routing</span><strong>•••••${esc(payment.routingNumber.slice(-4))}</strong></div>
      <div><span>Account</span><strong>••••${esc(payment.accountNumber.slice(-4))}</strong></div>
    </div>
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:14px">
      <button type="button" data-treasury-ach-send>Send ACH</button>
      <button type="button" data-treasury-ach-edit>Edit</button>
      <span style="color:#9a9a9a;font-size:12px">Sending creates the settlement instruction, checks Treasury cash, and submits through the configured ACH connection.</span>
    </div>`;

    review.querySelector('[data-treasury-ach-edit]')?.addEventListener('click', () => {
      review.hidden = true;
      review.innerHTML = '';
      entry.hidden = false;
    });

    review.querySelector('[data-treasury-ach-send]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const edit = review.querySelector('[data-treasury-ach-edit]');
      button.disabled = true;
      if (edit) edit.disabled = true;
      if (result) result.textContent = 'Sending ACH payment…';
      try {
        const prepared = await request('/api/admin/treasury-transfer-readiness/ach/prepare', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(payment),
        });
        const instruction = prepared.transferInstruction || prepared.paymentInstruction || {};
        const transferInstructionId = instruction.transferInstructionId || instruction.transactionId;
        if (!transferInstructionId) throw new Error('ACH instruction was not created.');
        const execution = await request('/api/admin/treasury-transfer-readiness/ach/execute', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            transferInstructionId,
            bankName:payment.bankName,
            accountType:payment.accountType,
            routingNumber:payment.routingNumber,
            accountNumber:payment.accountNumber,
          }),
        });
        payment.routingNumber = '';
        payment.accountNumber = '';
        const evidence = execution.executionEvidence || {};
        review.innerHTML = `<div class="admin-record-grid">
          <div><span>Amount</span><strong>${esc(money(payment.amountUsd))}</strong></div>
          <div><span>Status</span><strong>${esc(evidence.providerStatus || execution.instruction?.state || 'SUBMITTED')}</strong></div>
          <div><span>Reference</span><strong>${esc(evidence.providerReference || transferInstructionId)}</strong></div>
          <div><span>Instruction</span><strong>${esc(transferInstructionId)}</strong></div>
        </div>`;
        if (result) result.textContent = 'ACH payment submitted. Settlement status remains available in the platform records.';
        window.SRAAdminDataClient?.refresh?.('treasury-ach-submitted');
      } catch (error) {
        if (result) result.textContent = error.message || 'ACH payment failed.';
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
    if (oldForm && !card.querySelector('[data-treasury-ach-payment-form]')) {
      const holder = document.createElement('div');
      holder.innerHTML = paymentMarkup();
      oldForm.replaceWith(holder.firstElementChild);
    }
    const form = card.querySelector('[data-treasury-ach-payment-form]');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = form.querySelector('[data-treasury-ach-result]');
      try {
        const payment = validate(Object.fromEntries(new FormData(form).entries()));
        showReview(form, payment);
      } catch (error) {
        if (result) result.textContent = error.message;
      }
    });
  }

  function openCashPosition(workspace) {
    const tab = workspace?.querySelector('[data-admin-tab="Cash Position"]');
    if (tab) tab.click();
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
      queueMicrotask(() => {
        queued = false;
        enhance(workspace);
      });
    };
    workspace.addEventListener('click', (event) => {
      if (event.target.closest('[data-admin-tab]')) schedule();
    });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => {
      if (event.detail?.workspaceId === 'treasury') schedule();
    });
    const observer = new MutationObserver(schedule);
    observer.observe(workspace, { childList:true, subtree:true });
    observers.set(workspace, observer);
    schedule();
  }

  window.mountAdminTreasuryAchPayment = mount;
})();
