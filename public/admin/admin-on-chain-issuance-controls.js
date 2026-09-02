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
  function generatedAssetCode(id) {
    const compact = String(id ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!compact) return '';
    if (compact.length <= 12) return compact;
    let hash = 0x811c9dc5;
    for (const character of compact) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const suffix = hash.toString(36).toUpperCase().padStart(6, '0').slice(-6);
    return `${compact.slice(0, 6)}${suffix}`;
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

  function step(label, state, detail) {
    return `<div style="border:1px solid #292929;border-radius:10px;padding:10px 12px;background:#090909"><span style="display:block;color:#9a9a9a;font-size:10px;text-transform:uppercase">${esc(label)}</span><strong style="display:block;margin-top:4px">${esc(state)}</strong>${detail ? `<small style="display:block;color:#777;margin-top:4px;line-height:1.4">${esc(detail)}</small>` : ''}</div>`;
  }

  function lifecycleSteps(item, networkReady, asset, issued, offers = []) {
    const workflow = item.workflow || {};
    const linked = Boolean(item.assessment?.linkedCoinPositionIds?.length || item.instrument?.coinPositionId);
    const marketState = offers[0]?.marketState || (offers.length ? 'SUBMITTED' : (issued ? 'READY' : 'WAITING'));
    return [
      step('1 · Instrument approval', workflow.instrumentApproval || 'COMPLETE', 'Instrument must be approved before representation work begins.'),
      step('2 · Representation approval', item.representationApproved ? 'COMPLETE' : (workflow.representationApproval || 'REQUIRED'), 'Authorizes this instrument for on-chain representation preparation.'),
      step('3 · Coin Position linkage', linked ? 'COMPLETE' : (item.representationApproved ? 'REQUIRED' : 'WAITING'), 'Register the authorized source position in Coin Positions.'),
      step('4 · Network readiness', linked && networkReady ? 'COMPLETE' : 'WAITING', 'Selected network signer accounts and network connection must be live.'),
      step('5 · Asset identity', asset ? 'COMPLETE' : (linked && networkReady && item.representationApproved ? 'READY' : 'WAITING'), 'Register the asset code + issuer identity on the selected network.'),
      step('6 · Issue supply', issued ? 'COMPLETE' : (asset ? 'READY' : 'WAITING'), 'Issue the approved amount to the platform distribution account.'),
      step('7 · Transfer', issued ? 'READY' : 'WAITING', 'Transfer issued units from the distribution account to a destination address.'),
      step('8 · Live market', marketState, 'Offer issued units and monitor execution on the selected network market.'),
    ].join('');
  }

  function approvalCard(item) {
    const instrument = item.instrument || {};
    const id = instrumentId(instrument);
    const assessment = item.assessment || {};
    const blockers = Array.isArray(assessment.blockers) ? assessment.blockers : [];
    const authorized = authorizedAmount(instrument);
    const workflow = item.workflow || {};
    if (item.representationApproved) {
      return `<article class="admin-record-card"><header><strong>${esc(id)}</strong><em>REPRESENTATION APPROVED</em></header><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0">${step('1 · Instrument approval',workflow.instrumentApproval || 'COMPLETE','Instrument approval is complete.')}${step('2 · Representation approval','COMPLETE','On-chain representation approval is recorded.')}${step('3 · On-chain preparation',workflow.onChainPreparation || 'READY','Continue to the On-Chain tab for network readiness and execution.')}</div><div class="admin-record-grid"><div><span>Instrument state</span><strong>${esc(assessment.state || instrument.state || instrument.status || '—')}</strong></div><div><span>Amount / supply</span><strong>${esc(authorized ?? '—')}</strong></div></div></article>`;
    }
    return `<article class="admin-record-card" data-approval-card="${esc(id)}"><header><strong>${esc(id)}</strong><em>${assessment.eligible === false ? 'NOT ELIGIBLE' : 'STEP 2 · REPRESENTATION APPROVAL'}</em></header><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0">${step('1 · Instrument approval',workflow.instrumentApproval || 'COMPLETE','Instrument approval must be complete first.')}${step('2 · Representation approval',assessment.eligible === false ? 'BLOCKED' : 'REQUIRED','Explicitly approve this instrument for on-chain representation.')}${step('3 · On-chain preparation','WAITING','Begins only after representation approval is recorded.')}</div><div class="admin-record-grid"><div><span>Instrument state</span><strong>${esc(assessment.state || instrument.state || instrument.status || '—')}</strong></div><div><span>Amount / supply</span><strong>${esc(authorized ?? '—')}</strong></div></div>${blockers.length ? `<p style="color:#d6a92f;font-size:12px;line-height:1.45;margin:12px 0 0">${esc(blockers.join(', '))}</p>` : ''}<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-approve-on-chain="${esc(id)}" ${assessment.eligible === false ? 'disabled' : ''}>Approve Representation</button><span data-approval-result style="color:#d6a92f;font-size:12px"></span></div></article>`;
  }

  function networkOptions(status) {
    return (status?.networks || []).filter((item) => ['STELLAR','XRPL'].includes(item?.network) && item?.ready && (item.capabilities || []).includes('CREATE_ASSET')).map((item) => `<option value="${esc(item.network)}">${esc(item.network)} Mainnet</option>`).join('');
  }

  function sourceOptions(sources, instrumentId) {
    const eligible = sources.filter((source) => source.instrumentId === instrumentId);
    return eligible.map((source) => `<option value="${esc(source.positionId)}">${esc(source.positionId)} · ${esc(source.availableQuantity)} SRA available</option>`).join('');
  }

  function offerHistory(offers, nativeAsset, network) {
    if (!offers.length) return `<p style="color:#777;font-size:12px;margin:10px 0 0">No live-market offers have been submitted for this asset.</p>`;
    return `<div class="admin-record-list" style="margin-top:10px">${offers.slice(0,10).map((offer)=>{const state=offer.marketState || (offer.state === 'CONFIRMED' ? 'SUBMITTED' : offer.state || 'UNKNOWN');const manageable=network === 'XRPL' && ['SUBMITTED','OPEN','PARTIALLY_FILLED'].includes(state);return `<article class="admin-record-card" data-offer-card="${esc(offer.offerId)}" style="margin:0"><header><strong>${esc(offer.sellAmount)} ${esc(offer.market?.split('/')[0] || 'SRA')} → ${esc(offer.buyAmountXlm || offer.buyAmountXrp || '—')} ${esc(nativeAsset)}</strong><em>${esc(state)}</em></header><div class="admin-record-grid"><div><span>Filled asset</span><strong>${esc(offer.filledSellAmount ?? 'Refresh status')}</strong></div><div><span>Remaining asset</span><strong>${esc(offer.remainingSellAmount ?? 'Refresh status')}</strong></div><div><span>${esc(nativeAsset)} received</span><strong>${esc(offer.xrpReceived ?? 'Refresh status')}</strong></div><div><span>Remaining ${esc(nativeAsset)}</span><strong>${esc(offer.remainingBuyAmountXrp ?? 'Refresh status')}</strong></div><div><span>Transaction</span><strong>${esc(offer.transactionId || '—')}</strong></div><div><span>Ledger</span><strong>${esc(offer.confirmation?.ledger ?? offer.confirmation?.ledgerIndex ?? '—')}</strong></div><div><span>Offer sequence</span><strong>${esc(offer.offerSequence || 'Resolved on refresh')}</strong></div><div><span>Last reconciled</span><strong>${esc(offer.reconciledAt || 'Not yet')}</strong></div></div>${network === 'XRPL' ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px"><button data-reconcile-offer="${esc(offer.offerId)}">Refresh Status</button><button data-cancel-offer="${esc(offer.offerId)}" ${manageable ? '' : 'disabled'}>Cancel Offer</button><button data-replace-offer="${esc(offer.offerId)}" ${manageable ? '' : 'disabled'}>Replace Using Entered Amounts</button><span data-offer-action-result style="color:#d6a92f;font-size:12px"></span></div>` : ''}</article>`;}).join('')}</div>`;
  }

  function onChainCard(item, assets, status, sources, offersByAsset) {
    const instrument = item.instrument || {};
    const id = instrumentId(instrument);
    const authorized = authorizedAmount(instrument);
    const asset = assets.find((candidate) => candidate.instrumentId === id);
    const options = networkOptions(status);
    const networkReady = Boolean(options);
    const issued = Number(asset?.issuedSupply || 0) > 0;
    const storedAssetCode = String(instrument.assetCode || instrument.symbol || instrument.ticker || '').trim().toUpperCase();
    const existingAssetCode = storedAssetCode || generatedAssetCode(id);
    const eligibleSources = sources.filter((source) => source.instrumentId === id);
    const assetCodeSource = storedAssetCode ? 'Stored on the instrument.' : 'Generated automatically from the SRA instrument ID. You may edit it before creation.';
    const linked = Boolean(item.assessment?.linkedCoinPositionIds?.length || instrument.coinPositionId);
    const nativeAsset = asset?.network === 'XRPL' ? 'XRP' : 'XLM';
    const offers = asset ? (offersByAsset.get(asset.assetId) || []) : [];
    const lifecycle = lifecycleSteps(item, networkReady, asset, issued, offers);
    const marketState = offers[0]?.marketState || (offers.length ? 'OFFER SUBMITTED' : null);

    if (!item.representationApproved) {
      return `<article class="admin-record-card"><header><strong>${esc(id)}</strong><em>STEP 2 · REPRESENTATION APPROVAL</em></header><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0">${lifecycle}</div><div class="admin-record-grid"><div><span>Approved amount / supply</span><strong>${esc(authorized ?? '—')}</strong></div><div><span>Next step</span><strong>Complete Representation Approval</strong></div></div><p style="color:#9a9a9a;line-height:1.5">This instrument cannot enter network preparation until its representation approval record is complete.</p></article>`;
    }

    if (!linked) {
      return `<article class="admin-record-card"><header><strong>${esc(id)}</strong><em>STEP 3 · COIN POSITION LINKAGE</em></header><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0">${lifecycle}</div><div class="admin-record-grid"><div><span>Approved amount / supply</span><strong>${esc(authorized ?? '—')}</strong></div><div><span>Next operating station</span><strong>Coin Positions → Instrument Linkage</strong></div></div><p style="color:#9a9a9a;line-height:1.5">Register the authorized source Coin Position before creating this instrument’s network asset identity. Linkage records lineage only and does not issue or move supply.</p></article>`;
    }

    if (!asset) {
      const current = networkReady ? 'STEP 5 · ASSET IDENTITY' : 'STEP 4 · NETWORK READINESS';
      const explanation = networkReady
        ? 'Network readiness is complete. SRA has prepared the network asset code; review it and create the asset identity next.'
        : 'Representation approval is complete. The next required handoff is live network readiness; asset identity remains locked until a network that supports asset creation is ready.';
      return `<article class="admin-record-card" data-create-card="${esc(id)}"><header><strong>${esc(id)}</strong><em>${current}</em></header><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0">${lifecycle}</div><p style="color:#9a9a9a;line-height:1.5">${esc(explanation)} On Stellar, the asset code is 1–12 letters or numbers and is paired with the issuer identity; the SRA instrument ID remains the internal instrument reference.</p><div class="admin-record-grid"><div><span>Approved amount / supply</span><strong>${esc(authorized ?? '—')}</strong></div><label><span>Network</span><select data-create-network ${networkReady ? '' : 'disabled'}>${options || '<option value="">No create-capable network ready</option>'}</select></label><label><span>Asset code</span><input data-create-asset-code type="text" maxlength="12" autocomplete="off" placeholder="Generated by SRA" value="${esc(existingAssetCode)}" ${networkReady ? '' : 'disabled'}><small style="display:block;color:#777;margin-top:4px">${esc(assetCodeSource)}</small></label></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-create-on-chain="${esc(id)}" ${networkReady ? '' : 'disabled'}>Create Asset Identity</button><span data-create-result style="color:#d6a92f;font-size:12px">${networkReady ? '' : 'Waiting for create-capable network readiness.'}</span></div></article>`;
    }

    return `<article class="admin-record-card" data-asset-card="${esc(asset.assetId)}"><header><strong>${esc(id)}</strong><em>${esc(marketState || (issued ? 'STEP 7 · TRANSFER / STEP 8 · MARKET' : 'STEP 6 · ISSUE SUPPLY'))}</em></header><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0">${lifecycle}</div><div class="admin-record-grid"><div><span>Network</span><strong>${esc(asset.network)}</strong></div><div><span>Asset address</span><strong>${esc(asset.assetAddress)}</strong></div><div><span>Network decimals</span><strong>${esc(asset.decimals)}</strong></div><div><span>Issued supply</span><strong>${esc(asset.issuedSupply ?? '0')}</strong></div><div><span>Asset identity transaction</span><strong>${esc(asset.createdTransactionId || 'Not applicable / not broadcast')}</strong></div><div><span>Last issue transaction</span><strong>${esc(asset.lastIssueTransactionId || '—')}</strong></div></div>
      <section style="margin-top:16px;border-top:1px solid #292929;padding-top:16px"><strong>Step 6 · Issue Supply</strong><p style="color:#9a9a9a;font-size:12px;line-height:1.45">Issue units from the linked SRA Coin Position to the platform distribution account. The network adapter handles the required trustline and signed issuance transaction.</p><div class="admin-record-grid" style="margin-top:10px"><label><span>Source Coin Position</span><select data-issue-source>${sourceOptions(sources,id) || '<option value="">No linked SRA Coin Position available</option>'}</select></label><label><span>Amount</span><input data-issue-amount type="text" inputmode="decimal" autocomplete="off" placeholder="Amount"></label></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-issue-asset="${esc(asset.assetId)}" data-issue-network="${esc(asset.network)}" ${eligibleSources.length ? '' : 'disabled'}>Issue Supply</button><span data-issue-result style="color:#d6a92f;font-size:12px">${eligibleSources.length ? '' : 'No linked SRA Coin Position is available.'}</span></div></section>
      <section style="margin-top:16px;border-top:1px solid #292929;padding-top:16px"><strong>Step 7 · Transfer On Chain</strong><p style="color:#9a9a9a;font-size:12px;line-height:1.45">Send issued units from the platform distribution account to a destination address.</p><div class="admin-record-grid" style="margin-top:10px"><label><span>Amount</span><input data-transfer-amount type="text" inputmode="decimal" autocomplete="off" placeholder="Amount"></label><label><span>Destination address</span><input data-transfer-destination type="text" autocomplete="off" placeholder="Destination wallet"></label></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-transfer-asset="${esc(asset.assetId)}" data-transfer-symbol="${esc(asset.asset)}" data-transfer-network="${esc(asset.network)}" ${issued ? '' : 'disabled'}>Send On Chain</button><span data-transfer-result style="color:#d6a92f;font-size:12px">${issued ? '' : 'Issue supply first.'}</span></div></section>
      <section style="margin-top:16px;border-top:1px solid #292929;padding-top:16px"><strong>Step 8 · Offer on ${esc(asset.network)} Market</strong><p style="color:#9a9a9a;font-size:12px;line-height:1.45">Submit a live Mainnet offer selling this issued asset for native ${esc(nativeAsset)}. The offer fills only when market liquidity accepts the entered price.</p><div class="admin-record-grid" style="margin-top:10px"><label><span>Asset amount to sell</span><input data-offer-sell type="text" inputmode="decimal" autocomplete="off" placeholder="Amount"></label><label><span>${esc(nativeAsset)} requested</span><input data-offer-buy type="text" inputmode="decimal" autocomplete="off" placeholder="${esc(nativeAsset)} amount"></label><div><span>Implied ${esc(nativeAsset)} per unit</span><strong data-offer-rate>—</strong></div></div><label style="display:flex;gap:8px;align-items:flex-start;color:#cfcfcf;font-size:12px;line-height:1.4;margin-top:10px"><input type="checkbox" data-confirm-market-offer style="margin-top:2px"><span>I confirm this submits a live ${esc(asset.network)} Mainnet offer at the entered amounts.</span></label><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px"><button data-market-offer="${esc(asset.assetId)}" data-market-network="${esc(asset.network)}" data-market-native="${esc(nativeAsset)}" ${issued ? '' : 'disabled'}>Submit ${esc(asset.asset)}/${esc(nativeAsset)} Offer</button><span data-market-result style="color:#d6a92f;font-size:12px">${issued ? '' : 'Issue supply first.'}</span></div>${offerHistory(offers,nativeAsset,asset.network)}</section>
    </article>`;
  }

  function bindApproval(workspace, card) {
    card.querySelectorAll('[data-approve-on-chain]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.dataset.approveOnChain;
      const row = button.closest('[data-approval-card]');
      const result = row?.querySelector('[data-approval-result]');
      if (!confirm(`Approve ${id} for on-chain representation?`)) return;
      button.disabled = true;
      if (result) result.textContent = 'Recording representation approval…';
      try {
        await request(`/api/admin/instruments/${encodeURIComponent(id)}/representation/approve`, {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ approval:'APPROVE' }),
        });
        if (result) result.textContent = 'Representation approved.';
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
      const assetCode = row?.querySelector('[data-create-asset-code]')?.value?.trim().toUpperCase();
      const result = row?.querySelector('[data-create-result]');
      if (!network) { if (result) result.textContent = 'Select a ready network.'; return; }
      if (!assetCode) { if (result) result.textContent = 'SRA could not generate the network asset code.'; return; }
      if (!/^[A-Z0-9]{1,12}$/.test(assetCode)) { if (result) result.textContent = 'Asset code must be 1–12 letters or numbers.'; return; }
      if (!confirm(`Create ${assetCode} for ${id} on ${network}?`)) return;
      button.disabled = true;
      if (result) result.textContent = 'Creating asset identity…';
      try {
        const response = await request('/api/on-chain/assets', {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ instrumentId:id, network, asset:assetCode, symbol:assetCode }),
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
      const sourcePositionId = row?.querySelector('[data-issue-source]')?.value?.trim();
      const result = row?.querySelector('[data-issue-result]');
      if (!amount) { if (result) result.textContent = 'Enter amount.'; return; }
      if (!sourcePositionId) { if (result) result.textContent = 'Select the linked source Coin Position.'; return; }
      if (!confirm(`Issue ${amount} units from ${sourcePositionId} onto ${button.dataset.issueNetwork}?`)) return;
      button.disabled = true;
      if (result) result.textContent = 'Building, signing, broadcasting, and confirming issuance…';
      try {
        const response = await request(`/api/on-chain/assets/${encodeURIComponent(button.dataset.issueAsset)}/issue`, {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ amount, sourcePositionId }),
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

    card.querySelectorAll('[data-market-offer]').forEach((button) => {
      const row = button.closest('[data-asset-card]');
      const sell = row?.querySelector('[data-offer-sell]');
      const buy = row?.querySelector('[data-offer-buy]');
      const rate = row?.querySelector('[data-offer-rate]');
      const updateRate = () => { const s=Number(sell?.value); const b=Number(buy?.value); if(rate) rate.textContent=s>0&&b>0?`${(b/s).toLocaleString(undefined,{maximumFractionDigits:8})} ${button.dataset.marketNative}`:'—'; };
      sell?.addEventListener('input',updateRate); buy?.addEventListener('input',updateRate);
      button.addEventListener('click', async () => {
        const sellAmount=sell?.value?.trim(); const buyAmountNative=buy?.value?.trim(); const result=row?.querySelector('[data-market-result]');
        if(!sellAmount||!buyAmountNative||!(Number(sellAmount)>0)||!(Number(buyAmountNative)>0)){if(result)result.textContent='Enter positive sell and requested amounts.';return;}
        if(!row?.querySelector('[data-confirm-market-offer]')?.checked){if(result)result.textContent='Confirm the live Mainnet offer first.';return;}
        if(!confirm(`Submit a live offer selling ${sellAmount} units for ${buyAmountNative} ${button.dataset.marketNative}?`))return;
        button.disabled=true;if(result)result.textContent='Signing, submitting, and confirming market offer…';
        try{const response=await request(`/api/on-chain/assets/${encodeURIComponent(button.dataset.marketOffer)}/markets/offers`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sellAmount,buyAmountNative})});if(result)result.textContent=`${response.state} · ${response.transactionId}`;await render(workspace);}
        catch(error){if(result)result.textContent=error.message;button.disabled=false;}
      });
    });

    card.querySelectorAll('[data-reconcile-offer]').forEach((button) => button.addEventListener('click', async () => {
      const assetRow=button.closest('[data-asset-card]');const offerRow=button.closest('[data-offer-card]');const result=offerRow?.querySelector('[data-offer-action-result]');
      button.disabled=true;if(result)result.textContent='Reading validated XRPL offer state…';
      try{const response=await request(`/api/on-chain/assets/${encodeURIComponent(assetRow.dataset.assetCard)}/markets/offers/${encodeURIComponent(button.dataset.reconcileOffer)}/reconcile`,{method:'POST'});if(result)result.textContent=response.marketState;await render(workspace);}
      catch(error){if(result)result.textContent=error.message;button.disabled=false;}
    }));

    card.querySelectorAll('[data-cancel-offer]').forEach((button) => button.addEventListener('click', async () => {
      const assetRow=button.closest('[data-asset-card]');const offerRow=button.closest('[data-offer-card]');const result=offerRow?.querySelector('[data-offer-action-result]');
      if(!confirm('Cancel the remaining open amount of this live XRPL Mainnet offer?'))return;
      button.disabled=true;if(result)result.textContent='Reconciling and cancelling offer…';
      try{const response=await request(`/api/on-chain/assets/${encodeURIComponent(assetRow.dataset.assetCard)}/markets/offers/${encodeURIComponent(button.dataset.cancelOffer)}/cancel`,{method:'POST'});if(result)result.textContent=`CANCELLED · ${response.cancelTransactionId}`;await render(workspace);}
      catch(error){if(result)result.textContent=error.message;button.disabled=false;}
    }));

    card.querySelectorAll('[data-replace-offer]').forEach((button) => button.addEventListener('click', async () => {
      const assetRow=button.closest('[data-asset-card]');const offerRow=button.closest('[data-offer-card]');const result=offerRow?.querySelector('[data-offer-action-result]');
      const sellAmount=assetRow?.querySelector('[data-offer-sell]')?.value?.trim();const buyAmountNative=assetRow?.querySelector('[data-offer-buy]')?.value?.trim();
      if(!sellAmount||!buyAmountNative||!(Number(sellAmount)>0)||!(Number(buyAmountNative)>0)){if(result)result.textContent='Enter the replacement sell and XRP amounts above.';return;}
      if(!assetRow?.querySelector('[data-confirm-market-offer]')?.checked){if(result)result.textContent='Confirm the replacement Mainnet offer first.';return;}
      if(!confirm(`Cancel this offer and replace it with ${sellAmount} units for ${buyAmountNative} XRP?`))return;
      button.disabled=true;if(result)result.textContent='Cancelling original and submitting replacement…';
      try{const response=await request(`/api/on-chain/assets/${encodeURIComponent(assetRow.dataset.assetCard)}/markets/offers/${encodeURIComponent(button.dataset.replaceOffer)}/replace`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sellAmount,buyAmountNative})});if(result)result.textContent=`REPLACED · ${response.replacement.transactionId}`;await render(workspace);}
      catch(error){if(result)result.textContent=error.message;button.disabled=false;}
    }));
  }

  async function renderApproval(workspace, card) {
    card.innerHTML = '<header><strong>Representation Approval</strong><em>CHECKING</em></header><p>Loading instruments…</p>';
    const approvalStatus = await request(`/api/admin/instruments/approval-status?_=${Date.now()}`);
    if (!active(workspace) || activeTab(workspace) !== 'Approval') return;
    const eligible = approvalStatus.representationReady || [];
    card.innerHTML = `<header><strong>Representation Approval</strong><em>INSTRUMENT LIFECYCLE</em></header><p style="color:#9a9a9a;line-height:1.5">Instrument approval comes first. Representation approval is the explicit handoff that authorizes an approved instrument to enter on-chain preparation.</p><div style="display:grid;gap:10px">${eligible.length ? eligible.map(approvalCard).join('') : '<p>No approved instruments are currently available for representation review.</p>'}</div>`;
    bindApproval(workspace, card);
  }

  async function renderOnChain(workspace, card) {
    card.innerHTML = '<header><strong>On-Chain</strong><em>CHECKING</em></header><p>Loading instrument lifecycle and network state…</p>';
    const [approvalStatus, status, assetsResult, sourcesResult] = await Promise.all([
      request(`/api/admin/instruments/approval-status?_=${Date.now()}`),
      request('/api/on-chain/status'),
      request('/api/on-chain/assets'),
      request('/api/on-chain/source-positions'),
    ]);
    if (!active(workspace) || activeTab(workspace) !== 'On-Chain') return;
    const eligible = approvalStatus.representationReady || [];
    const assets = assetsResult.records || [];
    const sources = sourcesResult.records || [];
    const offersByAsset = new Map((await Promise.all(assets.map(async (asset) => {
      try { const response = await request(`/api/on-chain/assets/${encodeURIComponent(asset.assetId)}/markets/offers`); return [asset.assetId,response.records || []]; }
      catch { return [asset.assetId,[]]; }
    }))).map(([assetId,offers])=>[assetId,offers]));
    const ready = (status.networks || []).some((item) => item.ready && (item.capabilities || []).includes('CREATE_ASSET'));
    card.innerHTML = `<header><strong>On-Chain</strong><em>${ready ? 'NETWORK READY' : 'NETWORK NOT READY'}</em></header><p style="color:#9a9a9a;line-height:1.5">Instrument approval → representation approval → Coin Position linkage → network readiness → asset identity → issue supply → transfer or live market offer. Each stage must complete before the next stage becomes actionable. Choose Stellar Mainnet or XRPL Mainnet when creating the asset identity; the selected network is then recorded on the instrument.</p><div style="display:grid;gap:10px">${eligible.length ? eligible.map((item) => onChainCard(item, assets, status, sources, offersByAsset)).join('') : '<p>No approved instruments are currently available.</p>'}</div>`;
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
