import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT) || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const marketplace = {
  marketStatus: 'LIVE', verifiedValue: 12840000, projectedMarketplaceGain: 684000,
  activeProjects: 18, participatingAssets: 42, openPositions: 27, completionCandidates: 3,
  instrumentsActive: 9, completionNeed: 240000, completionReturn: 26000,
  assets: [
    { id:'A-1042',name:'North District Market',type:'OPERATING_BUSINESS',region:'Ogden, Utah',state:'ACTIVE',lifecycleEvents:418,verifiedCycles:392,verifiedValue:735000,verifiedScore:88,valueSignal:'STABLE',projectId:'SRA-RE-0021',dimensions:{production:91,condition:84,reliability:93,capacity:79}},
    { id:'A-2088',name:'Weber Residential Portfolio',type:'REAL_ESTATE',region:'Northern Utah',state:'UNDER_PROJECT',lifecycleEvents:96,verifiedCycles:81,verifiedValue:1860000,verifiedScore:76,valueSignal:'GROWING',projectId:'SRA-RE-0014',dimensions:{production:72,condition:68,reliability:82,capacity:81}},
    { id:'A-3104',name:'Weber Mixed-Use Block',type:'MIXED_USE_REAL_ESTATE',region:'Weber County, Utah',state:'UNDER_PROJECT',lifecycleEvents:147,verifiedCycles:126,verifiedValue:2480000,verifiedScore:92,valueSignal:'ACCELERATING',projectId:'SRA-RE-0033',dimensions:{production:89,condition:90,reliability:94,capacity:95}}
  ],
  projects: [
    { id:'SRA-RE-0014',assetId:'A-2088',assetName:'Weber Residential Portfolio',title:'14-Unit Residential Recovery',region:'Northern Utah',stage:'SERVICES_SCHEDULED',progress:62,verifiedValue:1860000,fundingTarget:420000,fundingProgress:74,signal:'+4.8%',status:'OPEN',completionState:'WATCH',projectedCompletedValue:2240000,projectedGain:380000,projectedGainRate:20.4,participationWindow:'8–14 months',trueBill:{id:'TB-0014',state:'ACTIVE',purpose:'CAPITAL_FORMATION',value:310000}},
    { id:'SRA-RE-0021',assetId:'A-1042',assetName:'North District Market',title:'Neighborhood Grocery Expansion',region:'Ogden, Utah',stage:'PRODUCTION_BEGINS',progress:39,verifiedValue:735000,fundingTarget:185000,fundingProgress:91,signal:'+2.1%',status:'OPEN',completionState:'NORMAL',projectedCompletedValue:842000,projectedGain:107000,projectedGainRate:14.6,participationWindow:'10–16 months',trueBill:{id:'TB-0021',state:'ISSUED',purpose:'ASSET_EXPANSION',value:168000}},
    { id:'SRA-RE-0033',assetId:'A-3104',assetName:'Weber Mixed-Use Block',title:'Mixed-Use Rehabilitation',region:'Weber County, Utah',stage:'VERIFIED_VALUE',progress:78,verifiedValue:2480000,fundingTarget:610000,fundingProgress:83,signal:'+6.3%',status:'OPEN',completionState:'ELIGIBLE',projectedCompletedValue:2677000,projectedGain:197000,projectedGainRate:7.9,participationWindow:'5–9 months',trueBill:{id:'TB-0033',state:'PLEDGED',purpose:'COMPLETION_CAPACITY',value:505000}}
  ],
  completionWatch: [
    {projectId:'SRA-RE-0014',title:'14-Unit Residential Recovery',gap:109000,verifiedCoverage:82,potentialGain:380000,platformReturn:12000,state:'WATCH',action:'Wait for market participation'},
    {projectId:'SRA-RE-0033',title:'Mixed-Use Rehabilitation',gap:88000,verifiedCoverage:94,potentialGain:197000,platformReturn:10000,state:'ELIGIBLE',action:'Prepare Completion Participant path'},
    {projectId:'SRA-RE-0041',title:'Community Equipment Hub',gap:43000,verifiedCoverage:71,potentialGain:107000,platformReturn:4000,state:'PENDING',action:'Verify remaining lifecycle events'}
  ],
  activity: [
    {time:'10:42',kind:'VERIFIED',label:'Inspection milestone verified',project:'SRA-RE-0014',amount:45000},
    {time:'10:36',kind:'PARTICIPANT',label:'Capital participant joined pool',project:'SRA-RE-0033'},
    {time:'10:21',kind:'ASSIGNED',label:'Material supply position assigned',project:'SRA-RE-0021'},
    {time:'09:58',kind:'VVP',label:'Verified Value package frozen',project:'SRA-RE-0033',amount:2480000},
    {time:'09:41',kind:'TRUE_BILL',label:'True Bill activated for expansion',project:'SRA-RE-0021',amount:168000}
  ]
};

const interoperability = {
  status: 'DESIGN_READY',
  corePolicy: 'SRA records remain authoritative; decentralized records are proofs, representations, authorizations, or settlement positions.',
  metrics: { linkedWallets: 0, anchoredProofs: 126, activeCredentials: 18, productivePoolUtilization: 63, representedInstruments: 0 },
  layers: [
    {name:'SRA Controlled Core',state:'ACTIVE',items:['Participant Accounts','Asset Accounts','Lifecycle Records','Verified Value Packages','True Bills','Sane orchestration']},
    {name:'Cryptographic Proof Layer',state:'READY',items:['Deterministic event hashes','Merkle roots','VVP attestations','Credential status','Instrument commitments']},
    {name:'DeFi Interoperability Layer',state:'SANDBOX',items:['Wallet authorization','Public proof verification','Productive pool positions','Optional instrument representations','Programmatic settlement']}
  ],
  completionHealth: [
    {projectId:'SRA-RE-0014',title:'14-Unit Residential Recovery',score:1.18,state:'WATCH',verifiedCoverage:82,fundingCoverage:74,scheduleStability:68},
    {projectId:'SRA-RE-0021',title:'Neighborhood Grocery Expansion',score:1.56,state:'HEALTHY',verifiedCoverage:88,fundingCoverage:91,scheduleStability:84},
    {projectId:'SRA-RE-0033',title:'Mixed-Use Rehabilitation',score:1.34,state:'COMPLETION_ELIGIBLE',verifiedCoverage:94,fundingCoverage:83,scheduleStability:72}
  ],
  credentials: [
    {type:'Inspection Completion Credential',issuer:'Authorized Inspector',subject:'SRA-RE-0014',status:'VERIFIED'},
    {type:'Verified Value Package Attestation',issuer:'SRA Verified Value Engine',subject:'VVP-0033',status:'ACTIVE'},
    {type:'Service Qualification Credential',issuer:'Participant Authority',subject:'SERVICE-PROFILE-018',status:'ACTIVE'}
  ],
  pools: [
    {name:'Completion Capacity Pool',available:1000000,deployed:630000,utilization:63,state:'ACTIVE'},
    {name:'Material Reserve Pool',available:540000,deployed:216000,utilization:40,state:'ACCUMULATING'},
    {name:'Equipment Capacity Pool',available:380000,deployed:273600,utilization:72,state:'ACTIVE'}
  ],
  phases: [
    {phase:'Phase 1',name:'Domain Readiness',status:'IN_PROGRESS'},
    {phase:'Phase 2',name:'Proof Services',status:'PLANNED'},
    {phase:'Phase 3',name:'External Representations',status:'PLANNED'},
    {phase:'Phase 4',name:'Settlement Interoperability',status:'PLANNED'}
  ]
};

app.get('/api/health', (_req,res)=>res.json({status:'ok',service:'SAIN Real Asset Market',version:'0.3.0',timestamp:new Date().toISOString()}));
app.get('/api/marketplace', (_req,res)=>res.json(marketplace));
app.get('/api/interoperability', (_req,res)=>res.json(interoperability));

app.post('/api/sane/message',(req,res)=>{
  const message=typeof req.body?.message==='string'?req.body.message.trim():'';
  if(!message)return res.status(400).json({error:'A message is required.'});
  const lower=message.toLowerCase();
  let reply='I can move that through SRA. Name the asset, project, or outcome, and I will organize the marketplace path behind the conversation.';
  if(lower.includes('wallet')||lower.includes('defi')||lower.includes('blockchain')||lower.includes('interoperability')) reply='SRA DeFi interoperability is in Domain Readiness. Wallets will be authorized contexts under Participant Accounts; SRA records remain authoritative while selected proofs, pool positions, and instrument representations can move across approved decentralized rails.';
  else if(lower.includes('credential')||lower.includes('proof')) reply='SRA will use signed event hashes, Merkle roots, and verifiable credentials to prove selected facts without publishing private Asset Account records.';
  else if(lower.includes('health')) reply='Completion Health combines verified coverage, funding coverage, schedule stability, participant availability, asset condition, and the remaining gap. Mixed-Use Rehabilitation is currently Completion Eligible at 1.34.';
  else if(lower.includes('gain')||lower.includes('return')||lower.includes('upside')) reply='The current live projects show $684,000 in combined projected gain. These are projections, not realized results.';
  else if(lower.includes('gap')||lower.includes('complete')) reply='Mixed-Use Rehabilitation is currently eligible for a Completion Participant path. The verified coverage is 94%, the completion gap is $88,000, and the projected gain is $197,000.';
  else if(lower.includes('true bill')||lower.includes('instrument')) reply='The authoritative True Bill stays inside SRA. An approved credential, unique position, divided participation position, or institutional ledger representation may be issued for interoperability.';
  else if(lower.includes('verified value')) reply='Verified Value remains the authoritative SRA state. External rails receive approved proofs or representations, not the private calculation record.';
  return res.json({reply});
});

app.get('*',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(port,'0.0.0.0',()=>console.log(`SRA Build V3 interoperability layer is running on port ${port}`));
