import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import * as StellarSdk from '@stellar/stellar-sdk';
import { PublicSraExchangeService } from '../services/public-sra-exchange-service.js';
import { createPublicSraExchangeRouter } from '../routes/public-sra-exchange-router.js';

class Domain {
  constructor(records = {}) { this.records = records; }
  list(type) { return this.records[type] || []; }
  get(type, id) { return this.list(type).find((item) => [item.id, item.quoteId, item.exchangeId].includes(id)) || null; }
  async put(type, id, payload) { this.records[type] ||= []; this.records[type].push({ ...payload, id }); return payload; }
  async atomicPut(items) { for (const item of items) await this.put(item.type, item.id, item.payload); }
}

function fixture() {
  const holder = StellarSdk.Keypair.random();
  const issuer = StellarSdk.Keypair.random();
  const usdcIssuer = StellarSdk.Keypair.random();
  const account = new StellarSdk.Account(holder.publicKey(), '100');
  account.balances = [
    { asset_type: 'credit_alphanum12', asset_code: 'SRAUSD', asset_issuer: issuer.publicKey(), balance: '250.0000000' },
    { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: usdcIssuer.publicKey(), balance: '0.0000000' },
  ];
  const submitted = [];
  const server = {
    async loadAccount(address) { assert.equal(address, holder.publicKey()); return account; },
    strictSendPaths() { return { async call() { return { records: [{ destination_amount: '19.7500000', path: [] }] }; } }; },
    async submitTransaction(transaction) { submitted.push(transaction); return { hash: transaction.hash().toString('hex'), ledger: 123 }; },
  };
  const domain = new Domain({
    ON_CHAIN_ASSET: [{ assetId: 'OCA-1', network: 'STELLAR', asset: 'SRAUSD', assetAddress: `SRAUSD:${issuer.publicKey()}`, issuedSupply: '1000', state: 'ISSUED' }],
    ON_CHAIN_USDC_MARKET: [{ marketId: 'OCUSM-1', assetId: 'OCA-1', state: 'ACTIVE', updatedAt: '2026-09-21T00:00:00.000Z' }],
    ON_CHAIN_NATIVE_MARKET: [{ marketId: 'OCNM-1', assetId: 'OCA-1', state: 'TWO_SIDED', updatedAt: '2026-09-21T00:00:00.000Z' }],
  });
  const environment = { STELLAR_NETWORK: 'TESTNET', STELLAR_USDC_ISSUER: usdcIssuer.publicKey() };
  return { holder, issuer, usdcIssuer, account, server, submitted, domain, environment };
}

test('public holder exchange requires no SRA account and uses the holder signature', async () => {
  const data = fixture();
  const service = new PublicSraExchangeService(data);
  const status = service.status();
  assert.equal(status.accountRequired, false);
  assert.equal(status.walletControlsExchange, true);
  assert.equal(status.availableMarkets.length, 1);
  assert.equal(status.availableRoutes.length, 2);
  assert.deepEqual(status.availableRoutes.map((route) => route.receiveAsset).sort(), ['USDC','XLM']);

  const quote = await service.quote({ quoteId: 'PHQ-1', assetId: 'OCA-1', sourceAddress: data.holder.publicKey(), sellAmount: '20' });
  const transaction = StellarSdk.TransactionBuilder.fromXDR(quote.unsignedXdr, quote.networkPassphrase);
  transaction.sign(data.holder);
  const result = await service.submit(quote, transaction.toXDR());
  assert.equal(result.state, 'CONFIRMED');
  assert.equal(result.sourceAddress, data.holder.publicKey());
  assert.equal(result.destinationAddress, data.holder.publicKey());
  assert.equal(data.submitted.length, 1);
});

test('public holder can select the active Stellar SRA/XLM route', async () => {
  const data = fixture();
  const service = new PublicSraExchangeService(data);
  const quote = await service.quote({ quoteId:'PHQ-XLM', assetId:'OCA-1', network:'STELLAR', receiveAsset:'XLM', sourceAddress:data.holder.publicKey(), sellAmount:'20' });
  assert.equal(quote.pair, 'SRA/XLM');
  assert.equal(quote.receiveAsset, 'XLM');
  assert.equal(quote.receiveAssetAddress, 'native:XLM');
  assert.equal(quote.expectedReceiveAmount, '19.7500000');
  const transaction = StellarSdk.TransactionBuilder.fromXDR(quote.unsignedXdr, quote.networkPassphrase);
  transaction.sign(data.holder);
  const result = await service.submit(quote, transaction.toXDR());
  assert.equal(result.state, 'CONFIRMED');
  assert.equal(result.receiveAsset, 'XLM');
  assert.equal(result.minimumReceiveAmount, quote.minimumReceiveAmount);
});

test('public holder exchange rejects a transaction signed by another wallet', async () => {
  const data = fixture();
  const service = new PublicSraExchangeService(data);
  const quote = await service.quote({ quoteId: 'PHQ-2', assetId: 'OCA-1', sourceAddress: data.holder.publicKey(), sellAmount: '20' });
  const transaction = StellarSdk.TransactionBuilder.fromXDR(quote.unsignedXdr, quote.networkPassphrase);
  transaction.sign(StellarSdk.Keypair.random());
  assert.throws(() => service.verifySignedTransaction(quote, transaction.toXDR()), /wallet holding the SRA has not signed/i);
});

test('public exchange routes work without an authenticated SRA session', async () => {
  const data = fixture();
  const service = new PublicSraExchangeService(data);
  const app = express();
  app.use(express.json());
  app.use('/api/public-exchange', createPublicSraExchangeRouter(service));
  const status = await request(app).get('/api/public-exchange/status').expect(200);
  assert.equal(status.body.accountRequired, false);
  const quote = await request(app).post('/api/public-exchange/quotes').send({ assetId: 'OCA-1', sourceAddress: data.holder.publicKey(), sellAmount: '20' }).expect(201);
  assert.equal(quote.body.sourceAddress, data.holder.publicKey());
  assert.equal(data.domain.list('PUBLIC_HOLDER_EXCHANGE_QUOTE').length, 1);
});

test('public exchange page keeps documentary settlement separate', async () => {
  const page = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../public/exchange-settled-sra.html', import.meta.url), 'utf8'));
  assert.match(page, /No SRA account is required/);
  assert.match(page, /Receiving network/);
  assert.match(page, /Asset to receive/);
  assert.match(page, /note or documentary settlement package/i);
  assert.match(page, /institutional presentment/i);
});
