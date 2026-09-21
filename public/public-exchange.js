(() => {
  const $ = (selector) => document.querySelector(selector);
  const form = $('#exchange-form');
  const assetSelect = $('#asset-id');
  const walletInput = $('#source-address');
  const message = $('#form-message');
  const quotePanel = $('#quote-result');
  const confirmation = $('#exchange-confirmation');
  let currentQuote = null;

  function setMessage(value, error = false) {
    message.textContent = value || '';
    message.dataset.error = error ? 'true' : 'false';
  }
  async function json(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'The exchange request could not be completed.');
    return body;
  }
  function freighter() {
    return window.freighterApi || window.freighter || null;
  }
  async function connectWallet() {
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
      const markets = status.availableMarkets || [];
      assetSelect.innerHTML = markets.length
        ? `<option value="">Select an SRA asset</option>${markets.map((market) => `<option value="${market.assetId}">${market.asset} · ${market.assetId}</option>`).join('')}`
        : '<option value="">No active SRA/USDC market yet</option>';
      assetSelect.disabled = !markets.length;
      $('#quote-button').disabled = !markets.length;
      $('#market-state').innerHTML = markets.length
        ? `<strong>SRA/USDC is available</strong><span>${markets.length} active market${markets.length === 1 ? '' : 's'} · Stellar ${status.networkEnvironment.toLowerCase()}</span>`
        : '<strong>SRA/USDC is being prepared</strong><span>An issued SRA asset and active market will appear here when ready.</span>';
    } catch (error) {
      assetSelect.innerHTML = '<option value="">Market status unavailable</option>';
      $('#market-state').innerHTML = `<strong>Market status unavailable</strong><span>${error.message}</span>`;
    }
  }
  function showQuote(quote) {
    currentQuote = quote;
    confirmation.hidden = true;
    quotePanel.hidden = false;
    $('#quote-sra').textContent = `${quote.sellAmount} SRA`;
    $('#quote-usdc').textContent = `${quote.expectedUsdc} USDC`;
    $('#quote-minimum').textContent = `${quote.minimumUsdc} USDC`;
    $('#quote-expires').textContent = new Date(quote.expiresAt).toLocaleTimeString();
    $('#unsigned-xdr').value = quote.unsignedXdr;
    $('#signed-xdr').value = '';
  }
  async function submitSigned(signedXdr) {
    if (!currentQuote) throw new Error('Request a live quote first.');
    const result = await json(await fetch('/api/public-exchange/exchanges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteId: currentQuote.quoteId, signedXdr }) }));
    quotePanel.hidden = true;
    confirmation.hidden = false;
    confirmation.innerHTML = `<strong>Exchange confirmed</strong><p>${result.sellAmount} SRA was exchanged through the available market. The receiving wallet now controls the resulting USDC.</p><dl><div><dt>Transaction</dt><dd>${result.transactionId}</dd></div><div><dt>Minimum quoted receipt</dt><dd>${result.minimumUsdc} USDC</dd></div></dl>`;
    setMessage('');
  }

  $('#connect-wallet').addEventListener('click', () => connectWallet().catch((error) => setMessage(error.message, true)));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage('Requesting a live SRA/USDC quote…');
    quotePanel.hidden = true;
    confirmation.hidden = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      const quote = await json(await fetch('/api/public-exchange/quotes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
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
      if (typeof wallet.signTransaction === 'function') result = await wallet.signTransaction(currentQuote.unsignedXdr, { networkPassphrase: currentQuote.networkPassphrase, address: currentQuote.sourceAddress });
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
