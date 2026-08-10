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

  const bankRails = new Set(['ACH','FEDWIRE','WIRE']);

  function financingPackages(payload) {
    return (payload?.records?.exportPackages || []).filter((record) => {
      if (String(record?.exportKind || '').toUpperCase() !== 'FINANCING_DISBURSEMENT') return false;
      return String(record?.state || '').toUpperCase() === 'READY_FOR_SETTLEMENT_INSTRUCTION';
    });
  }

  function preparedBankInstructions(payload) {
    return (payload?.records?.settlementInstructions || []).filter((record) => {
      if (!bankRails.has(String(record?.rail || '').toUpperCase())) return false;
      if (String(record?.sourceType || '').toUpperCase() !== 'FINANCING_DISBURSEMENT') return false;
      return ['READY','DISPATCHED','ACCEPTED','EXECUTED'].includes(String(record?.state || '').toUpperCase());
    });
  }

  function networkOptions(status) {
    const networks = status?.networks || [];
    return networks.length
      ? networks.map((item) => `<option value="${esc(item.network)}">${esc(item.network)}</option>`).join('')
      : '<option value="">No configured network adapter</option>';
  }

  function packageOptions(packages) {
    if (!packages.length) return '<option value="">No financing export package is ready</option>';
    return `<option value="">Select financing export package</option>${packages.map((pkg) => `<option value="${esc(pkg.exportPackageId)}">${esc(pkg.exportPackageId)} · ${esc(pkg.beneficiaryName || 'Beneficiary')} · ${esc(pkg.currency || 'USD')} ${money(pkg.amount)}</option>`).join('')}`;
  }

  function railOptions(rails) {
    const values = (rails || []).map((item) => String(item.rail || '').toUpperCase()).filter((rail) => bankRails.has(rail));
    return values.length ? values.map((rail) => `<option value="${esc(rail)}">${esc(rail === 'FEDWIRE' ? 'Fedwire' : rail === 'ACH' ? 'ACH' : 'Bank Wire')}</option>`).join('') : '<option value="">No bank settlement rails available</option>';
  }

  function adapterOptions(adapters, rail) {
    const matching = (adapters || []).filter((item) => item.state === 'ACTIVE' && item.rail === rail);
    return matching.length
      ? matching.map((item) => `<option value="${esc(item.adapterId)}">${esc(item.institutionName || item.institutionId)} · ${esc(item.executionMode || 'BANK_PARTNER')}</option>`).join('')
      : '<option value="">No active adapter for this rail</option>';
  }

  function preparationMarkup({ packages, rails, adapters }) {
    const initialRail = (rails || []).map((item) => String(item.rail || '').toUpperCase()).find((rail) => bankRails.has(rail)) || '';
    return `<section class="admin-record-card" data-settlement-instruction-preparation>
      <header><strong>New Bank Settlement Instruction</strong><em>PREPARE</em></header>
      <p style="color:#9a9a9a;margin:0 0 14px;line-height:1.5">Select the authorized financing export package first. SRA supplies the financing reference, beneficiary, amount and currency from that package; you choose the bank rail and enter the destination instructions.</p>
      <form data-settlement-instruction-form autocomplete="off">
        <div class="admin-record-grid">
          <label><span>Export package / financing</span><select name="exportPackageId" required style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px">${packageOptions(packages)}</select></label>
          <label><span>Settlement rail</span><select name="rail" required style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px">${railOptions(rails)}</select></label>
          <label><span>Execution connection</span><select name="adapterId" required style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px">${adapterOptions(adapters, initialRail)}</select></label>
          <label><span>Receiving bank</span><input name="bankName" type="text" placeholder="Receiving bank" required></label>
          <label><span>Routing number</span><input name="routingNumber" type="text" inputmode="numeric" pattern="[0-9]{9}" maxlength="9" placeholder="9 digits" required></label>
          <label><span>Account number</span><input name="accountNumber" type="password" inputmode="numeric" pattern="[0-9]{4,17}" maxlength="17" placeholder="4–17 digits" required></label>
          <label data-ach-account-type><span>ACH account type</span><select name="accountType" style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="CHECKING">Checking</option><option value="SAVINGS">Savings</option></select></label>
        </div>
        <div data-export-package-summary class="admin-record-grid" style="margin-top:14px"></div>
        <p style="color:#9a9a9a;font-size:12px;line-height:1.45;margin:12px 0">The financing amount is taken from the authorized export package; it is not typed again here. ACH, Fedwire and bank wire use the same SRA settlement-instruction lifecycle. On-chain remains a separate direct execution path in Destination Verification.</p>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button type="submit">Prepare Settlement Instruction</button><span data-settlement-instruction-result style="color:#d6a92f;font-size:12px"></span></div>
      </form>
    </section>`;
  }

  function selectedPackage(form, packages) {
    return packages.find((pkg) => pkg.exportPackageId === form.elements.exportPackageId.value) || null;
  }

  function refreshPackageSummary(form, packages) {
    const pkg = selectedPackage(form, packages);
    const root = form.querySelector('[data-export-package-summary]');
    if (!root) return;
    if (!pkg) {
      root.innerHTML = '<div><span>Financing</span><strong>Select an export package</strong></div>';
      return;
    }
    root.innerHTML = `<div><span>Financing reference</span><strong>${esc(pkg.financingTransactionId || pkg.exportPackageId)}</strong></div><div><span>Beneficiary</span><strong>${esc(pkg.beneficiaryName || '—')}</strong></div><div><span>Amount</span><strong>${esc(pkg.currency || 'USD')} ${money(pkg.amount)}</strong></div><div><span>Opportunity</span><strong>${esc(pkg.opportunityId || '—')}</strong></div>`;
  }

  function refreshRailFields(form, adapters) {
    const rail = String(form.elements.rail.value || '').toUpperCase();
    form.elements.adapterId.innerHTML = adapterOptions(adapters, rail);
    const ach = form.querySelector('[data-ach-account-type]');
    if (ach) ach.style.display = rail === 'ACH' ? '' : 'none';
    form.elements.accountType.required = rail === 'ACH';
  }

  async function prepareInstruction(form, packages) {
    const values = Object.fromEntries(new FormData(form).entries());
    const result = form.querySelector('[data-settlement-instruction-result]');
    const button = form.querySelector('button[type="submit"]');
    const pkg = selectedPackage(form, packages);
    if (!pkg) { result.textContent = 'Select a financing export package.'; return; }
    button.disabled = true;
    result.textContent = `Preparing ${values.rail} settlement instruction for ${pkg.exportPackageId}…`;
    try {
      const instruction = await request('/api/settlement-rails/instructions', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          exportPackageId: pkg.exportPackageId,
          adapterId: values.adapterId,
          rail: values.rail,
          amount: Number(pkg.amount),
          currency: pkg.currency || 'USD',
          beneficiaryName: pkg.beneficiaryName,
          receivingInstitutionReference: values.bankName,
          receivingAccountReference: values.accountNumber,
          routingNumber: values.routingNumber,
          accountType: values.rail === 'ACH' ? values.accountType : null,
          purpose: 'SRA_FINANCING_DISBURSEMENT',
          remittanceReference: pkg.exportPackageId,
        }),
      });
      form.elements.routingNumber.value = '';
      form.elements.accountNumber.value = '';
      result.textContent = `${instruction.instructionId} · ${instruction.rail} · ${instruction.currency} ${money(instruction.amount)} · READY`;
      client()?.refresh('financing-settlement-instruction-prepared');
      window.dispatchEvent(new CustomEvent('sra:admin-refresh',{ detail:{ source:'financing-settlement-instruction-prepared' } }));
    } catch (error) {
      result.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function bankInstructionOptions(instructions) {
    return instructions.length
      ? `<option value="">Select prepared bank instruction</option>${instructions.map((record) => `<option value="${esc(record.instructionId)}">${esc(record.instructionId)} · ${esc(record.rail)} · ${esc(record.currency || 'USD')} ${money(record.amount)} · ${esc(record.state)}</option>`).join('')}`
      : '<option value="">No prepared bank instruction</option>';
  }

  function executionMarkup({ bankInstructions, onChainStatus }) {
    const chainReady = (onChainStatus?.networks || []).some((item) => item.ready);
    return `<section class="admin-record-card" data-settlement-execution>
      <header><strong>Send Settlement</strong><em>DESTINATION VERIFICATION</em></header>
      <p style="color:#9a9a9a;margin:0 0 14px;line-height:1.5">Bank instructions prepared from financing export packages are shown here for destination verification. On-chain execution remains unchanged and sends directly through the normal network transfer flow.</p>
      <form data-settlement-execution-form autocomplete="off">
        <div class="admin-record-grid">
          <label><span>Execution path</span><select name="route" data-execution-route required style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="BANK">Bank rail</option><option value="ON_CHAIN">On-chain</option></select></label>
        </div>
        <div data-bank-execution-fields class="admin-record-grid" style="margin-top:12px">
          <label><span>Settlement instruction</span><select name="bankInstructionId" style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px">${bankInstructionOptions(bankInstructions)}</select></label>
        </div>
        <div data-onchain-execution-fields class="admin-record-grid" style="display:none;margin-top:12px">
          <label><span>Network</span><select name="network" style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px">${networkOptions(onChainStatus)}</select></label>
          <label><span>Asset</span><input name="asset" type="text" placeholder="Asset"></label>
          <label><span>Amount</span><input name="amount" type="text" inputmode="decimal" placeholder="Amount"></label>
          <label><span>Destination address</span><input name="destinationAddress" type="text" placeholder="Destination address"></label>
        </div>
        <p data-bank-execution-status style="color:#9a9a9a;font-size:12px;line-height:1.45;margin:12px 0">Bank rail preparation is live. External bank/provider transmission is not simulated here; the prepared instruction must be consumed by a connected Treasury bank/provider adapter before SRA records settlement confirmation.</p>
        <p data-onchain-execution-status style="display:none;color:#9a9a9a;font-size:12px;line-height:1.45;margin:12px 0">On-chain adapter: ${chainReady ? 'READY' : 'NOT READY'}. Enter the standard transfer inputs and send directly.</p>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button type="submit" data-execute-button disabled>Bank Provider Required</button><span data-settlement-execution-result style="color:#d6a92f;font-size:12px"></span></div>
      </form>
    </section>`;
  }

  function setRequired(group, enabled) {
    group?.querySelectorAll('input,select').forEach((field) => {
      field.disabled = !enabled;
      field.required = enabled;
    });
  }

  function toggleExecutionRoute(form, chainReady) {
    const onChain = form.elements.route.value === 'ON_CHAIN';
    const bankFields = form.querySelector('[data-bank-execution-fields]');
    const chainFields = form.querySelector('[data-onchain-execution-fields]');
    bankFields.style.display = onChain ? 'none' : '';
    chainFields.style.display = onChain ? '' : 'none';
    form.querySelector('[data-bank-execution-status]').style.display = onChain ? 'none' : '';
    form.querySelector('[data-onchain-execution-status]').style.display = onChain ? '' : 'none';
    setRequired(bankFields, !onChain);
    setRequired(chainFields, onChain);
    const button = form.querySelector('[data-execute-button]');
    button.textContent = onChain ? 'Send On Chain' : 'Bank Provider Required';
    button.disabled = onChain ? !chainReady : true;
  }

  async function executeInstruction(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const result = form.querySelector('[data-settlement-execution-result]');
    const button = form.querySelector('button[type="submit"]');
    if (values.route !== 'ON_CHAIN') {
      result.textContent = 'Select On-chain to execute here. Bank instructions remain prepared until a real provider connector submits them.';
      return;
    }
    button.disabled = true;
    try {
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
      client()?.refresh('settlement-executed');
      window.dispatchEvent(new CustomEvent('sra:admin-refresh',{ detail:{ source:'settlement-executed' } }));
    } catch (error) {
      result.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function renderPreparation(workspace, controls) {
    const [workspaces, railCatalog, adapterCatalog] = await Promise.all([
      request('/api/admin/workspaces?limit=100').catch(() => ({ records:{} })),
      request('/api/settlement-rails/rails').catch(() => ({ rails:[] })),
      request('/api/settlement-rails/adapters?state=ACTIVE').catch(() => ({ adapters:[] })),
    ]);
    if (!controls.isConnected || workspace.dataset.activeTab !== 'Settlement Instructions') return;
    const packages = financingPackages(workspaces);
    const rails = railCatalog.rails || [];
    const adapters = adapterCatalog.adapters || [];
    controls.insertAdjacentHTML('afterbegin', preparationMarkup({ packages, rails, adapters }));
    const form = controls.querySelector('[data-settlement-instruction-form]');
    if (!form) return;
    refreshPackageSummary(form, packages);
    refreshRailFields(form, adapters);
    form.elements.exportPackageId.addEventListener('change', () => {
      const pkg = selectedPackage(form, packages);
      refreshPackageSummary(form, packages);
      if (pkg?.preferredRail && bankRails.has(String(pkg.preferredRail).toUpperCase())) {
        form.elements.rail.value = String(pkg.preferredRail).toUpperCase();
        refreshRailFields(form, adapters);
      }
    });
    form.elements.rail.addEventListener('change', () => refreshRailFields(form, adapters));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void prepareInstruction(form, packages);
    });
  }

  async function renderExecution(workspace, controls) {
    controls.querySelector('[data-native-ach-destination-control]')?.remove();
    const [workspaces, onChainStatus] = await Promise.all([
      request('/api/admin/workspaces?limit=100').catch(() => ({ records:{} })),
      request('/api/on-chain/status').catch(() => ({ networks:[] })),
    ]);
    if (!controls.isConnected || workspace.dataset.activeTab !== 'Destination Verification') return;
    controls.querySelector('[data-native-ach-destination-control]')?.remove();
    const instructions = preparedBankInstructions(workspaces);
    controls.insertAdjacentHTML('afterbegin', executionMarkup({ bankInstructions: instructions, onChainStatus }));
    const form = controls.querySelector('[data-settlement-execution-form]');
    if (!form) return;
    const chainReady = (onChainStatus.networks || []).some((item) => item.ready);
    toggleExecutionRoute(form, chainReady);
    form.elements.route.addEventListener('change', () => toggleExecutionRoute(form, chainReady));
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