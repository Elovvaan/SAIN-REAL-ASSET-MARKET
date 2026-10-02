import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { PublicSraCoinDiscoveryService } from '../services/public-sra-coin-discovery-service.js';
import { createPublicSraCoinDiscoveryRouter } from '../routes/public-sra-coin-discovery-router.js';

test('public profile reports linked SRA records without exposing ownership or unrelated assets', async () => {
  const records = {
    COIN_POSITION:[{ coinPositionId:'CP-1', assetIdentity:'SRA_COIN', symbol:'SRA', ownerId:'PRIVATE-OWNER' }],
    SRA_INSTRUMENT:[{ instrumentId:'INS-1', coinPositionId:'CP-1' }],
    MARKETPLACE_LISTING:[{ listingId:'LIST-1', instrumentId:'INS-1', state:'PUBLISHED', quantity:20, unitPrice:1, currency:'USD' },{ listingId:'LIST-2', instrumentId:'OTHER', state:'PUBLISHED' }],
    ON_CHAIN_ASSET:[{ assetId:'CHAIN-1', instrumentId:'INS-1', network:'STELLAR', asset:'SRAUSD', assetAddress:'SRAUSD:GISSUER', sourceAccount:'PRIVATE-DISTRIBUTOR', issuedSupply:'20', state:'ISSUED' },{ assetId:'CHAIN-2', instrumentId:'OTHER', network:'STELLAR', assetAddress:'OTHER:GISSUER', state:'ISSUED' }],
    ON_CHAIN_USDC_MARKET:[{ assetId:'CHAIN-1', state:'ACTIVE' }],
    ON_CHAIN_NATIVE_MARKET:[],
  };
  const domain = { async hydrate() {}, list(type) { return records[type] || []; } };
  const service = await new PublicSraCoinDiscoveryService(domain).initialize();
  const app = express().use('/api/public/coin', createPublicSraCoinDiscoveryRouter(service));
  const response = await request(app).get('/api/public/coin/sra').expect(200);
  assert.equal(response.headers['access-control-allow-origin'], '*');
  assert.equal(response.body.symbol, 'SRA');
  assert.deepEqual(response.body.listings.map((item) => item.listingId), ['LIST-1']);
  assert.deepEqual(response.body.onChainRepresentations.map((item) => item.assetId), ['CHAIN-1']);
  assert.deepEqual(response.body.onChainRepresentations[0].markets, [{ pair:'SRA/USDC', state:'ACTIVE' }]);
  assert.doesNotMatch(JSON.stringify(response.body), /PRIVATE-OWNER|PRIVATE-DISTRIBUTOR|CHAIN-2/);
});

test('the public coin identity stays available before any issuance or listing', () => {
  const service = new PublicSraCoinDiscoveryService({ list:() => [] });
  assert.deepEqual(service.profile().onChainRepresentations, []);
  assert.deepEqual(service.profile().listings, []);
});


test('direct and legacy SRA source positions are discoverable without an instrument link', async () => {
  const records = {
    SRA_COIN_POSITION:[{positionId:'LEGACY',unit:'SRA/USD'}],
    COIN_POSITION:[{coinPositionId:'DIRECT',symbol:'SRA'}],
    ON_CHAIN_ASSET:[
      {assetId:'DIRECT-ASSET',sourcePositionId:'DIRECT',network:'STELLAR',asset:'SRA',assetAddress:'SRA:GISSUER',state:'ISSUED',issuedSupply:'20'},
      {assetId:'LEGACY-ASSET',sourcePositionId:'LEGACY',network:'STELLAR',asset:'SRA2',assetAddress:'SRA2:GISSUER',state:'ISSUED',issuedSupply:'30'},
      {assetId:'UNRELATED',sourcePositionId:'OTHER',network:'STELLAR',asset:'OTHER',assetAddress:'OTHER:GISSUER',state:'ISSUED',issuedSupply:'30'},
    ],
  };
  let hydrated;
  const service = await new PublicSraCoinDiscoveryService({hydrate:async(types)=>{hydrated=types;},list:(type)=>records[type]||[]}).initialize();
  assert.ok(hydrated.includes('SRA_COIN_POSITION'));
  assert.deepEqual(service.profile().onChainRepresentations.map((item)=>item.assetId),['DIRECT-ASSET','LEGACY-ASSET']);
});


test('explicit public ledger identity is verified without inventing an internal source position', async () => {
  const { Keypair } = await import('@stellar/stellar-sdk');
  const issuer = Keypair.random().publicKey();
  const environment = {SRA_STELLAR_PUBLIC_ASSETS:`SRA:${issuer}`,STELLAR_NETWORK:'PUBLIC'};
  const fetchImpl = async () => ({ok:true,json:async()=>({_embedded:{records:[{asset_code:'SRA',asset_issuer:issuer,balances:{authorized:'20',unauthorized:'2'},liquidity_pools_amount:'3'}]}})});
  const service = await new PublicSraCoinDiscoveryService({hydrate:async()=>{},list:()=>[]},{environment,fetchImpl}).initialize();
  const asset = service.profile().onChainRepresentations[0];
  assert.equal(asset.issuedSupply,'25.0000000');
  assert.equal(asset.instrumentId,null);
  assert.equal(asset.identitySource,'CONFIGURED_LEDGER_IDENTITY');
  const wrong = await new PublicSraCoinDiscoveryService({hydrate:async()=>{},list:()=>[]},{environment,fetchImpl:async()=>({ok:true,json:async()=>({_embedded:{records:[{asset_code:'SRA',asset_issuer:Keypair.random().publicKey(),balances:{authorized:'20'}}]}})})}).initialize();
  assert.deepEqual(wrong.profile().onChainRepresentations,[]);
});
