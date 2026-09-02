import test from 'node:test';
import assert from 'node:assert/strict';
import { InstrumentCoinPositionLinkageService } from '../services/instrument-coin-position-linkage-service.js';

class Domain {
  constructor(records={}) { this.records=new Map(Object.entries(records).flatMap(([type,rows])=>rows.map(row=>{const id=type==='SRA_INSTRUMENT'?row.instrumentId:type==='COIN_POSITION'?row.coinPositionId:row.approvalId||row.id;return [`${type}:${id}`,[type,row]];}))); }
  get(type,id){return structuredClone(this.records.get(`${type}:${id}`)?.[1]||null);}
  list(type){return [...this.records.values()].filter(([recordType])=>recordType===type).map(([,row])=>structuredClone(row));}
  async atomicPut(changes){for(const change of changes)this.records.set(`${change.type}:${change.id}`,[change.type,structuredClone(change.payload)]);return changes.map(change=>change.payload);}
}

function fixture(overrides={}) {
  const domain=new Domain({
    SRA_INSTRUMENT:[{instrumentId:'INS-1',state:'APPROVED',faceValueUsd:100,financialRecordId:'FR-1',...overrides.instrument}],
    COIN_POSITION:[{coinPositionId:'CP-1',state:'ACTIVE',symbol:'SRA',quantity:200,availableQuantity:150,financialRecordId:'FR-1',ownerId:'SRA_PLATFORM',restrictions:[],...overrides.position}],
    INSTRUMENT_REPRESENTATION_APPROVAL:[{id:'IRA-INS-1',approvalId:'IRA-INS-1',instrumentId:'INS-1',state:'APPROVED',linkedCoinPositionIds:[],...overrides.approval}],
  });
  return {domain,service:new InstrumentCoinPositionLinkageService(domain)};
}

test('links instrument, Coin Position, approval, and lifecycle event without changing balances',async()=>{
  const {domain,service}=fixture();
  const result=await service.link('INS-1','CP-1','ADMIN-1');
  assert.equal(result.changed,true);
  assert.equal(domain.get('SRA_INSTRUMENT','INS-1').coinPositionId,'CP-1');
  assert.equal(domain.get('COIN_POSITION','CP-1').instrumentId,'INS-1');
  assert.deepEqual(domain.get('INSTRUMENT_REPRESENTATION_APPROVAL','IRA-INS-1').linkedCoinPositionIds,['CP-1']);
  assert.equal(domain.get('COIN_POSITION','CP-1').availableQuantity,150);
  const event=domain.list('LIFECYCLE_EVENT')[0];
  assert.equal(event.eventType,'INSTRUMENT_COIN_POSITION_LINKED');
  assert.ok(event.payload.doesNot.includes('CHANGE_BALANCE'));
});

test('blocks missing representation approval and insufficient available quantity',()=>{
  const missing=fixture({approval:{state:'PENDING'}}).service.evaluate('INS-1','CP-1');
  assert.ok(missing.blockers.includes('REPRESENTATION_APPROVAL_REQUIRED'));
  const insufficient=fixture({position:{availableQuantity:50}}).service.evaluate('INS-1','CP-1');
  assert.ok(insufficient.blockers.includes('INSUFFICIENT_AVAILABLE_QUANTITY'));
});

test('requires recorded Coin Position authority',()=>{
  const {service}=fixture({position:{ownerId:null,participantId:null,coinAccountId:null}});
  assert.ok(service.evaluate('INS-1','CP-1').blockers.includes('COIN_POSITION_AUTHORITY_REQUIRED'));
});

test('blocks conflicting prior linkage',()=>{
  const {service}=fixture({position:{instrumentId:'INS-OTHER'}});
  assert.ok(service.evaluate('INS-1','CP-1').blockers.includes('COIN_POSITION_ALREADY_LINKED'));
});

test('existing complete linkage remains idempotent after available supply changes',async()=>{
  const {service}=fixture({
    instrument:{coinPositionId:'CP-1',linkedCoinPositionIds:['CP-1']},
    position:{instrumentId:'INS-1',linkedInstrumentId:'INS-1',availableQuantity:20},
    approval:{linkedCoinPositionIds:['CP-1']},
  });
  const result=await service.link('INS-1','CP-1','ADMIN-1');
  assert.equal(result.changed,false);
  assert.equal(result.assessment.alreadyLinked,true);
});
