import test from 'node:test';
import assert from 'node:assert/strict';
import { OpportunityInstrumentRepresentationService, opportunityInstrumentRepresentationIds } from '../services/opportunity-instrument-representation-service.js';
import { InstrumentCoinPositionLinkageService } from '../services/instrument-coin-position-linkage-service.js';
import { FundingInstrumentIssuanceService } from '../services/funding-instrument-issuance-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  get(type,id) { return structuredClone(this.records.get(`${type}:${id}`) || null); }
  list(type) { const prefix=`${type}:`; return [...this.records].filter(([key])=>key.startsWith(prefix)).map(([,record])=>structuredClone(record)); }
  async put(type,id,payload) { this.records.set(`${type}:${id}`,structuredClone(payload)); return payload; }
  async atomicPut(changes) { for (const change of changes) await this.put(change.type,change.id,change.payload); return changes.map((change)=>change.payload); }
  async hydrate() { return {}; }
}

async function addIssuedOpportunity(domain, { opportunityId, instrumentId, opportunityType, amount, assetId }) {
  await domain.put('FUNDING_OPPORTUNITY',opportunityId,{
    opportunityId,
    opportunityType,
    title:`${opportunityType} opportunity`,
    applicantParticipantId:`P-${opportunityId}`,
    relatedAssetIds:[assetId],
    currency:'USD',
    status:'INSTRUMENT_ISSUED',
    issuanceTransactionId:`TX-${instrumentId}`,
  });
  await domain.put('SRA_INSTRUMENT',instrumentId,{
    instrumentId,
    opportunityId,
    instrumentFamily:'ASSET_BACKED_NOTE',
    fundingModel:'ASSET_BACKED_FUNDING',
    issuerParticipantId:`P-${opportunityId}`,
    faceValue:amount,
    currency:'USD',
    canonicalVerifiedValueRecordId:`VVR-${opportunityId}`,
    issuanceTransactionId:`TX-${instrumentId}`,
    state:'ISSUED',
    status:'ACTIVE',
    issuanceStatus:'ISSUED',
    restrictions:[],
  });
}

test('issued opportunities across asset classes create distinct selectable Coin Positions',async()=>{
  const domain=new Domain();
  const cases=[
    {opportunityId:'FO-VEHICLE',instrumentId:'INS-VEHICLE',opportunityType:'VEHICLE_PURCHASE',amount:79_456.17,assetId:'VIN-1'},
    {opportunityId:'FO-HOME',instrumentId:'INS-HOME',opportunityType:'HOME_PURCHASE',amount:650_000,assetId:'PROPERTY-1'},
    {opportunityId:'FO-BUSINESS',instrumentId:'INS-BUSINESS',opportunityType:'BUSINESS_ACQUISITION',amount:4_600_000,assetId:'BUSINESS-1'},
  ];
  for(const item of cases) await addIssuedOpportunity(domain,item);
  const service=new OpportunityInstrumentRepresentationService(domain);
  const reconciled=await service.reconcile('ADMIN-1');
  assert.equal(reconciled.inspected,3);
  assert.equal(reconciled.created,3);
  assert.equal(domain.list('FINANCIAL_RECORD').length,3);
  assert.equal(domain.list('COIN_POSITION').length,3);

  for(const item of cases){
    const ids=opportunityInstrumentRepresentationIds(item.instrumentId);
    const position=domain.get('COIN_POSITION',ids.coinPositionId);
    assert.equal(position.quantity,item.amount);
    assert.equal(position.availableQuantity,item.amount);
    assert.equal(position.externalizedQuantity,0);
    assert.equal(position.opportunityId,item.opportunityId);
    assert.equal(position.sourceInstrumentId,item.instrumentId);
    assert.equal(position.instrumentId,undefined);
    assert.deepEqual(position.collateral.relatedAssetIds,[item.assetId]);
    await domain.put('INSTRUMENT_REPRESENTATION_APPROVAL',`IRA-${item.instrumentId}`,{approvalId:`IRA-${item.instrumentId}`,instrumentId:item.instrumentId,state:'APPROVED',linkedCoinPositionIds:[]});
    assert.deepEqual(new InstrumentCoinPositionLinkageService(domain).evaluate(item.instrumentId,ids.coinPositionId).blockers,[]);
  }
});

test('funding instrument issuance immediately prepares the opportunity Coin Position',async()=>{
  const domain=new Domain();
  await domain.put('FUNDING_OPPORTUNITY','FO-ISSUE',{opportunityId:'FO-ISSUE',title:'Vehicle purchase',opportunityType:'VEHICLE_PURCHASE',applicantParticipantId:'P-BUYER',relatedAssetIds:['VIN-ISSUE'],currency:'USD',status:'ISSUANCE_REQUESTED',history:[]});
  await domain.put('SRA_INSTRUMENT','INS-ISSUE',{instrumentId:'INS-ISSUE',opportunityId:'FO-ISSUE',instrumentFamily:'ASSET_BACKED_NOTE',fundingModel:'ASSET_BACKED_FUNDING',issuerParticipantId:'P-BUYER',verifiedRecordId:'FVR-1',faceValue:79_456.17,currency:'USD',state:'DRAFT',status:'ISSUANCE_REQUEST_PENDING',issuanceStatus:'NOT_ISSUED',settlementRule:'NET',governingDocumentId:'DOC-1',restrictions:[]});
  await domain.put('FUNDING_INSTRUMENT_ISSUANCE_REQUEST','REQ-1',{issuanceRequestId:'REQ-1',instrumentId:'INS-ISSUE',opportunityId:'FO-ISSUE',issuerParticipantId:'P-BUYER',faceValue:79_456.17,currency:'USD',status:'AUTHORIZED'});
  await domain.put('FUNDING_INSTRUMENT_ISSUANCE_AUTHORIZATION','AUTH-1',{issuanceAuthorizationId:'AUTH-1',issuanceRequestId:'REQ-1',instrumentId:'INS-ISSUE',opportunityId:'FO-ISSUE',authorizedFaceValue:79_456.17,currency:'USD',status:'AUTHORIZED',consumedAt:null,economicBasis:{faceValue:79_456.17,currency:'USD'}});
  const issuance=new FundingInstrumentIssuanceService(domain);
  await issuance.initialize();
  const result=await issuance.issue('AUTH-1',{},'ADMIN-1');
  const ids=opportunityInstrumentRepresentationIds('INS-ISSUE');
  assert.equal(result.representation.created,true);
  assert.equal(result.instrument.preparedCoinPositionId,ids.coinPositionId);
  assert.equal(domain.get('COIN_POSITION',ids.coinPositionId).quantity,79_456.17);
  assert.equal(domain.get('FUNDING_OPPORTUNITY','FO-ISSUE').preparedCoinPositionId,ids.coinPositionId);
});

test('reconciliation is idempotent and preserves linked or externalized position balances',async()=>{
  const domain=new Domain();
  await addIssuedOpportunity(domain,{opportunityId:'FO-1',instrumentId:'INS-1',opportunityType:'EQUIPMENT_FINANCING',amount:500_000,assetId:'EQUIPMENT-1'});
  const service=new OpportunityInstrumentRepresentationService(domain);
  await service.reconcile('ADMIN-1');
  const ids=opportunityInstrumentRepresentationIds('INS-1');
  const position=domain.get('COIN_POSITION',ids.coinPositionId);
  await domain.put('COIN_POSITION',ids.coinPositionId,{...position,instrumentId:'INS-1',availableQuantity:490_000,externalizedQuantity:10_000});
  const again=await service.reconcile('ADMIN-1');
  assert.equal(again.created,0);
  assert.equal(domain.list('COIN_POSITION').length,1);
  assert.equal(domain.get('COIN_POSITION',ids.coinPositionId).availableQuantity,490_000);
  assert.equal(domain.get('COIN_POSITION',ids.coinPositionId).externalizedQuantity,10_000);
});

test('reconciliation reuses an existing direct instrument position instead of duplicating it',async()=>{
  const domain=new Domain();
  await addIssuedOpportunity(domain,{opportunityId:'FO-EXISTING',instrumentId:'INS-EXISTING',opportunityType:'BUSINESS_STARTUP',amount:1_000_000,assetId:'STARTUP-1'});
  await domain.put('COIN_POSITION','CP-LEGACY',{coinPositionId:'CP-LEGACY',sourceInstrumentId:'INS-EXISTING',opportunityId:'FO-EXISTING',ownerId:'P-FO-EXISTING',symbol:'SRA',quantity:1_000_000,availableQuantity:900_000,externalizedQuantity:100_000,state:'ACTIVE'});
  const result=await new OpportunityInstrumentRepresentationService(domain).reconcile('ADMIN-1');
  assert.equal(result.created,0);
  assert.equal(domain.list('COIN_POSITION').length,1);
  assert.equal(domain.get('COIN_POSITION','CP-LEGACY').externalizedQuantity,100_000);
});
