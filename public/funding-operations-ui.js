(() => {
  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function style() {
    if (document.querySelector('#funding-operations-style')) return;
    const node = document.createElement('style');
    node.id = 'funding-operations-style';
    node.textContent = `
      .funding-ops{display:grid;gap:16px}.funding-ops-hero,.funding-ops-panel,.funding-detail{padding:20px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.025)}
      .funding-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}.funding-metric{padding:14px;border-radius:13px;background:rgba(255,255,255,.04)}.funding-metric strong{display:block;font-size:21px}.funding-metric span{font-size:12px;opacity:.7}
      .funding-ops-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.funding-phase-card{padding:15px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.025)}
      .funding-phase-head,.funding-panel-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.funding-phase-card small{display:block;opacity:.7;margin-top:8px}.funding-phase-state{font-size:11px;padding:5px 8px;border-radius:999px;background:rgba(45,190,120,.15);color:#7de0a9}
      .funding-ops-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.funding-ops-list{display:grid;gap:10px;margin-top:12px}.funding-ops-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:13px;border-radius:12px;background:rgba(255,255,255,.035);cursor:pointer}.funding-ops-row:hover{background:rgba(255,255,255,.06)}.funding-ops-row span{display:block;opacity:.72;font-size:12px;margin-top:4px}.funding-next{font-size:12px;text-align:right}
      .funding-intake-modal,.funding-detail{display:none}.funding-intake-modal.open,.funding-detail.open{display:block}.funding-intake-modal{padding:18px;border:1px solid rgba(215,166,42,.35);border-radius:16px;background:rgba(215,166,42,.06)}.funding-detail{scroll-margin-top:90px}
      .funding-intake-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.funding-intake-grid input,.funding-intake-grid select,.funding-intake-grid textarea{width:100%;box-sizing:border-box;padding:11px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#101010;color:#fff}.funding-intake-grid textarea{min-height:86px}.funding-intake-grid>.wide{grid-column:1/-1}
      .applicant-mode{grid-column:1/-1;display:grid;grid-template-columns:220px 1fr;gap:10px}.applicant-manual{display:none;grid-column:1/-1;grid-template-columns:1fr 1fr;gap:10px}.applicant-manual.open{display:grid}.applicant-manual .wide{grid-column:1/-1}
      .startup-intake{display:none;grid-column:1/-1;border-top:1px solid rgba(255,255,255,.12);padding-top:14px;margin-top:4px}.startup-intake.open{display:grid;gap:14px}.startup-section{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.025)}.startup-section h4,.startup-section p{grid-column:1/-1;margin:0}.startup-use-row{grid-column:1/-1;display:grid;grid-template-columns:1.1fr .55fr 1fr;gap:8px}.startup-checks{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.startup-checks label{display:flex;gap:8px;align-items:flex-start;padding:8px;background:rgba(255,255,255,.03);border-radius:8px;font-size:12px}.startup-checks input{width:auto;margin-top:2px}.startup-cert{grid-column:1/-1;padding:12px;border:1px solid rgba(215,166,42,.25);border-radius:10px}.startup-cert label{display:flex;gap:8px;align-items:flex-start}.startup-cert input{width:auto;margin-top:3px}
      .funding-intake-result{margin-top:10px;font-size:13px}.funding-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.funding-detail-card{padding:14px;border-radius:13px;background:rgba(255,255,255,.04)}.funding-detail-card span{display:block;font-size:12px;opacity:.7;margin-top:5px}.funding-evidence-list{display:grid;gap:7px;margin-top:10px}.funding-evidence-item{padding:10px;border-radius:10px;background:rgba(255,255,255,.035);font-size:12px}.funding-ops-empty{padding:16px;opacity:.7}
      @media(max-width:800px){.funding-ops-grid,.funding-metrics,.funding-intake-grid,.funding-detail-grid,.startup-section,.applicant-mode,.applicant-manual{grid-template-columns:1fr}.funding-ops-row{grid-template-columns:1fr}.funding-next{text-align:left}.startup-use-row,.startup-checks{grid-template-columns:1fr}}
    `;
    document.head.append(node);
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
    return payload;
  }

  function phaseCard(item) {
    const statuses = Object.entries(item.statusCounts || {}).slice(0, 3).map(([key, count]) => `${key}: ${count}`).join(' · ');
    return `<article class="funding-phase-card"><div class="funding-phase-head"><div><p class="eyebrow">PHASE ${item.phaseNumber}</p><strong>${esc(String(item.phase || '').replaceAll('_', ' '))}</strong></div><span class="funding-phase-state">READY</span></div><small>${item.count || 0} records${statuses ? ` · ${esc(statuses)}` : ''}</small></article>`;
  }

  function queueRow(item) {
    const amount = Number(item.requestedAmount || 0);
    return `<div class="funding-ops-row" data-opportunity-id="${esc(item.opportunityId)}"><div><strong>${esc(item.title || item.opportunityId)}</strong><span>${esc(item.opportunityId)} · ${esc(item.opportunityType || 'Opportunity')} · ${amount ? money.format(amount) : 'Amount pending'}</span><span>${esc(item.status || 'UNKNOWN')} · ${esc(item.fundingPhase || '')}</span></div><div class="funding-next"><strong>${esc(item.nextAction?.label || 'Review')}</strong><span>${esc(item.nextAction?.queue || '')}</span></div></div>`;
  }

  function startupFields() {
    const useRows = Array.from({ length: 8 }, (_, index) => `<div class="startup-use-row"><input name="startupUseItem${index}" placeholder="Use / item"><input name="startupUseCost${index}" type="number" min="0" step="0.01" placeholder="Estimated cost"><input name="startupUseEvidence${index}" placeholder="Evidence / source"></div>`).join('');
    const evidence = [
      ['GOVERNMENT_ID','Government-issued identification / applicant information'],['ENTITY_RECORDS','Entity formation / registration records'],['EQUIPMENT_INVENTORY_QUOTES','Equipment or inventory quotes'],['LEASE_WORKSPACE','Lease / workspace information'],['SUPPLIER_PRICING','Supplier pricing'],['PRODUCT_PRICING_MATERIALS','Website / product catalog / pricing materials'],['CUSTOMER_DEMAND','Preorders / contracts / letters of intent / customer interest'],['STARTUP_BUDGET_CASHFLOW','Startup budget and cash-flow projection'],['BANK_PAYMENT_INFORMATION','Existing business bank / payment information'],['COLLATERAL','Collateral information if proposed'],['OTHER_SUPPORT','Other supporting evidence'],
    ].map(([value,label]) => `<label><input type="checkbox" name="startupEvidenceChecklist" value="${value}">${label}</label>`).join('');
    const readiness = [
      ['entityFormation','Business/entity formed or formation planned'],['equipmentIdentified','Equipment identified'],['suppliersIdentified','Suppliers identified'],['pricingEstablished','Pricing established'],['workspaceIdentified','Workspace/location identified'],['salesChannelPlan','Website, sales channel, or point-of-sale plan'],['licensesPermitsResearched','Required licenses/permits researched'],['insuranceNeedsIdentified','Insurance needs identified'],['initialCustomersOrLeads','Initial customers, leads, preorders, or contracts'],['ownerContribution','Owner cash/equipment contribution, if any'],
    ].map(([value,label]) => `<label><input type="checkbox" name="startupReadiness" value="${value}">${label}</label>`).join('');
    return `<div class="startup-intake" id="startup-business-intake">
      <section class="startup-section"><h4>1. Applicant & Business</h4><input name="startupApplicantName" placeholder="Applicant name"><input name="startupBusinessLegalEntityName" placeholder="Business / legal entity name"><input name="startupBusinessTradeName" placeholder="Business / trade name"><input name="startupBusinessLocation" placeholder="Business location"><input name="startupEmailPhone" placeholder="Email / phone"><input name="startupBusinessFormationStatus" placeholder="Business formation status"></section>
      <section class="startup-section"><h4>2. What Are You Building?</h4><textarea class="wide" name="startupBusinessDescription" placeholder="What will the business sell, who will buy it, and how will it operate?"></textarea></section>
      <section class="startup-section"><h4>3. Funding Request</h4><input name="startupRequestedLaunchDate" placeholder="Requested startup / launch date"><textarea name="startupExactFundingPurpose" placeholder="Exact purpose of the financing"></textarea></section>
      <section class="startup-section"><h4>4. Use of Funds</h4><p>Break the request into specific uses. Add the evidence or source when it exists.</p>${useRows}</section>
      <section class="startup-section"><h4>5. Revenue & Repayment Model</h4><input name="startupPrimaryProductService" placeholder="Primary product / service"><input name="startupAverageSellingPrice" type="number" min="0" step="0.01" placeholder="Average selling price"><input name="startupDirectCost" type="number" min="0" step="0.01" placeholder="Estimated direct cost per sale / unit"><input name="startupMonthlySalesVolume" type="number" min="0" step="0.01" placeholder="Expected monthly sales volume"><input name="startupMonthlyRevenue" type="number" min="0" step="0.01" placeholder="Expected monthly revenue"><input name="startupMonthlyOperatingExpenses" type="number" min="0" step="0.01" placeholder="Expected monthly operating expenses"><input class="wide" name="startupMonthlyAvailableBeforeDebt" type="number" step="0.01" placeholder="Expected monthly amount available before debt payments"></section>
      <section class="startup-section"><h4>6. Customer & Sales Plan</h4><textarea name="startupTargetCustomer" placeholder="Who is the target customer?"></textarea><textarea name="startupSalesChannel" placeholder="How will customers find and purchase from the business?"></textarea><textarea class="wide" name="startupDemandEvidence" placeholder="What evidence supports expected demand? Preorders, customer interest, contracts, prior sales, market evidence, etc."></textarea></section>
      <section class="startup-section"><h4>7. Startup Readiness</h4><div class="startup-checks">${readiness}</div></section>
      <section class="startup-section"><h4>8. Supporting Evidence Checklist</h4><p>Check only what actually exists and is relevant. A startup is not expected to manufacture a history it does not have.</p><div class="startup-checks">${evidence}</div></section>
      <section class="startup-section"><h4>10. Applicant Statement</h4><input name="startupPrintedName" placeholder="Printed name"><input name="startupCertificationDate" type="date"><div class="startup-cert"><label><input type="checkbox" name="startupCertifiedAccurate" value="yes">I certify that the information provided is accurate to the best of my knowledge and that estimates or projections are identified as such.</label></div></section>
    </div>`;
  }

  function intakeForm() {
    return `<section class="funding-intake-modal" id="funding-intake-modal"><div class="funding-panel-head"><div><p class="eyebrow">REAL WORKFLOW</p><h3>Start a funding opportunity</h3><p>Capture the customer request directly into Phase 1.</p></div><button class="secondary-button" type="button" id="funding-intake-close">Close</button></div><form id="funding-opportunity-form" class="funding-intake-grid">
      <div class="applicant-mode"><select name="applicantSource" id="funding-applicant-source"><option value="EXISTING">Existing participant / account</option><option value="MANUAL">Manual applicant entry</option></select><input name="applicantParticipantId" id="funding-applicant-reference" placeholder="Participant ID, account ID, email, or exact participant name"></div>
      <div class="applicant-manual" id="funding-manual-applicant"><input name="applicantDisplayName" placeholder="Applicant / entity name"><select name="applicantType"><option value="ORGANIZATION">Organization</option><option value="PERSON">Person</option><option value="TRUST">Trust</option><option value="SPV">SPV / acquisition entity</option></select><input name="applicantEmail" type="email" placeholder="Applicant email (optional)"><input name="applicantPhone" placeholder="Applicant phone (optional)"></div>
      <input name="title" placeholder="Opportunity title" required><select name="opportunityType" id="funding-opportunity-type" required><option value="">Opportunity type</option><option value="STARTUP_BUSINESS">Startup business</option><option value="BUSINESS_ACQUISITION">Business acquisition</option><option value="PLATFORM">Platform</option><option value="PROJECT">Project</option><option value="CONSTRUCTION">Construction</option><option value="EQUIPMENT">Equipment</option><option value="WORKING_CAPITAL">Working capital</option><option value="INVOICE">Invoice</option></select><select name="purpose" required><option value="">Purpose</option><option value="STARTUP_LAUNCH">Startup / launch</option><option value="BUILD">Build</option><option value="DEVELOP">Develop</option><option value="EXPAND">Expand</option><option value="PURCHASE">Purchase</option><option value="WORKING_CAPITAL">Working capital</option><option value="REFINANCE">Refinance</option></select><input name="requestedAmount" type="number" min="1" step="0.01" placeholder="Requested amount" required><select name="currency"><option value="USD">USD</option></select><textarea class="wide" name="description" placeholder="Describe what is being funded and the expected result."></textarea>${startupFields()}<button class="primary-button" type="submit">Create opportunity record</button><div class="funding-intake-result" id="funding-intake-result"></div></form></section>`;
  }

  function startupPayload(formData) {
    const selected = new Set(formData.getAll('startupReadiness'));
    return {
      applicantBusiness: {
        applicantName: formData.get('startupApplicantName') || null,
        businessLegalEntityName: formData.get('startupBusinessLegalEntityName') || null,
        businessTradeName: formData.get('startupBusinessTradeName') || null,
        businessLocation: formData.get('startupBusinessLocation') || null,
        emailPhone: formData.get('startupEmailPhone') || null,
        businessFormationStatus: formData.get('startupBusinessFormationStatus') || null,
      },
      businessDescription: formData.get('startupBusinessDescription') || null,
      requestedLaunchDate: formData.get('startupRequestedLaunchDate') || null,
      exactFundingPurpose: formData.get('startupExactFundingPurpose') || null,
      useOfFunds: Array.from({ length: 8 }, (_, index) => ({ item: formData.get(`startupUseItem${index}`), estimatedCost: formData.get(`startupUseCost${index}`), evidenceSource: formData.get(`startupUseEvidence${index}`) })),
      revenueRepaymentModel: {
        primaryProductService: formData.get('startupPrimaryProductService') || null,
        averageSellingPrice: formData.get('startupAverageSellingPrice'),
        estimatedDirectCostPerSale: formData.get('startupDirectCost'),
        expectedMonthlySalesVolume: formData.get('startupMonthlySalesVolume'),
        expectedMonthlyRevenue: formData.get('startupMonthlyRevenue'),
        expectedMonthlyOperatingExpenses: formData.get('startupMonthlyOperatingExpenses'),
        expectedMonthlyAvailableBeforeDebtPayments: formData.get('startupMonthlyAvailableBeforeDebt'),
      },
      customerSalesPlan: {
        targetCustomer: formData.get('startupTargetCustomer') || null,
        salesChannel: formData.get('startupSalesChannel') || null,
        demandEvidence: formData.get('startupDemandEvidence') || null,
      },
      startupReadiness: {
        entityFormation: selected.has('entityFormation'), equipmentIdentified: selected.has('equipmentIdentified'), suppliersIdentified: selected.has('suppliersIdentified'), pricingEstablished: selected.has('pricingEstablished'), workspaceIdentified: selected.has('workspaceIdentified'), salesChannelPlan: selected.has('salesChannelPlan'), licensesPermitsResearched: selected.has('licensesPermitsResearched'), insuranceNeedsIdentified: selected.has('insuranceNeedsIdentified'), initialCustomersOrLeads: selected.has('initialCustomersOrLeads'), ownerContribution: selected.has('ownerContribution'),
      },
      supportingEvidenceChecklist: formData.getAll('startupEvidenceChecklist'),
      applicantStatement: { certifiedAccurate: formData.has('startupCertifiedAccurate'), printedName: formData.get('startupPrintedName') || null, date: formData.get('startupCertificationDate') || null },
    };
  }

  function startupDetail(record, completeness) {
    if (record.opportunityType !== 'STARTUP_BUSINESS') return '';
    const startup = record.startupFundingRequest || {};
    const revenue = startup.revenueRepaymentModel || {};
    const customer = startup.customerSalesPlan || {};
    const use = startup.useOfFunds || [];
    return `<section class="funding-ops-panel"><p class="eyebrow">STARTUP BUSINESS FUNDING REQUEST</p><div class="funding-detail-grid"><div class="funding-detail-card"><strong>${esc(startup.applicantBusiness?.businessLegalEntityName || 'Not entered')}</strong><span>Business / legal entity</span></div><div class="funding-detail-card"><strong>${esc(startup.requestedLaunchDate || 'Not entered')}</strong><span>Requested launch date</span></div><div class="funding-detail-card"><strong>${money.format(Number(revenue.expectedMonthlyRevenue || 0))}</strong><span>Expected monthly revenue</span></div><div class="funding-detail-card"><strong>${money.format(Number(revenue.expectedMonthlyAvailableBeforeDebtPayments || 0))}</strong><span>Available before debt payments</span></div></div><p>${esc(startup.businessDescription || '')}</p><p><strong>Target customer:</strong> ${esc(customer.targetCustomer || 'Not entered')}</p><div class="funding-evidence-list">${use.length ? use.map((line) => `<div class="funding-evidence-item"><strong>${esc(line.item || 'Use')}</strong><span>${money.format(Number(line.estimatedCost || 0))}${line.evidenceSource ? ` · ${esc(line.evidenceSource)}` : ''}</span></div>`).join('') : '<div class="funding-ops-empty">No use-of-funds lines entered.</div>'}</div><p>${completeness?.startup ? `Use-of-funds total: ${money.format(Number(completeness.startup.useOfFundsTotal || 0))} · Difference from request: ${money.format(Number(completeness.startup.useOfFundsDifference || 0))}` : ''}</p></section>`;
  }

  async function openDetail(root, opportunityId) {
    const panel = root.querySelector('#funding-detail');
    if (!panel) return;
    panel.classList.add('open');
    panel.innerHTML = '<div class="loading-state">Loading opportunity…</div>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const detail = await request(`/api/funding-operations/opportunities/${encodeURIComponent(opportunityId)}`);
      const record = detail.opportunity || {};
      const evidence = detail.intake?.evidence || [];
      const completeness = await request(`/api/funding/opportunities/${encodeURIComponent(opportunityId)}/completeness`).catch(() => null);
      const actions = [];
      if (record.status === 'INTAKE_IN_PROGRESS' && completeness?.intakeComplete) actions.push('<button class="primary-button" data-action="complete-intake">Complete intake</button>');
      if (['INTAKE_COMPLETE', 'PENDING_VERIFICATION'].includes(record.status)) actions.push('<button class="primary-button" data-action="create-verification">Create verification request</button>');
      panel.innerHTML = `<div class="funding-panel-head"><div><p class="eyebrow">OPPORTUNITY WORKSPACE</p><h3>${esc(record.title || record.opportunityId)}</h3><p>${esc(record.opportunityId)} · ${esc(record.status)} · ${esc(record.fundingPhase || '')}</p></div><button class="secondary-button" data-action="close-detail">Close</button></div><div class="funding-detail-grid"><div class="funding-detail-card"><strong>${money.format(Number(record.requestedAmount || 0))}</strong><span>Requested funding · ${esc(record.currency || '')}</span></div><div class="funding-detail-card"><strong>${esc(record.applicantParticipantId || 'Not linked')}</strong><span>Applicant participant</span></div><div class="funding-detail-card"><strong>${esc(record.opportunityType || '')}</strong><span>Opportunity type</span></div><div class="funding-detail-card"><strong>${esc(detail.nextAction?.label || 'Review')}</strong><span>Next controlled action</span></div></div>${startupDetail(record, completeness)}<div class="funding-ops-actions">${actions.join('') || '<span>No Phase 1 action is currently available from this screen.</span>'}</div><section class="funding-ops-panel"><p class="eyebrow">INTAKE COMPLETENESS</p><strong>${completeness?.intakeComplete ? 'Ready to complete' : 'Additional intake information required'}</strong><p>${completeness?.missingRequired?.length ? `Missing required: ${esc(completeness.missingRequired.join(', '))}` : 'All required intake fields are present.'}</p></section><section class="funding-ops-panel"><p class="eyebrow">EVIDENCE & REFERENCES</p><div class="funding-evidence-list">${evidence.length ? evidence.map((item) => `<div class="funding-evidence-item"><strong>${esc(item.title || item.evidenceType)}</strong><span>${esc(item.sourceReference || '')} · ${esc(item.verificationStatus || 'NOT_STARTED')}</span></div>`).join('') : '<div class="funding-ops-empty">No evidence records have been registered yet.</div>'}</div></section><div class="funding-intake-result" id="funding-detail-result"></div>`;
      panel.querySelector('[data-action="close-detail"]')?.addEventListener('click', () => panel.classList.remove('open'));
      panel.querySelector('[data-action="complete-intake"]')?.addEventListener('click', async () => {
        const result = panel.querySelector('#funding-detail-result');
        try {
          await request(`/api/funding/opportunities/${encodeURIComponent(opportunityId)}/complete-intake`, { method: 'POST', body: '{}' });
          if (result) result.textContent = 'Intake completed. Opportunity is ready for verification.';
          setTimeout(() => render(root), 700);
        } catch (error) { if (result) result.textContent = error.message; }
      });
      panel.querySelector('[data-action="create-verification"]')?.addEventListener('click', async () => {
        const result = panel.querySelector('#funding-detail-result');
        try {
          const created = await request(`/api/funding/opportunities/${encodeURIComponent(opportunityId)}/verification-requests`, { method: 'POST', body: '{}' });
          if (result) result.textContent = `Verification request ${created.verificationRequestId} created.`;
          setTimeout(() => render(root), 700);
        } catch (error) { if (result) result.textContent = error.message; }
      });
    } catch (error) {
      panel.innerHTML = `<strong>Opportunity could not load.</strong><p>${esc(error.message)}</p>`;
    }
  }

  async function render(root) {
    if (!root) return;
    style();
    root.innerHTML = '<div class="loading-state">Loading funding operations…</div>';
    try {
      const dashboard = await request('/api/funding-operations/dashboard');
      const metrics = dashboard.metrics || {};
      root.innerHTML = `<section class="funding-ops"><div class="funding-ops-hero"><p class="eyebrow">FUNDING ENGINE OPERATIONS</p><h2>Move each opportunity through one controlled lifecycle</h2><p>The operations queue identifies the next real action and opens the working opportunity workspace inside Financing.</p><div class="funding-metrics"><div class="funding-metric"><strong>${metrics.opportunities || 0}</strong><span>Funding opportunities</span></div><div class="funding-metric"><strong>${money.format(metrics.totalRequested || 0)}</strong><span>Total requested</span></div><div class="funding-metric"><strong>${metrics.activeQueueItems || 0}</strong><span>Active queue items</span></div><div class="funding-metric"><strong>${metrics.liveListings || 0}</strong><span>Live listings</span></div><div class="funding-metric"><strong>${metrics.confirmedCommitments || 0}</strong><span>Confirmed commitments</span></div><div class="funding-metric"><strong>${metrics.recognizedPositions || 0}</strong><span>Recognized positions</span></div></div><div class="funding-ops-actions"><button class="primary-button" id="funding-ops-new">Start opportunity intake</button><button class="secondary-button" id="funding-ops-refresh">Refresh operations</button></div></div>${intakeForm()}<section class="funding-detail" id="funding-detail"></section><div class="funding-ops-grid">${(dashboard.phases || []).map(phaseCard).join('')}</div><section class="funding-ops-panel"><div class="funding-panel-head"><div><p class="eyebrow">OPERATIONS QUEUE</p><h3>What needs to happen next</h3></div><span>${dashboard.queue?.length || 0} records</span></div><div class="funding-ops-list">${dashboard.queue?.length ? dashboard.queue.map(queueRow).join('') : '<div class="funding-ops-empty">No funding opportunities have been created yet.</div>'}</div></section></section>`;
      const modal = root.querySelector('#funding-intake-modal');
      root.querySelector('#funding-ops-new')?.addEventListener('click', () => modal?.classList.add('open'));
      root.querySelector('#funding-intake-close')?.addEventListener('click', () => modal?.classList.remove('open'));
      root.querySelector('#funding-ops-refresh')?.addEventListener('click', () => render(root));
      root.querySelectorAll('[data-opportunity-id]').forEach((row) => row.addEventListener('click', () => openDetail(root, row.dataset.opportunityId)));
      const typeSelect = root.querySelector('#funding-opportunity-type');
      const startupIntake = root.querySelector('#startup-business-intake');
      const applicantSource = root.querySelector('#funding-applicant-source');
      const applicantReference = root.querySelector('#funding-applicant-reference');
      const manualApplicant = root.querySelector('#funding-manual-applicant');
      const syncApplicantMode = () => {
        const manual = applicantSource?.value === 'MANUAL';
        manualApplicant?.classList.toggle('open', manual);
        if (applicantReference) {
          applicantReference.required = !manual;
          applicantReference.disabled = manual;
        }
        const manualName = manualApplicant?.querySelector('[name="applicantDisplayName"]');
        if (manualName) manualName.required = manual;
      };
      applicantSource?.addEventListener('change', syncApplicantMode);
      syncApplicantMode();
      typeSelect?.addEventListener('change', () => startupIntake?.classList.toggle('open', typeSelect.value === 'STARTUP_BUSINESS'));
      root.querySelector('#funding-opportunity-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const result = root.querySelector('#funding-intake-result');
        const formData = new FormData(form);
        const values = Object.fromEntries(formData.entries());
        const payload = { ...values, requestedAmount: Number(values.requestedAmount) };
        if (values.applicantSource === 'MANUAL') {
          delete payload.applicantParticipantId;
          payload.manualApplicant = {
            displayName: values.applicantDisplayName,
            type: values.applicantType || 'ORGANIZATION',
            contactEmail: values.applicantEmail || null,
            contactPhone: values.applicantPhone || null,
          };
        } else {
          payload.relatedParticipantIds = values.applicantParticipantId ? [values.applicantParticipantId] : [];
        }
        if (values.opportunityType === 'STARTUP_BUSINESS') payload.startupFundingRequest = startupPayload(formData);
        try {
          const record = await request('/api/funding/opportunities', { method: 'POST', body: JSON.stringify(payload) });
          if (result) result.innerHTML = `<strong>Created ${esc(record.opportunityId)}</strong> · ${esc(record.status)} · applicant ${esc(record.applicantParticipantId)}.`;
          form.reset();
          startupIntake?.classList.remove('open');
          syncApplicantMode();
          setTimeout(() => render(root), 900);
        } catch (error) { if (result) result.textContent = error.message; }
      });
      const fundingRoot = root.querySelector('.funding-ops');
      if (fundingRoot && typeof window.mountFundingVerificationDesk === 'function') {
        await window.mountFundingVerificationDesk(fundingRoot);
      }
      window.dispatchEvent(new CustomEvent('sra:funding-operations-rendered', { detail: { root } }));
    } catch (error) {
      root.innerHTML = `<div class="funding-ops-panel"><strong>Funding Operations could not load.</strong><p>${esc(error.message)}</p></div>`;
    }
  }

  window.renderParticipantFundingOperations = render;
})();