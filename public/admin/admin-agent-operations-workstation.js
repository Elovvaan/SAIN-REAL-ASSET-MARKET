(() => {
  if (window.__sraAdminAgentOperationsWorkstationInstalled) return;
  window.__sraAdminAgentOperationsWorkstationInstalled = true;

  const mounted = new WeakSet();
  const conversation = [];
  const ownedTabs = new Set(['Conversation','Suggested Actions','Workflow Approvals','Incomplete Workflows']);
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  async function request(payload) {
    const response = await fetch('/api/admin/agent/query', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed with ${response.status}.`);
    return body;
  }

  function workCard(item) {
    const agent = item.agent || item.nextAction?.agent || 'SRA_ADMIN_INTELLIGENCE_AGENT';
    const action = item.nextAction || item;
    const jobId = action.jobId || item.jobId || '';
    const label = action.label || item.label || item.blocker || 'Platform operation';
    const authority = action.authority || item.authority || 'READ_ONLY';
    const quantity = Number(action.requestedQuantity || 0);
    const targetSupply = Number(action.targetSupply || 0);
    const approvedIssuedOnChainSupply = Number(action.approvedIssuedOnChainSupply || 0);
    const snapshotVersion = action.snapshotVersion || '';
    const network = action.network || 'SRA';
    const administratorBoundary = String(authority).startsWith('ADMIN_');
    const canExecute = administratorBoundary && action.executionAction === 'EXECUTE_CHAIN_JOB' && action.executable !== false && jobId;
    return `<article class="admin-record-card" data-agent-operation-card>
      <header><strong>${esc(label)}</strong><em>${esc(authority)}</em></header>
      <div class="admin-record-grid">
        <div><span>Worker</span><strong>${esc(agent)}</strong></div>
        ${jobId ? `<div><span>Job</span><strong>${esc(jobId)}</strong></div>` : ''}
        <div><span>Operation</span><strong>${esc(action.jobType || item.firstMissing || action.stage || 'PLATFORM_WORK')}</strong></div>
        <div><span>Network</span><strong>${esc(network)}</strong></div>
        ${quantity ? `<div><span>Quantity reviewed</span><strong>${quantity.toLocaleString(undefined,{maximumFractionDigits:8})} SRA</strong></div>` : ''}
        ${targetSupply ? `<div><span>Approved target supply</span><strong>${targetSupply.toLocaleString(undefined,{maximumFractionDigits:8})} SRA</strong></div>` : ''}
        ${snapshotVersion ? `<div><span>Approval snapshot</span><strong>${esc(snapshotVersion)}</strong></div>` : ''}
      </div>
      ${canExecute ? `<div style="margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button type="button" data-agent-execute-chain-job="${esc(jobId)}" data-target-supply="${esc(targetSupply)}" data-approved-issued-supply="${esc(approvedIssuedOnChainSupply)}" data-snapshot-version="${esc(snapshotVersion)}">Approve & Execute</button><span data-agent-operation-result style="font-size:12px;color:#d6a92f"></span></div>` : ''}
    </article>`;
  }

  function summaryCard(data, title) {
    const snapshot = data.chainSnapshot || data.delegatedAgents?.chainOperations?.snapshot || data.chainOperations?.snapshot || null;
    return `<section class="admin-record-card" data-agent-operation-card>
      <header><strong>${esc(title)}</strong><em>${esc(data.status || 'AVAILABLE')}</em></header>
      <p style="color:#b8b8b8;line-height:1.5">${esc(data.answer || '')}</p>
      ${snapshot ? `<div class="admin-record-grid"><div><span>Platform supply</span><strong>${Number(snapshot.platformSupply || 0).toLocaleString(undefined,{maximumFractionDigits:8})} SRA</strong></div><div><span>On-chain issued</span><strong>${Number(snapshot.issuedOnChainSupply || 0).toLocaleString(undefined,{maximumFractionDigits:8})} SRA</strong></div><div><span>Pending chain work</span><strong>${Number(snapshot.pendingQuantity || 0).toLocaleString(undefined,{maximumFractionDigits:8})} SRA</strong></div><div><span>Chain state</span><strong>${esc(snapshot.state || 'UNKNOWN')}</strong></div></div>` : ''}
    </section>`;
  }

  function conversationMarkup() {
    const messages = conversation.length
      ? conversation.map((message) => `<div style="padding:12px 14px;border:1px solid #292929;border-radius:10px;background:${message.role === 'admin' ? '#1d1d1d' : '#0b0b08'}"><strong style="display:block;margin-bottom:6px">${message.role === 'admin' ? 'Administrator' : 'SAIN'}</strong><span style="line-height:1.5">${esc(message.text)}</span></div>`).join('')
      : `<div class="admin-placeholder">Ask SAIN about the platform, current work, approvals, records, or lifecycle state.</div>`;
    return `<section class="admin-record-card" data-agent-operation-card data-agent-conversation>
      <header><strong>SAIN Administrative Agent</strong><em>CONVERSATION</em></header>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
        <button type="button" data-agent-quick-question="What currently needs my approval?">Approval review</button>
        <button type="button" data-agent-quick-question="Give me the operational brief and work queue.">Platform status</button>
        <button type="button" data-agent-quick-question="What workflows are incomplete?">Incomplete workflows</button>
      </div>
      <div data-agent-conversation-log style="display:grid;gap:10px;margin:12px 0">${messages}</div>
      <form data-agent-conversation-form>
        <textarea name="question" rows="3" placeholder="Message SAIN about the platform..." required style="width:100%;box-sizing:border-box;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px;resize:vertical"></textarea>
        <div style="display:flex;gap:12px;align-items:center;margin-top:10px"><button type="submit">Send to SAIN</button><span data-agent-conversation-result style="font-size:12px;color:#d6a92f"></span></div>
      </form>
    </section>`;
  }

  function setPresentationOwnership(workspace, tab) {
    const records = workspace.querySelector('.admin-workspace-records');
    if (records) records.style.display = ownedTabs.has(tab) ? 'none' : '';
  }

  async function render(workspace) {
    if (!workspace) return;
    const controls = workspace.querySelector('.admin-workspace-controls');
    if (!controls) return;
    controls.querySelectorAll('[data-agent-operation-card]').forEach((node) => node.remove());
    const tab = workspace.dataset.activeTab;
    setPresentationOwnership(workspace, tab);

    if (tab === 'Conversation') {
      controls.insertAdjacentHTML('afterbegin', conversationMarkup());
      return;
    }
    if (!['Suggested Actions','Workflow Approvals','Incomplete Workflows'].includes(tab)) return;

    try {
      const payload = tab === 'Workflow Approvals'
        ? await request({ question: 'What needs my approval?' })
        : await request({ question: 'Give me the operational brief and work queue.' });
      if (workspace.dataset.activeTab !== tab) return;

      const items = tab === 'Workflow Approvals'
        ? (payload.pendingActions || [])
        : tab === 'Incomplete Workflows'
          ? (payload.incompleteWorkflows || [])
          : [...(payload.administratorQueue || []), ...(payload.autonomousQueue || [])];

      controls.insertAdjacentHTML('afterbegin', summaryCard(payload, tab === 'Workflow Approvals' ? 'Agent Workflow Approvals' : 'Agent Operations Brief'));
      if (items.length) {
        controls.insertAdjacentHTML('beforeend', `<div data-agent-operation-card class="admin-record-list">${items.map((item) => workCard(item)).join('')}</div>`);
      } else {
        controls.insertAdjacentHTML('beforeend', `<div data-agent-operation-card class="admin-placeholder">No agent work is waiting in this queue.</div>`);
      }
    } catch (error) {
      if (workspace.dataset.activeTab === tab) controls.insertAdjacentHTML('afterbegin', `<div data-agent-operation-card class="admin-placeholder"><strong>Agent operations unavailable.</strong><br>${esc(error.message)}</div>`);
    }
  }

  async function ask(workspace, question) {
    const text = String(question || '').trim();
    if (!text) return;
    conversation.push({ role:'admin', text });
    await render(workspace);
    const result = workspace.querySelector('[data-agent-conversation-result]');
    if (result) result.textContent = 'SAIN is reviewing the platform…';
    try {
      const response = await request({ question:text });
      conversation.push({ role:'agent', text:response.answer || response.summary || response.status || 'Request completed.' });
    } catch (error) {
      conversation.push({ role:'agent', text:`Unable to complete the request: ${error.message}` });
    }
    if (workspace.dataset.activeTab === 'Conversation') await render(workspace);
  }

  async function execute(workspace, button) {
    const jobId = button.dataset.agentExecuteChainJob;
    const card = button.closest('[data-agent-operation-card]');
    const result = card?.querySelector('[data-agent-operation-result]');
    button.disabled = true;
    if (result) result.textContent = 'Agent executing approved job…';
    try {
      const response = await request({
        question: `Execute approved chain operations job ${jobId}.`,
        action: 'EXECUTE_CHAIN_JOB',
        jobId,
        approval: 'APPROVE',
        targetSupply: Number(button.dataset.targetSupply || 0),
        approvedIssuedOnChainSupply: Number(button.dataset.approvedIssuedSupply || 0),
        snapshotVersion: button.dataset.snapshotVersion || '',
      });
      if (result) result.textContent = `${response.status} · ${response.reconciliation?.issuedOnChainSupply ?? 0} SRA on chain`;
      window.dispatchEvent(new CustomEvent('sra:admin-refresh',{ detail:{ source:'chain-operations-agent' } }));
      await render(workspace);
    } catch (error) {
      if (result) result.textContent = error.message;
      button.disabled = false;
    }
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click', (event) => {
      const executeButton = event.target.closest('[data-agent-execute-chain-job]');
      if (executeButton) { void execute(workspace, executeButton); return; }
      const quick = event.target.closest('[data-agent-quick-question]');
      if (quick) { void ask(workspace, quick.dataset.agentQuickQuestion); return; }
      if (event.target.closest('[data-admin-tab]')) queueMicrotask(() => void render(workspace));
    });
    workspace.addEventListener('submit', (event) => {
      const form = event.target.closest('[data-agent-conversation-form]');
      if (!form) return;
      event.preventDefault();
      const question = new FormData(form).get('question');
      form.reset();
      void ask(workspace, question);
    });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => {
      if (event.detail?.workspaceId === 'agent') void render(workspace);
    });
    void render(workspace);
  }

  window.mountAdminAgentOperationsWorkstation = (admin) => mount(admin?.querySelector('[data-workspace="agent"]'));
})();
