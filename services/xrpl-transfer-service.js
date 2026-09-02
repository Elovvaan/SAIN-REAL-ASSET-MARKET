import { Client, Wallet, dropsToXrp, isValidClassicAddress, xrpToDrops } from 'xrpl';

const NETWORK = 'XRPL';
const NATIVE_ASSET = 'XRP';
const ASSET_TYPE = 'ON_CHAIN_ASSET';
const DEFAULT_TRUST_LIMIT = '1000000000000000';

function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).toUpperCase(); }
function positiveAmount(value, decimals = 6, field = 'amount') {
  const raw = text(value);
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(raw) || Number(raw) <= 0) throw new Error(`${field} must be a positive amount with no more than ${decimals} decimal places.`);
  return raw;
}
function walletFromSeed(secret, name) {
  const seed = text(secret);
  if (!seed) throw new Error(`${name} is required.`);
  try { return Wallet.fromSeed(seed); }
  catch { throw new Error(`${name} is not a valid XRPL secret.`); }
}
function issuedCurrencyCode(value) {
  const code = upper(value);
  if (!/^[A-Z0-9]{1,20}$/.test(code)) throw new Error('XRPL issued currency code must contain 1 to 20 letters or numbers.');
  if (code === NATIVE_ASSET) throw new Error('XRP is reserved for the native XRP Ledger asset.');
  if (code.length === 3) return code;
  return Buffer.from(code, 'ascii').toString('hex').toUpperCase().padEnd(40, '0');
}
function transactionOutcome(result, transactionId) {
  const transactionResult = result?.result?.meta?.TransactionResult || result?.result?.meta?.transaction_result || null;
  const validated = Boolean(result?.result?.validated);
  const state = validated && transactionResult === 'tesSUCCESS' ? 'CONFIRMED' : 'FAILED';
  return { state, transactionId, validated, ledgerIndex: result?.result?.ledger_index ?? null, transactionResult };
}
function issuedValue(value) { return Number(value?.value || 0); }
function xrpValue(value) { return typeof value === 'string' ? Number(dropsToXrp(value)) : 0; }
function affectedNodes(meta) { return meta?.AffectedNodes || meta?.affected_nodes || []; }
function nodeBody(wrapper) { return wrapper?.CreatedNode || wrapper?.ModifiedNode || wrapper?.DeletedNode || null; }

export class XrplTransferService {
  constructor(options = {}) {
    this.domain = options.domain || null;
    this.environment = options.environment || process.env;
    this.rpcUrl = text(this.environment.XRPL_RPC_URL);
    this.distributorSecret = text(this.environment.XRPL_SECRET);
    this.issuerSecret = text(this.environment.XRPL_ISSUER_SECRET);
    this.expectedDistributorAddress = text(this.environment.XRPL_ADDRESS);
    this.expectedIssuerAddress = text(this.environment.XRPL_ISSUER_ADDRESS);
    this.client = null;
    this.distributor = null;
    this.issuer = null;
    this.issuerSettingsEnsured = false;
  }

  status() {
    const rpcConfigured = Boolean(this.rpcUrl);
    const distributorConfigured = Boolean(this.distributorSecret);
    const issuerConfigured = Boolean(this.issuerSecret);
    return {
      network: NETWORK,
      nativeAsset: NATIVE_ASSET,
      rpcConfigured,
      distributorConfigured,
      signerConfigured: distributorConfigured,
      issuerConfigured,
      configured: rpcConfigured && distributorConfigured,
      ready: false,
      issuanceConfigured: rpcConfigured && distributorConfigured && issuerConfigured,
      capabilities: issuerConfigured ? ['CREATE_ASSET', 'ISSUE_ASSET', 'TRANSFER_NATIVE', 'TRANSFER_ASSET', 'CREATE_DEX_OFFER'] : ['TRANSFER_NATIVE'],
      assets: [NATIVE_ASSET],
      signingMode: 'LOCAL_XRPL_WALLETS',
    };
  }

  async ensureClient() {
    if (!this.rpcUrl) {
      const error = new Error('XRPL_RPC_URL is required.');
      error.code = 'ON_CHAIN_NETWORK_NOT_READY';
      throw error;
    }
    if (!this.client) this.client = new Client(this.rpcUrl);
    if (!this.client.isConnected()) await this.client.connect();
    return this.client;
  }

  async ensure() {
    const client = await this.ensureClient();
    if (!this.distributor) this.distributor = walletFromSeed(this.distributorSecret, 'XRPL_SECRET');
    if (this.expectedDistributorAddress && this.distributor.address !== this.expectedDistributorAddress) throw new Error('XRPL_ADDRESS does not match the account derived from XRPL_SECRET.');
    return { client, wallet: this.distributor, distributor: this.distributor };
  }

  async ensureIssuance() {
    const { client, distributor } = await this.ensure();
    if (!this.issuer) this.issuer = walletFromSeed(this.issuerSecret, 'XRPL_ISSUER_SECRET');
    if (this.expectedIssuerAddress && this.issuer.address !== this.expectedIssuerAddress) throw new Error('XRPL_ISSUER_ADDRESS does not match the account derived from XRPL_ISSUER_SECRET.');
    if (this.issuer.address === distributor.address) throw new Error('XRPL issuer and distribution accounts must be different.');
    return { client, distributor, issuer: this.issuer };
  }

  async accountInfo(wallet) {
    const client = await this.ensureClient();
    return client.request({ command: 'account_info', account: wallet.address, ledger_index: 'validated' });
  }

  async health() {
    const configuration = this.status();
    if (!configuration.configured) return { ...configuration, reachable: false };
    try {
      const { distributor } = await this.ensure();
      const distributorResult = await this.accountInfo(distributor);
      let issuerAddress = null;
      let issuerReachable = false;
      let issuerError;
      if (configuration.issuerConfigured) {
        try {
          const { issuer } = await this.ensureIssuance();
          issuerAddress = issuer.address;
          await this.accountInfo(issuer);
          issuerReachable = true;
        } catch (error) { issuerError = String(error?.message || error); }
      }
      return {
        ...configuration,
        ready: true,
        reachable: true,
        address: distributor.address,
        distributorAddress: distributor.address,
        issuerAddress,
        issuerReachable,
        issuanceReady: configuration.issuerConfigured && issuerReachable,
        validatedLedgerIndex: distributorResult?.result?.ledger_index ?? null,
        issuerError,
      };
    } catch (error) {
      return { ...configuration, ready: false, reachable: false, error: String(error?.message || error) };
    }
  }

  assetRecord(asset) {
    const normalized = upper(asset);
    if (normalized === NATIVE_ASSET) return { native: true, asset: NATIVE_ASSET };
    const record = (this.domain?.list?.(ASSET_TYPE) || []).find((candidate) => {
      if (upper(candidate.network) !== NETWORK) return false;
      return [candidate.asset, candidate.symbol, candidate.instrumentId, candidate.assetId, candidate.assetAddress].map(upper).filter(Boolean).includes(normalized);
    });
    if (!record) {
      const error = new Error(`Asset ${normalized} has not been created on ${NETWORK}.`);
      error.code = 'ON_CHAIN_ASSET_NOT_CREATED';
      throw error;
    }
    return record;
  }

  issuedAsset(record) {
    const [currency, issuer] = text(record.assetAddress).split(':');
    if (!currency || !isValidClassicAddress(issuer)) throw new Error('XRPL asset address must be CURRENCY:ISSUER.');
    return { currency, issuer };
  }

  async submit(transaction, wallet) {
    const client = await this.ensureClient();
    const prepared = await client.autofill(transaction);
    const signed = wallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);
    return { transactionId: signed.hash, confirmation: transactionOutcome(result, signed.hash), result };
  }

  async ensureIssuerSettings() {
    if (this.issuerSettingsEnsured) return null;
    const { issuer } = await this.ensureIssuance();
    const info = await this.accountInfo(issuer);
    if (info?.result?.account_flags?.defaultRipple) {
      this.issuerSettingsEnsured = true;
      return null;
    }
    const submitted = await this.submit({ TransactionType: 'AccountSet', Account: issuer.address, SetFlag: 8 }, issuer);
    if (submitted.confirmation.state !== 'CONFIRMED') throw new Error('XRPL issuer DefaultRipple setting was not confirmed.');
    this.issuerSettingsEnsured = true;
    return submitted.transactionId;
  }

  async createAsset(input = {}) {
    const { issuer, distributor } = await this.ensureIssuance();
    const displayCode = upper(input.asset || input.symbol);
    const currency = issuedCurrencyCode(displayCode);
    return {
      network: NETWORK,
      asset: displayCode,
      symbol: displayCode,
      assetAddress: `${currency}:${issuer.address}`,
      issuerAddress: issuer.address,
      distributionAddress: distributor.address,
      decimals: 6,
      transactionId: null,
      state: 'CREATED',
    };
  }

  async distributorHasTrustline(asset) {
    const { client, distributor } = await this.ensureIssuance();
    const response = await client.request({ command: 'account_lines', account: distributor.address, peer: asset.issuer, ledger_index: 'validated' });
    return (response?.result?.lines || []).some((line) => upper(line.currency) === upper(asset.currency));
  }

  async ensureDistributorTrustline(asset, limit = DEFAULT_TRUST_LIMIT) {
    if (await this.distributorHasTrustline(asset)) return null;
    const { distributor } = await this.ensureIssuance();
    const submitted = await this.submit({
      TransactionType: 'TrustSet',
      Account: distributor.address,
      LimitAmount: { currency: asset.currency, issuer: asset.issuer, value: positiveAmount(limit, 15, 'trustlineLimit') },
    }, distributor);
    if (submitted.confirmation.state !== 'CONFIRMED') throw new Error('XRPL distributor trustline was not confirmed.');
    return submitted.transactionId;
  }

  async issueAsset(record, input = {}) {
    const { issuer, distributor } = await this.ensureIssuance();
    const asset = this.issuedAsset(record);
    if (asset.issuer !== issuer.address) throw new Error('Configured XRPL issuer does not match the asset issuer.');
    const issueAmount = positiveAmount(input.amount, 6);
    const issuerSettingsTransactionId = await this.ensureIssuerSettings();
    const trustlineTransactionId = await this.ensureDistributorTrustline(asset, input.trustlineLimit || DEFAULT_TRUST_LIMIT);
    const submitted = await this.submit({
      TransactionType: 'Payment',
      Account: issuer.address,
      Destination: distributor.address,
      Amount: { ...asset, value: issueAmount },
    }, issuer);
    return {
      network: NETWORK,
      assetAddress: record.assetAddress,
      sourceAccount: issuer.address,
      destinationAddress: distributor.address,
      amount: issueAmount,
      issuerSettingsTransactionId,
      trustlineTransactionId,
      transactionId: submitted.transactionId,
      confirmation: submitted.confirmation,
      state: submitted.confirmation.state,
    };
  }

  async destinationCanReceive(destination, asset) {
    const client = await this.ensureClient();
    const response = await client.request({ command: 'account_lines', account: destination, peer: asset.issuer, ledger_index: 'validated' });
    return (response?.result?.lines || []).some((line) => upper(line.currency) === upper(asset.currency));
  }

  async confirm(transactionId) {
    const hash = text(transactionId);
    if (!hash) throw new Error('transactionId is required.');
    const client = await this.ensureClient();
    try {
      const response = await client.request({ command: 'tx', transaction: hash });
      const result = response?.result || {};
      const transactionResult = result?.meta?.TransactionResult || result?.meta?.transaction_result || null;
      const validated = Boolean(result.validated);
      return { state: validated ? (transactionResult === 'tesSUCCESS' ? 'CONFIRMED' : 'FAILED') : 'PENDING', transactionId: hash, validated, ledgerIndex: result.ledger_index ?? null, transactionResult };
    } catch (error) {
      if (error?.data?.error === 'txnNotFound') return { state: 'PENDING', transactionId: hash, validated: false };
      throw error;
    }
  }

  async send(input = {}) {
    const destinationAddress = text(input.destinationAddress);
    if (!isValidClassicAddress(destinationAddress)) throw new Error('destinationAddress is not a valid XRP Ledger classic address.');
    const transferAmount = positiveAmount(input.amount, 6);
    const { distributor } = await this.ensure();
    const record = this.assetRecord(input.asset);
    let paymentAmount;
    if (record.native) paymentAmount = xrpToDrops(transferAmount);
    else {
      const asset = this.issuedAsset(record);
      if (!(await this.destinationCanReceive(destinationAddress, asset))) {
        const error = new Error('Destination XRPL account does not have a trustline for this SRA-issued asset.');
        error.code = 'XRPL_DESTINATION_TRUSTLINE_REQUIRED';
        throw error;
      }
      paymentAmount = { ...asset, value: transferAmount };
    }
    const submitted = await this.submit({ TransactionType: 'Payment', Account: distributor.address, Destination: destinationAddress, Amount: paymentAmount }, distributor);
    return {
      transferId: input.transferId,
      network: NETWORK,
      asset: upper(input.asset),
      amount: transferAmount,
      fromAddress: distributor.address,
      destinationAddress,
      transactionId: submitted.transactionId,
      confirmation: submitted.confirmation,
      state: submitted.confirmation.state,
    };
  }

  async createOffer(record, input = {}) {
    const { distributor } = await this.ensureIssuance();
    const asset = this.issuedAsset(record);
    const sellAmount = positiveAmount(input.sellAmount, 6, 'sellAmount');
    const buyAmountXrp = positiveAmount(input.buyAmountXrp ?? input.buyAmountNative, 6, 'buyAmountXrp');
    const submitted = await this.submit({
      TransactionType: 'OfferCreate',
      Account: distributor.address,
      TakerGets: { ...asset, value: sellAmount },
      TakerPays: xrpToDrops(buyAmountXrp),
    }, distributor);
    return {
      network: NETWORK,
      market: `${record.asset || record.symbol}/XRP`,
      side: 'SELL_SRA_ASSET_FOR_XRP',
      sellAmount,
      buyAmountXrp,
      offerSequence: submitted.result?.result?.tx_json?.Sequence ?? submitted.result?.result?.Sequence ?? null,
      offerOwnerAddress: distributor.address,
      transactionId: submitted.transactionId,
      confirmation: submitted.confirmation,
      state: submitted.confirmation.state,
    };
  }

  async offerIdentity(record, offer) {
    const { client, distributor } = await this.ensureIssuance();
    const response = await client.request({ command: 'tx', transaction: text(offer.transactionId), binary: false });
    const result = response?.result || {};
    const transaction = result.tx_json || result.tx || result;
    const sequence = Number(offer.offerSequence || transaction.Sequence);
    if (!Number.isInteger(sequence) || sequence <= 0) throw new Error('XRPL offer sequence could not be resolved from the confirmed transaction.');
    const created = affectedNodes(result.meta).map((wrapper) => ({ wrapper, node:nodeBody(wrapper) }))
      .find(({ wrapper, node }) => wrapper.CreatedNode && node?.LedgerEntryType === 'Offer' && Number(node?.NewFields?.Sequence) === sequence);
    return { client, distributor, sequence, ledgerEntryIndex:offer.offerLedgerIndex || created?.node?.LedgerIndex || null, createdLedgerIndex:offer.confirmation?.ledgerIndex || result.ledger_index || null };
  }

  async openOffers(client, address) {
    const records = [];
    let marker;
    do {
      const response = await client.request({ command:'account_offers', account:address, ledger_index:'validated', limit:400, ...(marker ? { marker } : {}) });
      records.push(...(response?.result?.offers || []));
      marker = response?.result?.marker;
    } while (marker && records.length < 4000);
    return records;
  }

  async reconcileOffer(record, offer) {
    const identity = await this.offerIdentity(record, offer);
    const asset = this.issuedAsset(record);
    const open = (await this.openOffers(identity.client, identity.distributor.address)).find((candidate) => Number(candidate.seq) === identity.sequence);
    const originalSell = Number(offer.sellAmount || 0);
    const originalBuy = Number(offer.buyAmountXrp || 0);
    const priorState = upper(offer.marketState || offer.state);
    const previouslyCancelled = !open && priorState === 'CANCELLED';
    const remainingSell = open ? issuedValue(open.taker_gets) : (previouslyCancelled ? Number(offer.remainingSellAmount || 0) : 0);
    const remainingBuy = open ? xrpValue(open.taker_pays) : (previouslyCancelled ? Number(offer.remainingBuyAmountXrp || 0) : 0);
    const filledSell = previouslyCancelled ? Number(offer.filledSellAmount || 0) : Math.max(0, originalSell - remainingSell);
    const xrpReceived = previouslyCancelled ? Number(offer.xrpReceived || 0) : Math.max(0, originalBuy - remainingBuy);
    const marketState = open ? (filledSell > 0 ? 'PARTIALLY_FILLED' : 'OPEN') : (priorState === 'CANCELLED' ? 'CANCELLED' : 'FILLED');
    return {
      offerSequence:identity.sequence,
      offerLedgerIndex:identity.ledgerEntryIndex,
      offerOwnerAddress:identity.distributor.address,
      issuedCurrency:asset.currency,
      marketState,
      state:marketState,
      originalSellAmount:String(originalSell),
      originalBuyAmountXrp:String(originalBuy),
      filledSellAmount:String(filledSell),
      xrpReceived:String(xrpReceived),
      remainingSellAmount:String(remainingSell),
      remainingBuyAmountXrp:String(remainingBuy),
      lastReconciledLedger:open?.ledger_index || null,
      reconciledAt:new Date().toISOString(),
    };
  }

  async cancelOffer(record, offer) {
    const current = await this.reconcileOffer(record, offer);
    if (!['OPEN','PARTIALLY_FILLED'].includes(current.marketState)) throw new Error(`XRPL offer is ${current.marketState} and cannot be cancelled.`);
    const { distributor } = await this.ensureIssuance();
    const submitted = await this.submit({ TransactionType:'OfferCancel', Account:distributor.address, OfferSequence:current.offerSequence }, distributor);
    return { ...current, marketState:'CANCELLED', state:'CANCELLED', cancelTransactionId:submitted.transactionId, cancelConfirmation:submitted.confirmation, cancelledAt:new Date().toISOString() };
  }
}

export { issuedCurrencyCode as xrplIssuedCurrencyCode };
