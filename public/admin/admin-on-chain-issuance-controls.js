(() => {
  if (window.__sraAdminOnChainIssuanceControlsInstalled) return;
  window.__sraAdminOnChainIssuanceControlsInstalled = true;

  const mounted = new WeakSet();
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const request = async (url, options = {}) => {
    if (window.SRAAdminDataClient) return window.SRAAdminDataClient.json(url, options);
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };

  function host(workspace) {
    const controls = workspace?.querySelector('.admin-workspace-controls');
    if (!controls) return null;
    let card = controls.querySelector('[data-on-chain-issuance-controls]');
    if (!card) {
      card = document.createElement('section');
      card.className = 'admin-record-card';
      card.dataset.onChainIssuanceControls = 'true';
      controls.append(card);
    }
    return card;
  }

  function instrumentId(record) { return record?.instrumentId || record?.id || ''; }

  async function render(workspace) {
    if (!workspace) return;
    const card = host(workspace);
    if (!card) return;
    card.innerHTML = '<header><strong>On-Chain Issuance</strong><em>CHECKING</em></header><p>Loading approved representations…</p>';
    try {
      const [approvalStatus, chainStatus, projectionsResult] = await Promise.all([
        request(`/api/admin/instruments/approval-status?_=${Date.now()}`),
        request('/api/on-chain/status'),
        request('/api/on-chain/representations'),
      ]);
      const allNetworks = chainStatus.networks || [];
      const readyNetworks = allNetworks.filter((item) => item?.ready === true);
      const networks = readyNetworks.map((item) => item.network).filter(Boolean);
      const projections = projectionsResult.records || [];
      const approved = (approvalStatus.representationReady || []).filter((item) => item.representationApproved);

      card.innerHTML = `<header><strong>On-Chain Issuance</strong><em>${networks.length ? 'READY FOR INSTRUCTION' : 'NETWORK NOT READY'}</em></header>
        <p style="color:#9a9a9a;line-height:1.5">Create the real on-chain representation for an approved instrument. Issuance creates the network mint, issues the requested supply to the platform wallet, records the mint address and transaction ID, and makes that asset available to the normal on-chain transfer flow.</p>
        ${networks.length ? '' : '<p style="color:#d6a92f">No configured network adapter is currently ready for issuance. Configure the network RPC and signer before issuing.</p>'}
        <div style="display:grid;gap:10px" data-on-chain-issuance-list></div>`;

      const list = card.querySelector('[data-on-chain-issuance-list]');
      if (!approved.length) {
        list.innerHTML = '<p>No representation-approved instruments are currently available for on-chain issuance.</p>';
        return;
      }

      list.innerHTML = approved.map((item) => {
        const instrument = item.instrument || {};
        const id = instrumentId(instrument);
        const projection = projections.find((candidate) => candidate.instrumentId === id && candidate.mintAddress);
        const authorized = instrument.authorizedSupply ?? instrument.authorizedAmount ?? instrument.quantity ?? instrument.faceAmount ?? instrument.faceValue ?? instrument.faceValueUsd ?? null;
        if (projection) {
          return `<article class="admin-record-card"><header><strong>${esc(id)}</strong><em>ON CHAIN</em></header><div class="admin-record-grid"><div><span>Network</span><strong>${esc(projection.network)}</strong></div><div><span>Cluster</span><strong>${esc(projection.cluster || '—')}</strong></div><div><span>Mint address</span><strong>${esc(projection.mintAddress)}</strong></div><div><span>Issued supply</span><strong>${esc(projection.issuedSupplyExact ?? projection.issuedSupply)}</strong></div><div><span>Decimals</span><strong>${esc(projection.decimals)}</strong></div><div><span>Issuance transaction</span><strong>${esc(projection.issuanceTransactionId || '—')}</strong></div></div></article>`;
        }
        return `<article class="admin-record-card" data-on-chain-issue-card="${esc(id)}"><header><strong>${esc(id)}</strong><em>${networks.length ? 'APPROVED TO ISSUE' : 'NETWORK NOT READY'}</em></header><div class="admin-record-grid"><div><span>Authorized supply / amount</span><strong>${esc(authorized ?? '—')}</strong></div><label><span>Network</span><select data-issue-network ${networks.length ? '' : 'disabled'}>${networks.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select></label><label><span>Amount to issue</span><input data-issue-amount type="text" inputmode="decimal" placeholder="Amount" required></label><label><span>Decimals</span><input data-issue-decimals type="number" min="0" max="255" step="1" placeholder="Token decimals" required></label></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-issue-on-chain="${esc(id)}" ${networks.length ? '' : 'disabled'}>Issue On Chain</button><span data-issue-result style="color:#d6a92f;font-size:12px"></span></div></article>`;
      }).join('');

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
          await render(workspace);
        } catch (error) {
          if (result) result.textContent = error.message || 'On-chain issuance failed.';
          button.disabled = false;
        }
      }));
    } catch (error) {
      card.innerHTML = `<header><strong>On-Chain Issuance</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`;
    }
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    const refresh = () => void render(workspace);
    window.addEventListener('sra:admin-workspace-synchronized', (event) => {
      if (event.detail?.workspaceId === 'instruments') refresh();
    });
    window.addEventListener('sra:admin-refresh', refresh);
    window.addEventListener('sra:admin-mutated', refresh);
    refresh();
  }

  window.mountAdminOnChainIssuanceControls = mount;
})();
