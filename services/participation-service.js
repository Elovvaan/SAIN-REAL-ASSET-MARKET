import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const PARTICIPATION_TYPES = ['CAPITAL','SERVICE','MATERIAL','EQUIPMENT','CONTRACT'];
const CONTRIBUTION_MEDIA = ['USD','BANK_TRANSFER','STABLE_DIGITAL_ASSET','CRYPTOCURRENCY','SRA_BALANCE','EQUIPMENT','MATERIAL','SERVICE','CONTRACT_RIGHT'];

function id(prefix){return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`}
function clean(value,max=240){return typeof value==='string'?value.trim().slice(0,max):''}

export class ParticipationService{
  constructor(marketplace,accessStore,domain){
    this.marketplace=marketplace;
    this.accessStore=accessStore;
    this.domain=domain;
  }

  listOpportunities(){
    return this.marketplace.projects.map(project=>({
      id:project.id,
      assetId:project.assetId,
      assetName:project.assetName,
      title:project.title,
      region:project.region,
      stage:project.stage,
      progress:project.progress,
      verifiedValue:project.verifiedValue,
      projectedCompletedValue:project.projectedCompletedValue,
      projectedGain:project.projectedGain,
      projectedGainRate:project.projectedGainRate,
      participationWindow:project.participationWindow,
      completionState:project.completionState,
      fundingTarget:project.fundingTarget,
      fundingProgress:project.fundingProgress,
      openPositions:[
        {type:'CAPITAL',remaining:Math.max(project.fundingTarget*(1-project.fundingProgress/100),0),acceptedMedia:['USD','BANK_TRANSFER','STABLE_DIGITAL_ASSET','CRYPTOCURRENCY','SRA_BALANCE']},
        {type:'SERVICE',remaining:null,acceptedMedia:['SERVICE']},
        {type:'MATERIAL',remaining:null,acceptedMedia:['MATERIAL']},
        {type:'EQUIPMENT',remaining:null,acceptedMedia:['EQUIPMENT']},
        {type:'CONTRACT',remaining:null,acceptedMedia:['CONTRACT_RIGHT']}
      ]
    }));
  }

  getOpportunity(projectId){return this.listOpportunities().find(item=>item.id===projectId)||null}

  async listMarketInventory(balanceReader){
    const assets=this.domain.list('ON_CHAIN_ASSET').filter(item=>Number(item.issuedSupply||0)>0);
    const offers=this.domain.list('ON_CHAIN_MARKET_OFFER');
    const usdcMarkets=this.domain.list('ON_CHAIN_USDC_MARKET');
    return Promise.all(assets.map(async asset=>{
      const assetOffers=offers.filter(item=>item.assetId===asset.assetId);
      const liveOffers=assetOffers.filter(item=>['CONFIRMED','ACTIVE','LIVE','OPEN'].includes(String(item.marketState||item.state||item.confirmation?.state||'').toUpperCase()));
      const activeUsdcMarket=usdcMarkets.find(item=>item.assetId===asset.assetId&&['CONFIRMED','ACTIVE','READY','TWO_SIDED'].includes(String(item.state||item.confirmation?.state||'').toUpperCase()));
      let wallet={account:asset.distributionAddress||asset.sourceAccount||null,balance:null,available:null,sellingLiabilities:null,trustline:null,live:false,error:null};
      if(String(asset.network||'').toUpperCase()==='STELLAR'&&typeof balanceReader==='function'){
        try{
          const live=await balanceReader(asset);
          wallet={account:live.account||wallet.account,balance:live.balance??'0',available:live.available??live.balance??'0',sellingLiabilities:live.sellingLiabilities??'0',trustline:live.trustline??true,live:true,error:null};
        }catch(error){wallet.error=String(error?.message||error);}
      }
      return{
        assetId:asset.assetId,instrumentId:asset.instrumentId||null,network:asset.network,asset:asset.asset||asset.symbol,
        assetAddress:asset.assetAddress||asset.mintAddress||null,issuedSupply:String(asset.issuedSupply||'0'),
        lastIssuedAmount:asset.lastIssuedAmount||null,lastIssueTransactionId:asset.lastIssueTransactionId||null,
        wallet,offerCount:assetOffers.length,liveOfferCount:liveOffers.length,usdcMarketActive:Boolean(activeUsdcMarket),
        marketState:liveOffers.length||activeUsdcMarket?'LIVE':'ISSUED_INVENTORY',
        participationState:liveOffers.length?'OPEN':'AVAILABLE_FOR_MARKET_FORMATION',updatedAt:asset.updatedAt||asset.createdAt||null
      };
    }));
  }

  async createPosition({session,projectId,participationType,medium,amount,description}){
    if(!session)return{ok:false,status:401,error:'Sign in to create a participation position.'};
    const opportunity=this.getOpportunity(projectId);
    if(!opportunity)return{ok:false,status:404,error:'Opportunity not found.'};
    const type=clean(participationType,40).toUpperCase();
    const contributionMedium=clean(medium,60).toUpperCase();
    if(!PARTICIPATION_TYPES.includes(type))return{ok:false,status:400,error:'Unsupported participation type.'};
    if(!CONTRIBUTION_MEDIA.includes(contributionMedium))return{ok:false,status:400,error:'Unsupported contribution medium.'};
    const available=opportunity.openPositions.find(position=>position.type===type);
    if(!available||!available.acceptedMedia.includes(contributionMedium))return{ok:false,status:400,error:'That contribution medium is not available for this position.'};
    const numericAmount=Number(amount||0);
    if(type==='CAPITAL'&&(!Number.isFinite(numericAmount)||numericAmount<=0))return{ok:false,status:400,error:'Enter a capital contribution amount.'};

    const now=new Date().toISOString();
    const position={
      id:id('POS'),
      participantId:session.id,
      participantName:session.displayName,
      activeRole:session.activeRole,
      projectId:opportunity.id,
      opportunityTitle:opportunity.title,
      assetName:opportunity.assetName,
      participationType:type,
      contribution:{
        medium:contributionMedium,
        statedAmount:type==='CAPITAL'?numericAmount:null,
        denomination:type==='CAPITAL'?'USD':contributionMedium,
        description:clean(description,500),
        verificationStatus:['USD','BANK_TRANSFER','SRA_BALANCE'].includes(contributionMedium)?'PENDING_RECEIPT':'CONTRIBUTION_V4V_REQUIRED'
      },
      state:'AUTHORIZED',
      createdAt:now,
      updatedAt:now,
      history:[{state:'AUTHORIZED',at:now,note:'Participant authorized the participation ticket.'}]
    };
    await this.domain.put(RECORD_TYPES.PARTICIPATION_POSITION,position.id,position,{actorId:session.id,eventType:'PARTICIPATION_POSITION_CREATED'});
    await this.domain.lifecycle({actorId:session.id,objectType:RECORD_TYPES.PARTICIPATION_POSITION,objectId:position.id,eventType:'POSITION_AUTHORIZED',payload:{projectId:position.projectId,medium:contributionMedium}});
    return{ok:true,status:201,position,nextAction:position.contribution.verificationStatus==='CONTRIBUTION_V4V_REQUIRED'?'BEGIN_CONTRIBUTION_V4V':'VERIFY_RECEIPT'};
  }

  listPositions(session){
    if(!session)return[];
    return this.domain.list(RECORD_TYPES.PARTICIPATION_POSITION).filter(position=>position.participantId===session.id);
  }
}

export const participationConfiguration={participationTypes:PARTICIPATION_TYPES,contributionMedia:CONTRIBUTION_MEDIA};
