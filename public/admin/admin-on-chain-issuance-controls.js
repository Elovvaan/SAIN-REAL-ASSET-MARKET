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

  function active(workspace) {
    return Boolean(workspace?.classList.contains('active'));
  }

  function activeTab(workspace) {
    return String(workspace?.dataset?.activeTab || '');
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

  function controls(workspace) {
    return workspace?.querySelector('.admin-workspace-controls') || null;
  }

  function records(workspace) {
    return workspace?.querySelector('.admin-workspace-records') || null;
  }

  function clearHost(workspace) {
    controls(workspace)?.querySelector('[data-on-chain-issuance-controls]')?.remove();
  }

  function host(workspace) {
    const root = controls(workspace);
    if (!root) return null;
    let card = root.querySelector('[data-on-chain-issuance-controls]');
    if (!card) {
      card = document.createElement('section');
      card.className = 'admin-record-card';
      card.dataset.onChainIssuanceControls = 'true';
      root.append(card);
    }
    return card;
  }

  function instrumentId(record) { return record?.instrumentId || record?.id || ''; }
  function authorizedAmount(instrument) {
    return instrument?.authorizedSupply ?? instrument?.authorizedAmount ?? instrument?.quantity ?? instrument?.faceAmount ?? instrument?.faceValue ?? instrument?.faceValueUsd ?? null;
  }

  function approvalCard(item) {
    const instrument = item.instrument || {};
    const id = instrumentId(instrument);
    const assessment = item.assessment || {};
    const blockers = Array.isArray(assessment.blockers) ? assessment.blockers : [];
    const authorized = authorizedAmount(instrument);

    if (item.representationApproved) {
      return `<article class="admin-record-card"><header><strong>${esc(id)}</strong><em>APPROVED</em></header><div class="admin-record-grid"><div><span>State</span><strong>${esc(assessment.state || instrument.state || instrument.status || '—')}</strong></div><div><span>Authorized supply / amount</span><strong>${esc(authorized ?? '—')}</strong></div><div><span>Representation approval</span><strong>APPROVED</strong></div></div></article>`;
    }

    return `<article class="admin-record-card" data-representation-approval-card="${esc(id)}"><header><strong>${esc(id)}</strong><em>${assessment.eligible === false ? 'NOT ELIGIBLE' : 'APPROVAL REQUIRED'}</em></header><div class="admin-record-grid"><div><span>State</span><strong>${esc(assessment.state || instrument.state || instrument.status || '—')}</strong></div><div><span>Authorized supply / amount</span><strong>${esc(authorized ?? '—')}</strong></div></div>${blockers.length ? `<p style="color:#d6a92f;font-size:12px;line-height:1.45;margin:12px 0 0">${esc(blockers.join(', '))}</p>` : ''}<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-approve-representation="${esc(id)}" ${assessment.eligible === false ? 'disabled' : ''}>Approve Representation</button><span data-representation-approval-result style="color:#d6a92f;font-size:12px"></span></div></article>`;
  }

  function onChainCard(item, projections, networks) {
    const instrument = item.instrument || {};
    const id = instrumentId(instrument);
    const authorized = authorizedAmount(instrument);
    const projection = projections.find((candidate) => candidate.instrumentId === id && candidate.mintAddress);

    if (projection) {
      return `<article class="admin-record-card"><header><strong>${esc(id)}</strong><em>ON CHAIN</em></header><div class="admin-record-grid"><div><span>Network</span><strong>${esc(projection.network)}</strong></div><div><span>Cluster</span><strong>${esc(projection.cluster || '—')}</strong></div><div><span>Mint address</span><strong>${esc(projection.mintAddress)}</strong></div><div><span>Issued supply</span><strong>${esc(projection.issuedSupplyExact ?? projection.issuedSupply)}</strong></div><div><span>Decimals</span><strong>${esc(projection.decimals)}</strong></div><div><span>Issuance transaction</span><strong>${esc(projection.issuanceTransactionId || '—')}</strong></div></div></article>`;
    }

    if (!item.representationApproved) {
      return `<article class="admin-record-card"><header><strong>${esc(id)}</strong><em>APPROVAL REQUIRED</em></header><div class="admin-record-grid"><div><span>Authorized supply / amount</span><strong>${esc(authorized ?? '—')}</strong></div><div><span>Next step</span><strong>Complete Approval tab</strong></div></div></article>`;
    }

    return `<article class="admin-record-card" data-on-chain-issue-card="${esc(id)}"><header><strong>${esc(id)}</strong><em>${networks.length ? 'READY TO ISSUE' : 'NETWORK NOT READY'}</em></header><div class="admin-record-grid"><div><span>Authorized supply / amount</span><strong>${esc(authorized ?? '—')}</strong></div><label><span>Network</span><select data-issue-network ${networks.length ? '' : 'disabled'}>${networks.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select></label><label><span>Amount to issue</span><input data-issue-amount type="text" inputmode="decimal" placeholder="Amount" autocomplete="off" required></label><label><span>Decimals</span><input data-issue-decimals type="number" min="0" max="255" step="1" value="9" autocomplete="off" required></label></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-issue-on-chain="${esc(id)}" ${networks.length ? '' : 'disabled'}>Issue On Chain</button><span data-issue-result style="color:#d6a92f;font-size:12px"></span></div></article>`;
  }

  function bindApprovalActions(workspace, card) {
    card.querySelectorAll('[data-approve-representation]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.dataset.approveRepresentation;
      const row = button.closest('[data-representation-approval-card]');
      const result = row?.querySelector('[data-representation-approval-result]');
      if (!confirm(`Approve the existing SRA instrument ${id} for on-chain representation?`)) return;
      button.disabled = true;
      if (result) result.textContent = 'Recording representation approval…';
      try {
        await request(`/api/admin/instruments/${encodeURIComponent(id)}/representation/approve`, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ approval:'APPROVE' }),
        });
        if (result) result.textContent = 'Representation approved.';
        window.SRAAdminDataClient?.refresh?.('instrument-representation-approved');
        await render(workspace);
      } catch (error) {
        if (result) result.textContent = error.message || 'Representation approval failed.';
        button.disabled = false;
      }
    }));
  }

  function bindIssuanceActions(workspace, card) {
    card.querySelectorAll('[data-issue-on-chain]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.dataset.issueOnChain;
      const row = button.closest('[data-on-chain-issue-card]');
      const amount = row?.querySelector('[data-issue-amount]')?.value?.trim();
      const decimals = row?.querySelector('[data-issue-decimals]')?.value;
      const network = row?.querySelector('[data-issue-network]')?.value;
      const result = row?.querySelector('[data-issue-result]');
      if (!amount || decimals === '' || !network) {
        if (result) result.textContent = 'Enter network, amount, and decimals.';
        return;
      }
      if (!confirm(`Issue ${amount} units of ${id} on ${network}? This creates the real network mint and initial platform supply.`)) return;
      button.disabled = true;
      if (result) result.textContent = 'Issuing on chain…';
      try {
        const response = await request('/api/on-chain/representations/issue', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ instrumentId:id, network, amount, decimals:Number(decimals) }),
        });
        if (result) result.textContent = `Issued. Mint: ${response.projection?.mintAddress || 'recorded'} · Transaction: ${response.projection?.issuanceTransactionId || 'recorded'}`;
        window.SRAAdminDataClient?.refresh?.('on-chain-representation-issued');
        window.dispatchEvent(new CustomEvent('sra:admin-refresh', { detail:{ source:'on-chain-representation-issued' } }));
      } catch (error) {
        if (result) result.textContent = error.message || 'On-chain issuance failed.';
        button.disabled = false;
      }
    }));
  }

  async function renderApproval(workspace, card) {
    card.innerHTML = '<header><strong>Representation Approval</strong><em>CHECKING</em></header><p>Loading eligible instruments…</p>';
    const approvalStatus = await request(`/api/admin/instruments/approval-status?_=${Date.now()}`);
    if (!active(workspace) || activeTab(workspace) !== 'Approval') return;
    const eligible = approvalStatus.representationReady || [];
    card.innerHTML = `<header><strong>Representation Approval</strong><em>INSTRUMENTS</em></header><p style="color:#9a9a9a;line-height:1.5">Approve an existing eligible instrument for on-chain representation. This approval does not mint or send the asset.</p><div style="display:grid;gap:10px" data-representation-approval-list>${eligible.length ? eligible.map(approvalCard).join('') : '<p>No issued, active, approved, or recorded instruments are currently available for representation approval.</p>'}</div>`;
    bindApprovalActions(workspace, card);
  }

  async function renderOnChain(workspace, card) {
    card.innerHTML = '<header><strong>On-Chain</strong><em>CHECKING</em></header><p>Loading approved instruments and network status…</p>';
    const [approvalStatus, chainStatus, projectionsResult] = await Promise.all([
      request(`/api/admin/instruments/approval-status?_=${Date.now()}`),
      request('/api/on-chain/status'),
      request('/api/on-chain/representations'),
    ]);
    if (!active(workspace) || activeTab(workspace) !== 'On-Chain') return;
    const readyNetworks = (chainStatus.networks || []).filter((item) => item?.ready === true);
    const networks = readyNetworks.map((item) => item.network).filter(Boolean);
    const projections = projectionsResult.records || [];
    const eligible = approvalStatus.representationReady || [];
    card.innerHTML = `<header><strong>On-Chain</strong><em>${networks.length ? 'READY FOR INSTRUCTION' : 'NETWORK NOT READY'}</em></header><p style="color:#9a9a9a;line-height:1.5">Issue the on-chain representation for an approved instrument. This creates the network mint, issues the requested supply to the platform wallet, records the mint address and transaction ID, and makes the asset available to the normal transfer flow.</p>${networks.length ? '' : '<p style="color:#d6a92f">No configured network adapter is currently ready for issuance.</p>'}<div style="display:grid;gap:10px" data-on-chain-issuance-list>${eligible.length ? eligible.map((item) => onChainCard(item, projections, networks)).join('') : '<p>No eligible instruments are currently available for on-chain issuance.</p>'}</div>`;
    bindIssuanceActions(workspace, card);
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
        if (active(workspace) && activeTab(workspace) === tab) {
          card.innerHTML = `<header><strong>${esc(tab)}</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`;
        }
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
    window.addEventListener('sra:admin-refresh', () => {
      if (SPECIAL_TABS.has(activeTab(workspace))) schedule();
    });
    window.addEventListener('sra:admin-mutated', () => {
      if (SPECIAL_TABS.has(activeTab(workspace))) schedule();
    });
    const observer = new MutationObserver(() => { if (active(workspace)) schedule(); });
    observer.observe(workspace, { attributes:true, attributeFilter:['class'] });
    if (active(workspace)) schedule();
  }

  window.mountAdminOnChainIssuanceControls = mount;
})();
