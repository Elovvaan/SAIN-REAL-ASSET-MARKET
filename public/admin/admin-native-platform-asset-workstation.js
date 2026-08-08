(() => {
  if (window.__sraAdminNativePlatformAssetWorkstationInstalled) return;
  window.__sraAdminNativePlatformAssetWorkstationInstalled = true;

  const mounted = new WeakSet();
  const client = () => window.SRAAdminDataClient;
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const money = (value) => Number(value || 0).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
  const list = (value) => Array.isArray(value) ? value : [];
  const request = async (url) => client() ? client().json(url) : fetch(url,{credentials:'same-origin',cache:'no-store'}).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  });

  function controls(workspace) { return workspace?.querySelector('.admin-workspace-controls'); }
  function field(label,value) { return `<div><span>${esc(label)}</span><strong>${esc(value ?? '—')}</strong></div>`; }
  function card(title,state,body) { return `<section class="admin-record-card" data-native-asset-workstation-card><header><strong>${esc(title)}</strong><em>${esc(state)}</em></header>${body}</section>`; }
  function clear(workspace) { controls(workspace)?.querySelectorAll('[data-native-asset-workstation-card]').forEach((node) => node.remove()); }

  function removeLegacySummary(workspace) {
    const root = controls(workspace); if (!root) return;
    for (const node of [...root.children]) {
      if (node.dataset?.nativeAssetWorkstationCard === 'true') continue;
      const text = node.textContent || '';
      if (/Native Platform Asset/i.test(text) && /Approve & Publish|Asset code|Export boundary/i.test(text)) node.remove();
    }
  }

  async function load() {
    const [status, workspace] = await Promise.all([
      request('/api/admin/platform-asset'),
      request('/api/admin/workspaces?limit=100'),
    ]);
    return { status, records: workspace?.records || {} };
  }

  function refs(data) { return data.status?.references || {}; }
  function byId(records, id, fields = []) {
    if (!id) return null;
    return list(records).find((record) => fields.some((field) => record?.[field] === id)) || null;
  }
  function nativeInstrument(data) {
    const id = refs(data).instrumentId;
    return byId(data.records.instruments,id,['instrumentId','id']) || list(data.records.instruments).find((item) => item.platformAssetCode === 'SRA_PLATFORM_ASSET') || null;
  }
  function listing(data) { return byId(data.records.marketplaceListings,refs(data).listingId,['listingId','id']); }
  function ownership(data) { return byId(data.records.ownershipRecognitions,refs(data).ownershipRecognitionId,['ownershipRecognitionId','id']); }
  function exportPackage(data) { return byId(data.records.exportPackages,refs(data).exportPackageId,['exportPackageId','id']); }
  function settlement(data) { return byId(data.records.settlementRecords,refs(data).settlementRecordId,['settlementRecordId','id']); }

  function currentAsset(data) {
    const instrument = nativeInstrument(data);
    return card('Current Asset',data.status.state || 'NOT_CREATED',`<div class="admin-record-grid">${field('Asset code',data.status.platformAssetCode)}${field('Instrument',instrument?.instrumentId || 'Not created')}${field('Instrument family',instrument?.instrumentFamily || '—')}${field('Instrument type',instrument?.instrumentType || '—')}${field('Face amount',instrument ? money(instrument.faceAmount) : '—')}${field('Currency',instrument?.currency || '—')}${field('State',instrument?.state || 'NOT_CREATED')}${field('Ready for export',data.status.readyForExport ? 'YES' : 'NO')}</div>`);
  }

  function approval(data) {
    const created = Boolean(refs(data).instrumentId);
    return card('Approval Status',created ? 'APPROVED / CREATED' : 'AWAITING APPROVAL',`<div class="admin-record-grid">${field('Next action',data.status.nextAction)}${field('Instrument created',created ? 'YES' : 'NO')}${field('Listing created',refs(data).listingId ? 'YES' : 'NO')}${field('Ownership recognized',refs(data).ownershipRecognitionId ? 'YES' : 'NO')}${field('Export package created',refs(data).exportPackageId ? 'YES' : 'NO')}</div>${created ? '' : '<p style="color:#9a9a9a;margin:12px 0 0">The governed bootstrap action remains the existing creation path for the native asset lifecycle.</p>'}`);
  }

  function listingView(data) {
    const item = listing(data);
    return card('Listing',item?.state || 'NOT_CREATED',`<div class="admin-record-grid">${field('Listing ID',item?.listingId || 'Not created')}${field('Instrument',item?.instrumentId || refs(data).instrumentId || '—')}${field('Quantity',item?.quantity ?? '—')}${field('Unit price',item?.unitPrice != null ? money(item.unitPrice) : '—')}${field('Market access',item?.marketAccessRule || '—')}${field('Transaction route',item?.transactionRoute || '—')}${field('Settlement route',item?.settlementRoute || '—')}${field('Published',item?.publishedAt || '—')}</div>`);
  }

  function marketplace(data) {
    const item = listing(data);
    const commitment = byId(data.records.marketplaceCommitments,refs(data).commitmentId,['commitmentId','id']);
    const allocation = byId(data.records.marketplacePositions,refs(data).allocationId,['positionId','id']);
    return card('Marketplace Status',item ? 'ACTIVE LIFECYCLE' : 'NOT_STARTED',`<div class="admin-record-grid">${field('Listing state',item?.state || 'NOT_CREATED')}${field('Participation',refs(data).participationId || 'Not created')}${field('Commitment',commitment?.state || (refs(data).commitmentId ? 'RECORDED' : 'Not created'))}${field('Allocation',allocation?.state || (refs(data).allocationId ? 'RECORDED' : 'Not created'))}${field('Participant',allocation?.participantId || commitment?.participantId || '—')}${field('Allocated amount',allocation?.amount != null ? money(allocation.amount) : '—')}</div>`);
  }

  function exportView(data) {
    const pkg = exportPackage(data);
    return card('Export Status',pkg?.state || 'NOT_REACHED',`<div class="admin-record-grid">${field('Export boundary',data.status.readyForExport ? 'REACHED' : 'NOT REACHED')}${field('Export package',pkg?.exportPackageId || 'Not created')}${field('State',pkg?.state || '—')}${field('Destination class',pkg?.destinationClass || '—')}${field('Execution required',pkg?.adapterInstructions?.executionRequired === false ? 'NO' : pkg ? 'YES' : '—')}${field('Supported targets',list(pkg?.adapterInstructions?.supportedTargets).join(', ') || '—')}</div>`);
  }

  function ownershipView(data) {
    const item = ownership(data);
    const settle = settlement(data);
    return card('Ownership',item ? 'RECOGNIZED' : 'NOT_RECOGNIZED',`<div class="admin-record-grid">${field('Ownership recognition',item?.ownershipRecognitionId || 'Not created')}${field('Owner',item?.ownerId || '—')}${field('Owner type',item?.ownerType || '—')}${field('Quantity',item?.quantity ?? '—')}${field('Unit',item?.unit || '—')}${field('Recognition basis',item?.recognitionBasis || '—')}${field('Settlement record',settle?.settlementRecordId || '—')}${field('Settlement state',settle?.state || '—')}</div>`);
  }

  function recognitions(data) {
    const r = refs(data);
    const recognition = byId(data.records.recognitions,r.recognitionId,['recognitionId','id']);
    const observation = byId(data.records.observations,r.observationId,['observationId','id']);
    const financial = byId(data.records.financialRecords,r.financialRecordId,['financialRecordId','id']);
    const coin = byId(data.records.coinPositions,r.coinPositionId,['coinPositionId','id']);
    return card('Recognitions',r.recognitionId ? 'RECORDED' : 'EMPTY',`<div class="admin-record-grid">${field('Observation',observation?.state || (r.observationId ? 'RECORDED' : 'Not created'))}${field('Recognition',recognition?.decision || recognition?.state || (r.recognitionId ? 'RECORDED' : 'Not created'))}${field('Financial record',financial?.state || (r.financialRecordId ? 'RECORDED' : 'Not created'))}${field('Recorded value',financial?.amount != null ? money(financial.amount) : '—')}${field('Coin position',coin?.state || (r.coinPositionId ? 'RECORDED' : 'Not created'))}${field('Coin quantity',coin?.quantity ?? '—')}</div>`);
  }

  function history(data) {
    const ids = new Set(Object.values(refs(data)).filter(Boolean));
    const events = list(data.records.lifecycleEvents).filter((event) => ids.has(event.objectId) || /NATIVE_PLATFORM_ASSET|SRA_PLATFORM_ASSET/i.test(JSON.stringify(event)));
    return card('Asset History',events.length ? 'RECORDED' : 'EMPTY',`<div class="admin-record-grid">${field('Lifecycle events',String(events.length))}${field('Current state',data.status.state)}${field('First stage',refs(data).observationId ? 'OBSERVED' : 'NOT_STARTED')}${field('Latest boundary',data.status.readyForExport ? 'READY_FOR_EXPORT' : data.status.nextAction)}</div><p style="color:#9a9a9a;margin:12px 0 0">The record list below is the event/history trace for this asset lifecycle.</p>`);
  }

  function publishing(data) {
    const item = listing(data);
    return card('Publishing',item?.state === 'PUBLISHED' ? 'PUBLISHED' : 'NOT_PUBLISHED',`<div class="admin-record-grid">${field('Listing',item?.listingId || 'Not created')}${field('Publication state',item?.state || 'NOT_PUBLISHED')}${field('Published at',item?.publishedAt || '—')}${field('Published by',item?.publishedBy || '—')}${field('Market access rule',item?.marketAccessRule || '—')}</div>`);
  }

  function governance(data) {
    const r = refs(data);
    return card('Governance',data.status.readyForExport ? 'LIFECYCLE COMPLETE' : 'GOVERNED',`<div class="admin-record-grid">${field('Platform asset',data.status.platformAssetCode)}${field('Next governed action',data.status.nextAction)}${field('Instrument',r.instrumentId || 'Not created')}${field('Listing',r.listingId || 'Not created')}${field('Settlement',r.settlementRecordId || 'Not created')}${field('Ownership',r.ownershipRecognitionId || 'Not created')}${field('Export package',r.exportPackageId || 'Not created')}${field('Ready for export',data.status.readyForExport ? 'YES' : 'NO')}</div>`);
  }

  async function render(workspace) {
    clear(workspace);
    removeLegacySummary(workspace);
    const root = controls(workspace); if (!root) return;
    const placeholder = document.createElement('section');
    placeholder.className = 'admin-record-card';
    placeholder.dataset.nativeAssetWorkstationCard = 'true';
    placeholder.innerHTML = '<header><strong>Native Platform Asset</strong><em>READING</em></header><p>Reading canonical asset lifecycle…</p>';
    root.prepend(placeholder);
    try {
      const data = await load();
      if (!placeholder.isConnected) return;
      const tab = workspace.dataset.activeTab || 'Current Asset';
      const renderers = {
        'Current Asset':currentAsset,
        'Approval Status':approval,
        'Listing':listingView,
        'Marketplace Status':marketplace,
        'Export Status':exportView,
        'Ownership':ownershipView,
        'Recognitions':recognitions,
        'Asset History':history,
        'Publishing':publishing,
        'Governance':governance,
      };
      placeholder.outerHTML = (renderers[tab] || currentAsset)(data);
    } catch (error) {
      placeholder.innerHTML = `<header><strong>Native Platform Asset</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`;
    }
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click',(event) => {
      if (event.target.closest('[data-admin-tab]')) queueMicrotask(() => void render(workspace));
    });
    window.addEventListener('sra:admin-workspace-synchronized',(event) => {
      if (event.detail?.workspaceId === 'native-asset') void render(workspace);
    });
    window.addEventListener('sra:admin-mutated',() => void render(workspace));
    void render(workspace);
  }

  window.mountAdminNativePlatformAssetWorkstation = mount;
})();
