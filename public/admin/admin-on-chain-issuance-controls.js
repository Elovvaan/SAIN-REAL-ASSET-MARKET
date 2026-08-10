(() => {
  if (window.__sraAdminOnChainIssuanceControlsInstalled) return;
  window.__sraAdminOnChainIssuanceControlsInstalled = true;

  const mounted = new WeakSet();
  const renderState = new WeakMap();
  const SPECIAL_TABS = new Set(['Approval', 'On-Chain']);
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const request = async (url, options = {}) => {
    if (window.SRAAdminDataClient) return window.SRAAdminDataClient.json(url, options);
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };

  function active(workspace) { return Boolean(workspace?.classList.contains('active')); }
  function activeTab(workspace) { return String(workspace?.dataset?.activeTab || ''); }
  function controls(workspace) { return workspace?.querySelector('.admin-workspace-controls') || null; }
  function records(workspace) { return workspace?.querySelector('.admin-workspace-records') || null; }
  function instrumentId(record) { return record?.instrumentId || record?.id || ''; }
  function authorizedAmount(instrument) {
    return instrument?.authorizedSupply ?? instrument?.authorizedAmount ?? instrument?.quantity ?? instrument?.faceAmount ?? instrument?.faceValue ?? instrument?.faceValueUsd ?? instrument?.principalQuantity ?? instrument?.representedSraQuantity ?? null;
  }

  function ensureTabs(workspace) {
    const tabs = workspace?.querySelector('.admin-workspace-tabs');
    const history = tabs?.querySelector('[data-admin-tab="History"]');
    if (!tabs || !history) return;
    let approval = tabs.querySelector('[data-admin-tab="Approval"]');
    if (!approval) {
      approval = document.createElement('button');
      approval.type = 'button';
      approval.setAttribute('role', 'tab');
      approval.setAttribute('aria-selected', 'false');
      approval.dataset.adminTab = 'Approval';
      approval.textContent = 'Approval';
      history.insertAdjacentElement('afterend', approval);
    }
    let onChain = tabs.querySelector('[data-admin-tab="On-Chain"]');
    if (!onChain) {
      onChain = document.createElement('button');
      onChain.type = 'button';
      onChain.setAttribute('role', 'tab');
      onChain.setAttribute('aria-selected', 'false');
      onChain.dataset.adminTab = 'On-Chain';
      onChain.textContent = 'On-Chain';
      approval.insertAdjacentElement('afterend', onChain);
    }
  }

  function clearHost(workspace) {
    controls(workspace)?.querySelector('[data-on-chain-controls]')?.remove();
  }

  function host(workspace) {
    const root = controls(workspace);
    if (!root) return null;
    let card = root.querySelector('[data-on-chain-controls]');
    if (!card) {
      card = document.createElement('section');
      card.className = 'admin-record-card';
      card.dataset.onChainControls = 'true';
      root.append(card);
    }
    return card;
  }

  function approvalCard(item) {
    const instrument = item.instrument || {};
    const id = instrumentId(instrument);
    const assessment = item.assessment || {};
    const blockers = Array.isArray(assessment.blockers) ? assessment.blockers : [];
    const authorized = authorizedAmount(instrument);
    if (item.representationApproved) {
      return `<article class="admin-record-card"><header><strong>${esc(id)}</strong><em>APPROVED</em></header><div class="admin-record-grid"><div><span>State</span><strong>${esc(assessment.state || instrument.state || instrument.status || '—')}</strong></div><div><span>Amount / supply</span><strong>${esc(authorized ?? '—')}</strong></div><div><span>On-chain approval</span><strong>APPROVED</strong></div></div></article>`;
    }
    return `<article class="admin-record-card" data-approval-card="${esc(id)}"><header><strong>${esc(id)}</strong><em>${assessment.eligible === false ? 'NOT ELIGIBLE' : 'APPROVAL REQUIRED'}</em></header><div class="admin-record-grid"><div><span>State</span><strong>${esc(assessment.state || instrument.state || instrument.status || '—')}</strong></div><div><span>Amount / supply</span><strong>${esc(authorized ?? '—')}</strong></div></div>${blockers.length ? `<p style="color:#d6a92f;font-size:12px;line-height:1.45;margin:12px 0 0">${esc(blockers.join(', '))}</p>` : ''}<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-approve-on-chain="${esc(id)}" ${assessment.eligible === false ? 'disabled' : ''}>Approve On-Chain</button><span data-approval-result style="color:#d6a92f;font-size:12px"></span></div></article>`;
  }

  function networkOptions(status) {
    return (status?.networks || []).filter((item) => item?.ready).map((item) => `<option value="${esc(item.network)}">${esc(item.network)}</option>`).join('');
  }

  function onChainCard(item, assets, status) {
    const instrument = item.instrument || {};
    const id = instrumentId(instrument);
    const authorized = authorizedAmount(instrument);
    const asset = assets.find((candidate) => candidate.instrumentId === id);
    const options = networkOptions(status);

    if (!item.representationApproved) {
      return `<article class="admin-record-card"><header><strong>${esc(id)}</strong><em>APPROVAL REQUIRED</em></header><div class="admin-record-grid"><div><span>Amount / supply</span><strong>${esc(authorized ?? '—')}</strong></div><div><span>Next step</span><strong>Complete Approval tab</strong></div></div></article>`;
    }

    if (!asset) {
      return `<article class="admin-record-card" data-create-card="${esc(id)}"><header><strong>${esc(id)}</strong><em>NOT ON CHAIN</em></header><p style="color:#9a9a9a;line-height:1.5">Create the network asset first. This creates the chain asset address only; supply is issued as the next step.</p><div class="admin-record-grid"><div><span>Amount / supply</span><strong>${esc(authorized ?? '—')}</strong></div><label><span>Network</span><select data-create-network ${options ? '' : 'disabled'}>${options || '<option value="">No ready network</option>'}</select></label><label><span>Decimals</span><input data-create-decimals type="number" min="0" max="255" step="1" value="9" autocomplete="off"></label></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-create-on-chain="${esc(id)}" ${options ? '' : 'disabled'}>Create On Chain</button><span data-create-result style="color:#d6a92f;font-size:12px"></span></div></article>`;
    }

    return `<article class="admin-record-card" data-asset-card="${esc(asset.assetId)}"><header><strong>${esc(id)}</strong><em>${esc(asset.state || 'CREATED')}</em></header><div class="admin-record-grid"><div><span>Network</span><strong>${esc(asset.network)}</strong></div><div><span>Asset address</span><strong>${esc(asset.assetAddress)}</strong></div><div><span>Decimals</span><strong>${esc(asset.decimals)}</strong></div><div><span>Issued supply</span><strong>${esc(asset.issuedSupply ?? '0')}</strong></div><div><span>Create transaction</span><strong>${esc(asset.createdTransactionId || '—')}</strong></div><div><span>Last issue transaction</span><strong>${esc(asset.lastIssueTransactionId || '—')}</strong></div></div>
      <section style="margin-top:16px;border-top:1px solid #292929;padding-top:16px"><strong>Issue Supply</strong><div class="admin-record-grid" style="margin-top:10px"><label><span>Amount</span><input data-issue-amount type="text" inputmode="decimal" autocomplete="off" placeholder="Amount"></label><label><span>Destination address</span><input data-issue-destination type="text" autocomplete="off" placeholder="Leave blank for platform wallet"></label></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-issue-asset="${esc(asset.assetId)}">Issue Supply</button><span data-issue-result style="color:#d6a92f;font-size:12px"></span></div></section>
      <section style="margin-top:16px;border-top:1px solid #292929;padding-top:16px"><strong>Transfer</strong><div class="admin-record-grid" style="margin-top:10px"><label><span>Amount</span><input data-transfer-amount type="text" inputmode="decimal" autocomplete="off" placeholder="Amount"></label><label><span>Destination address</span><input data-transfer-destination type="text" autocomplete="off" placeholder="Destination wallet"></label></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-transfer-asset="${esc(asset.assetId)}" data-transfer-symbol="${esc(asset.asset)}" data-transfer-network="${esc(asset.network)}">Send On Chain</button><span data-transfer-result style="color:#d6a92f;font-size:12px"></span></div></section>
    </article>`;
  }

  function bindApproval(workspace, card) {
    card.querySelectorAll('[data-approve-on-chain]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.dataset.approveOnChain;
      const row = button.closest('[data-approval-card]');
      const result = row?.querySelector('[data-approval-result]');
      if (!confirm(`Approve ${id} for on-chain creation?`)) return;
      button.disabled = true;
      if (result) result.textContent = 'Recording approval…';
      try {
        await request(`/api/admin/instruments/${encodeURIComponent(id)}/representation/approve`, {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ approval:'APPROVE' }),
        });
        if (result) result.textContent = 'Approved.';
        window.SRAAdminDataClient?.refresh?.('on-chain-approved');
        await render(workspace);
      } catch (error) {
        if (result) result.textContent = error.message;
        button.disabled = false;
      }
    }));
  }

  function bindOnChain(workspace, card) {
    card.querySelectorAll('[data-create-on-chain]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.dataset.createOnChain;
      const row = button.closest('[data-create-card]');
      const network = row?.querySelector('[data-create-network]')?.value;
      const decimals = row?.querySelector('[data-create-decimals]')?.value;
      const result = row?.querySelector('[data-create-result]');
      if (!network || decimals === '') { if (result) result.textContent = 'Enter network and decimals.'; return; }
      if (!confirm(`Create ${id} on ${network}?`)) return;
      button.disabled = true;
      if (result) result.textContent = 'Creating network asset…';
      try {
        const response = await request('/api/on-chain/assets', {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ instrumentId:id, network, decimals:Number(decimals) }),
        });
        if (result) result.textContent = `Created: ${response.asset?.assetAddress || 'recorded'}`;
        window.SRAAdminDataClient?.refresh?.('on-chain-created');
        await render(workspace);
      } catch (error) {
        if (result) result.textContent = error.message;
        button.disabled = false;
      }
    }));

    card.querySelectorAll('[data-issue-asset]').forEach((button) => button.addEventListener('click', async () => {
      const row = button.closest('[data-asset-card]');
      const amount = row?.querySelector('[data-issue-amount]')?.value?.trim();
      const destinationAddress = row?.querySelector('[data-issue-destination]')?.value?.trim();
      const result = row?.querySelector('[data-issue-result]');
      if (!amount) { if (result) result.textContent = 'Enter amount.'; return; }
      button.disabled = true;
      if (result) result.textContent = 'Issuing supply…';
      try {
        const response = await request(`/api/on-chain/assets/${encodeURIComponent(button.dataset.issueAsset)}/issue`, {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ amount, destinationAddress: destinationAddress || undefined }),
        });
        if (result) result.textContent = `Issued · ${response.issuance?.transactionId || 'transaction recorded'}`;
        window.SRAAdminDataClient?.refresh?.('on-chain-issued');
        await render(workspace);
      } catch (error) {
        if (result) result.textContent = error.message;
        button.disabled = false;
      }
    }));

    card.querySelectorAll('[data-transfer-asset]').forEach((button) => button.addEventListener('click', async () => {
      const row = button.closest('[data-asset-card]');
      const amount = row?.querySelector('[data-transfer-amount]')?.value?.trim();
      const destinationAddress = row?.querySelector('[data-transfer-destination]')?.value?.trim();
      const result = row?.querySelector('[data-transfer-result]');
      if (!amount || !destinationAddress) { if (result) result.textContent = 'Enter amount and destination address.'; return; }
      button.disabled = true;
      if (result) result.textContent = 'Building, signing, and broadcasting…';
      try {
        const response = await request('/api/on-chain/transfers', {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
            network:button.dataset.transferNetwork,
            asset:button.dataset.transferSymbol,
            amount,
            destinationAddress,
          }),
        });
        if (result) result.textContent = `${response.state} · ${response.transactionId || 'transaction recorded'}`;
        window.SRAAdminDataClient?.refresh?.('on-chain-transferred');
      } catch (error) {
        if (result) result.textContent = error.message;
        button.disabled = false;
      }
    }));
  }

  async function renderApproval(workspace, card) {
    card.innerHTML = '<header><strong>On-Chain Approval</strong><em>CHECKING</em></header><p>Loading instruments…</p>';
    const approvalStatus = await request(`/api/admin/instruments/approval-status?_=${Date.now()}`);
    if (!active(workspace) || activeTab(workspace) !== 'Approval') return;
    const eligible = approvalStatus.representationReady || [];
    card.innerHTML = `<header><strong>On-Chain Approval</strong><em>INSTRUMENTS</em></header><p style="color:#9a9a9a;line-height:1.5">Approve which existing SRA instruments may be sent to the on-chain creation flow.</p><div style="display:grid;gap:10px">${eligible.length ? eligible.map(approvalCard).join('') : '<p>No eligible instruments are currently available.</p>'}</div>`;
    bindApproval(workspace, card);
  }

  async function renderOnChain(workspace, card) {
    card.innerHTML = '<header><strong>On-Chain</strong><em>CHECKING</em></header><p>Loading network assets…</p>';
    const [approvalStatus, status, assetsResult] = await Promise.all([
      request(`/api/admin/instruments/approval-status?_=${Date.now()}`),
      request('/api/on-chain/status'),
      request('/api/on-chain/assets'),
    ]);
    if (!active(workspace) || activeTab(workspace) !== 'On-Chain') return;
    const eligible = approvalStatus.representationReady || [];
    const assets = assetsResult.records || [];
    const ready = (status.networks || []).some((item) => item.ready);
    card.innerHTML = `<header><strong>On-Chain</strong><em>${ready ? 'READY' : 'NETWORK NOT READY'}</em></header><p style="color:#9a9a9a;line-height:1.5">Create → issue → transfer. Network-specific transaction code stays inside the selected network adapter.</p><div style="display:grid;gap:10px">${eligible.length ? eligible.map((item) => onChainCard(item, assets, status)).join('') : '<p>No eligible instruments are currently available.</p>'}</div>`;
    bindOnChain(workspace, card);
  }

  async function render(workspace) {
    if (!workspace || !active(workspace)) return;
    ensureTabs(workspace);
    const tab = activeTab(workspace);
    const recordRoot = records(workspace);
    if (!SPECIAL_TABS.has(tab)) {
      clearHost(workspace);
      if (recordRoot) recordRoot.style.display = '';
      return;
    }
    if (recordRoot) recordRoot.style.display = 'none';

    const state = renderState.get(workspace) || { inFlight:null, queued:false, timer:null };
    if (state.inFlight) {
      state.queued = true;
      renderState.set(workspace, state);
      return state.inFlight;
    }
    const card = host(workspace);
    if (!card) return;
    const work = (async () => {
      try {
        if (tab === 'Approval') await renderApproval(workspace, card);
        else await renderOnChain(workspace, card);
      } catch (error) {
        if (active(workspace) && activeTab(workspace) === tab) card.innerHTML = `<header><strong>${esc(tab)}</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`;
      }
    })();
    state.inFlight = work;
    state.queued = false;
    renderState.set(workspace, state);
    try { await work; }
    finally {
      state.inFlight = null;
      if (state.queued && active(workspace)) {
        state.queued = false;
        clearTimeout(state.timer);
        state.timer = setTimeout(() => void render(workspace), 120);
      }
      renderState.set(workspace, state);
    }
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    ensureTabs(workspace);
    const schedule = () => {
      const state = renderState.get(workspace) || { inFlight:null, queued:false, timer:null };
      clearTimeout(state.timer);
      state.timer = setTimeout(() => { if (active(workspace)) void render(workspace); }, 120);
      renderState.set(workspace, state);
    };
    workspace.addEventListener('click', (event) => {
      if (event.target.closest('[data-admin-tab]')) setTimeout(schedule, 0);
    });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => {
      if (event.detail?.workspaceId === 'instruments') schedule();
    });
    window.addEventListener('sra:admin-refresh', () => { if (SPECIAL_TABS.has(activeTab(workspace))) schedule(); });
    window.addEventListener('sra:admin-mutated', () => { if (SPECIAL_TABS.has(activeTab(workspace))) schedule(); });
    const observer = new MutationObserver(() => { if (active(workspace)) schedule(); });
    observer.observe(workspace, { attributes:true, attributeFilter:['class'] });
    if (active(workspace)) schedule();
  }

  window.mountAdminOnChainIssuanceControls = mount;
})();
