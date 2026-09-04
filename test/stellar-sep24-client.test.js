import test from 'node:test';
import assert from 'node:assert/strict';
import * as StellarSdk from '@stellar/stellar-sdk';
import { StellarSep24ClientService } from '../services/stellar-sep24-client-service.js';

test('SEP-24 client discovers only configured HTTPS anchor services', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://anchor.example/.well-known/stellar.toml');
    return { ok:true, async text() { return 'TRANSFER_SERVER_SEP0024="https://anchor.example/sep24"\nWEB_AUTH_ENDPOINT="https://anchor.example/auth"\nSIGNING_KEY="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"'; } };
  };
  const auth = StellarSdk.Keypair.random();
  const funds = StellarSdk.Keypair.random();
  const service = new StellarSep24ClientService({ stellar:{}, environment:{ STELLAR_SEP24_ANCHOR_DOMAIN:'anchor.example', STELLAR_SEP24_MODE:'SANDBOX', MONEYGRAM_AUTH_SECRET:auth.secret(), MONEYGRAM_FUNDS_SECRET:funds.secret() }, fetchImpl });
  assert.deepEqual(service.status(), { configured:true, ready:true, credentialsConfigured:true, anchorDomain:'anchor.example', standard:'SEP-24', asset:'USDC', mode:'SANDBOX', network:'TESTNET', authAccount:auth.publicKey(), fundsAccount:funds.publicKey() });
  const discovered = await service.discover();
  assert.equal(discovered.transferServer, 'https://anchor.example/sep24');
  assert.equal(discovered.webAuthEndpoint, 'https://anchor.example/auth');
});

test('SEP-24 sandbox credentials are isolated from the primary Stellar adapter', () => {
  const auth = StellarSdk.Keypair.random();
  const funds = StellarSdk.Keypair.random();
  const service = new StellarSep24ClientService({
    stellar:{ ensure(){ throw new Error('Primary Stellar adapter must not be used.'); } },
    environment:{ STELLAR_SEP24_ANCHOR_DOMAIN:'extmgxanchor.moneygram.com', STELLAR_SEP24_MODE:'SANDBOX', MONEYGRAM_AUTH_SECRET:auth.secret(), MONEYGRAM_FUNDS_SECRET:funds.secret() },
  });
  const status = service.status();
  assert.equal(status.network, 'TESTNET');
  assert.equal(status.authAccount, auth.publicKey());
  assert.equal(status.fundsAccount, funds.publicKey());
  assert.equal(status.ready, true);
});

test('SEP-24 reports configured anchor separately from missing sandbox credentials', () => {
  const service = new StellarSep24ClientService({ stellar:{}, environment:{ STELLAR_SEP24_ANCHOR_DOMAIN:'extmgxanchor.moneygram.com', STELLAR_SEP24_MODE:'SANDBOX' } });
  const status = service.status();
  assert.equal(status.configured, true);
  assert.equal(status.credentialsConfigured, false);
  assert.equal(status.ready, false);
  assert.equal(status.network, 'TESTNET');
});

test('SEP-10 sandbox authentication signs with the dedicated auth key and custodial user memo', async () => {
  const anchor = StellarSdk.Keypair.random();
  const auth = StellarSdk.Keypair.random();
  const funds = StellarSdk.Keypair.random();
  const discovery = { anchorDomain:'anchor.example', webAuthEndpoint:'https://anchor.example/auth', signingKey:anchor.publicKey() };
  const challenge = StellarSdk.WebAuth.buildChallengeTx(anchor, auth.publicKey(), discovery.anchorDomain, 300, StellarSdk.Networks.TESTNET, 'anchor.example', '42');
  let submitted = false;
  const fetchImpl = async (url, options = {}) => {
    if (!options.method) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('account'), auth.publicKey());
      assert.equal(parsed.searchParams.get('memo'), '42');
      return { ok:true, async json(){ return { transaction:challenge }; } };
    }
    const transaction = StellarSdk.TransactionBuilder.fromXDR(JSON.parse(options.body).transaction, StellarSdk.Networks.TESTNET);
    assert.equal(StellarSdk.WebAuth.verifyTxSignedBy(transaction, auth.publicKey()), true);
    submitted = true;
    return { ok:true, async json(){ return { token:'sandbox-jwt' }; } };
  };
  const service = new StellarSep24ClientService({ stellar:{}, environment:{ STELLAR_SEP24_MODE:'SANDBOX', MONEYGRAM_AUTH_SECRET:auth.secret(), MONEYGRAM_FUNDS_SECRET:funds.secret() }, fetchImpl });
  const result = await service.authenticate(discovery, { userId:'42' });
  assert.equal(result.account, auth.publicKey());
  assert.equal(result.userId, '42');
  assert.equal(submitted, true);
});

test('SEP-24 client rejects local or non-HTTPS anchor configuration', async () => {
  assert.throws(() => new StellarSep24ClientService({ stellar:{}, environment:{ STELLAR_SEP24_ANCHOR_DOMAIN:'localhost' } }).status(), /public DNS hostname/);
  const service = new StellarSep24ClientService({ stellar:{}, environment:{ STELLAR_SEP24_ANCHOR_DOMAIN:'anchor.example' }, fetchImpl:async()=>({ ok:true, async text(){return 'TRANSFER_SERVER_SEP0024="http://anchor.example/sep24"\nWEB_AUTH_ENDPOINT="https://anchor.example/auth"\nSIGNING_KEY="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"';} }) });
  await assert.rejects(() => service.discover(), /must use HTTPS/);
});
