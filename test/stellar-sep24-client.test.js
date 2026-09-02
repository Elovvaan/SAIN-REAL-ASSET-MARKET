import test from 'node:test';
import assert from 'node:assert/strict';
import { StellarSep24ClientService } from '../services/stellar-sep24-client-service.js';

test('SEP-24 client discovers only configured HTTPS anchor services', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://anchor.example/.well-known/stellar.toml');
    return { ok:true, async text() { return 'TRANSFER_SERVER_SEP0024="https://anchor.example/sep24"\nWEB_AUTH_ENDPOINT="https://anchor.example/auth"\nSIGNING_KEY="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"'; } };
  };
  const service = new StellarSep24ClientService({ stellar:{}, environment:{ STELLAR_SEP24_ANCHOR_DOMAIN:'anchor.example', STELLAR_SEP24_MODE:'SANDBOX' }, fetchImpl });
  assert.deepEqual(service.status(), { configured:true, anchorDomain:'anchor.example', standard:'SEP-24', asset:'USDC', mode:'SANDBOX' });
  const discovered = await service.discover();
  assert.equal(discovered.transferServer, 'https://anchor.example/sep24');
  assert.equal(discovered.webAuthEndpoint, 'https://anchor.example/auth');
});

test('SEP-24 client rejects local or non-HTTPS anchor configuration', async () => {
  assert.throws(() => new StellarSep24ClientService({ stellar:{}, environment:{ STELLAR_SEP24_ANCHOR_DOMAIN:'localhost' } }).status(), /public DNS hostname/);
  const service = new StellarSep24ClientService({ stellar:{}, environment:{ STELLAR_SEP24_ANCHOR_DOMAIN:'anchor.example' }, fetchImpl:async()=>({ ok:true, async text(){return 'TRANSFER_SERVER_SEP0024="http://anchor.example/sep24"\nWEB_AUTH_ENDPOINT="https://anchor.example/auth"\nSIGNING_KEY="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"';} }) });
  await assert.rejects(() => service.discover(), /must use HTTPS/);
});
