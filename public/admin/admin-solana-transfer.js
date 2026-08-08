(() => {
  if (window.__sraAdminSolanaTransferInstalled) return;
  window.__sraAdminSolanaTransferInstalled = true;
  const mounted = new WeakSet();
  const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store', headers:{ Accept:'application/json', ...(options.headers || {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  }

  async function render(workspace) {
    if (!workspace || workspace.dataset.activeTab !== 'Solana') return;
    const controls = workspace.querySelector('.admin-workspace-controls');
    if (!controls) return;
    controls.querySelectorAll('[data-solana-address-transfer]').forEach(node => node.remove());
    try {
      const wallet = await request('/api/on-chain/solana/wallet');
      controls.insertAdjacentHTML('afterbegin', `<section class="admin-record-card" data-solana-address-transfer><header><strong>SRA Solana Wallet</strong><em>${esc(wallet.cluster || 'SOLANA')}</em></header><div class="admin-record-grid"><div><span>Platform address</span><strong style="word-break:break-all">${esc(wallet.address)}</strong></div><div><span>Asset</span><strong>SOL</strong></div></div><form data-solana-transfer-form style="border-top:1px solid #292929;margin-top:14px;padding-top:14px"><div class="admin-record-grid"><label><span>Destination address</span><input name="destinationAddress" type="text" required placeholder="Solana address"></label><label><span>Amount SOL</span><input name="amount" type="number" min="0.000000001" step="0.000000001" required value="0.001"></label></div><div style="display:flex;gap:12px;align-items:center;margin-top:12px"><button type="submit">Send SOL</button><span data-solana-transfer-result style="font-size:12px;color:#d6a92f"></span></div></form></section>`);
    } catch (error) {
      controls.insertAdjacentHTML('afterbegin', `<section class="admin-record-card" data-solana-address-transfer><header><strong>SRA Solana Wallet</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p></section>`);
    }
  }

  async function send(form) {
    const button = form.querySelector('button[type="submit"]');
    const result = form.querySelector('[data-solana-transfer-result]');
    const values = Object.fromEntries(new FormData(form).entries());
    button.disabled = true; result.textContent = 'Sending…';
    try {
      const transfer = await request('/api/on-chain/solana/transfers', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ destinationAddress:values.destinationAddress, amount:Number(values.amount) }) });
      result.textContent = `Confirmed · ${transfer.transactionSignature}`;
      window.dispatchEvent(new CustomEvent('sra:admin-refresh',{detail:{source:'solana-transfer'}}));
    } catch (error) { result.textContent = error.message; button.disabled = false; }
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click', event => { if (event.target.closest('[data-admin-tab]')) queueMicrotask(() => void render(workspace)); });
    workspace.addEventListener('submit', event => { const form=event.target.closest('[data-solana-transfer-form]'); if(!form) return; event.preventDefault(); void send(form); });
    window.addEventListener('sra:admin-workspace-synchronized', event => { if(event.detail?.workspaceId === 'connections') void render(workspace); });
    void render(workspace);
  }

  window.mountAdminSolanaTransfer = admin => mount(admin?.querySelector('[data-workspace="connections"]'));
})();
