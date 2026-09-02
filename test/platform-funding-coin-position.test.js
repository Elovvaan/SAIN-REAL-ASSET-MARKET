import test from 'node:test';
import assert from 'node:assert/strict';
import { TreasuryLedgerService } from '../services/treasury-ledger-service.js';
import { InstrumentCoinPositionLinkageService } from '../services/instrument-coin-position-linkage-service.js';
import {
  PlatformFundingInstrumentDepositService,
  CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,
  PLATFORM_COIN_ACCOUNT_ID,
  PLATFORM_COIN_POSITION_ID,
} from '../services/platform-funding-instrument-deposit-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  get(type,id) { return structuredClone(this.records.get(`${type}:${id}`) || null); }
  list(type) { const prefix=`${type}:`; return [...this.records].filter(([key])=>key.startsWith(prefix)).map(([,record])=>structuredClone(record)); }
  async put(type,id,payload) { this.records.set(`${type}:${id}`,structuredClone(payload)); return payload; }
  async atomicPut(changes) { for (const change of changes) await this.put(change.type,change.id,change.payload); return changes.map(change=>change.payload); }
}

async function setup() {
  const domain = new Domain();
  const timestamp = new Date().toISOString();
  await domain.put(RECORD_TYPES.SRA_INSTRUMENT,CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,{
    instrumentId:CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,
    instrumentPurpose:'PLATFORM_SELF_FINANCING',
    state:'ISSUED',
    principalQuantity:18_000_000,
    faceValueUsd:18_000_000,
    ownerId:'SRA_PLATFORM',
  });
  const treasury = new TreasuryLedgerService(domain);
  await treasury.initialize();
  await domain.put(RECORD_TYPES.LEDGER_ACCOUNT,'TRSY-1050-INSTRUMENT-USD',{accountId:'TRSY-1050-INSTRUMENT-USD',name:'Instrument',normalSide:'DEBIT',balance:0,totalDebits:0,totalCredits:0,state:'ACTIVE',createdAt:timestamp});
  return {domain,service:new PlatformFundingInstrumentDepositService(domain,treasury)};
}

test('canonical deposit creates one selectable platform Coin Position',async()=>{
  const {domain,service}=await setup();
  const result=await service.approve({instrumentId:CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,faceValueUsd:18_000_000,termMonths:36,depositReference:'TEST-DEPOSIT',approval:'APPROVE'},'ADMIN-1');
  assert.equal(result.coinAccount.coinAccountId,PLATFORM_COIN_ACCOUNT_ID);
  assert.equal(result.coinPosition.coinPositionId,PLATFORM_COIN_POSITION_ID);
  assert.equal(result.coinPosition.quantity,18_000_000);
  assert.equal(result.coinPosition.availableQuantity,18_000_000);
  assert.equal(result.coinPosition.sourceInstrumentId,CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID);
  assert.equal(result.coinPosition.instrumentId,undefined);
  assert.equal(domain.list(RECORD_TYPES.COIN_POSITION).length,1);
  await domain.put('INSTRUMENT_REPRESENTATION_APPROVAL',`IRA-${CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID}`,{
    approvalId:`IRA-${CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID}`,
    instrumentId:CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,
    state:'APPROVED',
    linkedCoinPositionIds:[],
  });
  const linkage=new InstrumentCoinPositionLinkageService(domain);
  assert.equal(linkage.read().positions.some((position)=>position.coinPositionId===PLATFORM_COIN_POSITION_ID),true);
  assert.deepEqual(linkage.evaluate(CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,PLATFORM_COIN_POSITION_ID).blockers,[]);
});

test('startup reconciliation restores the missing position without duplicating the deposit',async()=>{
  const {domain,service}=await setup();
  await service.approve({instrumentId:CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,faceValueUsd:18_000_000,termMonths:36,depositReference:'TEST-DEPOSIT',approval:'APPROVE'},'ADMIN-1');
  domain.records.delete(`${RECORD_TYPES.COIN_ACCOUNT}:${PLATFORM_COIN_ACCOUNT_ID}`);
  domain.records.delete(`${RECORD_TYPES.COIN_POSITION}:${PLATFORM_COIN_POSITION_ID}`);
  const restored=await service.ensureCoinPosition('SRA_TREASURY_SYSTEM');
  assert.equal(restored.created,true);
  assert.equal(restored.coinPosition.coinPositionId,PLATFORM_COIN_POSITION_ID);
  assert.equal(service.deposits().length,1);
  const again=await service.ensureCoinPosition('SRA_TREASURY_SYSTEM');
  assert.equal(again.created,false);
  assert.equal(domain.list(RECORD_TYPES.COIN_POSITION).length,1);
});
