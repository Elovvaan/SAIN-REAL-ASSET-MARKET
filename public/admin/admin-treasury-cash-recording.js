(() => {
  if (window.__sraAdminTreasuryCashRecordingInstalled) return;
  window.__sraAdminTreasuryCashRecordingInstalled = true;

  const mounted = new WeakSet();
  const request = async (url, options = {}) => {
    if (window.SRAAdminDataClient) return window.SRAAdminDataClient.json(url, options);
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  };

  function removeCard(workspace) {
    workspace?.querySelector('[data-treasury-cash-recording-card]')?.remove();
  }

  function markup() {
    return `<section class="admin-record-card" data-treasury-cash-recording-card>
      <header><strong>Record Cash</strong><em>MANUAL TREASURY ENTRY</em></header>
      <p style="color:#9a9a9a;margin:0 0 14px;line-height:1.5">Record USD cash that is actually held and available to the platform. This posts a balanced Treasury journal: debit Treasury Cash — USD and credit Platform Contributed Capital. It records the cash position; it does not move money from a bank or create cash from an instrument.</p>
      <form data-treasury-cash-recording-form autocomplete="off">
        <div class="admin-record-grid">
          <label><span>Amount USD</span><input name="amountUsd" type="number" min="0.01" step="0.01" placeholder="0.00" required></label>
          <label><span>Reference</span><input name="reference" type="text" placeholder="Bank deposit, cash contribution, receipt reference" required></label>
          <label><span>Memo</span><input name="memo" type="text" placeholder="Manual platform cash contribution" required></label>
        </div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px">
          <button type="submit">Record Cash</button>
          <span data-treasury-cash-recording-result style="color:#d6a92f;font-size:12px"></span>
        </div>
      </form>
    </section>`;
  }

  async function recordCash(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const amount = Number(values.amountUsd);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than zero.');
    const reference = String(values.reference || '').trim();
    const memo = String(values.memo || '').trim();
    if (!reference) throw new Error('Reference is required.');
    if (!memo) throw new Error('Memo is required.');

    return request('/api/admin/treasury/journals/approve', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        approval:'APPROVE',
        journalType:'CASH_CONTRIBUTION',
        memo,
        reference,
        idempotencyKey:`MANUAL-CASH:${reference}:${amount.toFixed(2)}`,
        lines:[
          { accountId:'TRSY-1000-CASH-USD', side:'DEBIT', amount, currency:'USD' },
          { accountId:'TRSY-3000-PLATFORM-CAPITAL', side:'CREDIT', amount, currency:'USD' },
        ],
      }),
    });
  }

  function render(workspace) {
    removeCard(workspace);
    if (!workspace || workspace.dataset.activeTab !== 'Cash Position') return;
    const controls = workspace.querySelector('.admin-workspace-controls');
    if (!controls) return;
    controls.insertAdjacentHTML('afterbegin', markup());
    const form = controls.querySelector('[data-treasury-cash-recording-form]');
    const result = controls.querySelector('[data-treasury-cash-recording-result]');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      if (result) result.textContent = 'Recording cash in Treasury…';
      try {
        const response = await recordCash(form);
        const cash = Number(response?.summary?.cashBalanceUsd || 0);
        if (result) result.textContent = `Cash recorded. Treasury Cash / Settlement USD is now ${cash.toLocaleString(undefined,{style:'currency',currency:'USD'})}.`;
        form.reset();
        window.SRAAdminDataClient?.refresh?.('treasury-cash-recorded');
        window.dispatchEvent(new CustomEvent('sra:admin-refresh', { detail:{ source:'treasury-cash-recorded' } }));
      } catch (error) {
        if (result) result.textContent = error.message || 'Cash recording failed.';
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click', (event) => {
      if (event.target.closest('[data-admin-tab]')) queueMicrotask(() => render(workspace));
    });
    window.addEventListener('sra:admin-workspace-synchronized', (event) => {
      if (event.detail?.workspaceId === 'treasury') render(workspace);
    });
    render(workspace);
  }

  window.mountAdminTreasuryCashRecording = mount;
})();
