import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectValueAccountService } from '../services/direct-value-account-service.js';
import { EventMarketService } from '../services/event-market-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor(){this.records=new Map();}
  key(type,id){return `${type}:${id}`;}
  get(type,id){return structuredClone(this.records.get(this.key(type,id))||null);}
  list(type){return [...this.records.entries()].filter(([key])=>key.startsWith(`${type}:`)).map(([,value])=>structuredClone(value));}
  async put(type,id,payload){this.records.set(this.key(type,id),structuredClone(payload));return payload;}
  async atomicPut(changes){for(const change of changes)await this.put(change.type,change.id,change.payload);return changes.map((x)=>x.payload);}
}

async function fixture(){
  const domain=new Domain(),accounts=new DirectValueAccountService(domain);await accounts.initialize();const events=new EventMarketService(domain,accounts);
  for(const [participant,universal,amount] of [['P-YES','UA-YES',100],['P-NO','UA-NO',100]]){await domain.put(RECORD_TYPES.SRA_TRANSACTION,`F-${participant}`,{transactionId:`F-${participant}`,transactionType:'LOAN_FINANCING_AUTHORIZATION',borrowerParticipantId:participant,amount,currency:'USD',state:'POSTED'});await accounts.creditAuthorizedFunding({financingTransactionId:`F-${participant}`,universalAccountId:universal},'ADMIN');}
  return {domain,accounts,events,yesAccount:(await accounts.ensureAccount({participantId:'P-YES',universalAccountId:'UA-YES'})).directValueAccountId,noAccount:(await accounts.ensureAccount({participantId:'P-NO',universalAccountId:'UA-NO'})).directValueAccountId};
}

test('event market requires governed listing, confirmed execution, evidence resolution, and exact settlement',async()=>{
  const {accounts,events,yesAccount,noAccount}=await fixture();
  await assert.rejects(()=>events.create({question:'Denied?',scheduledOpenAt:'2026-09-01',scheduledCloseAt:'2026-09-02',expectedResolutionAt:'2026-09-02',resolutionSource:'OFFICIAL',resolutionRule:'Final result.'},{participantId:'P',capacity:'UNIVERSAL'}),/not available/);
  const market=await events.create({question:'Will the home team win?',category:'SPORTS',scheduledOpenAt:'2026-09-01T12:00:00Z',scheduledCloseAt:'2026-09-02T12:00:00Z',expectedResolutionAt:'2026-09-02T16:00:00Z',resolutionSource:'OFFICIAL LEAGUE RESULT',resolutionRule:'YES only when the official final result records a home-team win.'},{participantId:'MP',capacity:'MARKET_PROFESSIONAL'});
  await events.review(market.eventMarketId,{decision:'APPROVE',rulebookReference:'RULE-1',eligibilityReference:'ELIG-1',decisionRationale:'Question and authority are definite.'},{participantId:'IO',capacity:'INSTITUTIONAL_OPERATOR'});
  await events.listOnVenue(market.eventMarketId,{venueId:'AUTHORIZED-TEST-VENUE',venueMarketId:'GAME-1',listingReference:'LIST-1',yesPrice:.6,noPrice:.4},{participantId:'ADMIN',capacity:'PLATFORM_ADMIN'});
  await assert.rejects(()=>events.buy(market.eventMarketId,{directValueAccountId:yesAccount,outcome:'YES',quantity:10,executionPrice:.6,venueExecutionReference:'X-0'},{participantId:'P-YES',capacity:'UNIVERSAL'}),/venue adapter/);
  const yes=await events.buy(market.eventMarketId,{directValueAccountId:yesAccount,outcome:'YES',quantity:10,executionPrice:.6,fee:.1,venueExecutionReference:'X-YES'},{participantId:'P-YES',capacity:'UNIVERSAL',venueConfirmed:true});
  await events.buy(market.eventMarketId,{directValueAccountId:noAccount,outcome:'NO',quantity:10,executionPrice:.4,venueExecutionReference:'X-NO'},{participantId:'P-NO',capacity:'UNIVERSAL',venueConfirmed:true});
  assert.equal(yes.position.maximumSettlementValue,10);assert.equal(accounts.getPosition(yesAccount,'SRA-USD').available,93.9);
  await events.control(market.eventMarketId,{action:'CLOSE',reason:'Event concluded.',evidenceReference:'CLOCK-1'},{participantId:'IO',capacity:'INSTITUTIONAL_OPERATOR'});
  await events.resolve(market.eventMarketId,{outcome:'YES',sourceResultReference:'OFFICIAL-RESULT-1',resolutionEvidenceReference:'HASH-1',determinationRationale:'The official final result records the home team as winner.'},{participantId:'ADMIN',capacity:'PLATFORM_ADMIN'});
  const settled=await events.settle(market.eventMarketId,{settlementReference:'SETTLE-1'},{participantId:'ADMIN',capacity:'PLATFORM_ADMIN'});
  assert.equal(settled.settlement.totalPayout,10);assert.equal(accounts.getPosition(yesAccount,'SRA-USD').available,103.9);assert.equal(accounts.getPosition(noAccount,'SRA-USD').available,96);
  const retry=await events.settle(market.eventMarketId,{settlementReference:'SETTLE-1'},{participantId:'ADMIN',capacity:'PLATFORM_ADMIN'});assert.equal(retry.created,false);
});
