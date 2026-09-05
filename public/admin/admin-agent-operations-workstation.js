(() => {
  if (window.__sraAdminAgentOperationsWorkstationInstalled) return;
  window.__sraAdminAgentOperationsWorkstationInstalled = true;

  const mounted = new WeakSet();
  const conversation = [];
  const ownedTabs = new Set(['Conversation','Capital Activation','Workforce','Suggested Actions','Workflow Approvals','Incomplete Workflows','Explain Record','Trace Instrument','Platform Questions','Diagnostics']);
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  async function request(payload) {
    const response = await fetch('/api/admin/agent/query', { method:'POST', credentials:'same-origin', cache:'no-store', headers:{ Accept:'application/json','Content-Type':'application/json' }, body:JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed with ${response.status}.`);
    return body;
  }

  async function json(url, options = {}) {
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', headers:{ Accept:'application/json','Content-Type':'application/json',...(options.headers||{}) }, ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed with ${response.status}.`);
    return body;
  }

  async function chainHealth() {
    const response = await fetch('/api/on-chain/solana/status', { credentials:'same-origin', cache:'no-store', headers:{ Accept:'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ...body, ready:false, reachable:false, error:body.error || `Chain status failed with ${response.status}.` };
    return body;
  }

  function actionOf(item) { return item?.nextAction || item || {}; }
  function executableApproval(item) {
    const action = actionOf(item);
    return String(action.authority || '').startsWith('ADMIN_') && action.executable !== false && Boolean(action.executionAction) && Boolean(action.jobId || item?.jobId);
  }

  function workCard(item) {
    const agent = item.agent || item.nextAction?.agent || 'SRA_ADMIN_INTELLIGENCE_AGENT';
    const action = actionOf(item);
    const jobId = action.jobId || item.jobId || '';
    const label = action.label || item.label || item.blocker || 'Platform operation';
    const authority = action.authority || item.authority || 'READ_ONLY';
    const quantity = Number(action.requestedQuantity || 0);
    const targetSupply = Number(action.targetSupply || 0);
    const approvedIssuedOnChainSupply = Number(action.approvedIssuedOnChainSupply || 0);
    const snapshotVersion = action.snapshotVersion || '';
    const network = action.network || 'SRA';
    const administratorBoundary = String(authority).startsWith('ADMIN_');
    const canExecute = administratorBoundary && action.executionAction === 'EXECUTE_CHAIN_JOB' && executableApproval(item);
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

  function chainReadinessCard(status) {
    const worker = status?.worker || {};
    const wallet = status?.wallet || {};
    const ready = Boolean(status?.ready);
    const detail = ready ? 'The chain executor is reachable and ready. Approval can dispatch directly to signing and broadcast.' : (status?.error || 'Complete the missing executor configuration before chain approval can execute.');
    return `<section class="admin-record-card" data-agent-operation-card>
      <header><strong>Chain Execution Readiness</strong><em>${ready ? 'READY' : 'BLOCKED'}</em></header>
      <div class="admin-record-grid">
        <div><span>Network</span><strong>${esc(worker.network || status?.network || 'SOLANA')}</strong></div>
        <div><span>Cluster</span><strong>${esc(worker.cluster || 'UNKNOWN')}</strong></div>
        <div><span>Executor endpoint</span><strong>${status?.endpointConfigured ? 'CONFIGURED' : 'NOT CONFIGURED'}</strong></div>
        <div><span>Executor credential</span><strong>${status?.credentialConfigured ? 'CONFIGURED' : 'NOT CONFIGURED'}</strong></div>
        <div><span>Executor reachable</span><strong>${status?.reachable ? 'YES' : 'NO'}</strong></div>
        <div><span>Executor process</span><strong>${status?.executorReady ? 'READY' : esc(status?.startupState || 'NOT READY')}</strong></div>
        <div><span>RPC</span><strong>${worker.rpcConfigured ? 'CONFIGURED' : 'NOT READY'}</strong></div>
        <div><span>Signer</span><strong>${worker.signerConfigured ? 'CONFIGURED' : 'NOT READY'}</strong></div>
        <div><span>Executor database</span><strong>${worker.databaseConfigured ? 'CONFIGURED' : 'NOT READY'}</strong></div>
        <div><span>Platform wallet</span><strong>${esc(wallet.address || worker.platformAddress || 'NOT AVAILABLE')}</strong></div>
      </div>
      <p style="color:#b8b8b8;line-height:1.5;margin:12px 0 0">${esc(detail)}</p>
    </section>`;
  }

  function summaryCard(data, title, override = null) {
    const snapshot = data.chainSnapshot || data.delegatedAgents?.chainOperations?.snapshot || data.chainOperations?.snapshot || null;
    const answer = override?.answer ?? data.answer ?? '';
    const status = override?.status ?? data.status ?? 'AVAILABLE';
    return `<section class="admin-record-card" data-agent-operation-card><header><strong>${esc(title)}</strong><em>${esc(status)}</em></header><p style="color:#b8b8b8;line-height:1.5">${esc(answer)}</p>${snapshot ? `<div class="admin-record-grid"><div><span>Platform supply</span><strong>${Number(snapshot.platformSupply || 0).toLocaleString(undefined,{maximumFractionDigits:8})} SRA</strong></div><div><span>On-chain issued</span><strong>${Number(snapshot.issuedOnChainSupply || 0).toLocaleString(undefined,{maximumFractionDigits:8})} SRA</strong></div><div><span>Pending chain work</span><strong>${Number(snapshot.pendingQuantity || 0).toLocaleString(undefined,{maximumFractionDigits:8})} SRA</strong></div><div><span>Chain state</span><strong>${esc(snapshot.state || 'UNKNOWN')}</strong></div></div>` : ''}</section>`;
  }

  function conversationMarkup() {
    const messages = conversation.length ? conversation.map((message) => `<div style="padding:12px 14px;border:1px solid #292929;border-radius:10px;background:${message.role === 'admin' ? '#1d1d1d' : '#0b0b08'}"><strong style="display:block;margin-bottom:6px">${message.role === 'admin' ? 'Administrator' : 'SAIN'}</strong><span style="line-height:1.5">${esc(message.text)}</span></div>`).join('') : '<div class="admin-placeholder">Ask SAIN about the platform, current work, approvals, records, or lifecycle state.</div>';
    return `<section class="admin-record-card" data-agent-operation-card data-agent-conversation><header><strong>SAIN Administrative Agent</strong><em>CONVERSATION</em></header><div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><button type="button" data-agent-quick-question="What currently needs my approval?">Approval review</button><button type="button" data-agent-quick-question="Give me the operational brief and work queue.">Platform status</button><button type="button" data-agent-quick-question="What workflows are incomplete?">Incomplete workflows</button></div><div data-agent-conversation-log style="display:grid;gap:10px;margin:12px 0">${messages}</div><form data-agent-conversation-form><textarea name="question" rows="3" placeholder="Message SAIN about the platform..." required style="width:100%;box-sizing:border-box;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px;resize:vertical"></textarea><div style="display:flex;gap:12px;align-items:center;margin-top:10px"><button type="submit">Send to SAIN</button><span data-agent-conversation-result style="font-size:12px;color:#d6a92f"></span></div></form></section>`;
  }

  function agentToolMarkup(tab) {
    const config = {
      'Explain Record': { label:'Record ID', placeholder:'Enter a Financial Record, Coin Position, transaction, or instrument ID', action:'Explain record' },
      'Trace Instrument': { label:'Instrument ID', placeholder:'Enter an instrument ID', action:'Trace instrument' },
      'Platform Questions': { label:'Question', placeholder:'Ask about platform records, workflows, or current status', action:'Ask SAIN' },
    }[tab];
    if (!config) return '';
    return `<section class="admin-record-card" data-agent-operation-card><header><strong>${esc(tab)}</strong><em>READY</em></header><form data-agent-tool-form data-agent-tool="${esc(tab)}"><label style="display:grid;gap:8px"><span>${esc(config.label)}</span><textarea name="value" rows="3" placeholder="${esc(config.placeholder)}" required style="width:100%;box-sizing:border-box;background:#050505;border:1px solid #292929;border-radius:10px;color:#f5f5f5;padding:12px;resize:vertical"></textarea></label><div style="display:flex;gap:12px;align-items:center;margin-top:10px"><button type="submit">${esc(config.action)}</button><span data-agent-tool-result style="font-size:12px;color:#d6a92f"></span></div></form><div data-agent-tool-answer style="margin-top:12px"></div></section>`;
  }

  function loadingMarkup(title) {
    return `<section class="admin-record-card" data-agent-operation-card><header><strong>${esc(title)}</strong><em>READING</em></header><p style="color:#b8b8b8">Loading current platform records…</p></section>`;
  }

  function workforceMarkup(status, agents, work) {
    const registry = status.agentOS?.agents || [];
    const byAgent = new Map();
    for (const item of work || []) {
      const counts = byAgent.get(item.agentId) || { total:0, completed:0, awaitingAcceptance:0 };
      counts.total += 1;
      if (['COMPLETED','ACCEPTED'].includes(item.state)) counts.completed += 1;
      if (item.state === 'COMPLETED') counts.awaitingAcceptance += 1;
      byAgent.set(item.agentId, counts);
    }
    const stored = new Map((agents || []).map((agent) => [agent.agentId, agent]));
    return `<section class="admin-record-card" data-agent-operation-card><header><strong>SRA Agent Workforce</strong><em>${registry.length} ACTIVE AGENTS</em></header><p style="color:#b8b8b8;line-height:1.5">Agents continuously inspect their assigned lifecycle stages and prepare work. Protected value movement, publication, settlement, instrument issuance, and on-chain execution remain subject to administrator approval.</p><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0"><button type="button" data-run-agent-workforce>Run Workforce Now</button><span data-workforce-result style="color:#d6a92f;font-size:12px"></span></div></section><div data-agent-operation-card class="admin-record-list">${registry.map((agent) => { const persisted=stored.get(agent.agentId)||{}, counts=byAgent.get(agent.agentId)||{total:0,completed:0,awaitingAcceptance:0}; const stages=agent.workflowStages||persisted.workflowStages||[]; return `<article class="admin-record-card"><header><strong>${esc(agent.name||agent.agentId)}</strong><em>${esc(agent.state||persisted.state||'UNKNOWN')}</em></header><div class="admin-record-grid"><div><span>Agent ID</span><strong>${esc(agent.agentId)}</strong></div><div><span>Scope</span><strong>${esc(agent.scope||persisted.scope||'—')}</strong></div><div><span>Assigned stages</span><strong>${esc(stages.join(' · ')||'NONE')}</strong></div><div><span>Records monitored</span><strong>${Number(agent.recordCount||0).toLocaleString()}</strong></div><div><span>Work orders</span><strong>${counts.total.toLocaleString()}</strong></div><div><span>Completed / awaiting acceptance</span><strong>${counts.completed.toLocaleString()} / ${counts.awaitingAcceptance.toLocaleString()}</strong></div></div></article>`; }).join('')}</div>`;
  }

  function capitalActivationMarkup(payload) {
    const summary = payload.summary || {};
    const queue = payload.queue || [];
    const policy = payload.policy || {};
    return `<section class="admin-record-card" data-agent-operation-card><header><strong>Capital Activation Agent</strong><em>${esc(payload.state || 'UNKNOWN')}</em></header><p style="color:#b8b8b8;line-height:1.5">Maps verified platform positions and on-chain inventory into governed next actions. Proposals do not execute transfers, swaps, market orders, or external trades.</p><div class="admin-record-grid"><div><span>Tracked assets</span><strong>${Number(summary.totalAssets || 0).toLocaleString()}</strong></div><div><span>Deployable</span><strong>${Number(summary.deployable || 0).toLocaleString()}</strong></div><div><span>Market ready</span><strong>${Number(summary.marketReady || 0).toLocaleString()}</strong></div><div><span>Liquidity blocked</span><strong>${Number(summary.liquidityBlocked || 0).toLocaleString()}</strong></div><div><span>Dormant</span><strong>${Number(summary.dormant || 0).toLocaleString()}</strong></div><div><span>Available units</span><strong>${Number(summary.availableUnits || 0).toLocaleString(undefined,{maximumFractionDigits:8})}</strong></div></div><p style="color:#d6a92f;font-size:12px">Authority: ${esc(policy.authorityLevel || 'RECOMMEND_AND_PREPARE_ONLY')} · Leverage cap: ${Number(policy.leverageCap || 0)} · Reserve floor: ${Number(policy.reserveFloorPercent || 0)}%</p></section>${queue.length ? `<div data-agent-operation-card class="admin-record-list">${queue.map((item)=>`<article class="admin-record-card"><header><strong>${esc(item.symbol)} · ${esc(item.assetId || item.coinPositionId || item.instrumentId)}</strong><em>${esc(item.classification)}</em></header><div class="admin-record-grid"><div><span>Available</span><strong>${Number(item.availableAmount || 0).toLocaleString(undefined,{maximumFractionDigits:8})} ${esc(item.symbol)}</strong></div><div><span>Network</span><strong>${esc(item.network || 'NOT ON CHAIN')}</strong></div><div><span>Instrument</span><strong>${esc(item.instrumentId || 'NOT LINKED')}</strong></div><div><span>Next governed action</span><strong>${esc(item.recommendedAction)}</strong></div></div><p style="color:#b8b8b8;line-height:1.5">${esc(item.reason)}</p>${item.classification === 'RESERVED' ? '' : `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button type="button" data-prepare-capital-proposal="${esc(item.assetId || item.coinPositionId || item.instrumentId)}" data-proposal-amount="${Number(item.availableAmount || 0)}">Prepare Proposal</button><span data-capital-proposal-result style="color:#d6a92f;font-size:12px"></span></div>`}</article>`).join('')}</div>` : '<div data-agent-operation-card class="admin-placeholder">No verified platform capital is currently available for classification.</div>'}`;
  }

  function setPresentationOwnership(workspace, tab) { const records = workspace.querySelector('.admin-workspace-records'); if (records) records.style.display = ownedTabs.has(tab) ? 'none' : ''; }
  function removeForeignAgentPresentation(workspace) { const controls = workspace?.querySelector('.admin-workspace-controls'); if (!controls) return; for (const child of [...controls.children]) if (!child.matches('[data-agent-operation-card]')) child.remove(); }

  async function render(workspace) {
    if (!workspace) return;
    const controls = workspace.querySelector('.admin-workspace-controls');
    if (!controls) return;
    controls.querySelectorAll('[data-agent-operation-card]').forEach((node) => node.remove());
    removeForeignAgentPresentation(workspace);
    const tab = workspace.dataset.activeTab;
    setPresentationOwnership(workspace, tab);
    if (tab === 'Conversation') { controls.insertAdjacentHTML('afterbegin', conversationMarkup()); return; }
    if (['Explain Record','Trace Instrument','Platform Questions'].includes(tab)) { controls.insertAdjacentHTML('afterbegin', agentToolMarkup(tab)); return; }
    if (tab === 'Capital Activation') {
      controls.insertAdjacentHTML('afterbegin', loadingMarkup('Capital Activation'));
      const loading = controls.firstElementChild;
      try { const payload = await json('/api/admin/capital-activation'); if (workspace.dataset.activeTab === tab) controls.insertAdjacentHTML('afterbegin', capitalActivationMarkup(payload)); }
      catch (error) { if (workspace.dataset.activeTab === tab) controls.insertAdjacentHTML('afterbegin', `<div data-agent-operation-card class="admin-placeholder"><strong>Capital activation unavailable.</strong><br>${esc(error.message)}</div>`); }
      finally { loading?.remove(); }
      return;
    }
    if (tab === 'Workforce') {
      controls.insertAdjacentHTML('afterbegin', loadingMarkup('Agent Workforce'));
      const loading = controls.firstElementChild;
      try {
        const [status, agents, work] = await Promise.all([json('/api/admin/agent-workforce/status'), json('/api/admin/agent-workforce/agents'), json('/api/admin/agent-workforce/work')]);
        if (workspace.dataset.activeTab !== tab) return;
        controls.insertAdjacentHTML('afterbegin', workforceMarkup(status, agents.records || [], work.records || []));
      } catch (error) { if (workspace.dataset.activeTab === tab) controls.insertAdjacentHTML('afterbegin', `<div data-agent-operation-card class="admin-placeholder"><strong>Agent workforce unavailable.</strong><br>${esc(error.message)}</div>`); }
      finally { loading?.remove(); }
      return;
    }
    if (tab === 'Diagnostics') {
      controls.insertAdjacentHTML('afterbegin', loadingMarkup('Agent Diagnostics'));
      const loading = controls.firstElementChild;
      try {
        const payload = await request({ question:'Give me the current platform diagnostics and identify any failed or incomplete administrative workflows.' });
        if (workspace.dataset.activeTab === tab) controls.insertAdjacentHTML('afterbegin', summaryCard(payload,'Agent Diagnostics'));
      } catch (error) { if (workspace.dataset.activeTab === tab) controls.insertAdjacentHTML('afterbegin', `<div data-agent-operation-card class="admin-placeholder"><strong>Agent diagnostics unavailable.</strong><br>${esc(error.message)}</div>`); }
      finally { loading?.remove(); }
      return;
    }
    if (!['Suggested Actions','Workflow Approvals','Incomplete Workflows'].includes(tab)) return;

    controls.insertAdjacentHTML('afterbegin', loadingMarkup(tab));
    const loading = controls.firstElementChild;
    try {
      const payload = await request({ question:'Give me the operational brief and work queue.' });
      if (workspace.dataset.activeTab !== tab) return;
      let items = tab === 'Workflow Approvals' ? (payload.administratorQueue || []) : tab === 'Incomplete Workflows' ? (payload.incompleteWorkflows || []) : [...(payload.administratorQueue || []), ...(payload.autonomousQueue || [])];
      let summaryOverride = null;
      if (tab === 'Workflow Approvals') {
        items = items.filter(executableApproval);
        summaryOverride = items.length ? { status:'APPROVAL_REQUIRED', answer:`${items.length} executable agent approval${items.length === 1 ? '' : 's'} ${items.length === 1 ? 'is' : 'are'} waiting here. Approve the task in this window and the agent will dispatch the owning worker.` } : { status:'NO_PENDING_APPROVAL', answer:'No executable agent approval is waiting in this window. Non-executable lifecycle blockers remain under Incomplete Workflows until their execution dependency is ready.' };
      }
      controls.insertAdjacentHTML('afterbegin', summaryCard(payload, tab === 'Workflow Approvals' ? 'Agent Workflow Approvals' : 'Agent Operations Brief', summaryOverride));
      const hasChainWork = items.some((item) => String(actionOf(item).network || '').toUpperCase() === 'SOLANA' || actionOf(item).executionAction === 'EXECUTE_CHAIN_JOB');
      if (hasChainWork) controls.insertAdjacentHTML('beforeend', chainReadinessCard(await chainHealth()));
      if (items.length) controls.insertAdjacentHTML('beforeend', `<div data-agent-operation-card class="admin-record-list">${items.map((item) => workCard(item)).join('')}</div>`);
      else controls.insertAdjacentHTML('beforeend', '<div data-agent-operation-card class="admin-placeholder">No agent work is waiting in this queue.</div>');
    } catch (error) {
      if (workspace.dataset.activeTab === tab) controls.insertAdjacentHTML('afterbegin', `<div data-agent-operation-card class="admin-placeholder"><strong>Agent operations unavailable.</strong><br>${esc(error.message)}</div>`);
    } finally { loading?.remove(); }
  }

  async function runAgentTool(workspace, form) {
    const value = String(new FormData(form).get('value') || '').trim();
    if (!value) return;
    const tab = form.dataset.agentTool;
    const result = form.querySelector('[data-agent-tool-result]');
    const answer = form.closest('[data-agent-operation-card]')?.querySelector('[data-agent-tool-answer]');
    const question = tab === 'Explain Record' ? `Explain record ${value} and its current lifecycle state.` : tab === 'Trace Instrument' ? `Trace instrument ${value} through its records, Coin Position, marketplace, and settlement lifecycle.` : value;
    if (result) result.textContent = 'SAIN is reviewing the platform…';
    try {
      const payload = await request({ question });
      if (answer) answer.innerHTML = summaryCard(payload, tab);
      if (result) result.textContent = 'Complete';
    } catch (error) { if (result) result.textContent = error.message; }
  }

  async function ask(workspace, question) {
    const text = String(question || '').trim(); if (!text) return; conversation.push({ role:'admin', text }); await render(workspace); const result = workspace.querySelector('[data-agent-conversation-result]'); if (result) result.textContent = 'SAIN is reviewing the platform…';
    try { const response = await request({ question:text }); conversation.push({ role:'agent', text:response.answer || response.summary || response.status || 'Request completed.' }); }
    catch (error) { conversation.push({ role:'agent', text:`Unable to complete the request: ${error.message}` }); }
    if (workspace.dataset.activeTab === 'Conversation') await render(workspace);
  }

  async function execute(workspace, button) {
    const jobId = button.dataset.agentExecuteChainJob; const card = button.closest('[data-agent-operation-card]'); const result = card?.querySelector('[data-agent-operation-result]'); button.disabled = true; if (result) result.textContent = 'Agent executing approved job…';
    try { const response = await request({ question:`Execute approved chain operations job ${jobId}.`, action:'EXECUTE_CHAIN_JOB', jobId, approval:'APPROVE', targetSupply:Number(button.dataset.targetSupply || 0), approvedIssuedOnChainSupply:Number(button.dataset.approvedIssuedSupply || 0), snapshotVersion:button.dataset.snapshotVersion || '' }); if (result) result.textContent = `${response.status} · ${response.reconciliation?.issuedOnChainSupply ?? 0} SRA on chain`; window.dispatchEvent(new CustomEvent('sra:admin-refresh',{ detail:{ source:'chain-operations-agent' } })); await render(workspace); }
    catch (error) { if (result) result.textContent = error.message; button.disabled = false; }
  }

  async function runWorkforce(workspace, button) {
    const result = workspace.querySelector('[data-workforce-result]'); button.disabled = true; if (result) result.textContent = 'Agents are reviewing their assigned work…';
    try { const response = await json('/api/admin/agent-workforce/run',{method:'POST',body:'{}'}); if (result) result.textContent = `${response.run?.completedCount || 0} work order(s) completed · ${response.run?.skippedCount || 0} already current`; window.dispatchEvent(new CustomEvent('sra:admin-refresh',{detail:{source:'agent-workforce'}})); await render(workspace); }
    catch (error) { if (result) result.textContent = error.message; button.disabled = false; }
  }

  async function prepareCapitalProposal(workspace, button) {
    const card = button.closest('[data-agent-operation-card]'); const result = card?.querySelector('[data-capital-proposal-result]'); button.disabled = true; if (result) result.textContent = 'Preparing governed proposal…';
    try { const proposal = await json(`/api/admin/capital-activation/${encodeURIComponent(button.dataset.prepareCapitalProposal)}/proposals`,{method:'POST',body:JSON.stringify({amount:Number(button.dataset.proposalAmount || 0)})}); if (result) result.textContent = `${proposal.proposalId} prepared · execution remains unauthorized`; }
    catch (error) { if (result) result.textContent = error.message; button.disabled = false; }
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return; mounted.add(workspace); removeForeignAgentPresentation(workspace); const controls = workspace.querySelector('.admin-workspace-controls'); const presentationObserver = controls ? new MutationObserver(() => removeForeignAgentPresentation(workspace)) : null; presentationObserver?.observe(controls,{ childList:true });
    workspace.addEventListener('click', (event) => { const proposalButton=event.target.closest('[data-prepare-capital-proposal]'); if(proposalButton){void prepareCapitalProposal(workspace,proposalButton);return;} const runButton=event.target.closest('[data-run-agent-workforce]'); if(runButton){void runWorkforce(workspace,runButton);return;} const executeButton = event.target.closest('[data-agent-execute-chain-job]'); if (executeButton) { void execute(workspace, executeButton); return; } const quick = event.target.closest('[data-agent-quick-question]'); if (quick) { void ask(workspace, quick.dataset.agentQuickQuestion); return; } if (event.target.closest('[data-admin-tab]')) queueMicrotask(() => void render(workspace)); });
    workspace.addEventListener('submit', (event) => { const toolForm=event.target.closest('[data-agent-tool-form]'); if(toolForm){event.preventDefault();void runAgentTool(workspace,toolForm);return;} const form = event.target.closest('[data-agent-conversation-form]'); if (!form) return; event.preventDefault(); const question = new FormData(form).get('question'); form.reset(); void ask(workspace, question); });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => { if (event.detail?.workspaceId === 'agent') void render(workspace); });
    void render(workspace);
  }

  window.mountAdminAgentOperationsWorkstation = (admin) => mount(admin?.querySelector('[data-workspace="agent"]'));
})();
