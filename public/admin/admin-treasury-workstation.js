(() => {
  if (window.__sraAdminTreasuryWorkstationInstalled) return;
  window.__sraAdminTreasuryWorkstationInstalled = true;

  const mounted = new WeakSet();
  const client = () => window.SRAAdminDataClient;
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const money = (value) => Number(value || 0).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
  const list = (value) => Array.isArray(value) ? value : [];
  const request = async (url, options = {}) => client() ? client().json(url, options) : fetch(url,{credentials:'same-origin',cache:'no-store',...options}).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}.`);
    return payload;
  });

  function controls(workspace) { return workspace?.querySelector('.admin-workspace-controls'); }
  function field(label,value) { return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function card(title,state,body) { return `<section class="admin-record-card" data-treasury-workstation-card><header><strong>${esc(title)}</strong><em>${esc(state)}</em></header>${body}</section>`; }
  function clear(workspace) { controls(workspace)?.querySelectorAll('[data-treasury-workstation-card]').forEach((node) => node.remove()); }

  async function load(tab = 'Overview', includeUsdc = false) {
    const needsEligibleInstrument = ['Overview','Commercial Instruments','Available Financing','Funding Capacity'].includes(tab);
    const needsWorkspaceRecords = ['Commercial Instruments','Journal Entries','Treasury Wallets','Ledger','Treasury Reports'].includes(tab);
    const treasury = await request('/api/admin/treasury');
    const eligible = needsEligibleInstrument
      ? await request('/api/admin/treasury/funding-instrument-deposits/eligible-instruments')
      : { instruments: [], canonicalInstrumentId: null };
    const workspace = needsWorkspaceRecords
      ? await request(`/api/admin/workspaces?workspace=treasury&tab=${encodeURIComponent(tab)}&limit=100`)
      : { records: {} };
    let profiles = null;
    let conversions = null;
    let cctpStatus = null;
    let cctpTransfers = null;
    if (includeUsdc) {
      profiles = await request('/api/platform-treasury/profiles');
      conversions = await request('/api/platform-treasury/usdc-conversions');
      cctpStatus = await request('/api/platform-treasury/cctp/status');
      cctpTransfers = await request('/api/platform-treasury/cctp/transfers');
    }
    const btcRoute = tab === 'Treasury Wallets' ? await request('/api/platform-treasury/btc-route/status') : null;
    return { treasury, eligible, records: workspace?.records || {}, profiles:profiles?.profiles || [], conversions:conversions?.conversions || [], cctpStatus:cctpStatus||{}, cctpTransfers:cctpTransfers?.transfers||[], btcRoute };
  }

  function canonicalInstrument(data) {
    return list(data.eligible?.instruments).find((item) => item.instrumentId === data.eligible?.canonicalInstrumentId) || null;
  }

  function recognitionAction(data) {
    const instrument = canonicalInstrument(data);
    if (!instrument || instrument.deposited) return '';
    return `<div style="margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button type="button" data-treasury-recognize-instrument>Recognize ${money(instrument.faceValueUsd)} in Treasury</button><span data-treasury-recognition-result style="color:#9a9a9a;font-size:12px">Issued instrument is awaiting Treasury recognition. This posts the existing canonical instrument once; it does not create another instrument.</span></div>`;
  }

  function renderOverview(data) {
    const instrument = canonicalInstrument(data);
    return card('Treasury Position','CURRENT',`<div class="admin-record-grid">${field('Cash / Settlement USD',money(data.treasury.cashBalanceUsd))}${field('Commercial instrument USD',money(data.treasury.commercialInstrumentUsd))}${field('Financing capacity',money(data.treasury.totalFundingCapacityUsd))}${field('Available financing',money(data.treasury.availableFinancingCapacityUsd))}${field('Financing held',money(data.treasury.committedFinancingUsd))}${field('Financing deployed',money(data.treasury.deployedFinancingUsd))}${field('Canonical $18M instrument',instrument ? (instrument.deposited ? 'TREASURY RECOGNIZED' : 'ISSUED · AWAITING TREASURY RECOGNITION') : 'NOT FOUND')}</div>${recognitionAction(data)}`);
  }

  function renderCommercial(data) {
    const instruments = list(data.records.instruments).filter((item) => /FUNDING|COMMERCIAL|TREASURY/i.test(JSON.stringify(item)));
    const instrument = canonicalInstrument(data);
    return card('Commercial Instruments', instruments.length ? 'ACTIVE' : 'EMPTY', `<div class="admin-record-grid">${field('Instrument records',String(instruments.length))}${field('Canonical instrument',instrument?.instrumentId || 'Not found')}${field('Canonical face value',instrument ? money(instrument.faceValueUsd) : '—')}${field('Treasury state',instrument?.treasuryState || '—')}${field('Financing state',instrument?.financingState || '—')}${field('Recognized instrument USD',money(data.treasury.commercialInstrumentUsd))}${field('Total funding capacity',money(data.treasury.totalFundingCapacityUsd))}${field('Available financing',money(data.treasury.availableFinancingCapacityUsd))}</div>${recognitionAction(data)}<p style="color:#9a9a9a;margin:12px 0 0">Issued instruments remain instrument records until the governed Treasury recognition step posts them into the Treasury ledger.</p>`);
  }

  function renderCash(data) {
    return card('Cash Position','OPERATING',`<div class="admin-record-grid">${field('Cash / Settlement USD',money(data.treasury.cashBalanceUsd))}</div><p style="color:#9a9a9a;margin:12px 0">Commercial instrument value and financing capacity are not cash. Cash changes only through cash/settlement accounting events.</p>`);
  }

  function renderFinancing(data, capacity = false) {
    const total = Number(data.treasury.totalFundingCapacityUsd || 0);
    const available = Number(data.treasury.availableFinancingCapacityUsd || 0);
    const committed = Number(data.treasury.committedFinancingUsd || 0);
    const deployed = Number(data.treasury.deployedFinancingUsd || 0);
    const title = capacity ? 'Funding Capacity' : 'Available Financing';
    const body = capacity
      ? `<div class="admin-record-grid">${field('Total capacity',money(total))}${field('Committed / held',money(committed))}${field('Deployed',money(deployed))}${field('Remaining capacity',money(available))}${field('Capacity used',money(committed + deployed))}${field('Source instrument deposits',String(data.treasury.fundingInstrumentDeposits?.depositCount || 0))}</div>${recognitionAction(data)}<p style="color:#9a9a9a;margin:12px 0 0">Treasury-sourced financing authorizations reserve capacity. Settled Treasury financing moves from held to deployed without being counted twice.</p>`
      : `<div class="admin-record-grid">${field('Available now',money(available))}${field('Held for authorized financing',money(committed))}${field('Already deployed',money(deployed))}${field('Total funding capacity',money(total))}</div>${recognitionAction(data)}<p style="color:#9a9a9a;margin:12px 0 0">Available Financing is the remaining Treasury capacity after current Treasury-funded authorizations and completed deployments.</p>`;
    return card(title,'CURRENT',body);
  }

  function renderJournal(data) {
    const entries = list(data.records.ledgerEntries);
    return card('Journal Entries','LEDGER',`<div class="admin-record-grid">${field('Journal entries',String(entries.length))}${field('Ledger accounts',String(list(data.records.ledgerAccounts).length))}</div><p style="color:#9a9a9a;margin:12px 0 0">Balanced-entry controls remain the write path; journal records below are the posted history.</p>`);
  }

  function renderWallets(data) {
    const wallets = list(data.records.treasuryWallets);
    const activity = list(data.records.treasuryCryptoActivity);
    const profiles = list(data.profiles);
    const conversions = list(data.conversions);
    const cctpTransfers = list(data.cctpTransfers);
    const destinations = list(data.cctpStatus?.supportedDestinations).filter((item)=>item.ready).map((item)=>`<option value="${esc(item.network)}">${esc(item.network)} · CCTP domain ${esc(item.domain)}</option>`).join('');
    const profileOptions = profiles.filter((profile)=>profile.profileId==='SRA_PLATFORM_TREASURY').map((profile)=>`<option value="${esc(profile.profileId)}">${esc(profile.name)} · ${esc(profile.profileId)}</option>`).join('');
    const nextAction = (record) => {
      const base=`data-conversion-id="${esc(record.conversionId)}"`;
      if(record.state==='AUTHORIZED')return `<input ${base} data-provider-reference placeholder="Provider transaction reference (non-anchor)"><button type="button" ${base} data-conversion-action="initiate">Initiate Provider</button>`;
      if(record.state==='PROVIDER_INITIATED')return `<input ${base} data-usd-funding-reference placeholder="Verified USD funding reference"><button type="button" ${base} data-conversion-action="confirm-usd">Confirm USD Funding</button>`;
      if(record.state==='USD_FUNDING_CONFIRMED')return `<input ${base} data-stellar-transaction placeholder="Stellar transaction hash"><button type="button" ${base} data-conversion-action="confirm-usdc">Verify USDC Receipt</button>`;
      if(record.state==='USDC_RECEIVED')return `<button type="button" ${base} data-conversion-action="reconcile">Reconcile On Chain</button>`;
      if(record.state==='ON_CHAIN_RECONCILED')return `<button type="button" ${base} data-conversion-action="reclassify">Reclassify Reserve</button>`;
      return '';
    };
    const records = conversions.map((record)=>`<article style="border-top:1px solid #292929;padding:12px 0"><div class="admin-record-grid">${field('Conversion',record.conversionId)}${field('State',record.state)}${field('USD authorized',money(record.amountUsd))}${field('USDC expected',String(record.expectedUsdc))}${field('Provider',record.provider)}${field('Stellar destination',record.destinationWallet)}${record.stellarTransactionId?field('Stellar transaction',record.stellarTransactionId):''}${record.ledgerEntryId?field('Ledger entry',record.ledgerEntryId):''}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${nextAction(record)}<span data-conversion-result="${esc(record.conversionId)}" style="color:#d6a92f;font-size:12px"></span></div></article>`).join('') || '<p style="color:#9a9a9a">No Treasury USD-to-USDC conversions have been authorized.</p>';
    const cctpAction=(record)=>{const base=`data-cctp-transfer-id="${esc(record.cctpTransferId)}"`;if(record.state==='AUTHORIZED')return `<button type="button" ${base} data-cctp-action="burn">Approve + Burn on Stellar</button>`;if(record.state==='SOURCE_BURN_CONFIRMED')return `<button type="button" ${base} data-cctp-action="attest">Check Circle Attestation</button>`;if(record.state==='ATTESTATION_READY')return `<button type="button" ${base} data-cctp-action="mint">Mint on ${esc(record.destinationNetwork)}</button>`;if(record.state==='DESTINATION_MINT_SUBMITTED')return `<button type="button" ${base} data-cctp-action="reconcile">Reconcile Destination</button>`;return '';};
    const cctpRecords=cctpTransfers.map((record)=>`<article style="border-top:1px solid #292929;padding:12px 0"><div class="admin-record-grid">${field('CCTP transfer',record.cctpTransferId)}${field('State',record.state)}${field('Amount',`${record.amount} USDC`)}${field('Route',`Stellar → ${record.destinationNetwork}`)}${field('Destination',record.destinationAddress)}${record.sourceBurnTransactionHash?field('Source burn',record.sourceBurnTransactionHash):''}${record.destinationMintTransactionHash?field('Destination mint',record.destinationMintTransactionHash):''}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${cctpAction(record)}<span data-cctp-result="${esc(record.cctpTransferId)}" style="color:#d6a92f;font-size:12px"></span></div></article>`).join('')||'<p style="color:#9a9a9a">No CCTP network transfers have been authorized.</p>';
    const cctp=`<div style="border-top:1px solid #292929;margin-top:20px;padding-top:18px"><h3 style="margin:0 0 8px">USDC Network Transfer · Circle CCTP</h3><p style="color:#9a9a9a;margin:0 0 12px">Move genuine USDC from Stellar to another configured network through Circle CCTP V2. SRA records source burn, Circle attestation, destination mint, and reconciliation separately.</p><form data-cctp-transfer-form><div class="admin-record-grid"><label><span>USDC amount</span><input name="amount" type="number" min="0.000001" step="0.000001" required></label><label><span>Destination network</span><select name="destinationNetwork" required><option value="">Select configured network</option>${destinations}</select></label><label><span>Destination wallet</span><input name="destinationAddress" required placeholder="Destination-network address"></label></div><label style="display:block;margin:12px 0"><input name="confirmNetworkTransfer" type="checkbox" required> I authorize this governed USDC network-transfer record.</label><button type="submit" ${destinations?'':'disabled'}>Authorize CCTP Transfer</button><span data-cctp-authorize-result style="color:#d6a92f;font-size:12px;margin-left:10px"></span></form><div style="margin-top:16px">${cctpRecords}</div></div>`;
    const btc = data.btcRoute || {};
    const btcWallets = list(btc.wallets);
    const walletOptions = btcWallets.filter((item)=>item.state==='ACTIVE').map((item)=>`<option value="${esc(item.walletId)}">${esc(item.label)} · ${esc(item.address)}</option>`).join('');
    const listingOptions = list(btc.eligibleListings).map((item)=>`<option value="${esc(item.listingId)}">${esc(item.listingId)} · ${esc(item.availableQuantity ?? 'available quantity unreported')} SRA</option>`).join('');
    const btcWalletRows = btcWallets.map((item)=>`<article style="border-top:1px solid #292929;padding:10px 0"><strong>${esc(item.label)}</strong><div class="admin-record-grid">${field('Receiving address',item.address)}${field('State',item.state)}${field('Network validation',item.networkValidated?'VALIDATED':'PENDING')}${field('Control','SRA ADMIN DECLARED')}</div>${item.state==='ACTIVE'?`${!item.networkValidated?`<button type="button" data-btc-wallet-validate="${esc(item.walletId)}" ${btc.bitcoinRpcConfigured?'':'disabled'}>Validate on Bitcoin network</button>`:''}<button type="button" data-btc-wallet-retire="${esc(item.walletId)}">Retire Address</button>`:''}</article>`).join('') || '<p>No dedicated SRA Bitcoin wallet has been registered.</p>';
    const btcTrades = list(btc.trades).map((item)=>`<article style="border-top:1px solid #292929;padding:10px 0"><div class="admin-record-grid">${field('SRA/BTC trade',item.id)}${field('State',item.state)}${field('Terms',`${item.sraQuantity} SRA for ${item.btcAmount} BTC`)}${field('Counterparty',item.counterpartyId)}${field('BTC destination',item.destinationAddress)}${item.btcTransactionId?field('BTC transaction',item.btcTransactionId):''}</div>${['PREPARED','BTC_RECEIPT_PENDING'].includes(item.state)?`<form data-btc-receipt-form data-trade-id="${esc(item.id)}"><label><span>BTC transaction ID</span><input name="transactionId" required pattern="[a-fA-F0-9]{64}" placeholder="64-character transaction ID"></label><button type="submit" ${btc.bitcoinRpcConfigured?'':'disabled'}>Verify BTC receipt</button><span data-btc-result></span></form>`:''}</article>`).join('') || '<p>No SRA/BTC treasury trades have been prepared.</p>';
    const btcPanel = `<div style="border-top:1px solid #292929;margin-top:20px;padding-top:18px"><h3>SRA/BTC · Platform Retained Bitcoin</h3><div class="admin-record-grid">${field('Pair',btc.pair||'SRA/BTC')}${field('Trade execution',btc.tradeExecution||'PREPARATION_ONLY')}${field('Counterparty connection',btc.liveCounterpartyConnected?'CONNECTED':'AWAITING CONNECTION')}${field('Bitcoin node',btc.bitcoinRpcConfigured?'CONFIGURED':'NOT CONFIGURED')}${field('Wallet setup deposit','0 BTC')}</div><p>Register a dedicated SRA-controlled receiving address. This records no private key or recovery phrase. A trade remains a prepared record until a real counterparty and both settlement legs are verified.</p><form data-btc-wallet-form><div class="admin-record-grid"><label><span>Wallet label</span><input name="label" required placeholder="SRA Bitcoin Treasury"></label><label><span>Bitcoin mainnet receiving address</span><input name="address" required autocomplete="off" placeholder="bc1…"></label></div><button type="submit">Register SRA BTC Address</button><span data-btc-result></span></form>${btcWalletRows}<h4>Prepare SRA/BTC Terms</h4><form data-btc-trade-form><div class="admin-record-grid"><label><span>SRA listing</span><select name="listingId" required>${listingOptions}</select></label><label><span>Treasury BTC wallet</span><select name="walletId" required>${walletOptions}</select></label><label><span>Counterparty reference</span><input name="counterpartyId" required></label><label><span>SRA quantity</span><input name="sraQuantity" type="number" min="0.00000001" step="0.00000001" required></label><label><span>BTC amount</span><input name="btcAmount" type="number" min="0.00000001" step="0.00000001" required></label><label><span>Terms expire</span><input name="expiresAt" type="datetime-local" required></label></div><button type="submit" ${walletOptions&&listingOptions?'':'disabled'}>Prepare Trade Terms</button><span data-btc-result></span></form>${btcTrades}</div>`;
    return card('Treasury Wallets','SRA HOLDINGS & SERVICING',`<div class="admin-record-grid">${field('Wallets',String(wallets.length))}${field('Crypto activity records',String(activity.length))}${field('Retained financing records',String(list(data.records.financedPositions).length))}</div><p style="color:#9a9a9a;margin:12px 0">SRA records the confirmed settlement, retains the resulting financed position, and services the originating obligation. Any later holder exchange, chain movement, or conversion takes place outside the SRA settlement workflow.</p>${btcPanel}`);
  }

  async function btcSubmit(workspace, form, endpoint, body) {
    const result=form.querySelector('[data-btc-result]') || form.closest('article')?.querySelector('[data-btc-result]');
    const button=form.querySelector('button[type="submit"]');
    if(button)button.disabled=true;
    if(result)result.textContent='Recording…';
    try { await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); await render(workspace); }
    catch(error) { if(result)result.textContent=error.message; if(button)button.disabled=false; }
  }

  async function refreshLiveUsdcStatus(workspace) {
    const root=controls(workspace),balance=root?.querySelector('[data-stellar-usdc-balance] strong'),anchor=root?.querySelector('[data-stellar-sep24-status] strong');
    try{const status=await request('/api/settlement-rails/stellar-usdc/status');if(balance)balance.textContent=status.treasury?.balance||'0';if(anchor){const sep24=status.sep24||{};anchor.textContent=sep24.ready?`${sep24.anchorDomain||'Configured'} · ${sep24.assetCode||'USDC'}`:'Not configured';}}catch(error){if(balance)balance.textContent='Unavailable';if(anchor)anchor.textContent=error.message;}
  }

  async function conversionAction(workspace,action,conversionId,button) {
    const root=controls(workspace),result=root?.querySelector(`[data-conversion-result="${CSS.escape(conversionId)}"]`),routes={initiate:['initiate-provider',{providerReference:root?.querySelector(`[data-provider-reference][data-conversion-id="${CSS.escape(conversionId)}"]`)?.value}], 'confirm-usd':['confirm-usd-funding',{usdFundingReference:root?.querySelector(`[data-usd-funding-reference][data-conversion-id="${CSS.escape(conversionId)}"]`)?.value}], 'confirm-usdc':['confirm-usdc-receipt',{stellarTransactionId:root?.querySelector(`[data-stellar-transaction][data-conversion-id="${CSS.escape(conversionId)}"]`)?.value}],reconcile:['reconcile-on-chain',{}],reclassify:['reclassify-reserve',{}]};
    const [suffix,body]=routes[action]||[];if(!suffix)return;
    button.disabled=true;if(result)result.textContent='Recording governed conversion stage…';
    try{await request(`/api/platform-treasury/usdc-conversions/${encodeURIComponent(conversionId)}/${suffix}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await render(workspace);}
    catch(error){if(result)result.textContent=error.message;button.disabled=false;}
  }

  async function authorizeConversion(workspace, form) {
    const result=form.querySelector('[data-usdc-conversion-result]'),button=form.querySelector('button[type="submit"]');button.disabled=true;if(result)result.textContent='Authorizing conversion…';
    try{const values=new FormData(form);await request('/api/platform-treasury/usdc-conversions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profileId:values.get('profileId'),amount:Number(values.get('amount')),provider:values.get('provider'),destinationNetwork:'STELLAR',confirmLiveConversion:values.get('confirmLiveConversion')==='on'})});await render(workspace);}
    catch(error){if(result)result.textContent=error.message;button.disabled=false;}
  }

  async function authorizeCctp(workspace,form){const result=form.querySelector('[data-cctp-authorize-result]'),button=form.querySelector('button[type="submit"]');button.disabled=true;if(result)result.textContent='Authorizing CCTP transfer…';try{const values=new FormData(form);await request('/api/platform-treasury/cctp/transfers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:values.get('amount'),destinationNetwork:values.get('destinationNetwork'),destinationAddress:values.get('destinationAddress'),confirmNetworkTransfer:values.get('confirmNetworkTransfer')==='on',idempotencyKey:`ADMIN-CCTP-${Date.now()}`})});await render(workspace);}catch(error){if(result)result.textContent=error.message;button.disabled=false;}}

  async function cctpAction(workspace,action,transferId,button){const root=controls(workspace),result=root?.querySelector(`[data-cctp-result="${CSS.escape(transferId)}"]`),routes={burn:['burn',{confirmSourceBurn:true}],attest:['attest',{}],mint:['mint',{confirmDestinationMint:true}],reconcile:['reconcile',{}]};const[suffix,body]=routes[action]||[];if(!suffix)return;button.disabled=true;if(result)result.textContent='Recording CCTP stage…';try{const updated=await request(`/api/platform-treasury/cctp/transfers/${encodeURIComponent(transferId)}/${suffix}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(action==='attest'&&updated.attestationStatus!=='complete'){result.textContent='Circle attestation is still pending.';button.disabled=false;return;}await render(workspace);}catch(error){if(result)result.textContent=error.message;button.disabled=false;}}

  function renderLedger(data) {
    return card('Treasury Ledger','CURRENT',`<div class="admin-record-grid">${field('Accounts',String(list(data.records.ledgerAccounts).length))}${field('Entries',String(list(data.records.ledgerEntries).length))}${field('Accounting periods',String(list(data.records.accountingPeriods).length))}</div>`);
  }

  function renderReports(data) {
    return card('Treasury Reports','CURRENT',`<div class="admin-record-grid">${field('Statement snapshots',String(list(data.records.financialStatementSnapshots).length))}${field('Treasury statements',String(list(data.records.treasuryStatements).length))}${field('Forecasts',String(list(data.records.treasuryForecasts).length))}${field('Exceptions',String(list(data.records.treasuryExceptions).length))}</div>`);
  }

  async function recognizeCanonicalInstrument(workspace, data) {
    const instrument = canonicalInstrument(data);
    if (!instrument || instrument.deposited) return;
    const button = controls(workspace)?.querySelector('[data-treasury-recognize-instrument]');
    const result = controls(workspace)?.querySelector('[data-treasury-recognition-result]');
    if (button) button.disabled = true;
    if (result) result.textContent = 'Posting canonical instrument into Treasury…';
    try {
      await request('/api/admin/treasury/funding-instrument-deposits/approve', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
          approval:'APPROVE', instrumentId:instrument.instrumentId, faceValueUsd:instrument.faceValueUsd,
          termMonths:instrument.termMonths || 36, depositReference:`ADMIN-TREASURY-RECOGNITION-${Date.now()}`,
        }),
      });
      if (result) result.textContent = 'Canonical instrument recognized in Treasury.';
      client()?.refresh?.('treasury-instrument-recognized');
      await render(workspace);
    } catch (error) {
      if (result) result.textContent = error.message;
      if (button) button.disabled = false;
    }
  }

  async function render(workspace) {
    clear(workspace);
    const root = controls(workspace); if (!root) return;
    const placeholder = document.createElement('section');
    placeholder.className = 'admin-record-card';
    placeholder.dataset.treasuryWorkstationCard = 'true';
    placeholder.innerHTML = '<header><strong>Treasury Workstation</strong><em>READING</em></header><p>Reading current Treasury state…</p>';
    root.prepend(placeholder);
    try {
      const tab = workspace.dataset.activeTab || 'Overview';
      const data = await load(tab, false);
      if (!placeholder.isConnected) return;
      let markup;
      if (tab === 'Overview') markup = renderOverview(data);
      else if (tab === 'Commercial Instruments') markup = renderCommercial(data);
      else if (tab === 'Cash Position') markup = renderCash(data);
      else if (tab === 'Available Financing') markup = renderFinancing(data,false);
      else if (tab === 'Funding Capacity') markup = renderFinancing(data,true);
      else if (tab === 'Journal Entries') markup = renderJournal(data);
      else if (tab === 'Treasury Wallets') markup = renderWallets(data);
      else if (tab === 'Ledger') markup = renderLedger(data);
      else markup = renderReports(data);
      placeholder.outerHTML = markup;
      const current = root.querySelector('[data-treasury-workstation-card]');
      current?.querySelector('[data-treasury-recognize-instrument]')?.addEventListener('click', () => void recognizeCanonicalInstrument(workspace, data));
      current?.querySelector('[data-usdc-conversion-form]')?.addEventListener('submit',(event)=>{event.preventDefault();void authorizeConversion(workspace,event.currentTarget);});
      current?.querySelectorAll('[data-conversion-action]').forEach((button)=>button.addEventListener('click',()=>void conversionAction(workspace,button.dataset.conversionAction,button.dataset.conversionId,button)));
      current?.querySelector('[data-cctp-transfer-form]')?.addEventListener('submit',(event)=>{event.preventDefault();void authorizeCctp(workspace,event.currentTarget);});
      current?.querySelectorAll('[data-cctp-action]').forEach((button)=>button.addEventListener('click',()=>void cctpAction(workspace,button.dataset.cctpAction,button.dataset.cctpTransferId,button)));
      current?.querySelector('[data-btc-wallet-form]')?.addEventListener('submit',(event)=>{event.preventDefault();const values=new FormData(event.currentTarget);void btcSubmit(workspace,event.currentTarget,'/api/platform-treasury/btc-route/wallets',{label:values.get('label'),address:values.get('address')});});
      current?.querySelector('[data-btc-trade-form]')?.addEventListener('submit',(event)=>{event.preventDefault();const values=new FormData(event.currentTarget);void btcSubmit(workspace,event.currentTarget,'/api/platform-treasury/btc-route/trades',{listingId:values.get('listingId'),walletId:values.get('walletId'),counterpartyId:values.get('counterpartyId'),sraQuantity:values.get('sraQuantity'),btcAmount:values.get('btcAmount'),expiresAt:new Date(values.get('expiresAt')).toISOString()});});
      current?.querySelectorAll('[data-btc-receipt-form]').forEach((form)=>form.addEventListener('submit',(event)=>{event.preventDefault();const values=new FormData(form);void btcSubmit(workspace,form,`/api/platform-treasury/btc-route/trades/${encodeURIComponent(form.dataset.tradeId)}/verify-btc`,{transactionId:values.get('transactionId')});}));
      current?.querySelectorAll('[data-btc-wallet-validate]').forEach((button)=>button.addEventListener('click',async()=>{button.disabled=true;try{await request(`/api/platform-treasury/btc-route/wallets/${encodeURIComponent(button.dataset.btcWalletValidate)}/validate`,{method:'POST'});await render(workspace);}catch(error){button.textContent=error.message;button.disabled=false;}}));
      current?.querySelectorAll('[data-btc-wallet-retire]').forEach((button)=>button.addEventListener('click',async()=>{button.disabled=true;try{await request(`/api/platform-treasury/btc-route/wallets/${encodeURIComponent(button.dataset.btcWalletRetire)}/retire`,{method:'POST'});await render(workspace);}catch(error){button.textContent=error.message;button.disabled=false;}}));
    } catch (error) {
      placeholder.innerHTML = `<header><strong>Treasury Workstation</strong><em>UNAVAILABLE</em></header><p>${esc(error.message)}</p>`;
    }
  }

  function mount(workspace) {
    if (!workspace || mounted.has(workspace)) return;
    mounted.add(workspace);
    workspace.addEventListener('click', (event) => {
      if (event.target.closest('[data-admin-tab]')) queueMicrotask(() => void render(workspace));
    });
  }

  window.mountAdminTreasuryWorkstation = mount;
})();
