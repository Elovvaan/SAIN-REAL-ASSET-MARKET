(() => {
  if (window.__sraAdminFinancialRecordsWorkstationInstalled) return;
  window.__sraAdminFinancialRecordsWorkstationInstalled = true;

  const mounted = new WeakSet();
  const client = () => window.SRAAdminDataClient;
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const list = (value) => Array.isArray(value) ? value : [];
  const money = (value) => Number(value || 0).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
  const request = async (url) => client() ? client().json(url) : fetch(url,{credentials:'same-origin',cache:'no-store'}).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  });

  function scalar(value) {
    if (value == null || value === '') return '—';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(scalar).join(', ');
    for (const key of ['code','name','type','recordType','classification','kind','label','id']) {
      if (value?.[key] != null && typeof value[key] !== 'object') return String(value[key]);
    }
    try { return JSON.stringify(value); } catch { return 'Structured record'; }
  }
  function idOf(record) {
    return record?.financialRecordId || record?.recognitionId || record?.ownershipRecognitionId || record?.observationId || record?.evidencePackageId || record?.financialHistoryId || record?.relationshipId || record?.eventId || record?.id || 'RECORD';
  }
  function stateOf(record) { return scalar(record?.state || record?.status || record?.decision || record?.lifecycleState || 'RECORDED'); }
  function typeOf(record) { return scalar(record?.recordType || record?.type || record?.classification || record?.eventType || record?.recognitionBasis || 'FINANCIAL_RECORD'); }
  function amountOf(record) {
    const value = record?.recordedValueUsd ?? record?.recognizedValueUsd ?? record?.amountUsd ?? record?.amount ?? record?.verifiedValue ?? record?.value;
    return value == null ? '—' : `${money(value)} ${record?.currency || 'USD'}`;
  }
  function field(label,value) { return `<div><span>${esc(label)}</span><strong>${esc(scalar(value))}</strong></div>`; }
  function card(record) {
    return `<article class="admin-record-card"><header><strong>${esc(idOf(record))}</strong><em>${esc(stateOf(record))}</em></header><div class="admin-record-grid">${field('Type',typeOf(record))}${field('Amount / value',amountOf(record))}${field('Observation',record.observationId)}${field('Recognition',record.recognitionId)}${field('Financial record',record.financialRecordId)}${field('Coin position',record.coinPositionId)}${field('Instrument',record.instrumentId)}${field('Owner',record.ownerId || record.participantId)}${field('Updated',record.updatedAt || record.recordedAt || record.recognizedAt || record.observedAt || record.createdAt)}</div><details><summary>Record details</summary><pre>${esc(JSON.stringify(record,null,2))}</pre></details></article>`;
  }
  function recordsFor(tab, r) {
    if (tab === 'Recognitions') return [...list(r.recognitions), ...list(r.ownershipRecognitions)];
    if (tab === 'Observations') return list(r.observations);
    if (tab === 'Financial Records') return [...list(r.financialRecords), ...list(r.financialRecordAccounts), ...list(r.verifiedValueRecords)];
    if (tab === 'Evidence') return list(r.evidencePackages);
    if (tab === 'Origin Records') return list(r.financialHistory);
    if (tab === 'Trace') return [...list(r.assetRelationships), ...list(r.financialHistory), ...list(r.lifecycleEvents)];
    return list(r.lifecycleEvents);
  }
  function summary(tab, r, records) {
    const financialValue = list(r.financialRecords).reduce((sum,item) => sum + Number(item.recordedValueUsd ?? item.recognizedValueUsd ?? item.amountUsd ?? item.amount ?? 0), 0);
    return `<section class="admin-record-card" data-financial-records-workstation-card><header><strong>${esc(tab)}</strong><em>CANONICAL RECORDS</em></header><div class="admin-record-grid">${field('Records in view',records.length)}${field('Recognitions',list(r.recognitions).length + list(r.ownershipRecognitions).length)}${field('Observations',list(r.observations).length)}${field('Financial records',list(r.financialRecords).length)}${field('Recorded USD in current sample',money(financialValue))}${field('Evidence packages',list(r.evidencePackages).length)}${field('Relationships / trace',list(r.assetRelationships).length)}</div><p style="color:#9a9a9a;margin:12px 0 0">Observation → Recognition → Financial Record → Coin Position → Instrument. Structured record types are rendered as readable labels instead of object coercion.</p></section>`;
  }

  async function render(workspace) {
    const controls = workspace?.querySelector('.admin-workspace-controls');
    const body = workspace?.querySelector('.admin-workspace-records');
    if (!controls || !body) return;
    controls.querySelectorAll('[data-financial-records-workstation-card]').forEach((node) => node.remove());
    const loading = document.createElement('section');
    loading.className = 'admin-record-card';
    loading.dataset.financialRecordsWorkstationCard = 'true';
    loading.innerHTML = '<header><strong>Financial Records</strong><em>READING</em></header><p>Reading canonical financial record chain…</p>';
    controls.prepend(loading);
    try {
      const payload = await request('/api/admin/workspaces?workspace=records&limit=100');
      const r = payload?.records || {};
      const tab = workspace.dataset.activeTab || 'Recognitions';
      const records = recordsFor(tab, r);
      loading.outerHTML = summary(tab, r, records);
      body.innerHTML = records.length ? `<div class="admin-record-list">${records.map(card).join('')}</div>` : `<div class="admin-placeholder">No ${esc(tab)} records are currently stored.</div>`;
    } catch (error) {
      loading.innerHTML = `<header><strong>Financial Records</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`;
    }
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click',(event) => {
      if (event.target.closest('[data-admin-tab]')) queueMicrotask(() => void render(workspace));
    });
    window.addEventListener('sra:admin-workspace-synchronized',(event) => {
      if (event.detail?.workspaceId === 'records') void render(workspace);
    });
    window.addEventListener('sra:admin-mutated',() => void render(workspace));
    void render(workspace);
  }

  window.mountAdminFinancialRecordsWorkstation = mount;
})();
