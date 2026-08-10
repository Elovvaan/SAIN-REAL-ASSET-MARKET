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

  function eligibleAchInstructions(payload) {
    return (payload?.records?.settlementInstructions || []).filter((record) => {
      if (String(record?.transactionType || '').toUpperCase() !== 'EXTERNAL_TRANSFER_INSTRUCTION') return false;
      if (String(record?.route || '').toUpperCase() !== 'ACH') return false;
      if (Number(record?.amountUsd ?? record?.amount ?? record?.quantity) <= 0) return false;
      const prepared = record?.state === 'PREPARED' && record?.executionState === 'PREPARED' && record?.fundsState === 'UNRESERVED';
      const authorizedRetry = record?.state === 'READY_TO_SEND' && record?.executionState === 'AUTHORIZED' && record?.fundsState === 'HELD';
      return prepared || authorizedRetry;
    });
  }

  function networkOptions(status) {
    const networks = status?.networks || [];
    return networks.length
      ? networks.map((item) => `<option value="${esc(item.network)}">${esc(item.network)}</option>`).join('')
      : '<option value="">No configured network adapter</option>';
  }

  function preparationMarkup() {
    return `<section class="admin-record-card" data-settlement-instruction-preparation>
      <header><strong>New ACH Settlement Instruction</strong><em>PREPARE</em></header>
      <p style="color:#9a9a9a;margin:0 0 14px;line-height:1.5">Enter the ACH destination and amount to prepare the settlement instruction. On-chain transfers are sent directly from Destination Verification using the normal blockchain transaction flow.</p>
      <form data-settlement-instruction-form autocomplete="off">
        <div class="admin-record-grid">
          <label><span>Receiving bank / destination</span><input name="bankName" type="text" placeholder="Receiving bank" required></label>
          <label><span>Account type</span><select name="accountType" required style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="CHECKING">Checking</option><option value="SAVINGS">Savings</option></select></label>
          <label><span>Routing number</span><input name="routingNumber" type="text" inputmode="numeric" pattern="[0-9]{9}" maxlength="9" placeholder="9 digits" required></label>
          <label><span>Account number</span><input name="accountNumber" type="password" inputmode="numeric" pattern="[0-9]{4,17}" maxlength="17" placeholder="4–17 digits" required></label>
          <label><span>Amount USD</span><input name="amountUsd" type="number" min="0.01" step="0.01" placeholder="0.00" required></label>
        </div>
        <p style="color:#9a9a9a;font-size:12px;line-height:1.45;margin:12px 0">Routing and account numbers are used only to prepare the ACH destination and are not stored in SRA. Preparation does not reserve Treasury cash; cash availability is checked and reserved only when you execute in Destination Verification.</p>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button type="submit">Prepare ACH Instruction</button><span data-settlement-instruction-result style="color:#d6a92f;font-size:12px"></span></div>
      </form>
    </section>`;
  }

  async function prepareInstruction(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const result = form.querySelector('[data-settlement-instruction-result]');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    result.textContent = 'Preparing ACH settlement instruction…';
    try {
      const prepared = await request('/api/admin/treasury-transfer-readiness/ach/prepare', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          bankName: values.bankName,
          accountType: values.accountType,
          routingNumber: values.routingNumber,
          accountNumber: values.accountNumber,
          amountUsd: Number(values.amountUsd),
        }),
      });
      form.elements.routingNumber.value = '';
      form.elements.accountNumber.value = '';
      const instruction = prepared.transferInstruction || prepared.paymentInstruction || {};
      result.textContent = `Prepared ${instruction.transferInstructionId || instruction.transactionId || 'settlement instruction'} · USD ${money(instruction.amountUsd ?? values.amountUsd)} · PREPARED`;
      client()?.refresh('settlement-instruction-prepared');
      window.dispatchEvent(new CustomEvent('sra:admin-refresh',{ detail:{ source:'settlement-instruction-prepared' } }));
    } catch (error) {
      result.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function achInstructionOptions(instructions) {
    return instructions.map((record) => {
      const amount = record.amountUsd ?? record.amount ?? record.quantity;
      const currency = String(record.currency || 'USD').toUpperCase();
      const state = String(record.state || 'PREPARED').toUpperCase();
      return `<option value="${esc(record.transferInstructionId || record.transactionId)}">${esc(record.transferInstructionId || record.transactionId)} · ${esc(currency)} ${money(amount)} · ${esc(state)}</option>`;
    }).join('');
  }

  function executionMarkup({ achStatus, achInstructions, onChainStatus }) {
    const achReady = Boolean(achStatus?.ready);
    const chainReady = (onChainStatus?.networks || []).some((item) => item.ready);
    return `<section class="admin-record-card" data-settlement-execution>
      <header><strong>Send Settlement</strong><em>DESTINATION VERIFICATION</em></header>
      <p style="color:#9a9a9a;margin:0 0 14px;line-height:1.5">ACH executes a prepared ACH instruction. On-chain sends directly from network + asset + amount + destination address through build → sign → broadcast → transaction ID → confirm → record.</p>
      <form data-settlement-execution-form autocomplete="off">
        <div class="admin-record-grid">
          <label><span>Route</span><select name="route" data-execution-route required style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="ACH">ACH</option><option value="ON_CHAIN">On-chain</option></select></label>
        </div>
        <div data-ach-execution-fields class="admin-record-grid" style="margin-top:12px">
          <label><span>Settlement instruction</span><select name="transferInstructionId" style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="">Select prepared ACH instruction</option>${achInstructionOptions(achInstructions)}</select></label>
          <label><span>Receiving bank / destination</span><input name="bankName" placeholder="Receiving bank"></label>
          <label><span>Account type</span><select name="accountType" style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="CHECKING">Checking</option><option value="SAVINGS">Savings</option></select></label>
          <label><span>Routing number</span><input name="routingNumber" type="text" inputmode="numeric" pattern="[0-9]{9}" maxlength="9" placeholder="9 digits"></label>
          <label><span>Account number</span><input name="accountNumber" type="password" inputmode="numeric" pattern="[0-9]{4,17}" maxlength="17" placeholder="4–17 digits"></label>
        </div>
        <div data-onchain-execution-fields class="admin-record-grid" style="display:none;margin-top:12px">
          <label><span>Network</span><select name="network" style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px">${networkOptions(onChainStatus)}</select></label>
          <label><span>Asset</span><input name="asset" type="text" placeholder="Asset"></label>
          <label><span>Amount</span><input name="amount" type="text" inputmode="decimal" placeholder="Amount"></label>
          <label><span>Destination address</span><input name="destinationAddress" type="text" placeholder="Destination address"></label>
        </div>
        <p data-ach-execution-status style="color:#9a9a9a;font-size:12px;line-height:1.45;margin:12px 0">ACH connection: ${achReady ? 'READY' : 'NOT READY'} · endpoint ${achStatus?.endpointConfigured ? 'configured' : 'not configured'} · credential ${achStatus?.credentialConfigured ? 'configured' : 'not configured'}. At execution, SRA checks available Treasury cash, reserves the instruction amount, then submits to the configured provider. Bank details are supplied transiently.</p>
        <p data-onchain-execution-status style="display:none;color:#9a9a9a;font-size:12px;line-height:1.45;margin:12px 0">On-chain adapter: ${chainReady ? 'READY' : 'NOT READY'}. Enter the standard transfer inputs and send directly.</p>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button type="submit" data-execute-button>Execute ACH</button><span data-settlement-execution-result style="color:#d6a92f;font-size:12px"></span></div>
      </form>
    </section>`;
  }

  function setRequired(group, enabled) {
    group?.querySelectorAll('input,select').forEach((field) => {
      field.disabled = !enabled;
      field.required = enabled;
    });
  }

  function toggleExecutionRoute(form, status) {
    const onChain = form.elements.route.value === 'ON_CHAIN';
    const achFields = form.querySelector('[data-ach-execution-fields]');
    const chainFields = form.querySelector('[data-onchain-execution-fields]');
    achFields.style.display = onChain ? 'none' : '';
    chainFields.style.display = onChain ? '' : 'none';
    form.querySelector('[data-ach-execution-status]').style.display = onChain ? 'none' : '';
    form.querySelector('[data-onchain-execution-status]').style.display = onChain ? '' : 'none';
    setRequired(achFields, !onChain);
    setRequired(chainFields, onChain);
    const button = form.querySelector('[data-execute-button]');
    button.textContent = onChain ? 'Send On Chain' : 'Execute ACH';
    const ready = onChain ? status.chainReady : status.achReady;
    const hasRequiredInput = onChain ? true : status.achCount > 0;
    button.disabled = !ready || !hasRequiredInput;
  }

  async function executeInstruction(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const result = form.querySelector('[data-settlement-execution-result]');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      if (values.route === 'ON_CHAIN') {
        result.textContent = 'Building, signing, and broadcasting on-chain transaction…';
        const response = await request('/api/on-chain/transfers', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            network:values.network,
            asset:values.asset,
            amount:values.amount,
            destinationAddress:values.destinationAddress,
          }),
        });
        result.textContent = `${response.state} · ${response.transactionId || 'transaction ID pending'}`;
      } else {
        result.textContent = 'Checking Treasury cash, reserving amount, and submitting ACH…';
        const response = await request('/api/admin/treasury-transfer-readiness/ach/execute', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(values),
        });
        form.elements.routingNumber.value = '';
        form.elements.accountNumber.value = '';
        result.textContent = `Provider ${response.executionEvidence?.providerStatus || 'accepted'} · ${response.executionEvidence?.providerReference || 'reference recorded'} · receiving confirmation required`;
      }
      client()?.refresh('settlement-executed');
      window.dispatchEvent(new CustomEvent('sra:admin-refresh',{ detail:{ source:'settlement-executed' } }));
    } catch (error) {
      result.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function renderPreparation(workspace, controls) {
    if (!controls.isConnected || workspace.dataset.activeTab !== 'Settlement Instructions') return;
    controls.insertAdjacentHTML('afterbegin', preparationMarkup());
    const form = controls.querySelector('[data-settlement-instruction-form]');
    if (!form) return;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void prepareInstruction(form);
    });
  }

  async function renderExecution(workspace, controls) {
    controls.querySelector('[data-native-ach-destination-control]')?.remove();
    const [executionStatus, workspaces, onChainStatus] = await Promise.all([
      request('/api/admin/treasury-transfer-readiness/execution/status').catch(() => ({ rails:[] })),
      request('/api/admin/workspaces?limit=100').catch(() => ({ records:{} })),
      request('/api/on-chain/status').catch(() => ({ networks:[] })),
    ]);
    if (!controls.isConnected || workspace.dataset.activeTab !== 'Destination Verification') return;
    controls.querySelector('[data-native-ach-destination-control]')?.remove();
    const achStatus = (executionStatus.rails || []).find((item) => item.rail === 'ACH') || {};
    const achInstructions = eligibleAchInstructions(workspaces);
    controls.insertAdjacentHTML('afterbegin', executionMarkup({ achStatus, achInstructions, onChainStatus }));
    const form = controls.querySelector('[data-settlement-execution-form]');
    if (!form) return;
    const status = {
      achReady:Boolean(achStatus.ready),
      chainReady:(onChainStatus.networks || []).some((item) => item.ready),
      achCount:achInstructions.length,
    };
    toggleExecutionRoute(form, status);
    form.elements.route.addEventListener('change', () => toggleExecutionRoute(form, status));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void executeInstruction(form);
    });
  }

  async function render(workspace) {
    const controls = workspace?.querySelector('.admin-workspace-controls');
    if (!controls) return;
    controls.querySelector('[data-live-ach-control]')?.remove();
    controls.querySelector('[data-settlement-instruction-preparation]')?.remove();
    controls.querySelector('[data-settlement-execution]')?.remove();

    if (workspace.dataset.activeTab === 'Settlement Instructions') {
      await renderPreparation(workspace, controls);
      return;
    }
    if (workspace.dataset.activeTab === 'Destination Verification') {
      await renderExecution(workspace, controls);
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
