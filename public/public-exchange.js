(() => {
  const $ = (selector) => document.querySelector(selector);
  const form = $('#exchange-form');
  const networkSelect = $('#network');
  const receiveAssetSelect = $('#receive-asset');
  const assetSelect = $('#asset-id');
  const walletInput = $('#source-address');
  const message = $('#form-message');
  const quotePanel = $('#quote-result');
  const confirmation = $('#exchange-confirmation');
  let currentQuote = null;
  let availableRoutes = [];
  let networkEnvironment = '';

  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  function setMessage(value, error = false) { message.textContent = value || ''; message.dataset.error = error ? 'true' : 'false'; }
  async function json(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'The exchange request could not be completed.');
    return body;
  }
  function freighter() { return window.freighterApi || window.freighter || null; }
  function routesForSelection() { return availableRoutes.filter((route) => route.network === networkSelect.value && route.receiveAsset === receiveAssetSelect.value); }

  function populateAssets() {
    const routes = routesForSelection();
    assetSelect.innerHTML = routes.length
      ? `<option value="">Select an SRA asset</option>${routes.map((route) => `<option value="${esc(route.assetId)}">${esc(route.asset)} · ${esc(route.assetId)}</option>`).join('')}`
      : '<option value="">No active market for this route</option>';
    assetSelect.disabled = !routes.length;
    $('#quote-button').disabled = !routes.length;
    const pair = receiveAssetSelect.value ? `SRA/${receiveAssetSelect.value}` : 'SRA exchange';
    $('#market-state').innerHTML = routes.length
      ? `<strong>${esc(pair)} is available</strong><span>${routes.length} active market${routes.length === 1 ? '' : 's'} · ${esc(networkSelect.value)} ${esc(networkEnvironment.toLowerCase())}</span>`
      : `<strong>${esc(pair)} is being prepared</strong><span>An issued SRA asset and active market will appear here when ready.</span>`;
  }

  function populateReceiveAssets() {
    const assets = [...new Set(availableRoutes.filter((route) => route.network === networkSelect.value).map((route) => route.receiveAsset))];
    receiveAssetSelect.innerHTML = assets.length
      ? assets.map((asset) => `<option value="${esc(asset)}">${esc(asset)}</option>`).join('')
      : '<option value="">No active receiving assets</option>';
    receiveAssetSelect.disabled = !assets.length;
    if (assets.includes('USDC')) receiveAssetSelect.value = 'USDC';
    $('#wallet-network-label').textContent = networkSelect.value || 'Receiving';
    walletInput.placeholder = networkSelect.value === 'STELLAR' ? 'G…' : 'Wallet address';
    populateAssets();
  }

  async function connectWallet() {
    if (networkSelect.value !== 'STELLAR') throw new Error(`Connect a ${networkSelect.value || 'supported'} wallet for the selected route.`);
    const wallet = freighter();
    if (!wallet) throw new Error('A Stellar wallet extension was not detected. You may enter the wallet address and use the signed-XDR option.');
    let result;
    if (typeof wallet.requestAccess === 'function') result = await wallet.requestAccess();
    else if (typeof wallet.getPublicKey === 'function') result = await wallet.getPublicKey();
    else throw new Error('This Stellar wallet does not expose a connection method.');
    const address = typeof result === 'string' ? result : result?.address || result?.publicKey;
    if (!address) throw new Error(result?.error || 'The Stellar wallet did not return an address.');
    walletInput.value = address;
    setMessage('Wallet connected.');
    return address;
  }

  async function loadStatus() {
    try {
      const status = await json(await fetch('/api/public-exchange/status'));
      availableRoutes = status.availableRoutes || status.availableMarkets || [];
      networkEnvironment = status.networkEnvironment || '';
      const networks = [...new Set(availableRoutes.map((route) => route.network))];
      networkSelect.innerHTML = networks.length
        ? networks.map((network) => `<option value="${esc(network)}">${esc(network[0] + network.slice(1).toLowerCase())}</option>`).join('')
        : '<option value="">No active exchange networks yet</option>';
      networkSelect.disabled = !networks.length;
      populateReceiveAssets();
    } catch (error) {
      networkSelect.innerHTML = '<option value="">Route status unavailable</option>';
      receiveAssetSelect.innerHTML = '<option value="">Route status unavailable</option>';
      assetSelect.innerHTML = '<option value="">Route status unavailable</option>';
      $('#market-state').innerHTML = `<strong>Exchange routes unavailable</strong><span>${esc(error.message)}</span>`;
    }
  }

  function showQuote(quote) {
    currentQuote = quote;
    const receiveAsset = quote.receiveAsset || 'USDC';
    const expected = quote.expectedReceiveAmount || quote.expectedUsdc;
    const minimum = quote.minimumReceiveAmount || quote.minimumUsdc;
    confirmation.hidden = true;
    quotePanel.hidden = false;
    $('#quote-sra').textContent = `${quote.sellAmount} SRA`;
    $('#quote-expected-label').textContent = `Expected ${receiveAsset}`;
    $('#quote-receive').textContent = `${expected} ${receiveAsset}`;
    $('#quote-minimum-label').textContent = `Minimum ${receiveAsset}`;
    $('#quote-minimum').textContent = `${minimum} ${receiveAsset}`;
    $('#quote-expires').textContent = new Date(quote.expiresAt).toLocaleTimeString();
    $('#unsigned-xdr').value = quote.unsignedXdr;
    $('#signed-xdr').value = '';
  }

  async function submitSigned(signedXdr) {
    if (!currentQuote) throw new Error('Request a live quote first.');
    const result = await json(await fetch('/api/public-exchange/exchanges', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ quoteId:currentQuote.quoteId, signedXdr }) }));
    const receiveAsset = result.receiveAsset || currentQuote.receiveAsset || 'USDC';
    const minimum = result.minimumReceiveAmount || result.minimumUsdc;
    quotePanel.hidden = true;
    confirmation.hidden = false;
    confirmation.innerHTML = `<strong>Exchange confirmed</strong><p>${esc(result.sellAmount)} SRA was exchanged through the available ${esc(result.pair || `SRA/${receiveAsset}`)} market. The receiving wallet now controls the resulting ${esc(receiveAsset)}.</p><dl><div><dt>Transaction</dt><dd>${esc(result.transactionId)}</dd></div><div><dt>Minimum quoted receipt</dt><dd>${esc(minimum)} ${esc(receiveAsset)}</dd></div></dl>`;
    setMessage('');
  }

  networkSelect.addEventListener('change', populateReceiveAssets);
  receiveAssetSelect.addEventListener('change', populateAssets);
  $('#connect-wallet').addEventListener('click', () => connectWallet().catch((error) => setMessage(error.message, true)));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage(`Requesting a live SRA/${receiveAssetSelect.value} quote…`);
    quotePanel.hidden = true;
    confirmation.hidden = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      const quote = await json(await fetch('/api/public-exchange/quotes', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) }));
      showQuote(quote);
      setMessage('Live quote ready for wallet review.');
    } catch (error) { setMessage(error.message, true); }
  });
  $('#sign-submit').addEventListener('click', async () => {
    try {
      const wallet = freighter();
      if (!wallet) throw new Error('A Stellar wallet extension was not detected. Use the signed-XDR option with another compatible wallet.');
      setMessage('Waiting for the wallet signature…');
      let result;
      if (typeof wallet.signTransaction === 'function') result = await wallet.signTransaction(currentQuote.unsignedXdr, { networkPassphrase:currentQuote.networkPassphrase, address:currentQuote.sourceAddress });
      else throw new Error('This Stellar wallet does not expose transaction signing.');
      const signedXdr = typeof result === 'string' ? result : result?.signedTxXdr || result?.signedXdr;
      if (!signedXdr) throw new Error(result?.error || 'The wallet did not return a signed transaction.');
      await submitSigned(signedXdr);
    } catch (error) { setMessage(error.message, true); }
  });
  $('#copy-xdr').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#unsigned-xdr').value); setMessage('Unsigned XDR copied.'); }
    catch { setMessage('Select and copy the unsigned XDR from the field.', true); }
  });
  $('#submit-signed').addEventListener('click', () => submitSigned($('#signed-xdr').value.trim()).catch((error) => setMessage(error.message, true)));
  loadStatus();
})();
