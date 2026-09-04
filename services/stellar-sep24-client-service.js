import * as StellarSdk from '@stellar/stellar-sdk';

function text(value) { return String(value ?? '').trim(); }

function mode(environment) {
  const value = text(environment.STELLAR_SEP24_MODE || 'SANDBOX').toUpperCase();
  if (!['SANDBOX', 'PRODUCTION'].includes(value)) throw new Error('STELLAR_SEP24_MODE must be SANDBOX or PRODUCTION.');
  return value;
}

function moneyGramKeypair(environment, field) {
  const secret = text(environment[field]);
  if (!secret) return null;
  try { return StellarSdk.Keypair.fromSecret(secret); }
  catch { throw new Error(`${field} is not a valid Stellar secret key.`); }
}

function custodialUserId(value) {
  const raw = text(value);
  if (!/^\d+$/.test(raw) || raw === '0' || BigInt(raw) > 18_446_744_073_709_551_615n) {
    throw new Error('MoneyGram custodial authentication requires a positive 64-bit user ID.');
  }
  return raw;
}

function configuredDomain(environment) {
  const domain = text(environment.STELLAR_SEP24_ANCHOR_DOMAIN).toLowerCase();
  if (!domain) return null;
  if (!/^(?=.{1,253}$)(?!localhost$)(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(domain)) throw new Error('STELLAR_SEP24_ANCHOR_DOMAIN must be a public DNS hostname.');
  return domain;
}

function tomlValue(source, key) {
  const match = String(source || '').match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']\\s*$`, 'mi'));
  return match?.[1] || null;
}

function httpsEndpoint(value, field) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`${field} must use HTTPS.`);
  return url.toString().replace(/\/$/, '');
}

async function jsonResponse(response, context) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${context} failed with HTTP ${response.status}.`);
  return payload;
}

export class StellarSep24ClientService {
  constructor({ stellar, environment = process.env, fetchImpl = fetch } = {}) {
    this.stellar = stellar;
    this.environment = environment;
    this.fetch = fetchImpl;
  }

  status() {
    const anchorDomain = configuredDomain(this.environment);
    const environmentMode = mode(this.environment);
    const auth = moneyGramKeypair(this.environment, 'MONEYGRAM_AUTH_SECRET');
    const funds = moneyGramKeypair(this.environment, 'MONEYGRAM_FUNDS_SECRET');
    const credentialsConfigured = Boolean(auth && funds);
    return {
      configured:Boolean(anchorDomain),
      ready:Boolean(anchorDomain) && credentialsConfigured,
      credentialsConfigured,
      anchorDomain,
      standard:'SEP-24',
      asset:'USDC',
      mode:environmentMode,
      network:environmentMode === 'SANDBOX' ? 'TESTNET' : 'PUBLIC',
      authAccount:auth?.publicKey() || null,
      fundsAccount:funds?.publicKey() || null,
    };
  }

  async discover() {
    const anchorDomain = configuredDomain(this.environment);
    if (!anchorDomain) throw new Error('STELLAR_SEP24_ANCHOR_DOMAIN is not configured.');
    const response = await this.fetch(`https://${anchorDomain}/.well-known/stellar.toml`, { headers:{ Accept:'text/plain' } });
    if (!response.ok) throw new Error(`Anchor stellar.toml discovery failed with HTTP ${response.status}.`);
    const source = await response.text();
    const transferServer = httpsEndpoint(tomlValue(source, 'TRANSFER_SERVER_SEP0024'), 'TRANSFER_SERVER_SEP0024');
    const webAuthEndpoint = httpsEndpoint(tomlValue(source, 'WEB_AUTH_ENDPOINT'), 'WEB_AUTH_ENDPOINT');
    const signingKey = text(tomlValue(source, 'SIGNING_KEY'));
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(signingKey)) throw new Error('Anchor SIGNING_KEY is missing or invalid.');
    return { anchorDomain, transferServer, webAuthEndpoint, signingKey };
  }

  async authenticate(discovery, input = {}) {
    const environmentMode = mode(this.environment);
    const authKeypair = moneyGramKeypair(this.environment, 'MONEYGRAM_AUTH_SECRET');
    if (!authKeypair) throw new Error('MONEYGRAM_AUTH_SECRET is required for MoneyGram SEP-10 authentication.');
    const account = authKeypair.publicKey();
    const userId = custodialUserId(input.userId || this.environment.MONEYGRAM_USER_ID);
    const passphrase = environmentMode === 'SANDBOX' ? StellarSdk.Networks.TESTNET : StellarSdk.Networks.PUBLIC;
    const challengeUrl = new URL(discovery.webAuthEndpoint);
    challengeUrl.searchParams.set('account', account);
    challengeUrl.searchParams.set('home_domain', discovery.anchorDomain);
    challengeUrl.searchParams.set('memo', userId);
    const challenge = await jsonResponse(await this.fetch(challengeUrl, { headers:{ Accept:'application/json' } }), 'SEP-10 challenge');
    const xdr = text(challenge.transaction || challenge.transaction_xdr);
    if (!xdr) throw new Error('SEP-10 challenge did not return a transaction.');
    StellarSdk.WebAuth.readChallengeTx(xdr, discovery.signingKey, passphrase, discovery.anchorDomain, new URL(discovery.webAuthEndpoint).hostname);
    const transaction = StellarSdk.TransactionBuilder.fromXDR(xdr, passphrase);
    transaction.sign(authKeypair);
    const authResponse = await jsonResponse(await this.fetch(discovery.webAuthEndpoint, { method:'POST', headers:{ 'Content-Type':'application/json', Accept:'application/json' }, body:JSON.stringify({ transaction:transaction.toXDR() }) }), 'SEP-10 authentication');
    if (!text(authResponse.token)) throw new Error('SEP-10 authentication did not return a token.');
    return { token:authResponse.token, account, userId };
  }

  async info(discovery, token) {
    return jsonResponse(await this.fetch(`${discovery.transferServer}/info`, { headers:{ Authorization:`Bearer ${token}`, Accept:'application/json' } }), 'SEP-24 anchor info');
  }

  async startInteractive(input = {}) {
    const discovery = await this.discover();
    const { token, userId } = await this.authenticate(discovery, input);
    const funds = moneyGramKeypair(this.environment, 'MONEYGRAM_FUNDS_SECRET');
    if (!funds) throw new Error('MONEYGRAM_FUNDS_SECRET is required for MoneyGram SEP-24 transactions.');
    const account = funds.publicKey();
    const info = await this.info(discovery, token);
    const kind = text(input.kind || 'deposit').toLowerCase();
    if (!['deposit', 'withdraw'].includes(kind)) throw new Error('SEP-24 kind must be deposit or withdraw.');
    const capability = info?.[kind]?.USDC;
    if (!capability?.enabled) throw new Error(`Configured SEP-24 anchor does not report ${kind} support for USDC.`);
    const body = new URLSearchParams({ asset_code:'USDC', account });
    if (input.amount != null) body.set('amount', text(input.amount));
    const result = await jsonResponse(await this.fetch(`${discovery.transferServer}/transactions/${kind}/interactive`, { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/x-www-form-urlencoded', Accept:'application/json' }, body }), `SEP-24 ${kind}`);
    const interactiveUrl = httpsEndpoint(result.url, 'SEP-24 interactive URL');
    return { anchorDomain:discovery.anchorDomain, kind, asset:'USDC', account, authAccount:moneyGramKeypair(this.environment, 'MONEYGRAM_AUTH_SECRET').publicKey(), userId, transactionId:text(result.id) || null, interactiveUrl };
  }

  async getTransaction(input = {}) {
    const transactionId = text(input.transactionId);
    if (!transactionId) throw new Error('MoneyGram transaction ID is required.');
    const discovery = await this.discover();
    const { token } = await this.authenticate(discovery, input);
    const url = new URL(`${discovery.transferServer}/transaction`);
    url.searchParams.set('id', transactionId);
    const result = await jsonResponse(await this.fetch(url, {
      headers:{ Authorization:`Bearer ${token}`, Accept:'application/json' },
    }), 'SEP-24 transaction status');
    return { anchorDomain:discovery.anchorDomain, transaction:result.transaction || result };
  }
}
