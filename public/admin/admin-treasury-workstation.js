(() => {
  if (window.__sraAdminTreasuryWorkstationInstalled) return;
  window.__sraAdminTreasuryWorkstationInstalled = true;

  const mounted = new WeakSet();
  const client = () => window.SRAAdminDataClient;
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const money = (value) => Number(value || 0).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
  const list = (value) => Array.isArray(value) ? value : [];
  const request = async (url, options = {}) => client() ? client().json(url, options) : fetch(url,{credentials:'same-origin',cache:'no-store',...options}).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  });

  function controls(workspace) { return workspace?.querySelector('.admin-workspace-controls'); }
  function field(label,value) { return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function card(title,state,body) { return `<section class="admin-record-card" data-treasury-workstation-card><header><strong>${esc(title)}</strong><em>${esc(state)}</em></header>${body}</section>`; }
  function clear(workspace) { controls(workspace)?.querySelectorAll('[data-treasury-workstation-card]').forEach((node) => node.remove()); }

  function openSettlementInstruction(amountUsd) {
    sessionStorage.setItem('sra:treasury-payment-draft', JSON.stringify({ amountUsd:Number(amountUsd), rail:'ACH', createdAt:new Date().toISOString() }));
    document.querySelector('[data-admin-workspace="settlement"]')?.click();
    queueMicrotask(() => {
      const settlement = document.querySelector('[data-workspace="settlement"]');
      settlement?.querySelector('[data-admin-tab="Settlement Instructions"]')?.click();
      queueMicrotask(() => applyDraftToSettlementInstruction(settlement));
    });
  }

  function applyDraftToSettlementInstruction(settlementWorkspace) {
    if (!settlementWorkspace || settlementWorkspace.dataset.activeTab !== 'Settlement Instructions') return;
    let draft = null;
    try { draft = JSON.parse(sessionStorage.getItem('sra:treasury-payment-draft') || 'null'); } catch {}
    const form = settlementWorkspace.querySelector('[data-settlement-instruction-form]');
    if (!form || !draft?.amountUsd) return;
    if (form.elements.route) {
      form.elements.route.value = 'ACH';
      form.elements.route.dispatchEvent(new Event('change', { bubbles:true }));
    }
    if (form.elements.amountUsd) form.elements.amountUsd.value = Number(draft.amountUsd).toFixed(2);
    const button = form.querySelector('button[type="submit"]');
    if (button) button.textContent = 'Prepare ACH Settlement Instruction';
    let note = form.querySelector('[data-treasury-payment-draft-note]');
    if (!note) {
      note = document.createElement('p');
      note.dataset.treasuryPaymentDraftNote = 'true';
      note.style.cssText = 'color:#d6a92f;font-size:12px;line-height:1.45;margin:10px 0';
      form.prepend(note);
    }
    note.textContent = `Treasury payment draft · ${money(draft.amountUsd)} · ACH · source: Cash / Settlement USD`;
  }

  async function load() {
    const [treasury, readiness, eligible, workspace] = await Promise.all([
      request('/api/admin/treasury'),
      request('/api/admin/treasury-transfer-readiness'),
      request('/api/admin/treasury/funding-instrument-deposits/eligible-instruments'),
      request('/api/admin/workspaces?limit=100'),
    ]);
    return { treasury, readiness, eligible, records: workspace?.records || {} };
  }

  function canonicalInstrument(data) {
    return list(data.eligible?.instruments).find((item) => item.instrumentId === data.eligible?.canonicalInstrumentId) || null;
  }
  function recognitionAction(data) {
    const instrument = canonicalInstrument(data);
    if (!instrument || instrument.deposited) return '';
    return `<div style="margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button type="button" data-treasury-recognize-instrument>Recognize ${money(instrument.faceValueUsd)} in Treasury</button><span data-treasury-recognition-result style="color:#9a9a9a;font-size:12px">Issued instrument is awaiting Treasury recognition. This posts the existing canonical instrument once; it does not create another instrument.</span></div>`;
  }

  function renderOverview(data) {
    const cash = Number(data.treasury.cashBalanceUsd || 0);
    const held = Number(data.readiness.status?.reservedUsd || 0);
    const available = Math.max(0, cash - held);
    const instrument = canonicalInstrument(data);
    return card('Treasury Position','CURRENT',`<div class="admin-record-grid">${field('Cash / Settlement USD',money(cash))}${field('Held for payments',money(held))}${field('Available to send',money(available))}${field('Commercial instrument USD',money(data.treasury.commercialInstrumentUsd))}${field('Financing capacity',money(data.treasury.totalFundingCapacityUsd))}${field('Available financing',money(data.treasury.availableFinancingCapacityUsd))}${field('Financing held',money(data.treasury.committedFinancingUsd))}${field('Financing deployed',money(data.treasury.deployedFinancingUsd))}${field('Authorized payments',String(data.readiness.status?.readyToSend || 0))}${field('Canonical $18M instrument',instrument ? (instrument.deposited ? 'TREASURY RECOGNIZED' : 'ISSUED · AWAITING TREASURY RECOGNITION') : 'NOT FOUND')}</div>${recognitionAction(data)}<div style="margin-top:14px"><button type="button" data-treasury-start-payment>Send Payment</button></div>`);
  }

  function renderCommercial(data) {
    const instruments = list(data.records.instruments).filter((item) => /FUNDING|COMMERCIAL|TREASURY/i.test(JSON.stringify(item)));
    const instrument = canonicalInstrument(data);
    return card('Commercial Instruments', instruments.length ? 'ACTIVE' : 'EMPTY', `<div class="admin-record-grid">${field('Instrument records',String(instruments.length))}${field('Canonical instrument',instrument?.instrumentId || 'Not found')}${field('Canonical face value',instrument ? money(instrument.faceValueUsd) : '—')}${field('Treasury state',instrument?.treasuryState || '—')}${field('Financing state',instrument?.financingState || '—')}${field('Recognized instrument USD',money(data.treasury.commercialInstrumentUsd))}${field('Total funding capacity',money(data.treasury.totalFundingCapacityUsd))}${field('Available financing',money(data.treasury.availableFinancingCapacityUsd))}</div>${recognitionAction(data)}<p style="color:#9a9a9a;margin:12px 0 0">Issued instruments remain instrument records until the governed Treasury recognition step posts them into the Treasury ledger.</p>`);
  }

  function renderCash(data) {
    const cash = Number(data.treasury.cashBalanceUsd || 0);
    const held = Number(data.readiness.status?.reservedUsd || 0);
    const available = Math.max(0, cash - held);
    const inFlight = list(data.records.transactions).filter((item) => item.transactionType === 'EXTERNAL_TRANSFER_INSTRUCTION' && ['HELD','SUBMITTED'].includes(String(item.fundsState || '').toUpperCase()));
    return card('Cash Position','OPERATING',`<div class="admin-record-grid">${field('Cash / Settlement USD',money(cash))}${field('Held',money(held))}${field('Available',money(available))}${field('In-flight payments',String(inFlight.length))}</div><p style="color:#9a9a9a;margin:12px 0">Commercial instrument value and financing capacity are not cash. Cash changes only through cash/settlement accounting events.</p><form data-treasury-payment-form style="margin-top:14px"><div class="admin-record-grid"><label><span>Amount USD</span><input name="amountUsd" type="number" min="0.01" step="0.01" value="1.00" required></label><label><span>Rail</span><select name="rail" style="width:100%;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px"><option value="ACH">ACH</option></select></label></div><div style="display:flex;gap:12px;align-items:center;margin-top:12px"><button type="submit" ${available <= 0 ? 'disabled' : ''}>Send Payment</button><span style="color:#9a9a9a;font-size:12px">Continues to Settlement Instructions.</span></div></form>`);
  }

  function renderFinancing(data, capacity = false) {
    const total = Number(data.treasury.totalFundingCapacityUsd || 0);
    const available = Number(data.treasury.availableFinancingCapacityUsd || 0);
    const committed = Number(data.treasury.committedFinancingUsd || 0);
    const deployed = Number(data.treasury.deployedFinancingUsd || 0);
    const title = capacity ? 'Funding Capacity' : 'Available Financing';
    const body = capacity
      ? `<div class="admin-record-grid">${field('Total capacity',money(total))}${field('Committed / held',money(committed))}${field('Deployed',money(deployed))}${field('Remaining capacity',money(available))}${field('Capacity used',money(committed + deployed))}${field('Source instrument deposits',String(data.treasury.fundingInstrumentDeposits?.depositCount || 0))}</div>${recognitionAction(data)}<p style="color:#9a9a9a;margin:12px 0 0">Treasury-sourced financing authorizations reserve capacity. Settled Treasury financing moves from held to deployed without being counted twice.</p>`
      : `<div class="admin-record-grid">${field('Available now',money(available))}${field('Held for authorized financing',money(committed))}${field('Already deployed',money(deployed))}${field('Total funding capacity',money(total))}</div>${recognitionAction(data)}<p style="color:#9a9a9a;margin:12px 0 0">Available Financing is the remaining Treasury capacity after current Treasury-funded authorizations and completed deployments.</p>`;
    return card(title,'CURRENT',body);
  }

  function renderJournal(data) {
    const entries = list(data.records.ledgerEntries);
    return card('Journal Entries','LEDGER',`<div class="admin-record-grid">${field('Journal entries',String(entries.length))}${field('Ledger accounts',String(list(data.records.ledgerAccounts).length))}</div><p style="color:#9a9a9a;margin:12px 0 0">Balanced-entry controls remain the write path; journal records below are the posted history.</p>`);
  }

  function renderWallets(data) {
    const wallets = list(data.records.treasuryWallets);
    const activity = list(data.records.treasuryCryptoActivity);
    return card('Treasury Wallets', wallets.length ? 'ACTIVE' : 'EMPTY',`<div class="admin-record-grid">${field('Wallets',String(wallets.length))}${field('Crypto activity records',String(activity.length))}</div>`);
  }

  function renderLedger(data) {
    return card('Treasury Ledger','CURRENT',`<div class="admin-record-grid">${field('Accounts',String(list(data.records.ledgerAccounts).length))}${field('Entries',String(list(data.records.ledgerEntries).length))}${field('Accounting periods',String(list(data.records.accountingPeriods).length))}</div>`);
  }

  function renderReports(data) {
    return card('Treasury Reports','CURRENT',`<div class="admin-record-grid">${field('Statement snapshots',String(list(data.records.financialStatementSnapshots).length))}${field('Treasury statements',String(list(data.records.treasuryStatements).length))}${field('Forecasts',String(list(data.records.treasuryForecasts).length))}${field('Exceptions',String(list(data.records.treasuryExceptions).length))}</div>`);
  }

  async function recognizeCanonicalInstrument(workspace, data) {
    const instrument = canonicalInstrument(data);
    if (!instrument || instrument.deposited) return;
    const button = controls(workspace)?.querySelector('[data-treasury-recognize-instrument]');
    const result = controls(workspace)?.querySelector('[data-treasury-recognition-result]');
    if (button) button.disabled = true;
    if (result) result.textContent = 'Posting canonical instrument into Treasury…';
    try {
      await request('/api/admin/treasury/funding-instrument-deposits/approve', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
          approval:'APPROVE', instrumentId:instrument.instrumentId, faceValueUsd:instrument.faceValueUsd,
          termMonths:instrument.termMonths || 36, depositReference:`ADMIN-TREASURY-RECOGNITION-${Date.now()}`,
        }),
      });
      if (result) result.textContent = 'Canonical instrument recognized in Treasury.';
      client()?.refresh?.('treasury-instrument-recognized');
      await render(workspace);
    } catch (error) {
      if (result) result.textContent = error.message;
      if (button) button.disabled = false;
    }
  }

  async function render(workspace) {
    clear(workspace);
    const root = controls(workspace); if (!root) return;
    const placeholder = document.createElement('section');
    placeholder.className = 'admin-record-card';
    placeholder.dataset.treasuryWorkstationCard = 'true';
    placeholder.innerHTML = '<header><strong>Treasury Workstation</strong><em>READING</em></header><p>Reading current Treasury state…</p>';
    root.prepend(placeholder);
    try {
      const data = await load();
      if (!placeholder.isConnected) return;
      const tab = workspace.dataset.activeTab || 'Overview';
      let markup;
      if (tab === 'Overview') markup = renderOverview(data);
      else if (tab === 'Commercial Instruments') markup = renderCommercial(data);
      else if (tab === 'Cash Position') markup = renderCash(data);
      else if (tab === 'Available Financing') markup = renderFinancing(data,false);
      else if (tab === 'Funding Capacity') markup = renderFinancing(data,true);
      else if (tab === 'Journal Entries') markup = renderJournal(data);
      else if (tab === 'Treasury Wallets') markup = renderWallets(data);
      else if (tab === 'Ledger') markup = renderLedger(data);
      else markup = renderReports(data);
      placeholder.outerHTML = markup;
      const current = root.querySelector('[data-treasury-workstation-card]');
      current?.querySelector('[data-treasury-recognize-instrument]')?.addEventListener('click', () => void recognizeCanonicalInstrument(workspace, data));
      current?.querySelector('[data-treasury-start-payment]')?.addEventListener('click', () => {
        const amount = Math.min(1, Math.max(0, Number(data.treasury.cashBalanceUsd || 0) - Number(data.readiness.status?.reservedUsd || 0)));
        if (amount > 0) openSettlementInstruction(amount);
      });
      current?.querySelector('[data-treasury-payment-form]')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget).entries());
        openSettlementInstruction(Number(values.amountUsd));
      });
    } catch (error) {
      placeholder.innerHTML = `<header><strong>Treasury Workstation</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`;
    }
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click', (event) => {
      if (event.target.closest('[data-admin-tab]')) queueMicrotask(() => void render(workspace));
    });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => {
      if (event.detail?.workspaceId === 'treasury') void render(workspace);
      if (event.detail?.workspaceId === 'settlement') applyDraftToSettlementInstruction(document.querySelector('[data-workspace="settlement"]'));
    });
    document.querySelector('[data-workspace="settlement"]')?.addEventListener('click', (event) => {
      if (event.target.closest('[data-admin-tab="Settlement Instructions"]')) queueMicrotask(() => applyDraftToSettlementInstruction(document.querySelector('[data-workspace="settlement"]')));
    });
    void render(workspace);
  }

  window.mountAdminTreasuryWorkstation = mount;
})();