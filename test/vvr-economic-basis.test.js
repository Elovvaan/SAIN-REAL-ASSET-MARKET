import test from 'node:test';
import assert from 'node:assert/strict';
import { FundingModelSelectionService } from '../services/funding-model-selection-service.js';
import { FundingInstrumentSelectionService } from '../services/funding-instrument-selection-service.js';
import { DETERMINATION_RECORD_TYPES } from '../services/determination-engine-service.js';

class MemoryDomain {
  constructor(){this.records=new Map();this.lifecycleEvents=[];}
  key(type,id){return `${type}:${id}`;}
  async hydrate(){return {};}
  get(type,id){return structuredClone(this.records.get(this.key(type,id))||null);}
  list(type){const prefix=`${type}:`;return [...this.records.entries()].filter(([key])=>key.startsWith(prefix)).map(([,value])=>structuredClone(value));}
  async put(type,id,payload){this.records.set(this.key(type,id),structuredClone(payload));return structuredClone(payload);}
  async lifecycle(input){this.lifecycleEvents.push(structuredClone(input));return input;}
}

const OPPORTUNITY='FUNDING_OPPORTUNITY';
const ASSESSMENT='FUNDING_MODEL_ASSESSMENT';
const INSTRUMENT_SELECTION='FUNDING_INSTRUMENT_SELECTION';

test('canonical VVR value is carried as economic reference without replacing requested amount or face value',async()=>{
  const domain=new MemoryDomain();
  await domain.put(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE,'VVR-1',{verifiedValueRecordId:'VVR-1',value:100000,currency:'USD',state:'CANONICAL',immutable:true,permittedUses:['CONTRACT_REFERENCE'],determinationId:'DET-1',snapshotId:'SNP-1'});
  await domain.put(ASSESSMENT,'FMA-1',{assessmentId:'FMA-1',assessments:[{model:'PROJECT_FUNDING',score:80,reasons:['fit']}],recommendedModel:'PROJECT_FUNDING'});
  await domain.put(OPPORTUNITY,'FO-1',{opportunityId:'FO-1',status:'VALUE_PREPARED',modelAssessmentId:'FMA-1',valuePreparationId:'FVP-1',requestedAmount:80000,currency:'USD',canonicalVerifiedValueRecordId:'VVR-1',verifiedRecordId:'FVRD-1',applicantParticipantId:'P-1',purpose:'PROJECT',opportunityType:'PROJECT',history:[]});

  const modelService=new FundingModelSelectionService(domain);await modelService.initialize();
  const selection=await modelService.selectModel('FO-1',{selectedModel:'PROJECT_FUNDING'},'ADMIN-1');
  assert.equal(selection.requestedAmount,80000);
  assert.equal(selection.recognizedReferenceValue,100000);
  assert.equal(selection.requestedToRecognizedRatio,0.8);
  assert.equal(selection.economicReferenceArchitecture,'CANONICAL_VVR_ECONOMIC_REFERENCE');

  const request=await modelService.createInstrumentSelectionRequest(selection.selectionId,{candidateInstrumentFamilies:['TRUE_BILL']},'ADMIN-1');
  assert.equal(request.canonicalVerifiedValueRecordId,'VVR-1');
  assert.equal(request.recognizedReferenceValue,100000);

  await domain.put(INSTRUMENT_SELECTION,'FIS-1',{instrumentSelectionId:'FIS-1',instrumentSelectionRequestId:request.instrumentSelectionRequestId,opportunityId:'FO-1',fundingModel:'PROJECT_FUNDING',selectedInstrumentFamily:'TRUE_BILL',terms:{},restrictions:[],status:'SELECTED'});
  const instrumentService=new FundingInstrumentSelectionService(domain);await instrumentService.initialize();
  const instrument=await instrumentService.createDraftInstrument('FIS-1',{faceValue:75000,settlementRule:'NET',governingDocumentId:'DOC-1'},'ADMIN-1');
  assert.equal(instrument.requestedAmount,80000);
  assert.equal(instrument.recognizedReferenceValue,100000);
  assert.equal(instrument.faceValue,75000);
  assert.equal(instrument.faceValueBasis,'EXPLICIT_STRUCTURING_DECISION');
  assert.equal(instrument.faceValueToRecognizedRatio,0.75);
  assert.equal(instrument.requestedToRecognizedRatio,0.8);
});
