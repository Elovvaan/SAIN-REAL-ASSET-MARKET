(() => {
  if (window.__sraAdminMarketplaceLifecycleWorkstationInstalled) return;
  window.__sraAdminMarketplaceLifecycleWorkstationInstalled = true;

  const mounted = new WeakSet();
  const state = new WeakMap();
  const client = () => window.SRAAdminDataClient;
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const qty = (value) => num(value).toLocaleString(undefined,{maximumFractionDigits:8});
  const money = (value) => num(value).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
  const when = (value) => value ? new Date(value).toLocaleString() : '—';

  async function requestJson(url, options = {}) {
    if (client()) return client().json(url, options);
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', ...options, headers:{ Accept:'application/json', 'Cache-Control':'no-cache', ...(options.headers||{}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }

  async function allListings() {
    const first = await requestJson('/api/marketplace-listings?page=1&limit=100');
    const records = [...(first.listings || [])];
    const pages = Math.max(1, Number(first.totalPages || 1));
    for (let page = 2; page <= pages; page += 1) {
      const next = await requestJson(`/api/marketplace-listings?page=${page}&limit=100`);
      records.push(...(next.listings || []));
    }
    return records;
  }

  const fulfilled = (result, fallback) => result?.status === 'fulfilled' ? result.value : fallback;
  const failure = (result) => result?.status === 'rejected' ? (result.reason?.message || String(result.reason || 'Unavailable')) : null;
  const records = (payload) => Array.isArray(payload?.records) ? payload.records : [];
  const text = (value) => String(value || '').toUpperCase();
  const isLiveListing = (listing) => text(listing?.status) === 'LIVE' || text(listing?.status) === 'ACTIVE' || ['PUBLISHED','ACTIVE','LIVE','LISTED'].includes(text(listing?.state)) || text(listing?.publicationStatus) === 'PUBLISHED';
  const isReadyListing = (listing) => !isLiveListing(listing) && (['READY','READY_FOR_PUBLICATION_APPROVAL','PUBLICATION_AUTHORIZED'].includes(text(listing?.status)) || text(listing?.state) === 'READY' || text(listing?.publicationDecision) === 'AUTHORIZED_FOR_PUBLICATION');
  const isTerminalListing = (listing) => ['CLOSED','CANCELLED','CANCELED','EXPIRED','WITHDRAWN','SUPERSEDED','RETIRED'].includes(text(listing?.state)) || ['CLOSED','CANCELLED','CANCELED','EXPIRED','WITHDRAWN','SUPERSEDED'].includes(text(listing?.status));
  const isPreparedListing = (listing) => !isLiveListing(listing) && !isReadyListing(listing) && !isTerminalListing(listing);

  function removeLegacyMarketplaceCards(workspace) {
    const controls = workspace.querySelector('.admin-workspace-controls');
    if (!controls) return;
    for (const node of [...controls.children]) {
      if (node.dataset?.workstationControl === 'marketplace-governance' || node.dataset?.marketplaceLifecycleSummary === 'true') continue;
      const heading = node.querySelector?.('h2,h3,.section-title')?.textContent || node.textContent || '';
      if (/Marketplace Listing Readiness/i.test(heading) || /^\s*Marketplace Listings\s*\d*\s*$/i.test(heading.trim())) node.remove();
    }
  }

  function summaryHost(workspace) {
    const controls = workspace.querySelector('.admin-workspace-controls');
    if (!controls) return null;
    let node = controls.querySelector('[data-marketplace-lifecycle-summary]');
    if (!node) {
      node = document.createElement('section');
      node.className = 'admin-record-card';
      node.dataset.marketplaceLifecycleSummary = 'true';
      controls.prepend(node);
    }
    return node;
  }

  function recordsHost(workspace) { return workspace.querySelector('.admin-workspace-records'); }
  function field(label, value) { return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function identifier(record) {
    return record?.listingId || record?.commitmentWindowId || record?.commitmentId || record?.reservationId || record?.allocationReviewId || record?.positionId || record?.settlementPreparationId || record?.settlementReviewId || record?.settlementAuthorizationId || record?.settlementConfirmationId || record?.transactionId || record?.id || 'Marketplace record';
  }
  function recordState(record) { return record?.status || record?.state || record?.publicationStatus || record?.settlementStatus || record?.ownershipStatus || 'RECORDED'; }
  function card(record, kind) {
    const amount = record?.totalAmount ?? record?.amount ?? record?.openingQuantity ?? record?.quantity ?? null;
    const currency = record?.currency || record?.pricingCurrency || (kind === 'LISTING' ? 'SRA' : 'USD');
    return `<article class="admin-record-card"><header><strong>${esc(identifier(record))}</strong><em>${esc(String(recordState(record)).replaceAll('_',' '))}</em></header><div class="admin-record-grid">${field('Stage',kind)}${record.listingId?field('Listing',record.listingId):''}${record.instrumentId?field('Instrument',record.instrumentId):''}${record.participantId?field('Participant',record.participantId):''}${record.commitmentId?field('Commitment',record.commitmentId):''}${record.positionId?field('Position',record.positionId):''}${amount != null ? field(kind === 'LISTING' || /WINDOW|RESERVATION/.test(kind) ? 'Quantity' : 'Amount', `${qty(amount)} ${currency}`) : ''}${record.quantity != null && amount !== record.quantity ? field('Quantity',`${qty(record.quantity)} SRA`) : ''}${field('Updated',when(record.updatedAt || record.createdAt || record.publishedAt || record.submittedAt || record.reservedAt || record.startedAt || record.authorizedAt || record.receivedAt || record.verifiedAt || record.settledAt))}</div><details><summary>Record details</summary><pre>${esc(JSON.stringify(record,null,2))}</pre></details></article>`;
  }
  function empty(title, copy) { return `<div class="admin-placeholder"><strong>${esc(title)}</strong><br>${esc(copy)}</div>`; }

  function derive(data) {
    const listings = data.listings;
    const prepared = listings.filter(isPreparedListing);
    const ready = listings.filter(isReadyListing);
    const published = listings.filter(isLiveListing);
    const historical = listings.filter(isTerminalListing);
    const windows = data.windows;
    const commitments = data.commitments;
    const reservations = commitments.filter((item) => text(item.status) === 'RESERVED');
    const confirmedOrders = commitments.filter((item) => text(item.status) === 'CONFIRMED');
    const positions = data.positions;
    const preparations = data.settlementPreparations;
    const confirmations = data.settlementConfirmations;
    const verifiedConfirmations = confirmations.filter((item) => ['VERIFIED','CONSUMED'].includes(text(item.status)));
    const publishedQuantity = published.reduce((sum,item) => sum + num(item.quantity), 0);
    const reservedQuantity = reservations.reduce((sum,item) => sum + num(item.quantity), 0);
    const confirmedQuantity = confirmedOrders.reduce((sum,item) => sum + num(item.quantity), 0);
    const allocatedQuantity = positions.reduce((sum,item) => sum + num(item.quantity), 0);
    const settlementPreparedAmount = preparations.reduce((sum,item) => sum + num(item.amount), 0);
    const verifiedSettlementAmount = verifiedConfirmations.reduce((sum,item) => sum + num(item.amount), 0);
    return { ...data, prepared, ready, published, historical, reservations, confirmedOrders, verifiedConfirmations, publishedQuantity, reservedQuantity, confirmedQuantity, allocatedQuantity, settlementPreparedAmount, verifiedSettlementAmount };
  }

  async function load(workspace, force = false) {
    const existing = state.get(workspace);
    if (existing?.data && !force) return existing.data;
    if (existing?.loading && !force) return existing.loading;
    const loading = Promise.allSettled([
      allListings(),
      requestJson('/api/admin/listing-readiness-batch?unitPrice=1&minimumOrder=1&askingPriceMethod=VERIFIED_RECORDED_USD_VALUE_AT_SRA_PAR&eligibilityRule=SRA_REGISTERED_PARTICIPANTS&transactionRouteId=SRA_INTERNAL_MARKETPLACE&settlementRouteId=SRA_INTERNAL_SETTLEMENT'),
      requestJson('/api/admin/listing-publication-batch'),
      requestJson('/api/funding-marketplace-commitment/windows'),
      requestJson('/api/funding-marketplace-commitment/commitments'),
      requestJson('/api/funding-marketplace-allocation/reviews'),
      requestJson('/api/funding-marketplace-allocation/positions'),
      requestJson('/api/funding-marketplace-allocation/settlement-preparations'),
      requestJson('/api/funding-marketplace-settlement/reviews'),
      requestJson('/api/funding-marketplace-settlement/authorizations'),
      requestJson('/api/funding-marketplace-settlement/confirmations'),
    ]).then((results) => {
      const [listingResult, readinessResult, publicationResult, windowsResult, commitmentsResult, allocationReviewsResult, positionsResult, settlementPreparationsResult, settlementReviewsResult, settlementAuthorizationsResult, settlementConfirmationsResult] = results;
      const next = derive({
        listings: fulfilled(listingResult, []),
        readiness: fulfilled(readinessResult, {}),
        publication: fulfilled(publicationResult, {}),
        windows: records(fulfilled(windowsResult, {})),
        commitments: records(fulfilled(commitmentsResult, {})),
        allocationReviews: records(fulfilled(allocationReviewsResult, {})),
        positions: records(fulfilled(positionsResult, {})),
        settlementPreparations: records(fulfilled(settlementPreparationsResult, {})),
        settlementReviews: records(fulfilled(settlementReviewsResult, {})),
        settlementAuthorizations: records(fulfilled(settlementAuthorizationsResult, {})),
        settlementConfirmations: records(fulfilled(settlementConfirmationsResult, {})),
        errors: {
          listings: failure(listingResult), readiness: failure(readinessResult), publication: failure(publicationResult), windows: failure(windowsResult), commitments: failure(commitmentsResult), allocations: failure(allocationReviewsResult) || failure(positionsResult), settlement: failure(settlementPreparationsResult) || failure(settlementReviewsResult) || failure(settlementAuthorizationsResult) || failure(settlementConfirmationsResult),
        },
      });
      state.set(workspace,{ data:next, loading:null });
      return next;
    }).catch((error) => { state.set(workspace,{ data:null, loading:null, error:error.message }); throw error; });
    state.set(workspace,{ ...(existing||{}), loading });
    return loading;
  }

  function nextAction(data) {
    const invalid = Number(data.readiness?.preview?.invalidListingCount || 0);
    if (invalid) return `${invalid} listing(s) require recorded-value correction before readiness can advance.`;
    if (data.prepared.length) return `${data.prepared.length} prepared listing(s) are waiting for readiness authorization.`;
    if (data.ready.length) return `${data.ready.length} ready listing(s) are waiting for publication authorization.`;
    const openWindows = data.windows.filter((item) => text(item.status) === 'OPEN');
    if (data.published.length && !openWindows.length) return `${data.published.length} listing(s) are LIVE; no commitment window is currently open.`;
    if (data.reservations.length) return `${data.reservations.length} reserved commitment(s) must be confirmed or cancelled before allocation closes.`;
    const unallocated = data.confirmedOrders.filter((item) => text(item.allocationStatus) !== 'ALLOCATED');
    if (unallocated.length) return `${unallocated.length} confirmed commitment(s) are waiting for allocation.`;
    const pendingSettlement = data.positions.filter((item) => text(item.ownershipStatus) === 'PENDING_SETTLEMENT');
    if (pendingSettlement.length) return `${pendingSettlement.length} allocated position(s) are still pending verified settlement.`;
    return 'Marketplace lifecycle is current. New participant activity will advance the next stage.';
  }

  function renderSummary(workspace, data) {
    removeLegacyMarketplaceCards(workspace);
    const root = summaryHost(workspace); if (!root) return;
    const stages = [
      ['Prepared',data.prepared.length], ['Ready',data.ready.length], ['Published',data.published.length], ['Orders',data.commitments.length], ['Reservations',data.reservations.length], ['Allocations',data.positions.length], ['Settlement',data.settlementPreparations.length], ['Historical',data.historical.length],
    ];
    const partial = Object.values(data.errors).filter(Boolean);
    root.innerHTML = `<header><strong>Marketplace Lifecycle Reconciliation</strong><em>${partial.length ? 'PARTIAL READ' : 'CURRENT'}</em></header><div style="display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px;margin-top:12px">${stages.map(([label,count],index)=>`<div style="border:1px solid #292929;border-radius:11px;padding:11px;background:#090909;min-width:0"><span style="display:block;color:#9a9a9a;font-size:9px;text-transform:uppercase">Stage ${index+1}</span><strong style="display:block;margin-top:4px">${esc(label)}</strong><b style="display:block;font-size:20px;margin-top:6px">${Number(count).toLocaleString()}</b></div>`).join('')}</div><div class="admin-record-grid" style="margin-top:12px">${field('Published quantity',`${qty(data.publishedQuantity)} SRA`)}${field('Reserved quantity',`${qty(data.reservedQuantity)} SRA`)}${field('Confirmed order quantity',`${qty(data.confirmedQuantity)} SRA`)}${field('Allocated quantity',`${qty(data.allocatedQuantity)} SRA`)}${field('Settlement prepared',money(data.settlementPreparedAmount))}${field('Verified settlement',money(data.verifiedSettlementAmount))}</div><p style="color:#d6d6d6;margin:14px 0 0"><strong style="color:#d6a92f">Next:</strong> ${esc(nextAction(data))}</p>${partial.length ? `<p style="color:#d6a92f;margin:8px 0 0">${esc(partial.join(' · '))}</p>` : ''}<p style="color:#9a9a9a;margin:8px 0 0">Prepared → Ready → Published → Orders → Reservations → Allocations → Settlement → Historical Listings</p>`;
  }

  function stageRecords(tab, data) {
    if (tab === 'Prepared') return data.prepared.map((record) => [record,'LISTING']);
    if (tab === 'Ready') return data.ready.map((record) => [record,'READY LISTING']);
    if (tab === 'Published') return data.published.map((record) => [record,'LIVE LISTING']);
    if (tab === 'Orders') return data.commitments.map((record) => [record,'ORDER / COMMITMENT']);
    if (tab === 'Reservations') return data.reservations.map((record) => [record,'ACTIVE RESERVATION']);
    if (tab === 'Allocations') return [...data.allocationReviews.map((record) => [record,'ALLOCATION REVIEW']), ...data.positions.map((record) => [record,'ALLOCATED POSITION'])];
    if (tab === 'Settlement') return [
      ...data.settlementPreparations.map((record) => [record,'SETTLEMENT PREPARATION']),
      ...data.settlementReviews.map((record) => [record,'SETTLEMENT REVIEW']),
      ...data.settlementAuthorizations.map((record) => [record,'SETTLEMENT AUTHORIZATION']),
      ...data.settlementConfirmations.map((record) => [record,'SETTLEMENT CONFIRMATION']),
    ];
    if (tab === 'Historical Listings') return data.historical.map((record) => [record,'HISTORICAL LISTING']);
    return [];
  }

  function renderRecords(workspace, data) {
    const root = recordsHost(workspace); if (!root) return;
    const tab = workspace.dataset.activeTab || 'Prepared';
    const items = stageRecords(tab,data);
    if (!items.length) {
      const copies = {
        Prepared:'No canonical listing is currently waiting at preparation.', Ready:'No listing is currently waiting for publication approval.', Published:'No published LIVE listing is currently present.', Orders:'No marketplace commitments/orders have been recorded.', Reservations:'No active reserved commitment is currently holding marketplace quantity.', Allocations:'No allocation review or participant marketplace position has been recorded.', Settlement:'No marketplace position has entered the verified-settlement workflow.', 'Historical Listings':'No terminal, withdrawn, expired, cancelled, or closed listing is currently recorded.'
      };
      root.innerHTML = empty(`No ${tab} records`, copies[tab] || 'No records are currently stored for this stage.');
      return;
    }
    root.innerHTML = `<div class="admin-record-list">${items.map(([record,kind]) => card(record,kind)).join('')}</div>`;
  }

  async function refresh(workspace, force = false) {
    const root = recordsHost(workspace); if (root) root.innerHTML = '<div class="admin-placeholder">Reading the authoritative marketplace lifecycle…</div>';
    try {
      const data = await load(workspace,force);
      if (!workspace.isConnected) return;
      renderSummary(workspace,data);
      renderRecords(workspace,data);
    } catch (error) {
      if (root) root.innerHTML = empty('Marketplace lifecycle unavailable', error.message);
    }
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    removeLegacyMarketplaceCards(workspace);
    workspace.addEventListener('click',(event) => {
      if (event.target.closest('[data-admin-tab]')) queueMicrotask(() => void refresh(workspace,false));
      if (event.target.closest('[data-refresh-workspace="marketplace"]')) queueMicrotask(() => void refresh(workspace,true));
    });
    document.addEventListener('click',(event) => {
      const opener = event.target.closest('[data-admin-workspace="marketplace"],[data-open-workspace="marketplace"]');
      if (opener) queueMicrotask(() => void refresh(workspace,true));
    });
    window.addEventListener('hashchange',() => { if (location.hash === '#admin-marketplace') void refresh(workspace,true); });
    window.addEventListener('sra:admin-workspace-synchronized',(event) => { if (event.detail?.workspaceId === 'marketplace') void refresh(workspace,true); });
    window.addEventListener('sra:admin-mutated',() => { state.delete(workspace); });
    void refresh(workspace,true);
  }

  window.mountAdminMarketplaceLifecycleWorkstation = mount;
})();