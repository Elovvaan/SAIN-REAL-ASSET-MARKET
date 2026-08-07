(() => {
  if (window.__sraAdminCoinLifecycleInstalled) return;
  window.__sraAdminCoinLifecycleInstalled = true;

  const mounted = new WeakSet();
  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const qty = (value) => num(value).toLocaleString(undefined, { maximumFractionDigits: 8 });
  const usd = (value) => `$${num(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const list = (value) => Array.isArray(value) ? value : [];
  const terminalTabs = new Set(['Legacy Corrections']);

  async function requestJson(url) {
    const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }

  function controls(workspace) {
    return workspace?.querySelector('.admin-workspace-controls') || null;
  }

  function removePanel(workspace) {
    controls(workspace)?.querySelector('[data-coin-lifecycle-workstation]')?.remove();
  }

  function panel(workspace) {
    const root = controls(workspace);
    if (!root) return null;
    let node = root.querySelector('[data-coin-lifecycle-workstation]');
    if (!node) {
      node = document.createElement('section');
      node.className = 'admin-record-card';
      node.dataset.coinLifecycleWorkstation = 'true';
      root.prepend(node);
    }
    return node;
  }

  function card(label, value, detail = '') {
    return `<div style="border:1px solid #292929;border-radius:12px;padding:14px;background:#090909;min-width:0"><span style="display:block;color:#9a9a9a;font-size:10px;text-transform:uppercase">${esc(label)}</span><strong style="display:block;font-size:20px;margin-top:7px">${esc(value)}</strong>${detail ? `<small style="display:block;color:#8f8f8f;margin-top:5px">${esc(detail)}</small>` : ''}</div>`;
  }

  function sourceAmount(position) {
    return num(position?.sourcePosition?.amount ?? position?.nativeQuantity ?? position?.sourceQuantity);
  }

  function sourceUnit(position) {
    return String(position?.sourcePosition?.unit || position?.nativeUnit || position?.sourceUnit || 'SOURCE').toUpperCase();
  }

  function representedUsd(position, record) {
    const candidates = [
      position?.recordedValue?.amount,
      position?.representedValueUsd,
      record?.recordedValue?.amount,
      record?.recognizedRecordedValue?.amount,
      record?.recognizedPosition?.unit === 'USD' ? record?.recognizedPosition?.amount : null,
      record?.measurement?.unit === 'USD' ? record?.measurement?.value : null,
    ];
    const found = candidates.map(Number).find((value) => Number.isFinite(value) && value > 0);
    return found || 0;
  }

  function positionRows(positions, recordsById, limit = 8) {
    if (!positions.length) return '<p style="color:#9a9a9a;margin:14px 0 0">No SRA Coin Positions are currently stored.</p>';
    return `<div class="admin-record-list" style="margin-top:14px">${positions.slice(0, limit).map((position) => {
      const record = recordsById.get(position.financialRecordId) || null;
      const basis = representedUsd(position, record);
      return `<article class="admin-record-card" style="margin:0"><header><strong>${esc(position.coinPositionId || position.id || 'Coin Position')}</strong><em>${esc(position.state || 'UNKNOWN')}</em></header><div class="admin-record-grid">${
        `<div><span>Native source</span><strong>${esc(qty(sourceAmount(position)))} ${esc(sourceUnit(position))}</strong></div>` +
        `<div><span>Recognized USD</span><strong>${esc(basis ? usd(basis) : 'Not established')}</strong></div>` +
        `<div><span>SRA represented</span><strong>${esc(qty(position.quantity))} SRA</strong></div>` +
        `<div><span>Available</span><strong>${esc(qty(position.availableQuantity ?? Math.max(0, num(position.quantity) - num(position.reservedQuantity) - num(position.externalizedQuantity ?? position.externallyTransferredQuantity))))} SRA</strong></div>`
      }</div></article>`;
    }).join('')}</div>`;
  }

  function currentSupplyMarkup(r) {
    const all = list(r.coinPositions).filter((item) => String(item.symbol || '').toUpperCase() === 'SRA');
    const active = all.filter((item) => String(item.state || '').toUpperCase() !== 'RETIRED');
    const recordsById = new Map(list(r.financialRecords).map((item) => [item.financialRecordId, item]));
    const total = active.reduce((sum, item) => sum + num(item.quantity), 0);
    const reserved = active.reduce((sum, item) => sum + num(item.reservedQuantity), 0);
    const externalized = active.reduce((sum, item) => sum + num(item.externalizedQuantity ?? item.externallyTransferredQuantity), 0);
    const available = active.reduce((sum, item) => sum + num(item.availableQuantity ?? Math.max(0, num(item.quantity) - num(item.reservedQuantity) - num(item.externalizedQuantity ?? item.externallyTransferredQuantity))), 0);
    const retired = all.filter((item) => String(item.state || '').toUpperCase() === 'RETIRED').reduce((sum, item) => sum + num(item.quantity), 0);
    const represented = active.reduce((sum, item) => sum + representedUsd(item, recordsById.get(item.financialRecordId)), 0);
    return `<header><strong>Current SRA Supply</strong><em>STAGE 1</em></header><div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-top:12px">${card('Active supply', `${qty(total)} SRA`)}${card('Available', `${qty(available)} SRA`)}${card('Reserved', `${qty(reserved)} SRA`)}${card('Externalized', `${qty(externalized)} SRA`)}${card('Retired', `${qty(retired)} SRA`)}${card('Recognized value', usd(represented), 'USD representation basis')}</div><p style="color:#9a9a9a;margin:14px 0 0">Current Supply answers what exists now. Native source quantities remain separate from SRA represented quantity.</p>${positionRows(active, recordsById)}`;
  }

  function representedValueMarkup(r) {
    const positions = list(r.coinPositions).filter((item) => String(item.symbol || '').toUpperCase() === 'SRA' && String(item.state || '').toUpperCase() !== 'RETIRED');
    const recordsById = new Map(list(r.financialRecords).map((item) => [item.financialRecordId, item]));
    let representedSra = 0;
    let recognizedUsd = 0;
    let missingBasis = 0;
    let mismatch = 0;
    for (const position of positions) {
      const basis = representedUsd(position, recordsById.get(position.financialRecordId));
      representedSra += num(position.quantity);
      recognizedUsd += basis;
      if (!basis) missingBasis += 1;
      else if (Math.abs(num(position.quantity) - basis) > 0.00000001) mismatch += 1;
    }
    const delta = representedSra - recognizedUsd;
    return `<header><strong>Represented Value Reconciliation</strong><em>${missingBasis || mismatch ? 'REVIEW' : 'AT PAR'}</em></header><div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:12px">${card('SRA represented', `${qty(representedSra)} SRA`)}${card('Recognized USD', usd(recognizedUsd))}${card('Par delta', `${qty(delta)} SRA`)}${card('Missing USD basis', missingBasis)}${card('Mismatches', mismatch)}</div><p style="color:#9a9a9a;margin:14px 0 0">SRA quantity must reconcile to recognized recorded USD value at 1 SRA = 1 USD. The native asset quantity is lineage, not the SRA quantity.</p>${positionRows(positions, recordsById)}`;
  }

  function intelligenceMarkup(r) {
    const positions = list(r.coinPositions).filter((item) => String(item.symbol || '').toUpperCase() === 'SRA');
    const active = positions.filter((item) => String(item.state || '').toUpperCase() !== 'RETIRED');
    const recordsById = new Map(list(r.financialRecords).map((item) => [item.financialRecordId, item]));
    const withBasis = active.filter((item) => representedUsd(item, recordsById.get(item.financialRecordId)) > 0);
    const mismatches = active.filter((item) => {
      const basis = representedUsd(item, recordsById.get(item.financialRecordId));
      return basis > 0 && Math.abs(num(item.quantity) - basis) > 0.00000001;
    });
    const restricted = active.filter((item) => String(item.state || '').toUpperCase() === 'RESTRICTED').length;
    const sourceBreakdown = new Map();
    for (const position of active) sourceBreakdown.set(sourceUnit(position), (sourceBreakdown.get(sourceUnit(position)) || 0) + 1);
    const coverage = active.length ? (withBasis.length / active.length) * 100 : 100;
    const sources = [...sourceBreakdown.entries()].sort((a, b) => b[1] - a[1]).map(([unit, count]) => `${unit}: ${count}`).join(' · ') || 'No active positions';
    return `<header><strong>Coin Intelligence</strong><em>STAGE 3</em></header><div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:12px">${card('Representation coverage', `${coverage.toFixed(1)}%`)}${card('Active positions', active.length)}${card('Needs reconciliation', mismatches.length)}${card('Restricted', restricted)}${card('Source types', sourceBreakdown.size)}</div><p style="color:#9a9a9a;margin:14px 0 0"><strong style="color:#f5f5f5">Source mix:</strong> ${esc(sources)}</p><p style="color:#9a9a9a;margin:8px 0 0">Intelligence checks whether every active SRA position has a recognized USD basis and whether represented quantity remains at par.</p>`;
  }

  function historyMarkup(r) {
    const events = list(r.lifecycleEvents).filter((item) => /COIN_POSITION_REPRESENTED|COIN_REPRESENTATION_CREATED|MINT/i.test(String(item.eventType || JSON.stringify(item))));
    return `<header><strong>Representation / Mint History</strong><em>STAGE 4</em></header><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px">${card('Representation events', events.length)}${card('Coin positions', list(r.coinPositions).length)}${card('Financial records', list(r.financialRecords).length)}</div><p style="color:#9a9a9a;margin:14px 0 0">Every supply increase should trace back through Coin Position → Financial Record → recognized recorded value → source lineage.</p>`;
  }

  function adjustmentsMarkup(r) {
    const events = list(r.lifecycleEvents).filter((item) => /ADJUST|RESTAT|CORRECT/i.test(String(item.eventType || JSON.stringify(item))));
    return `<header><strong>Adjustments</strong><em>STAGE 5</em></header><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px">${card('Recorded adjustment events', events.length)}${card('Active positions', list(r.coinPositions).filter((item) => String(item.state || '').toUpperCase() !== 'RETIRED').length)}${card('Write controls', 'NOT ENABLED', 'Aggregate reconciliation required first')}</div><p style="color:#9a9a9a;margin:14px 0 0">This stage is intentionally read-only in this checkpoint. A future adjustment action must persist before/after quantity, reason, actor, and keep Coin Account aggregates reconciled atomically.</p>`;
  }

  function retirementsMarkup(r) {
    const positions = list(r.coinPositions);
    const retired = positions.filter((item) => String(item.state || '').toUpperCase() === 'RETIRED');
    const retiredQuantity = retired.reduce((sum, item) => sum + num(item.quantity), 0);
    const events = list(r.lifecycleEvents).filter((item) => /RETIR/i.test(String(item.eventType || JSON.stringify(item))));
    return `<header><strong>Retirements</strong><em>STAGE 6</em></header><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px">${card('Retired positions', retired.length)}${card('Retired quantity', `${qty(retiredQuantity)} SRA`)}${card('Retirement events', events.length)}</div><p style="color:#9a9a9a;margin:14px 0 0">Retirement closes the Coin Position lifecycle. Write controls remain disabled until retirement atomically reduces active Coin Account supply and preserves the retirement basis and audit trail.</p>`;
  }

  function markup(tab, records) {
    if (tab === 'Current Supply') return currentSupplyMarkup(records);
    if (tab === 'Represented Value') return representedValueMarkup(records);
    if (tab === 'Coin Intelligence') return intelligenceMarkup(records);
    if (tab === 'Mint History') return historyMarkup(records);
    if (tab === 'Adjustments') return adjustmentsMarkup(records);
    if (tab === 'Retirements') return retirementsMarkup(records);
    return null;
  }

  async function refresh(workspace) {
    const tab = workspace?.dataset.activeTab || '';
    if (!tab || terminalTabs.has(tab)) { removePanel(workspace); return; }
    const node = panel(workspace);
    if (!node) return;
    node.innerHTML = '<header><strong>Coin Position Lifecycle</strong><em>LOADING</em></header><p style="color:#9a9a9a">Reconciling current Coin Position state…</p>';
    try {
      const data = await requestJson(`/api/admin/workspaces?limit=1000&_=${Date.now()}`);
      if (!node.isConnected || workspace.dataset.activeTab !== tab) return;
      node.innerHTML = markup(tab, data.records || {}) || '';
    } catch (error) {
      node.innerHTML = `<header><strong>Coin Position Lifecycle</strong><em>UNAVAILABLE</em></header><p style="color:#d6a92f">${esc(error.message)}</p>`;
    }
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click', (event) => {
      if (!event.target.closest('[data-admin-tab]')) return;
      queueMicrotask(() => { void refresh(workspace); });
    });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => {
      if (event.detail?.workspaceId === 'coin-positions') void refresh(workspace);
    });
    void refresh(workspace);
  }

  window.mountAdminCoinLifecycleWorkstation = mount;
})();