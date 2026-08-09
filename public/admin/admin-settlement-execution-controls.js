(() => {
  if (window.__sraAdminSettlementExecutionControlsInstalled) return;
  window.__sraAdminSettlementExecutionControlsInstalled = true;

  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const money = (value) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const client = () => window.SRAAdminDataClient;
  const request = async (url, options = {}) => {
    if (client()) return client().json(url, options);
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };

  function eligibleInstructions(payload) {
    return (payload?.records?.settlementInstructions || []).filter((record) =>
      String(record?.transactionType || '').toUpperCase() === 'EXTERNAL_TRANSFER_INSTRUCTION'
      && String(record?.route || '').toUpperCase() === 'ACH'
      && Number(record?.amountUsd ?? record?.amount ?? record?.quantity) > 0
      && record?.state === 'READY_TO_SEND'
      && record?.executionState === 'AUTHORIZED'
      && record?.fundsState === 'HELD');
  }

  async function render(workspace) {
    const controls = workspace?.querySelector('.admin-workspace-controls');
    if (!controls) return;
    controls.querySelector('[data-live-ach-control]')?.remove();
    if (workspace.dataset.activeTab !== 'Settlement Instructions') return;

    const section = document.createElement('section');
    section.className = 'admin-record-card';
    section.dataset.liveAchControl = 'true';
    section.innerHTML = '<header><strong>Live ACH Payment</strong><em>CHECKING</em></header><p>Reading provider readiness and authorized ACH payments…</p>';
    controls.prepend(section);

    try {
      const [status, workspaces] = await Promise.all([
        request('/api/admin/treasury-transfer-readiness/execution/status'),
        request('/api/admin/workspaces?limit=100'),
      ]);
      if (!section.isConnected || workspace.dataset.activeTab !== 'Settlement Instructions') return;
      const ach = (status.rails || []).find((item) => item.rail === 'ACH') || {};
      const instructions = eligibleInstructions(workspaces);
      section.innerHTML = `<header><strong>Live ACH Payment</strong><em>${ach.ready ? 'LIVE READY' : 'PROVIDER NOT READY'}</em></header>
        <div class="admin-record-grid">
          <div><span>Execution mode</span><strong>${esc(ach.mode || 'DISABLED')}</strong></div>
          <div><span>ACH endpoint</span><strong>${ach.endpointConfigured ? 'CONFIGURED' : 'NOT CONFIGURED'}</strong></div>
          <div><span>Credential</span><strong>${ach.credentialConfigured ? 'CONFIGURED' : 'NOT CONFIGURED'}</strong></div>
          <div><span>Authorized ACH payments</span><strong>${instructions.length}</strong></div>
        </div>
        <form data-live-ach-form autocomplete="off" style="margin-top:14px">
          <div class="admin-record-grid">
            <label><span>Payment</span><select name="transferInstructionId" required style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="">Select authorized ACH payment</option>${instructions.map((record) => { const amount = record.amountUsd ?? record.amount ?? record.quantity; const currency = String(record.currency || 'USD').toUpperCase(); return `<option value="${esc(record.transferInstructionId || record.transactionId)}">${esc(record.transferInstructionId || record.transactionId)} · ${esc(currency)} ${money(amount)}</option>`; }).join('')}</select></label>
            <label><span>Bank / destination label</span><input name="bankName" placeholder="Receiving bank" required></label>
            <label><span>Account type</span><select name="accountType" required style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="CHECKING">Checking</option><option value="SAVINGS">Savings</option></select></label>
            <label><span>Routing number</span><input name="routingNumber" type="text" inputmode="numeric" pattern="[0-9]{9}" maxlength="9" placeholder="9 digits" required></label>
            <label><span>Account number</span><input name="accountNumber" type="password" inputmode="numeric" pattern="[0-9]{4,17}" maxlength="17" placeholder="4–17 digits" required></label>
          </div>
          <p style="color:#9a9a9a;font-size:12px;line-height:1.45;margin:12px 0">Routing and account numbers are used only for this provider request and are not stored in SRA. The authorized payment instruction supplies the amount and send authority. Receiving confirmation completes reconciliation.</p>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button type="submit" ${!ach.ready || instructions.length === 0 ? 'disabled' : ''}>Send ACH</button><span data-live-ach-result style="color:#d6a92f;font-size:12px">${instructions.length ? '' : 'Authorize an ACH payment first.'}</span></div>
        </form>`;

      section.querySelector('[data-live-ach-form]')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = Object.fromEntries(new FormData(form).entries());
        const result = form.querySelector('[data-live-ach-result]');
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        result.textContent = 'Sending to configured ACH provider…';
        try {
          const response = await request('/api/admin/treasury-transfer-readiness/ach/execute', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(values),
          });
          form.elements.routingNumber.value = '';
          form.elements.accountNumber.value = '';
          result.textContent = `Provider ${response.executionEvidence?.providerStatus || 'accepted'} · ${response.executionEvidence?.providerReference || 'reference recorded'} · receiving confirmation required`;
          client()?.refresh('live-ach');
        } catch (error) {
          result.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      });
    } catch (error) {
      section.innerHTML = `<header><strong>Live ACH Payment</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`;
    }
  }

  function mount(workspace) {
    if (!workspace || workspace.dataset.settlementExecutionMounted === 'true') return;
    workspace.dataset.settlementExecutionMounted = 'true';
    workspace.addEventListener('click', (event) => {
      if (!event.target.closest('[data-admin-tab]')) return;
      setTimeout(() => void render(workspace), 0);
    });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => {
      if (event.detail?.workspaceId === 'settlement') void render(workspace);
    });
    void render(workspace);
  }

  window.mountAdminSettlementExecutionControls = mount;
})();