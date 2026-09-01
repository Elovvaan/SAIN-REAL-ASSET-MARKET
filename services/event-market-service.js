import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';
import { SRA_USD_CANONICAL_ASSET_ID } from './direct-value-account-service.js';

const AUTHOR = new Set(['MARKET_PROFESSIONAL', 'INSTITUTIONAL_OPERATOR', 'PLATFORM_ADMIN']);
const OPERATE = new Set(['INSTITUTIONAL_OPERATOR', 'PLATFORM_ADMIN']);
const ADMIN = new Set(['PLATFORM_ADMIN']);
const CATEGORIES = new Set(['SPORTS', 'ECONOMICS', 'BUSINESS', 'CULTURE', 'CRYPTO', 'PUBLIC_EVENT']);
const now = () => new Date().toISOString();
const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const uid = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
function positive(value, field) { const n=Number(value); if (!Number.isFinite(n) || n <= 0) throw new Error(`${field} must be greater than zero.`); return Number(n.toFixed(8)); }
function requireTier(actor, allowed, action) { if (!allowed.has(upper(actor.capacity))) throw new Error(`${action} is not available to the active operating tier.`); }
function requireFields(input, fields) { for (const field of fields) if (!text(input[field])) throw new Error(`${field} is required.`); }

export class EventMarketService {
  constructor(domain, directAccounts) { this.domain=domain; this.directAccounts=directAccounts; }
  get(id) { return this.domain.get(RECORD_TYPES.EVENT_MARKET, id); }
  contracts(id) { return this.domain.list(RECORD_TYPES.EVENT_CONTRACT).filter((x) => x.eventMarketId === id); }
  positions(id) { return this.domain.list(RECORD_TYPES.EVENT_POSITION).filter((x) => x.eventMarketId === id); }
  resolution(id) { return this.domain.list(RECORD_TYPES.EVENT_RESOLUTION).find((x) => x.eventMarketId === id && x.state === 'FINAL') || null; }
  list(filters={}) { return this.domain.list(RECORD_TYPES.EVENT_MARKET).filter((x) => !filters.state || x.state === upper(filters.state)).filter((x) => !filters.category || x.category === upper(filters.category)).sort((a,b) => String(a.scheduledCloseAt).localeCompare(String(b.scheduledCloseAt))).map((x) => this.summary(x.eventMarketId)); }
  summary(id) {
    const market=this.get(id); if (!market) return null;
    const contracts=this.contracts(id); const positions=this.positions(id); const executions=this.domain.list(RECORD_TYPES.EVENT_EXECUTION).filter((x) => x.eventMarketId === id);
    return { ...market, contracts, resolution:this.resolution(id), volume:Number(executions.reduce((s,x)=>s+Number(x.quantity||0),0).toFixed(8)), openInterest:Number(positions.filter((x)=>x.state==='OPEN').reduce((s,x)=>s+Number(x.quantity||0),0).toFixed(8)), participantCount:new Set(positions.map((x)=>x.participantId)).size };
  }
  detail(id) { const market=this.summary(id); return market ? { market, suspensions:this.domain.list(RECORD_TYPES.EVENT_SUSPENSION).filter((x)=>x.eventMarketId===id) } : null; }
  participantPositions(participantId) { return this.domain.list(RECORD_TYPES.EVENT_POSITION).filter((x)=>x.participantId===participantId).map((x)=>({ ...x, market:this.summary(x.eventMarketId) })); }

  async create(input={}, actor={}) {
    requireTier(actor, AUTHOR, 'Event market creation');
    const question=text(input.question); const category=upper(input.category||'PUBLIC_EVENT');
    if (!question.endsWith('?')) throw new Error('question must be unambiguous and end with a question mark.');
    if (!CATEGORIES.has(category)) throw new Error('Unsupported event market category.');
    requireFields(input, ['scheduledOpenAt','scheduledCloseAt','expectedResolutionAt','resolutionSource','resolutionRule']);
    const eventMarketId=text(input.eventMarketId)||uid('EVM'); if (this.get(eventMarketId)) throw new Error('Event market already exists.');
    const createdAt=now();
    const market={ id:eventMarketId,eventMarketId,question,shortName:text(input.shortName)||question.slice(0,72),category,description:text(input.description)||null,subjectReference:text(input.subjectReference)||null,scheduledOpenAt:text(input.scheduledOpenAt),scheduledCloseAt:text(input.scheduledCloseAt),expectedResolutionAt:text(input.expectedResolutionAt),resolutionSource:text(input.resolutionSource),resolutionRule:text(input.resolutionRule),correctionRule:text(input.correctionRule)||'AUTHORIZED_SOURCE_CORRECTION_REVIEW',venueModel:'AUTHORIZED_MARKET_VENUE_ADAPTER',settlementAssetId:SRA_USD_CANONICAL_ASSET_ID,payoutPerWinningContract:1,state:'DRAFT',createdBy:actor.participantId,createdByCapacity:upper(actor.capacity),createdAt,updatedAt:createdAt };
    const contract=(outcome)=>({ id:`${eventMarketId}-${outcome}`,contractId:`${eventMarketId}-${outcome}`,eventMarketId,outcome,denomination:'SRA/USD',minimumPrice:0.01,maximumPrice:0.99,payoutIfCorrect:1,state:'DRAFT',createdAt,updatedAt:createdAt });
    const yes=contract('YES'); const no=contract('NO');
    await this.domain.atomicPut([{type:RECORD_TYPES.EVENT_MARKET,id:eventMarketId,payload:market,actorId:actor.participantId,eventType:'EVENT_MARKET_DRAFTED'},{type:RECORD_TYPES.EVENT_CONTRACT,id:yes.contractId,payload:yes,actorId:actor.participantId,eventType:'EVENT_CONTRACT_CREATED'},{type:RECORD_TYPES.EVENT_CONTRACT,id:no.contractId,payload:no,actorId:actor.participantId,eventType:'EVENT_CONTRACT_CREATED'}]);
    return this.summary(eventMarketId);
  }

  async review(id,input={},actor={}) {
    requireTier(actor, OPERATE, 'Event market review'); const market=this.get(id);
    if (!market || market.state!=='DRAFT') throw new Error('A draft event market was not found.');
    if (upper(input.decision)!=='APPROVE') throw new Error('decision must be APPROVE.');
    requireFields(input,['rulebookReference','eligibilityReference','decisionRationale']); const at=now();
    await this.domain.put(RECORD_TYPES.EVENT_MARKET,id,{...market,state:'REVIEWED',rulebookReference:text(input.rulebookReference),eligibilityReference:text(input.eligibilityReference),decisionRationale:text(input.decisionRationale),reviewedBy:actor.participantId,reviewedAt:at,updatedAt:at},{actorId:actor.participantId,eventType:'EVENT_MARKET_REVIEWED'});
    return this.summary(id);
  }

  async listOnVenue(id,input={},actor={}) {
    requireTier(actor,ADMIN,'Event market listing'); const market=this.get(id);
    if (!market || market.state!=='REVIEWED') throw new Error('A reviewed event market was not found.');
    requireFields(input,['venueId','venueMarketId','listingReference']); const yesPrice=positive(input.yesPrice,'yesPrice'); const noPrice=positive(input.noPrice,'noPrice');
    if (yesPrice>=1 || noPrice>=1 || Math.abs(yesPrice+noPrice-1)>0.02) throw new Error('YES and NO prices must be below $1 and approximately complementary.');
    const at=now(); const changes=[{type:RECORD_TYPES.EVENT_MARKET,id,payload:{...market,state:'OPEN',venueId:upper(input.venueId),venueMarketId:text(input.venueMarketId),listingReference:text(input.listingReference),listedAt:at,listedBy:actor.participantId,updatedAt:at},actorId:actor.participantId,eventType:'EVENT_MARKET_LISTED'}];
    for (const c of this.contracts(id)) changes.push({type:RECORD_TYPES.EVENT_CONTRACT,id:c.contractId,payload:{...c,state:'OPEN',currentPrice:c.outcome==='YES'?yesPrice:noPrice,venueContractId:text(input[`${c.outcome.toLowerCase()}VenueContractId`])||null,updatedAt:at},actorId:actor.participantId,eventType:'EVENT_CONTRACT_LISTED'});
    await this.domain.atomicPut(changes); return this.summary(id);
  }

  async buy(id,input={},actor={}) {
    if (actor.venueConfirmed !== true) throw new Error('An authorized venue adapter confirmation is required before an event position can be opened.');
    const market=this.get(id); if (!market || market.state!=='OPEN') throw new Error('An open event market was not found.');
    const outcome=upper(input.outcome); if (!['YES','NO'].includes(outcome)) throw new Error('outcome must be YES or NO.');
    const contract=this.contracts(id).find((x)=>x.outcome===outcome&&x.state==='OPEN'); if (!contract) throw new Error('Open event contract not found.');
    const quantity=positive(input.quantity,'quantity'); const executionPrice=positive(input.executionPrice,'executionPrice'); if(executionPrice>=1) throw new Error('executionPrice must be below $1.');
    requireFields(input,['venueExecutionReference']); const venueRef=text(input.venueExecutionReference);
    const duplicate=this.domain.list(RECORD_TYPES.EVENT_EXECUTION).find((x)=>x.venueExecutionReference===venueRef); if(duplicate) return {created:false,execution:duplicate,position:this.domain.get(RECORD_TYPES.EVENT_POSITION,duplicate.positionId)};
    const accountId=text(input.directValueAccountId); const account=this.domain.get(RECORD_TYPES.DIRECT_VALUE_ACCOUNT,accountId); if(!account||account.participantId!==actor.participantId) throw new Error('Participant Direct Value Account not found.');
    const cash=this.directAccounts.getPosition(accountId,SRA_USD_CANONICAL_ASSET_ID,'NATIVE'); const fee=Number(Number(input.fee||0).toFixed(8)); if(fee<0) throw new Error('fee cannot be negative.');
    const cost=Number((quantity*executionPrice).toFixed(8)); const totalDebit=Number((cost+fee).toFixed(8)); if(!cash||Number(cash.available)<totalDebit) throw new Error('Available SRA/USD is insufficient for this event position.');
    const at=now(),orderId=uid('EOR'),executionId=uid('EEX'),positionId=uid('EVP');
    const order={id:orderId,orderId,eventMarketId:id,contractId:contract.contractId,participantId:actor.participantId,side:'BUY',outcome,quantity,limitPrice:Number(input.limitPrice||executionPrice),orderType:upper(input.orderType||'IOC'),state:'FILLED',venueOrderReference:text(input.venueOrderReference)||null,createdAt:at,filledAt:at};
    const execution={id:executionId,executionId,orderId,eventMarketId:id,contractId:contract.contractId,participantId:actor.participantId,directValueAccountId:accountId,outcome,quantity,executionPrice,cost,fee,totalDebit,venueId:market.venueId,venueExecutionReference:venueRef,positionId,state:'CONFIRMED',executedAt:at,createdAt:at};
    const position={id:positionId,positionId,eventMarketId:id,contractId:contract.contractId,participantId:actor.participantId,directValueAccountId:accountId,outcome,quantity,averageEntryPrice:executionPrice,costBasis:cost,feesPaid:fee,maximumSettlementValue:quantity,state:'OPEN',openedAt:at,updatedAt:at};
    const updatedCash={...cash,available:Number((Number(cash.available)-totalDebit).toFixed(8)),total:Number((Number(cash.total)-totalDebit).toFixed(8)),updatedAt:at};
    await this.domain.atomicPut([{type:RECORD_TYPES.ACCOUNT_ASSET_POSITION,id:cash.positionId,payload:updatedCash,actorId:actor.participantId,eventType:'EVENT_POSITION_CASH_DEBITED'},{type:RECORD_TYPES.EVENT_ORDER,id:orderId,payload:order,actorId:actor.participantId,eventType:'EVENT_ORDER_FILLED'},{type:RECORD_TYPES.EVENT_EXECUTION,id:executionId,payload:execution,actorId:actor.participantId,eventType:'EVENT_EXECUTION_CONFIRMED'},{type:RECORD_TYPES.EVENT_POSITION,id:positionId,payload:position,actorId:actor.participantId,eventType:'EVENT_POSITION_OPENED'}]);
    return {created:true,order,execution,position,accountPosition:updatedCash};
  }

  async control(id,input={},actor={}) {
    requireTier(actor,OPERATE,'Event market control'); const market=this.get(id); if(!market||!['OPEN','SUSPENDED'].includes(market.state)) throw new Error('A controllable event market was not found.');
    const action=upper(input.action||'SUSPEND'); if(!['SUSPEND','REOPEN','CLOSE'].includes(action)) throw new Error('action must be SUSPEND, REOPEN, or CLOSE.'); requireFields(input,['reason','evidenceReference']);
    const state=action==='SUSPEND'?'SUSPENDED':action==='REOPEN'?'OPEN':'CLOSED',at=now(),suspensionId=uid('EVS');
    await this.domain.atomicPut([{type:RECORD_TYPES.EVENT_MARKET,id,payload:{...market,state,updatedAt:at},actorId:actor.participantId,eventType:`EVENT_MARKET_${state}`},{type:RECORD_TYPES.EVENT_SUSPENSION,id:suspensionId,payload:{id:suspensionId,suspensionId,eventMarketId:id,action,reason:text(input.reason),evidenceReference:text(input.evidenceReference),recordedBy:actor.participantId,recordedAt:at},actorId:actor.participantId,eventType:'EVENT_MARKET_CONTROL_RECORDED'}]);
    return this.summary(id);
  }

  async resolve(id,input={},actor={}) {
    requireTier(actor,ADMIN,'Event market resolution'); const market=this.get(id); if(!market||!['OPEN','SUSPENDED','CLOSED'].includes(market.state)) throw new Error('A resolvable event market was not found.');
    const outcome=upper(input.outcome); if(!['YES','NO','VOID'].includes(outcome)) throw new Error('outcome must be YES, NO, or VOID.'); requireFields(input,['sourceResultReference','resolutionEvidenceReference','determinationRationale']); if(this.resolution(id)) throw new Error('Event market is already resolved.');
    const at=now(),resolutionId=uid('EVR'); const resolution={id:resolutionId,resolutionId,eventMarketId:id,outcome,sourceAuthority:market.resolutionSource,sourceResultReference:text(input.sourceResultReference),resolutionEvidenceReference:text(input.resolutionEvidenceReference),determinationRationale:text(input.determinationRationale),state:'FINAL',resolvedBy:actor.participantId,resolvedAt:at,createdAt:at};
    await this.domain.atomicPut([{type:RECORD_TYPES.EVENT_RESOLUTION,id:resolutionId,payload:resolution,actorId:actor.participantId,eventType:'EVENT_MARKET_RESOLUTION_FINAL'},{type:RECORD_TYPES.EVENT_MARKET,id,payload:{...market,state:'RESOLVED',resolvedOutcome:outcome,resolutionId,resolvedAt:at,updatedAt:at},actorId:actor.participantId,eventType:'EVENT_MARKET_RESOLVED'}]); return {resolution,market:this.summary(id)};
  }

  async settle(id,input={},actor={}) {
    requireTier(actor,ADMIN,'Event market settlement'); requireFields(input,['settlementReference']);
    const reference=text(input.settlementReference),duplicate=this.domain.list(RECORD_TYPES.EVENT_SETTLEMENT).find((x)=>x.eventMarketId===id&&x.settlementReference===reference); if(duplicate) return {created:false,settlement:duplicate,market:this.summary(id)};
    const market=this.get(id),resolution=this.resolution(id); if(!market||market.state!=='RESOLVED'||!resolution) throw new Error('A resolved event market was not found.');
    const positions=this.positions(id).filter((x)=>x.state==='OPEN'),at=now(),allocations=[],changes=[],credits=new Map();
    for(const position of positions){ const payout=resolution.outcome==='VOID'?Number(position.costBasis):resolution.outcome===position.outcome?Number(position.quantity):0; const cash=this.directAccounts.getPosition(position.directValueAccountId,SRA_USD_CANONICAL_ASSET_ID,'NATIVE'); if(!cash) throw new Error('Settlement account position not found.'); if(payout>0) credits.set(position.directValueAccountId,{cash,payout:Number(((credits.get(position.directValueAccountId)?.payout||0)+payout).toFixed(8))}); changes.push({type:RECORD_TYPES.EVENT_POSITION,id:position.positionId,payload:{...position,state:'SETTLED',resolvedOutcome:resolution.outcome,settlementPayout:payout,settledAt:at,updatedAt:at},actorId:actor.participantId,eventType:'EVENT_POSITION_SETTLED'}); allocations.push({positionId:position.positionId,participantId:position.participantId,outcome:position.outcome,quantity:position.quantity,payout}); }
    for(const {cash,payout} of credits.values()) changes.push({type:RECORD_TYPES.ACCOUNT_ASSET_POSITION,id:cash.positionId,payload:{...cash,available:Number((Number(cash.available)+payout).toFixed(8)),total:Number((Number(cash.total)+payout).toFixed(8)),updatedAt:at},actorId:actor.participantId,eventType:'EVENT_SETTLEMENT_ACCOUNT_CREDITED'});
    const settlementId=uid('EVT'),settlement={id:settlementId,settlementId,eventMarketId:id,resolutionId:resolution.resolutionId,outcome:resolution.outcome,settlementReference:reference,allocationCount:allocations.length,totalPayout:Number(allocations.reduce((s,x)=>s+x.payout,0).toFixed(8)),allocations,state:'COMPLETED',settledBy:actor.participantId,settledAt:at,createdAt:at};
    changes.push({type:RECORD_TYPES.EVENT_SETTLEMENT,id:settlementId,payload:settlement,actorId:actor.participantId,eventType:'EVENT_MARKET_SETTLEMENT_COMPLETED'},{type:RECORD_TYPES.EVENT_MARKET,id,payload:{...market,state:'SETTLED',settlementId,settledAt:at,updatedAt:at},actorId:actor.participantId,eventType:'EVENT_MARKET_SETTLED'}); await this.domain.atomicPut(changes); return {created:true,settlement,market:this.summary(id)};
  }
}
