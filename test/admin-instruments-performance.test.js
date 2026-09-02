import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { InstrumentRepresentationApprovalService } from '../services/instrument-representation-approval-service.js';

const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('instrument approval assessment scans Coin Positions once per response',()=>{
  const calls=new Map();
  const records={
    SRA_INSTRUMENT:[{instrumentId:'INS-1',state:'ISSUED'},{instrumentId:'INS-2',state:'APPROVED'}],
    COIN_POSITION:[{coinPositionId:'CP-1',instrumentId:'INS-1'},{coinPositionId:'CP-2',instrumentId:'INS-2'}],
    INSTRUMENT_REPRESENTATION_APPROVAL:[],
  };
  const domain={
    list(type){calls.set(type,(calls.get(type)||0)+1);return structuredClone(records[type]||[]);},
    get(type,id){return structuredClone((records[type]||[]).find((record)=>(record.instrumentId||record.id)===id)||null);},
  };
  const service=new InstrumentRepresentationApprovalService(domain);
  const assessments=service.evaluateMany(records.SRA_INSTRUMENT);
  assert.equal(assessments.length,2);
  assert.equal(calls.get('COIN_POSITION'),1);
  assert.deepEqual(assessments.map((item)=>item.linkedCoinPositionIds),[['CP-1'],['CP-2']]);
});

test('on-chain status is scoped, bounded, and cached',()=>{
  const router=read('routes/on-chain-projection-router.js');
  assert.match(router,/NETWORK_HEALTH_TIMEOUT_MS = 4_000/);
  assert.match(router,/NETWORK_HEALTH_TTL_MS = 15_000/);
  assert.match(router,/req\.query\.networks/);
  assert.match(router,/Promise\.race/);
  assert.match(router,/router\.get\('\/market-offers'/);
});

test('Instruments avoids global cache invalidation and per-asset offer fan-out',()=>{
  const ui=read('public/admin/admin-on-chain-issuance-controls.js');
  assert.doesNotMatch(ui,/approval-status\?_=/);
  assert.match(ui,/status\?networks=STELLAR,XRPL/);
  assert.match(ui,/\/api\/on-chain\/market-offers/);
  assert.doesNotMatch(ui,/assets\.map\(async \(asset\)/);
});
