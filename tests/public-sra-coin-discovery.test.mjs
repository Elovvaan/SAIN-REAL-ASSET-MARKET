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
