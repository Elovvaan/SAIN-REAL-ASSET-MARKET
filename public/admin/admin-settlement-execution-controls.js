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
  let lastBankLifecycleSuccess = null;

  function railDisplayName(rail) {
    if (rail === 'ACH') return 'ACH Network · Nacha';
    if (rail === 'FEDWIRE') return 'Fedwire Funds Service · ISO 20022';
    if (rail === 'WIRE') return 'Bank Wire';
    return rail;
  }

  function financingPackages(payload) {
    return (payload?.records?.exportPackages || []).filter((record) => {
      if (String(record?.exportKind || '').toUpperCase() !== 'FINANCING_DISBURSEMENT') return false;
      return String(record?.state || '').toUpperCase() === 'READY_FOR_SETTLEMENT_INSTRUCTION';
    });
  }

  function preparedBankInstructions(payload) {
    const records = payload?.instructions || payload?.records?.settlementInstructions || [];
    return records.filter((record) => {
      if (!bankRails.has(String(record?.rail || '').toUpperCase())) return false;
      if (String(record?.sourceType || '').toUpperCase() !== 'FINANCING_DISBURSEMENT') return false;
      return ['READY','DISPATCHED','ACCEPTED','EXECUTED','EXCEPTION'].includes(String(record?.state || '').toUpperCase());
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
    return values.length
      ? values.map((rail) => `<option value="${esc(rail)}">${esc(railDisplayName(rail))}</option>`).join('')
      : '<option value="">No bank settlement rails available</option>';
  }

  function preparationMarkup({ packages, rails }) {
    return `<section class="admin-record-card" data-settlement-instruction-preparation>
      <header><strong>New Bank Settlement Instruction</strong><em>PUBLIC STANDARD</em></header>
      <p style="color:#9a9a9a;margin:0 0 14px;line-height:1.5">Select the authorized financing export package. SRA supplies the financing reference, beneficiary, amount and currency. Enter the receiving institution instructions and select the settlement rail.</p>
      <form data-settlement-instruction-form autocomplete="off">
        <div class="admin-record-grid">
          <label><span>Export package / financing</span><select name="exportPackageId" required style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px">${packageOptions(packages)}</select></label>
          <label><span>Settlement rail</span><select name="rail" required style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px">${railOptions(rails)}</select></label>
          <label><span data-receiving-institution-label>Receiving institution</span><input name="bankName" type="text" placeholder="Receiving institution" required></label>
          <label><span>ABA routing number</span><input name="routingNumber" type="text" inputmode="numeric" pattern="[0-9]{9}" maxlength="9" placeholder="9 digits" required></label>
          <label><span data-account-label>Receiving account number</span><input name="accountNumber" type="password" inputmode="numeric" pattern="[0-9]{4,17}" maxlength="17" placeholder="4–17 digits" required></label>
          <label data-ach-account-type><span>ACH account type</span><select name="accountType" style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="CHECKING">Checking</option><option value="SAVINGS">Savings</option></select></label>
        </div>
        <div data-export-package-summary class="admin-record-grid" style="margin-top:14px"></div>
        <div data-standard-summary class="admin-record-grid" style="margin-top:14px"></div>
        <p style="color:#9a9a9a;font-size:12px;line-height:1.45;margin:12px 0">You do not re-enter the authorized amount. Preparing the instruction records the selected rail and receiving instructions; an execution connection is not required at this stage. For ACH, SRA derives the Receiving DFI Identification and Check Digit from the 9-digit ABA routing number and records the Nacha fields under the instruction. For Fedwire, SRA records the Fedwire Funds Service ISO 20022 vocabulary, including head.001 and the applicable credit-transfer message.</p>
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

  function refreshStandardSummary(form) {
    const rail = String(form.elements.rail.value || '').toUpperCase();
    const root = form.querySelector('[data-standard-summary]');
    if (!root) return;
    if (rail === 'ACH') {
      root.innerHTML = '<div><span>Network</span><strong>ACH Network</strong></div><div><span>Rules / format</span><strong>Nacha Operating Rules</strong></div><div><span>Routing structure</span><strong>Receiving DFI Identification + Check Digit</strong></div><div><span>Network reference</span><strong>Trace Number</strong></div>';
      return;
    }
    if (rail === 'FEDWIRE') {
      root.innerHTML = '<div><span>Service</span><strong>Fedwire Funds Service</strong></div><div><span>Message standard</span><strong>ISO 20022</strong></div><div><span>Financing credit transfer</span><strong>head.001 + pacs.008</strong></div><div><span>Fedwire reference</span><strong>IMAD</strong></div>';
      return;
    }
    root.innerHTML = '<div><span>Settlement standard</span><strong>Institution-defined bank wire instructions</strong></div>';
  }

  function refreshRailFields(form) {
    const rail = String(form.elements.rail.value || '').toUpperCase();
    const ach = form.querySelector('[data-ach-account-type]');
    if (ach) ach.style.display = rail === 'ACH' ? '' : 'none';
    form.elements.accountType.required = rail === 'ACH';
    const accountLabel = form.querySelector('[data-account-label]');
    if (accountLabel) accountLabel.textContent = rail === 'ACH' ? 'Account number' : rail === 'FEDWIRE' ? 'Creditor account' : 'Receiving account number';
    const institutionLabel = form.querySelector('[data-receiving-institution-label]');
    if (institutionLabel) institutionLabel.textContent = rail === 'FEDWIRE' ? 'Creditor Agent / receiving institution' : 'Receiving institution';
    refreshStandardSummary(form);
  }

  function standardResultText(instruction) {
    const details = instruction.standardDetails || {};
    if (instruction.rail === 'ACH') {
      const dfi = details.receivingDfiIdentification ? ` · Receiving DFI ${details.receivingDfiIdentification}-${details.checkDigit || ''}` : '';
      return `ACH Network · Nacha${dfi}`;
    }
    if (instruction.rail === 'FEDWIRE') return `Fedwire Funds Service · ISO 20022 · ${details.businessApplicationHeader || 'head.001'} + ${details.messageType || 'pacs.008'}`;
    return railDisplayName(instruction.rail);
  }

  async function prepareInstruction(form, packages) {
    const values = Object.fromEntries(new FormData(form).entries());
    const result = form.querySelector('[data-settlement-instruction-result]');
    const button = form.querySelector('button[type="submit"]');
    const pkg = selectedPackage(form, packages);
    if (!pkg) { result.textContent = 'Select a financing export package.'; return; }
    button.disabled = true;
    result.textContent = `Preparing ${railDisplayName(values.rail)} settlement instruction for ${pkg.exportPackageId}…`;
    try {
      const instruction = await request('/api/settlement-rails/instructions', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          exportPackageId: pkg.exportPackageId,
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
      result.textContent = `${instruction.instructionId} · ${standardResultText(instruction)} · ${instruction.currency} ${money(instruction.amount)} · READY`;
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
      ? `<option value="">Select prepared bank instruction</option>${instructions.map((record) => `<option value="${esc(record.instructionId)}">${esc(record.instructionId)} · ${esc(railDisplayName(record.rail))} · ${esc(record.currency || 'USD')} ${money(record.amount)} · ${esc(record.state)}</option>`).join('')}`
      : '<option value="">No prepared bank instruction</option>';
  }

  function selectedInstruction(form, instructions) {
    return instructions.find((record) => record.instructionId === form.elements.bankInstructionId.value) || null;
  }

  function executionMarkup({ bankInstructions, onChainStatus }) {
    const chainReady = (onChainStatus?.networks || []).some((item) => item.ready);
    return `<section class="admin-record-card" data-settlement-execution>
      <header><strong>Send Settlement</strong><em>DESTINATION VERIFICATION</em></header>
      <p style="color:#9a9a9a;margin:0 0 14px;line-height:1.5">The prepared bank instruction and its downstream lifecycle now stay together here. Record dispatch, institution acceptance, network execution, and reconciliation as those events occur.</p>
      <form data-settlement-execution-form autocomplete="off">
        <div class="admin-record-grid">
          <label><span>Execution path</span><select name="route" data-execution-route required style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="BANK">Bank rail</option><option value="ON_CHAIN">On-chain</option></select></label>
        </div>
        <div data-bank-execution-fields style="margin-top:12px">
          <div class="admin-record-grid"><label><span>Settlement instruction</span><select name="bankInstructionId" style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px">${bankInstructionOptions(bankInstructions)}</select></label></div>
          <div data-bank-lifecycle style="margin-top:12px"><div data-bank-lifecycle-summary class="admin-record-grid"></div><div data-bank-reference-fields class="admin-record-grid" style="margin-top:12px"></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button type="button" data-bank-lifecycle-action></button><span data-bank-lifecycle-result style="color:#d6a92f;font-size:12px"></span></div></div>
        </div>
        <div data-onchain-execution-fields class="admin-record-grid" style="display:none;margin-top:12px">
          <label><span>Network</span><select name="network" style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px">${networkOptions(onChainStatus)}</select></label>
          <label><span>Asset</span><input name="asset" type="text" placeholder="Asset"></label>
          <label><span>Amount</span><input name="amount" type="text" inputmode="decimal" placeholder="Amount"></label>
          <label><span>Destination address</span><input name="destinationAddress" type="text" placeholder="Destination address"></label>
        </div>
        <p data-bank-execution-status style="color:#9a9a9a;font-size:12px;line-height:1.45;margin:12px 0">This panel records the bank-rail lifecycle in SRA. It does not fabricate a network reference: Trace Number, IMAD, institution reference, and receiving confirmation are entered only when actually returned or confirmed by the applicable institution/network process.</p>
        <p data-onchain-execution-status style="display:none;color:#9a9a9a;font-size:12px;line-height:1.45;margin:12px 0">On-chain adapter: ${chainReady ? 'READY' : 'NOT READY'}. Enter the standard transfer inputs and send directly.</p>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button type="submit" data-execute-button>Send On Chain</button><span data-settlement-execution-result style="color:#d6a92f;font-size:12px"></span></div>
      </form>
    </section>`;
  }

  function renderBankLifecycle(form, instructions) {
    const instruction = selectedInstruction(form, instructions);
    const root = form.querySelector('[data-bank-lifecycle]');
    const summary = root?.querySelector('[data-bank-lifecycle-summary]');
    const fields = root?.querySelector('[data-bank-reference-fields]');
    const action = root?.querySelector('[data-bank-lifecycle-action]');
    const result = root?.querySelector('[data-bank-lifecycle-result]');
    if (!root || !summary || !fields || !action || !result) return;
    const successForSelection = lastBankLifecycleSuccess && (!instruction || lastBankLifecycleSuccess.instructionId === instruction.instructionId);
    result.textContent = successForSelection ? `${lastBankLifecycleSuccess.instructionId} · ${lastBankLifecycleSuccess.state}` : '';
    if (!instruction) {
      summary.innerHTML = '<div><span>Status</span><strong>Select a settlement instruction</strong></div>';
      fields.innerHTML = '';
      action.style.display = 'none';
      return;
    }
    const state = String(instruction.state || '').toUpperCase();
    summary.innerHTML = `<div><span>Instruction</span><strong>${esc(instruction.instructionId)}</strong></div><div><span>Rail</span><strong>${esc(railDisplayName(instruction.rail))}</strong></div><div><span>Amount</span><strong>${esc(instruction.currency || 'USD')} ${money(instruction.amount)}</strong></div><div><span>State</span><strong>${esc(state)}</strong></div>`;
    action.style.display = '';
    fields.innerHTML = '';
    if (state === 'READY') { action.textContent = 'Record Sent / Dispatch'; return; }
    if (state === 'DISPATCHED') {
      fields.innerHTML = '<label><span>Institution transaction reference</span><input name="institutionTransactionReference" type="text" placeholder="Reference returned by institution" required></label>';
      action.textContent = 'Record Institution Acceptance';
      return;
    }
    if (state === 'ACCEPTED') {
      fields.innerHTML = `<label><span>Institution transaction reference</span><input name="institutionTransactionReference" type="text" value="${esc(instruction.institutionTransactionReference || '')}" required></label><label><span>${instruction.rail === 'ACH' ? 'ACH Trace Number' : instruction.rail === 'FEDWIRE' ? 'Fedwire IMAD' : 'Network reference'}</span><input name="networkReference" type="text" placeholder="Network-assigned reference" required></label>`;
      action.textContent = 'Record Network Execution';
      return;
    }
    if (state === 'EXECUTED') {
      fields.innerHTML = `<label><span>Institution transaction reference</span><input name="institutionTransactionReference" type="text" value="${esc(instruction.institutionTransactionReference || '')}" required></label><label><span>${instruction.rail === 'ACH' ? 'ACH Trace Number' : instruction.rail === 'FEDWIRE' ? 'Fedwire IMAD' : 'Network reference'}</span><input name="networkReference" type="text" value="${esc(instruction.networkReference || '')}" required></label><label><span>Receiving confirmation reference</span><input name="receivingConfirmationReference" type="text" placeholder="Receiving confirmation" required></label><label><span>Confirmed amount</span><input name="confirmedAmount" type="number" inputmode="decimal" step="0.01" min="0.01" value="${Number(instruction.amount || 0).toFixed(2)}" required></label>`;
      action.textContent = 'Reconcile Settlement';
      return;
    }
    if (state === 'EXCEPTION') { action.textContent = 'Retry Dispatch'; return; }
    action.style.display = 'none';
  }

  async function transitionBankInstruction(form, instructions) {
    const instruction = selectedInstruction(form, instructions);
    const root = form.querySelector('[data-bank-lifecycle]');
    const result = root?.querySelector('[data-bank-lifecycle-result]');
    const action = root?.querySelector('[data-bank-lifecycle-action]');
    if (!instruction || !result || !action) return;
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const state = String(instruction.state || '').toUpperCase();
    let targetState = null;
    const body = {};
    if (state === 'READY' || state === 'EXCEPTION') targetState = 'DISPATCHED';
    else if (state === 'DISPATCHED') { targetState = 'ACCEPTED'; body.institutionTransactionReference = values.institutionTransactionReference; }
    else if (state === 'ACCEPTED') { targetState = 'EXECUTED'; body.institutionTransactionReference = values.institutionTransactionReference || instruction.institutionTransactionReference; body.networkReference = values.networkReference; }
    else if (state === 'EXECUTED') {
      const confirmedAmount = Number(String(values.confirmedAmount ?? '').trim());
      if (!Number.isFinite(confirmedAmount) || confirmedAmount <= 0) {
        result.textContent = 'Enter a valid finite confirmed amount before reconciling.';
        form.elements.confirmedAmount?.focus();
        return;
      }
      targetState = 'RECONCILED';
      body.institutionTransactionReference = values.institutionTransactionReference || instruction.institutionTransactionReference;
      body.networkReference = values.networkReference || instruction.networkReference;
      body.receivingConfirmationReference = values.receivingConfirmationReference;
      body.confirmedAmount = confirmedAmount;
    }
    if (!targetState) return;
    action.disabled = true;
    result.textContent = `Recording ${targetState}…`;
    try {
      const updated = await request(`/api/settlement-rails/instructions/${encodeURIComponent(instruction.instructionId)}/transition`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ state:targetState, ...body }) });
      const index = instructions.findIndex((item) => item.instructionId === updated.instructionId);
      if (index >= 0) instructions[index] = updated;
      lastBankLifecycleSuccess = { instructionId: updated.instructionId, state: updated.state };
      renderBankLifecycle(form, instructions);
      result.textContent = `${updated.instructionId} · ${updated.state}`;
      client()?.refresh(`settlement-${String(updated.state || '').toLowerCase()}`);
      window.dispatchEvent(new CustomEvent('sra:admin-refresh',{ detail:{ source:`settlement-${String(updated.state || '').toLowerCase()}` } }));
    } catch (error) { result.textContent = error.message; }
    finally { action.disabled = false; }
  }

  function setRequired(group, enabled, requireWhenEnabled = false) {
    group?.querySelectorAll('input,select').forEach((field) => {
      if (field.dataset.sraRequiredWhenEnabled === undefined) field.dataset.sraRequiredWhenEnabled = field.required ? 'true' : 'false';
      field.disabled = !enabled;
      field.required = enabled && (requireWhenEnabled || field.dataset.sraRequiredWhenEnabled === 'true');
    });
  }

  function toggleExecutionRoute(form, chainReady, instructions) {
    const onChain = form.elements.route.value === 'ON_CHAIN';
    const bankFields = form.querySelector('[data-bank-execution-fields]');
    const chainFields = form.querySelector('[data-onchain-execution-fields]');
    bankFields.style.display = onChain ? 'none' : '';
    chainFields.style.display = onChain ? '' : 'none';
    form.querySelector('[data-bank-execution-status]').style.display = onChain ? 'none' : '';
    form.querySelector('[data-onchain-execution-status]').style.display = onChain ? '' : 'none';
    setRequired(bankFields, !onChain);
    setRequired(chainFields, onChain, true);
    const button = form.querySelector('[data-execute-button]');
    button.style.display = onChain ? '' : 'none';
    button.disabled = onChain ? !chainReady : true;
    if (!onChain) renderBankLifecycle(form, instructions);
  }

  async function executeOnChain(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const result = form.querySelector('[data-settlement-execution-result]');
    const button = form.querySelector('button[type="submit"]');
    if (values.route !== 'ON_CHAIN') return;
    button.disabled = true;
    try {
      result.textContent = 'Building, signing, and broadcasting on-chain transaction…';
      const response = await request('/api/on-chain/transfers', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ network:values.network, asset:values.asset, amount:values.amount, destinationAddress:values.destinationAddress }) });
      result.textContent = `${response.state} · ${response.transactionId || 'transaction ID pending'}`;
      client()?.refresh('settlement-executed');
      window.dispatchEvent(new CustomEvent('sra:admin-refresh',{ detail:{ source:'settlement-executed' } }));
    } catch (error) { result.textContent = error.message; }
    finally { button.disabled = false; }
  }

  async function renderPreparation(workspace, controls) {
    const [workspaces, railCatalog] = await Promise.all([ request('/api/admin/workspaces?limit=100').catch(() => ({ records:{} })), request('/api/settlement-rails/rails').catch(() => ({ rails:[] })) ]);
    if (!controls.isConnected || workspace.dataset.activeTab !== 'Settlement Instructions') return;
    const packages = financingPackages(workspaces);
    const rails = railCatalog.rails || [];
    controls.insertAdjacentHTML('afterbegin', preparationMarkup({ packages, rails }));
    const form = controls.querySelector('[data-settlement-instruction-form]');
    if (!form) return;
    refreshPackageSummary(form, packages);
    refreshRailFields(form);
    form.elements.exportPackageId.addEventListener('change', () => {
      const pkg = selectedPackage(form, packages);
      refreshPackageSummary(form, packages);
      if (pkg?.preferredRail && bankRails.has(String(pkg.preferredRail).toUpperCase())) { form.elements.rail.value = String(pkg.preferredRail).toUpperCase(); refreshRailFields(form); }
    });
    form.elements.rail.addEventListener('change', () => refreshRailFields(form));
    form.addEventListener('submit', (event) => { event.preventDefault(); void prepareInstruction(form, packages); });
  }

  async function renderExecution(workspace, controls) {
    controls.querySelector('[data-native-ach-destination-control]')?.remove();
    const [instructionPayload, onChainStatus] = await Promise.all([ request('/api/settlement-rails/instructions').catch(() => ({ instructions:[] })), request('/api/on-chain/status').catch(() => ({ networks:[] })) ]);
    if (!controls.isConnected || workspace.dataset.activeTab !== 'Destination Verification') return;
    const instructions = preparedBankInstructions(instructionPayload);
    controls.insertAdjacentHTML('afterbegin', executionMarkup({ bankInstructions: instructions, onChainStatus }));
    const form = controls.querySelector('[data-settlement-execution-form]');
    if (!form) return;
    const chainReady = (onChainStatus.networks || []).some((item) => item.ready);
    toggleExecutionRoute(form, chainReady, instructions);
    form.elements.route.addEventListener('change', () => toggleExecutionRoute(form, chainReady, instructions));
    form.elements.bankInstructionId.addEventListener('change', () => renderBankLifecycle(form, instructions));
    form.querySelector('[data-bank-lifecycle-action]')?.addEventListener('click', () => void transitionBankInstruction(form, instructions));
    form.addEventListener('submit', (event) => { event.preventDefault(); void executeOnChain(form); });
  }

  async function render(workspace) {
    const controls = workspace?.querySelector('.admin-workspace-controls');
    if (!controls) return;
    controls.querySelector('[data-live-ach-control]')?.remove();
    controls.querySelector('[data-settlement-instruction-preparation]')?.remove();
    controls.querySelector('[data-settlement-execution]')?.remove();
    if (workspace.dataset.activeTab === 'Settlement Instructions') return renderPreparation(workspace, controls);
    if (workspace.dataset.activeTab === 'Destination Verification') return renderExecution(workspace, controls);
  }

  function mount(workspace) {
    if (!workspace || workspace.dataset.settlementExecutionMounted === 'true') return;
    workspace.dataset.settlementExecutionMounted = 'true';
    workspace.addEventListener('click', (event) => { if (!event.target.closest('[data-admin-tab]')) return; setTimeout(() => void render(workspace), 0); });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => { if (event.detail?.workspaceId === 'settlement') void render(workspace); });
    void render(workspace);
  }

  window.mountAdminSettlementExecutionControls = mount;
})();