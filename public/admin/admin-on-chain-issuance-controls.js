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

  function step(label, state, detail) {
    return `<div style="border:1px solid #292929;border-radius:10px;padding:10px 12px;background:#090909"><span style="display:block;color:#9a9a9a;font-size:10px;text-transform:uppercase">${esc(label)}</span><strong style="display:block;margin-top:4px">${esc(state)}</strong>${detail ? `<small style="display:block;color:#777;margin-top:4px;line-height:1.4">${esc(detail)}</small>` : ''}</div>`;
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
      return `<article class="admin-record-card" data-create-card="${esc(id)}"><header><strong>${esc(id)}</strong><em>STEP 1 · ASSET IDENTITY</em></header><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0">${step('Step 1','Create asset identity','Register the network asset identity for this approved instrument.')}${step('Step 2','Issue supply','After the asset identity exists, issue the approved amount to the platform distribution account.')}${step('Step 3','Transfer','After supply exists, send units to a destination address.')}</div><p style="color:#9a9a9a;line-height:1.5">Select a ready network and create the asset identity. On Stellar this records the asset code + issuer identity; the supply transaction happens in Step 2.</p><div class="admin-record-grid"><div><span>Approved amount / supply</span><strong>${esc(authorized ?? '—')}</strong></div><label><span>Network</span><select data-create-network ${options ? '' : 'disabled'}>${options || '<option value="">No ready network</option>'}</select></label></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-create-on-chain="${esc(id)}" ${options ? '' : 'disabled'}>Create Asset Identity</button><span data-create-result style="color:#d6a92f;font-size:12px"></span></div></article>`;
    }

    const issued = Number(asset.issuedSupply || 0) > 0;
    return `<article class="admin-record-card" data-asset-card="${esc(asset.assetId)}"><header><strong>${esc(id)}</strong><em>${esc(asset.state || 'CREATED')}</em></header><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0">${step('Step 1','COMPLETE','Asset identity exists on the selected network.')}${step('Step 2',issued ? 'COMPLETE' : 'READY','Issue supply from the issuer to the platform distribution account.')}${step('Step 3',issued ? 'READY' : 'WAITING','Transfer issued units to an external destination.')}</div><div class="admin-record-grid"><div><span>Network</span><strong>${esc(asset.network)}</strong></div><div><span>Asset address</span><strong>${esc(asset.assetAddress)}</strong></div><div><span>Network decimals</span><strong>${esc(asset.decimals)}</strong></div><div><span>Issued supply</span><strong>${esc(asset.issuedSupply ?? '0')}</strong></div><div><span>Asset identity transaction</span><strong>${esc(asset.createdTransactionId || 'Not applicable / not broadcast')}</strong></div><div><span>Last issue transaction</span><strong>${esc(asset.lastIssueTransactionId || '—')}</strong></div></div>
      <section style="margin-top:16px;border-top:1px solid #292929;padding-top:16px"><strong>Step 2 · Issue Supply</strong><p style="color:#9a9a9a;font-size:12px;line-height:1.45">Issue units to the platform distribution account. The network adapter handles the required trustline and signed issuance transaction.</p><div class="admin-record-grid" style="margin-top:10px"><label><span>Amount</span><input data-issue-amount type="text" inputmode="decimal" autocomplete="off" placeholder="Amount"></label></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-issue-asset="${esc(asset.assetId)}">Issue Supply</button><span data-issue-result style="color:#d6a92f;font-size:12px"></span></div></section>
      <section style="margin-top:16px;border-top:1px solid #292929;padding-top:16px"><strong>Step 3 · Transfer On Chain</strong><p style="color:#9a9a9a;font-size:12px;line-height:1.45">Send issued units from the platform distribution account to a destination address.</p><div class="admin-record-grid" style="margin-top:10px"><label><span>Amount</span><input data-transfer-amount type="text" inputmode="decimal" autocomplete="off" placeholder="Amount"></label><label><span>Destination address</span><input data-transfer-destination type="text" autocomplete="off" placeholder="Destination wallet"></label></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-transfer-asset="${esc(asset.assetId)}" data-transfer-symbol="${esc(asset.asset)}" data-transfer-network="${esc(asset.network)}" ${issued ? '' : 'disabled'}>Send On Chain</button><span data-transfer-result style="color:#d6a92f;font-size:12px">${issued ? '' : 'Issue supply first.'}</span></div></section>
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
      const result = row?.querySelector('[data-create-result]');
      if (!network) { if (result) result.textContent = 'Select a ready network.'; return; }
      if (!confirm(`Create the ${id} asset identity on ${network}?`)) return;
      button.disabled = true;
      if (result) result.textContent = 'Creating asset identity…';
      try {
        const response = await request('/api/on-chain/assets', {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ instrumentId:id, network }),
        });
        if (result) result.textContent = `Asset identity ready: ${response.asset?.assetAddress || 'recorded'}`;
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
      const result = row?.querySelector('[data-issue-result]');
      if (!amount) { if (result) result.textContent = 'Enter amount.'; return; }
      button.disabled = true;
      if (result) result.textContent = 'Building, signing, broadcasting, and confirming issuance…';
      try {
        const response = await request(`/api/on-chain/assets/${encodeURIComponent(button.dataset.issueAsset)}/issue`, {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ amount }),
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
      if (result) result.textContent = 'Building, signing, broadcasting, and confirming transfer…';
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
    card.innerHTML = `<header><strong>On-Chain</strong><em>${ready ? 'READY' : 'NETWORK NOT READY'}</em></header><p style="color:#9a9a9a;line-height:1.5">Approved instrument → create asset identity → issue supply → transfer. New on-chain operations require a live ready network; completed records remain available independently of network health.</p><div style="display:grid;gap:10px">${eligible.length ? eligible.map((item) => onChainCard(item, assets, status)).join('') : '<p>No eligible instruments are currently available.</p>'}</div>`;
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
