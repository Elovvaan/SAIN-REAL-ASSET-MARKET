import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import * as StellarSdk from '@stellar/stellar-sdk';
import { createApp } from '../app.js';
import { StellarTransferService } from '../services/stellar-transfer-service.js';

const environment = {
  SRA_ANCHOR_MODE: 'TESTNET',
  SRA_ANCHOR_HOME_DOMAIN: 'www.sainrealasset.com',
  SRA_ANCHOR_PUBLIC_URL: 'https://anchor-testnet.sainrealasset.com',
  SRA_ANCHOR_SIGNING_KEY: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  SRA_ANCHOR_USDC_ISSUER: 'GBBD47IF6WT2KWRFHPGZ7MM3QMS6SVUF6OM7BDBJAZQXH74BPLQ5V7FS',
  SRA_ANCHOR_CALLBACK_API_KEY: 'test-anchor-callback-key-at-least-32-bytes',
  STELLAR_DISTRIBUTOR_PUBLIC_KEY: 'GCUZ6YLL5RQBTYLTTQLPCM73C5XAIUGK2TIMWQH7HPSGWVS2KJ2F3CHS',
};

test('SRA publishes Anchor Platform discovery and status without secrets', async () => {
  const built = await createApp({ serveStatic:false, seedMarketplace:false, environment });
  const status = await request(built.app).get('/api/anchor-platform/status').expect(200);
  assert.equal(status.body.provider, 'SRA_ANCHOR_PLATFORM');
  assert.equal(status.body.mode, 'TESTNET');
  assert.equal(status.body.ready, true);
  assert.equal(status.body.callbackKeyConfigured, true);
  assert.equal(JSON.stringify(status.body).includes(environment.SRA_ANCHOR_CALLBACK_API_KEY), false);
  const toml = await request(built.app).get('/.well-known/stellar.toml').expect(200);
  assert.match(toml.text, /TRANSFER_SERVER_SEP0024="https:\/\/anchor-testnet\.sainrealasset\.com\/sep24"/);
  assert.match(toml.text, /code="USDC"/);
});

test('Anchor Platform event callback is authenticated, idempotent, and persisted', async () => {
  const built = await createApp({ serveStatic:false, seedMarketplace:false, environment });
  const payload = { type:'TRANSACTION_STATUS_CHANGED', sep:'24', transaction:{ id:'sep24-1', kind:'deposit', status:'pending_anchor', amount_in:'25', asset_in:'iso4217:USD', asset_out:'stellar:USDC' } };
  await request(built.app).post('/api/anchor-platform/events').send(payload).expect(401);
  const first = await request(built.app).post('/api/anchor-platform/events').set('X-Api-Key', environment.SRA_ANCHOR_CALLBACK_API_KEY).send(payload).expect(202);
  const second = await request(built.app).post('/api/anchor-platform/events').set('X-Api-Key', environment.SRA_ANCHOR_CALLBACK_API_KEY).send(payload).expect(202);
  assert.equal(first.body.anchorEventId, second.body.anchorEventId);
  const records = await request(built.app).get('/api/anchor-platform/events').set('X-Api-Key', environment.SRA_ANCHOR_CALLBACK_API_KEY).expect(200);
  assert.equal(records.body.records.length, 1);
  assert.equal(records.body.records[0].anchorTransactionId, 'sep24-1');
});

test('stellar.toml publishes issued SRA code and issuer without optional anchor configuration', async () => {
  const issuer=StellarSdk.Keypair.random().publicKey();
  const built=await createApp({ serveStatic:false, seedMarketplace:false, environment:{ STELLAR_NETWORK:'PUBLIC' } });
  await built.persistentDomain.put('COIN_POSITION','CP-SRA',{coinPositionId:'CP-SRA',assetIdentity:'SRA_COIN',symbol:'SRA'},{audit:false});
  await built.persistentDomain.put('ON_CHAIN_ASSET','OCA-SRA',{assetId:'OCA-SRA',sourcePositionId:'CP-SRA',asset:'SRAUSD',assetAddress:`SRAUSD:${issuer}`,issuedSupply:'20',state:'ISSUED',network:'STELLAR'},{audit:false});
  await built.persistentDomain.put('ON_CHAIN_ASSET','OCA-DRAFT',{assetId:'OCA-DRAFT',sourcePositionId:'CP-SRA',asset:'DRAFT',assetAddress:`DRAFT:${issuer}`,issuedSupply:'0',state:'CREATED',network:'STELLAR'},{audit:false});
  const response=await request(built.app).get('/.well-known/stellar.toml').expect(200);
  assert.equal(response.headers['access-control-allow-origin'],'*');
  assert.match(response.text,/\[DOCUMENTATION\]/);
  assert.match(response.text, new RegExp(`code="SRAUSD"\\nissuer="${issuer}"`));
  assert.match(response.text, new RegExp(`ACCOUNTS=\\["${issuer}"\\]`));
  assert.match(response.text,/is_asset_anchored=false/);
  assert.doesNotMatch(response.text,/code="DRAFT"|code="USDC"/);
  assert.match(response.text,/Public Global Stellar Network/);
  assert.match(response.text,/image="https:\/\/www\.sainrealasset\.com\/brand-logo\.png"/);
  await request(built.app).get('/brand-logo.png').expect(200);
});

test('issuer home domain link is signed by the actual issuer and is idempotent', async () => {
  const issuer=StellarSdk.Keypair.random();
  const distributor=StellarSdk.Keypair.random();
  let submitted;
  const adapter=new StellarTransferService({environment:{STELLAR_NETWORK:'TESTNET'}});
  let account=new StellarSdk.Account(issuer.publicKey(),'42');
  adapter.ensure=()=>({issuer,distributor,server:{
    async loadAccount(){return account;},
    async submitTransaction(tx){submitted=tx;return {hash:'domain-tx',ledger:99};},
  }});
  const linked=await adapter.linkIssuerHomeDomain(`SRAUSD:${issuer.publicKey()}`);
  assert.equal(linked.transactionId,'domain-tx');
  assert.equal(submitted.operations[0].homeDomain,'www.sainrealasset.com');
  assert.ok(submitted.signatures.length);
  account=new StellarSdk.Account(issuer.publicKey(),'43');
  account.home_domain='www.sainrealasset.com';
  assert.equal((await adapter.linkIssuerHomeDomain(`SRAUSD:${issuer.publicKey()}`)).state,'ALREADY_LINKED');
  await assert.rejects(adapter.linkIssuerHomeDomain(`SRAUSD:${distributor.publicKey()}`),/does not control/);
});
