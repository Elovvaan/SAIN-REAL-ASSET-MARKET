import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ParticipationService } from '../services/participation-service.js';

test('issued on-chain supply projects into marketplace inventory with its live Stellar wallet balance', async () => {
  const records = {
    ON_CHAIN_ASSET:[{ assetId:'OCA-1', instrumentId:'INS-1', network:'STELLAR', asset:'SRAUSD', assetAddress:'SRAUSD:GISSUER', issuedSupply:'100000', lastIssuedAmount:'100000' }],
    ON_CHAIN_MARKET_OFFER:[],
    ON_CHAIN_USDC_MARKET:[],
  };
  const domain={ list:type=>records[type]||[] };
  const service=new ParticipationService({projects:[]},null,domain);
  const inventory=await service.listMarketInventory(async()=>({ account:'GDISTRIBUTOR', balance:'100000.0000000', available:'100000.0000000', sellingLiabilities:'0.0000000', trustline:true }));

  assert.equal(inventory.length,1);
  assert.equal(inventory[0].issuedSupply,'100000');
  assert.equal(inventory[0].wallet.account,'GDISTRIBUTOR');
  assert.equal(inventory[0].wallet.balance,'100000.0000000');
  assert.equal(inventory[0].marketState,'ISSUED_INVENTORY');
  assert.equal(inventory[0].participationState,'AVAILABLE_FOR_MARKET_FORMATION');
});

test('regular participant marketplace renders issued wallet inventory separately from live sell offers', () => {
  const ui=fs.readFileSync(new URL('../public/transaction-market-ui.js',import.meta.url),'utf8');
  assert.match(ui,/\/api\/participation\/market-inventory/);
  assert.match(ui,/Issued Stellar Wallet Inventory/);
  assert.match(ui,/wallet balance as an automatic sell order/);
});
