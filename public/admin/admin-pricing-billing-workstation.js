(() => {
  if (window.mountAdminPricingBillingWorkstation) return;
  const mounted = new WeakSet();
  const versions = new WeakMap();
  const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const amount = value => Number(value || 0).toFixed(2);
  const request = (path, body) => window.SRAAdminDataClient.json(`/api/economics${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const field = (name, label, type = 'text', extra = '') => `<label>${esc(label)}<input name="${name}" type="${type}" ${extra} required></label>`;
  const table = (headers, rows) => `<div style="overflow:auto"><table><thead><tr>${headers.map(h => `<th style="padding:8px;text-align:left">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td style="padding:8px">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const card = (title, content) => `<section class="admin-record-card"><header><strong>${esc(title)}</strong></header>${content}</section>`;
  function renderView(report, tab) {
    const rates = report.serviceRates;
    const overview = table(['Currency', 'Invoiced', 'Waivers on invoices', 'Recorded collections', 'Outstanding', 'Compensation earned', 'Compensation paid', 'Unmatched payment journals'], report.totals.map(row => [esc(row.currency), ...['invoicedGross','invoicedWaivers','collected','outstanding','compensationAccrued','compensationPaid','unmatchedPaymentJournals'].map(key => amount(row[key]))]));
    if (tab === 'Overview') return card('Pricing and billing', overview + `<p>Collections use posted fee-payment records. Reconcile them to bank statements and payment evidence before using them in financing projections.</p>`) + card('Existing service prices', table(['Service','USD per accepted billable item','Accepted work','Charged work'], rates.map(rate => [esc(rate.serviceName), amount(rate.amount), rate.acceptedWorkCount, rate.chargedWorkCount]))) + card('Capability tiers', table(['Tier','Economic basis'], report.tiers.map(tier => [esc(tier.label), esc(tier.feeBasis)]))) + `<p>No new customer prices or activity volumes are assumed.</p>`;
    if (tab === 'Schedules') return card('Saved fee schedules', table(['Name','Version','State','Rules','Action'], report.schedules.map(schedule => [esc(schedule.name),esc(schedule.version),esc(schedule.state), `<pre>${esc(JSON.stringify(schedule.rules,null,2))}</pre>`,schedule.state === 'DRAFT' ? `<button data-activate="${esc(schedule.scheduleId)}">Activate schedule</button>` : '—'])) + `<button data-agent-schedule>Load established agent service schedule</button>`) + card('Add fee catalog item', `<form data-operation="catalog">${field('feeCode','Fee code')}${field('name','Name')}${field('category','Category')}${field('defaultPayerType','Payer type')}${field('currency','Currency','text','value="USD"')}<button type="submit">Save fee item</button></form>`) + card('Create draft price', `<form data-operation="schedule">${field('name','Schedule name')}${field('version','Version')}${field('effectiveFrom','Effective date','date')}<label>Fee<select name="feeCode" required>${report.catalog.map(item=>`<option value="${esc(item.feeCode)}">${esc(item.name)}</option>`).join('')}</select></label>${field('trigger','Billing trigger')}<label>Method<select name="method"><option>FIXED</option><option>PERCENTAGE</option><option>USAGE</option></select></label>${field('price','Amount, decimal rate, or price per unit','number','min="0" step="any"')}${field('payerType','Payer type')}<p>Percentage rates use decimals: 0.01 means 1%. Draft prices take effect only after activation.</p><button type="submit">Save draft price</button></form>`);
    if (tab === 'Charges') return card('Saved charges', table(['Charge','Payer','Currency','Amount','State'],report.charges.map(charge=>[esc(charge.chargeId),esc(charge.payerId),esc(charge.currency),amount(charge.total),esc(charge.state)]))) + card('Assess a fee', `<form data-operation="charge">${field('scheduleId','Saved schedule ID')}${field('trigger','Billing trigger')}${field('subjectType','Subject type')}${field('subjectId','Subject ID')}${field('payerId','Payer ID')}${field('payerType','Payer type')}${field('currency','Currency','text','value="USD"')}<label>Calculation context (JSON)<textarea name="context" required>{}</textarea></label><button type="submit">Assess fee</button></form>`);
    if (tab === 'Invoices') return card('Saved invoices', table(['Invoice','Payer','Currency','Amount','State','Due'],report.invoices.map(invoice=>[esc(invoice.invoiceId),esc(invoice.payerId),esc(invoice.currency),amount(invoice.total),esc(invoice.state),esc(invoice.dueDate)]))) + card('Create invoice', `<form data-operation="invoice">${field('payerId','Payer ID')}${field('payerType','Payer type')}${field('currency','Currency','text','value="USD"')}${field('dueDate','Due date','date')}${field('chargeIds','Charge IDs, separated by commas')}<button type="submit">Create invoice</button></form>`);
    if (tab === 'Collections') return card('Recorded collections',table(['Journal','Invoice','Currency','Amount','Recorded','Receipt match'],report.payments.map(payment=>[esc(payment.entryId),esc(payment.invoiceId),esc(payment.currency),amount(payment.amount),esc(payment.occurredAt),payment.receiptBacked?'Matched':'Review required']))) + card('Record received fee payment',`<form data-operation="payment">${field('invoiceId','Invoice ID')}${field('amount','Amount received','number','min="0.01" step="0.01"')}${field('currency','Currency','text','value="USD"')}${field('externalReference','External payment reference')}${field('evidenceReference','Receipt or bank evidence reference')}${field('cashAccountId','Operating cash account ID','text','value="GL-CASH-OPERATING"')}<p>This records an already received payment. It updates the receipt, invoice balance, and cash/receivable journal together.</p><button type="submit">Record received payment</button></form>`);
    return card('$5 million financing revenue inputs', `<p>Repayment source: future SRA business revenue. Enter projected monthly billable work counts to calculate gross service charges at the established prices.</p><form data-revenue-model data-operation="model">${field('name','Scenario name')}${field('period','Forecast month','month')}${rates.map(rate=>`<label>${esc(rate.serviceName)} — $${amount(rate.amount)}<input type="number" name="${esc(rate.agentId)}" data-rate="${rate.amount}" min="0" step="1"></label>`).join('')}<output data-model-total>No projected activity entered.</output><button type="submit">Save revenue scenario</button></form><p>These counts are scenarios. Compensation, collections timing, other operating expenses, taxes, and working capital must be included before calculating money available for repayment.</p>`) + card('Historical monthly billing and collections', table(['Month','Currency','Assessed','Invoiced','Collected','Compensation paid'],report.monthly.map(row=>[esc(row.period),esc(row.currency),amount(row.assessedGross),amount(row.invoicedGross),amount(row.collected),amount(row.compensationPaid)]))) + card('Saved revenue scenarios',table(['Scenario','Month','USD gross charges','Coverage'],(report.models||[]).map(model=>[esc(model.name),esc(model.period),amount(model.grossCharges),esc(model.coverage)]))) + `<a href="/api/economics/report/export" download="SRA_Billing_Financing_Inputs.json">Download financing inputs (JSON)</a>`;
  }
  async function render(root) {
    const version = (versions.get(root) || 0) + 1; versions.set(root, version);
    const body = root.querySelector('.admin-workspace-records');
    const tab = root.dataset.activeTab || 'Overview';
    body.innerHTML = card('Pricing and billing', '<p>Loading saved billing records…</p>');
    try {
      const report = await request('/report');
      if (versions.get(root) !== version) return;
      root.billingReport = report;
      body.innerHTML = `<p role="status" data-billing-message></p>` + renderView(report,tab);
    } catch(error) { if (versions.get(root) === version) body.innerHTML = card('Billing records unavailable', `<p role="alert">${esc(error.message)}</p><button data-billing-retry>Retry billing records</button>`); }
  }
  function mount(root) {
    if (!root || mounted.has(root)) return; mounted.add(root);
    root.addEventListener('click', async event => {
      if (event.target.closest('[data-admin-tab],[data-refresh-workspace],[data-billing-retry]')) { queueMicrotask(()=>void render(root)); return; }
      const activate = event.target.closest('[data-activate]');
      const seed = event.target.closest('[data-agent-schedule]');
      if (activate || seed) {
        const button = activate || seed; button.disabled = true;
        try { await request(activate ? `/schedules/${encodeURIComponent(activate.dataset.activate)}/activate` : '/agent-schedule', {}); await render(root); }
        catch(error) { root.querySelector('[data-billing-message]').textContent = error.message; }
        finally { if (button.isConnected) button.disabled = false; }
      }

    });
    root.addEventListener('input', event => {
      const form=event.target.closest('[data-revenue-model]'); if(!form)return;
      const inputs=[...form.querySelectorAll('[data-rate]')];
      const valid=inputs.every(input=>input.value===''||(Number.isInteger(Number(input.value))&&Number(input.value)>=0));
      form.querySelector('[data-model-total]').textContent=valid ? `Projected monthly gross service charges: $${amount(inputs.reduce((total,input)=>total+Number(input.value||0)*Number(input.dataset.rate),0))}` : 'Use whole, non-negative work counts.';
    });
    root.addEventListener('submit', async event => {
      const form=event.target.closest('[data-operation]'); if(!form)return;
      event.preventDefault(); const button=form.querySelector('button');button.disabled=true;
      try {
        const data=Object.fromEntries(new FormData(form)); let path;
        if(form.dataset.operation==='catalog')path='/catalog';
        if(form.dataset.operation==='schedule') {
          const rule={feeCode:data.feeCode,trigger:data.trigger,payerType:data.payerType,method:data.method};
          rule[data.method==='FIXED'?'amount':data.method==='PERCENTAGE'?'rate':'unitPrice']=Number(data.price);
          data.rules=[rule];data.effectiveFrom=`${data.effectiveFrom}T00:00:00.000Z`;path='/schedules';
        }
        if(form.dataset.operation==='charge'){data.context=JSON.parse(data.context);path='/charges';}
        if(form.dataset.operation==='invoice'){data.chargeIds=data.chargeIds.split(',').map(value=>value.trim()).filter(Boolean);path='/invoices';}
        if(form.dataset.operation==='model'){data.workCounts=Object.fromEntries([...form.querySelectorAll('[data-rate]')].map(input=>[input.name,input.value===''?null:Number(input.value)]));path='/revenue-models';}
        if(form.dataset.operation==='payment'){path=`/invoices/${encodeURIComponent(data.invoiceId)}/payments`;data.amount=Number(data.amount);}
        await request(path,data); await render(root);root.querySelector('[data-billing-message]').textContent='Saved successfully.';
      }catch(error){root.querySelector('[data-billing-message]').textContent=error.message;}
      finally{if(button.isConnected)button.disabled=false;}
    });
    void render(root);
  }
  window.mountAdminPricingBillingWorkstation=mount;
})();
