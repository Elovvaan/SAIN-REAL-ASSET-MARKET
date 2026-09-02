(() => {
  if (window.__sraAdminXrplExchangeWorkstationInstalled) return;
  window.__sraAdminXrplExchangeWorkstationInstalled = true;

  const mounted = new WeakSet();
  const TAB = 'XRPL Exchange';
  const ASSET = 'SRAUSD';
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const request = async (url, options = {}) => {
    if (window.SRAAdminDataClient) return window.SRAAdminDataClient.json(url, options);
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };
  const controls = (workspace) => workspace?.querySelector('.admin-workspace-controls') || null;
  const records = (workspace) => workspace?.querySelector('.admin-workspace-records') || null;
  const active = (workspace) => workspace?.classList.contains('active') && workspace?.dataset.activeTab === TAB;
  const positive = (value) => /^\d+(?:\.\d{1,6})?$/.test(String(value || '').trim()) && Number(value) > 0;

  function remove(workspace) {
    controls(workspace)?.querySelector('[data-xrpl-exchange-workstation]')?.remove();
    const recordRoot = records(workspace); if (recordRoot) recordRoot.style.display = '';
  }
  function host(workspace) {
    const root = controls(workspace); if (!root) return null;
    let node = root.querySelector('[data-xrpl-exchange-workstation]');
    if (!node) { node = document.createElement('section'); node.className = 'admin-record-card'; node.dataset.xrplExchangeWorkstation = 'true'; root.prepend(node); }
    const recordRoot = records(workspace); if (recordRoot) recordRoot.style.display = 'none';
    return node;
  }
  function metric(label, value, detail = '') {
    return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong>${detail ? `<small style="display:block;color:#777;margin-top:4px">${esc(detail)}</small>` : ''}</div>`;
  }
  function confirmation(name, label) {
    return `<label style="display:flex;gap:8px;align-items:flex-start;color:#cfcfcf;font-size:12px;line-height:1.4;margin-top:10px"><input type="checkbox" data-confirm-${name} style="margin-top:2px"><span>${esc(label)}</span></label>`;
  }
  function offersMarkup(offers = []) {
    if (!offers.length) return '<p style="color:#777;margin:10px 0 0">No SRAUSD/XRP offers have been submitted from this platform.</p>';
    return `<div class="admin-record-list" style="margin-top:10px">${offers.slice(0, 10).map((offer) => `<article class="admin-record-card" style="margin:0"><header><strong>${esc(offer.sellAmount)} SRAUSD → ${esc(offer.buyAmountXrp)} XRP</strong><em>${esc(offer.state || 'UNKNOWN')}</em></header><div class="admin-record-grid">${metric('Transaction', offer.transactionId || '—')}${metric('Ledger', offer.confirmation?.ledgerIndex || '—')}${metric('Created', offer.createdAt || '—')}</div></article>`).join('')}</div>`;
  }

  function markup(network, asset, offers) {
    const ready = Boolean(network?.issuanceReady);
    const issued = Number(asset?.issuedSupply || 0);
    const badge = ready ? 'MAINNET READY' : 'NOT READY';
    return `<header><strong>SRAUSD → XRP Mainnet Workflow</strong><em>${badge}</em></header>
      <p style="color:#9a9a9a;line-height:1.5">This workflow begins with SRAUSD. It creates SRAUSD on XRPL, issues an entered amount to SRA's distribution account, then posts a separate offer selling SRAUSD for native XRP. Nothing executes until an administrator enters the values and confirms the Mainnet action.</p>
      <div class="admin-record-grid" style="margin-top:12px">${metric('Network','XRPL Mainnet')}${metric('Issuer',network?.issuerAddress || 'Not configured')}${metric('Distribution account',network?.distributorAddress || network?.address || 'Not configured')}${metric('Issuer status',network?.issuerReachable ? 'ACTIVE' : 'NOT READY')}${metric('Asset identity',asset?.assetAddress || 'Not created')}${metric('Issued supply',`${asset?.issuedSupply || 0} SRAUSD`)}</div>
      ${!asset ? `<section style="margin-top:16px;border-top:1px solid #292929;padding-top:16px"><strong>1 · Create SRAUSD Identity</strong><p style="color:#9a9a9a;font-size:12px">Registers SRAUSD with the configured XRPL issuer. This step does not issue supply.</p>${confirmation('create','I confirm this creates the SRAUSD identity using the configured XRPL Mainnet issuer.')}<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button type="button" data-create-xrpl-asset ${ready ? '' : 'disabled'}>Create SRAUSD Identity</button><span data-create-result style="color:#d6a92f;font-size:12px"></span></div></section>` : `
      <section style="margin-top:16px;border-top:1px solid #292929;padding-top:16px"><strong>2 · Issue SRAUSD</strong><p style="color:#9a9a9a;font-size:12px">The entered amount is signed by the issuer and delivered to SRA's XRPL distribution account. Issuance is not an XRP exchange.</p><div class="admin-record-grid" style="margin-top:10px"><label><span>SRAUSD amount</span><input data-issue-amount type="text" inputmode="decimal" autocomplete="off" placeholder="Enter amount, for example 1000"></label></div>${confirmation('issue','I confirm this will issue the entered SRAUSD amount on XRPL Mainnet.')}<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button type="button" data-issue-xrpl-asset="${esc(asset.assetId)}" ${ready ? '' : 'disabled'}>Issue SRAUSD</button><span data-issue-result style="color:#d6a92f;font-size:12px"></span></div></section>
      <section style="margin-top:16px;border-top:1px solid #292929;padding-top:16px"><strong>3 · Offer SRAUSD for XRP</strong><p style="color:#9a9a9a;font-size:12px">Enter both sides of the offer. This sells the entered SRAUSD amount and requests the entered native XRP amount. The offer only fills when XRPL liquidity accepts it.</p><div class="admin-record-grid" style="margin-top:10px"><label><span>SRAUSD to sell</span><input data-offer-sell type="text" inputmode="decimal" autocomplete="off" placeholder="SRAUSD amount"></label><label><span>XRP requested</span><input data-offer-buy type="text" inputmode="decimal" autocomplete="off" placeholder="XRP amount"></label><div><span>Implied XRP per SRAUSD</span><strong data-implied-rate>—</strong></div></div>${confirmation('offer','I confirm this will submit a live XRPL Mainnet offer selling SRAUSD for XRP at the entered amounts.')}<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button type="button" data-create-xrpl-offer="${esc(asset.assetId)}" ${issued > 0 && ready ? '' : 'disabled'}>Submit SRAUSD/XRP Offer</button><span data-offer-result style="color:#d6a92f;font-size:12px">${issued > 0 ? '' : 'Issue SRAUSD first.'}</span></div>${offersMarkup(offers)}</section>`}`;
  }

  function bind(workspace, node, asset) {
    node.querySelector('[data-create-xrpl-asset]')?.addEventListener('click', async (event) => {
      const result = node.querySelector('[data-create-result]');
      if (!node.querySelector('[data-confirm-create]')?.checked) { result.textContent = 'Confirm the Mainnet identity action first.'; return; }
      if (!window.confirm('Create the SRAUSD asset identity on XRPL Mainnet? No supply will be issued yet.')) return;
      event.currentTarget.disabled = true; result.textContent = 'Creating SRAUSD identity…';
      try { await request('/api/on-chain/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({network:'XRPL',asset:ASSET,symbol:ASSET})}); await refresh(workspace); }
      catch (error) { result.textContent = error.message; event.currentTarget.disabled = false; }
    });
    node.querySelector('[data-issue-xrpl-asset]')?.addEventListener('click', async (event) => {
      const amount = node.querySelector('[data-issue-amount]')?.value?.trim(); const result = node.querySelector('[data-issue-result]');
      if (!positive(amount)) { result.textContent = 'Enter a positive SRAUSD amount with no more than 6 decimals.'; return; }
      if (!node.querySelector('[data-confirm-issue]')?.checked) { result.textContent = 'Confirm the Mainnet issuance first.'; return; }
      if (!window.confirm(`Issue exactly ${amount} SRAUSD on XRPL Mainnet?`)) return;
      event.currentTarget.disabled = true; result.textContent = 'Signing, submitting, and confirming issuance…';
      try { const response = await request(`/api/on-chain/assets/${encodeURIComponent(asset.assetId)}/issue`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount})}); result.textContent = `Confirmed · ${response.issuance?.transactionId || 'transaction recorded'}`; await refresh(workspace); }
      catch (error) { result.textContent = error.message; event.currentTarget.disabled = false; }
    });
    const updateRate = () => { const sell = Number(node.querySelector('[data-offer-sell]')?.value); const buy = Number(node.querySelector('[data-offer-buy]')?.value); const target = node.querySelector('[data-implied-rate]'); if (target) target.textContent = sell > 0 && buy > 0 ? `${(buy / sell).toLocaleString(undefined,{maximumFractionDigits:8})} XRP` : '—'; };
    node.querySelector('[data-offer-sell]')?.addEventListener('input', updateRate); node.querySelector('[data-offer-buy]')?.addEventListener('input', updateRate);
    node.querySelector('[data-create-xrpl-offer]')?.addEventListener('click', async (event) => {
      const sellAmount = node.querySelector('[data-offer-sell]')?.value?.trim(); const buyAmountXrp = node.querySelector('[data-offer-buy]')?.value?.trim(); const result = node.querySelector('[data-offer-result]');
      if (!positive(sellAmount) || !positive(buyAmountXrp)) { result.textContent = 'Enter positive SRAUSD and XRP amounts with no more than 6 decimals.'; return; }
      if (Number(sellAmount) > Number(asset.issuedSupply || 0)) { result.textContent = `Offer exceeds the recorded issued supply of ${asset.issuedSupply || 0} SRAUSD.`; return; }
      if (!node.querySelector('[data-confirm-offer]')?.checked) { result.textContent = 'Confirm the live Mainnet offer first.'; return; }
      if (!window.confirm(`Submit a live offer selling ${sellAmount} SRAUSD for ${buyAmountXrp} XRP?`)) return;
      event.currentTarget.disabled = true; result.textContent = 'Signing, submitting, and confirming offer…';
      try { const response = await request(`/api/on-chain/assets/${encodeURIComponent(asset.assetId)}/markets/offers`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sellAmount,buyAmountXrp})}); result.textContent = `${response.state} · ${response.transactionId}`; await refresh(workspace); }
      catch (error) { result.textContent = error.message; event.currentTarget.disabled = false; }
    });
  }

  async function refresh(workspace) {
    if (!active(workspace)) { remove(workspace); return; }
    const node = host(workspace); if (!node) return;
    node.innerHTML = '<header><strong>SRAUSD → XRP Mainnet Workflow</strong><em>CHECKING</em></header><p style="color:#9a9a9a">Checking XRPL accounts and SRAUSD state…</p>';
    try {
      const [status, assetsResult] = await Promise.all([request('/api/on-chain/status'), request('/api/on-chain/assets?network=XRPL&asset=SRAUSD')]);
      if (!active(workspace) || !node.isConnected) return;
      const network = (status.networks || []).find((item) => item.network === 'XRPL') || null;
      const asset = (assetsResult.records || []).find((item) => item.network === 'XRPL' && item.asset === ASSET) || null;
      const offers = asset ? (await request(`/api/on-chain/assets/${encodeURIComponent(asset.assetId)}/markets/offers`)).records || [] : [];
      if (!active(workspace) || !node.isConnected) return;
      node.innerHTML = markup(network, asset, offers); bind(workspace, node, asset);
    } catch (error) { node.innerHTML = `<header><strong>SRAUSD → XRP Mainnet Workflow</strong><em>UNAVAILABLE</em></header><p style="color:#d6a92f">${esc(error.message)}</p>`; }
  }
  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return; mounted.add(workspace);
    workspace.addEventListener('click', (event) => { if (event.target.closest('[data-admin-tab]')) queueMicrotask(() => void refresh(workspace)); });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => { if (event.detail?.workspaceId === 'coin-positions') void refresh(workspace); });
    void refresh(workspace);
  }
  window.mountAdminXrplExchangeWorkstation = mount;
})();
