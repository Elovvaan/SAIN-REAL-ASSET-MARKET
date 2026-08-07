import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FundingInstrumentIssuanceService } from '../services/funding-instrument-issuance-service.js';
import { DETERMINATION_RECORD_TYPES } from '../services/determination-engine-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  async hydrate() {}
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) { const p = `${type}:`; return [...this.records].filter(([k]) => k.startsWith(p)).map(([,v]) => structuredClone(v)); }
  async put(type, id, payload) { this.records.set(this.key(type,id), structuredClone(payload)); return payload; }
  async atomicPut(changes) { for (const c of changes) await this.put(c.type,c.id,c.payload); return changes; }
}

test('draft instrument source validates canonical VVR contract-reference eligibility', () => {
  const source = fs.readFileSync(new URL('../services/funding-instrument-selection-service.js', import.meta.url), 'utf8');
  assert.match(source, /canonicalVerifiedValueRecordId/);
  assert.match(source, /state !== 'CANONICAL'/);
  assert.match(source, /immutable !== true/);
  assert.match(source, /permittedUses\.includes\('CONTRACT_REFERENCE'\)/);
  assert.match(source, /valueReferenceArchitecture: vvr \? 'CANONICAL_VVR_REFERENCE' : 'LEGACY_VERIFIED_RECORD_REFERENCE'/);
});

test('issuance readiness blocks an invalid supplied canonical VVR but preserves legacy compatibility', async () => {
  const domain = new MemoryDomain();
  const service = new FundingInstrumentIssuanceService(domain);
  await service.initialize();

  await domain.put('SRA_INSTRUMENT', 'I-1', {
    instrumentId:'I-1', state:'DRAFT', issuanceStatus:'NOT_ISSUED', reviewDecision:'APPROVED_FOR_ISSUANCE_REQUEST',
    verifiedRecordId:'FVRD-1', settlementRule:'ON_MATURITY', governingDocumentId:'DOC-1', canonicalVerifiedValueRecordId:'VVR-BAD'
  });
  await domain.put('FUNDING_INSTRUMENT_ISSUANCE_REQUEST', 'R-1', { issuanceRequestId:'R-1', instrumentId:'I-1', status:'PENDING', issuerParticipantId:'P-1', faceValue:100, currency:'USD' });
  await domain.put(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE, 'VVR-BAD', { verifiedValueRecordId:'VVR-BAD', state:'CANONICAL', immutable:true, permittedUses:['INTERNAL_ANALYSIS'] });
  let assessment = service.assessRequest('R-1');
  assert.equal(assessment.checks.canonicalVvrReferenceValid, false);
  assert.ok(assessment.blockers.includes('canonicalVvrReferenceValid'));

  const legacyInstrument = { ...domain.get('SRA_INSTRUMENT','I-1'), instrumentId:'I-2', canonicalVerifiedValueRecordId:null };
  await domain.put('SRA_INSTRUMENT','I-2',legacyInstrument);
  await domain.put('FUNDING_INSTRUMENT_ISSUANCE_REQUEST','R-2',{ issuanceRequestId:'R-2', instrumentId:'I-2', status:'PENDING', issuerParticipantId:'P-1', faceValue:100, currency:'USD' });
  assessment = service.assessRequest('R-2');
  assert.equal(assessment.checks.canonicalVvrReferenceValid, true);
  assert.equal(assessment.valueReference.mode, 'LEGACY_COMPATIBILITY');
});

test('issuance readiness accepts canonical immutable VVR permitted for contract reference', async () => {
  const domain = new MemoryDomain();
  const service = new FundingInstrumentIssuanceService(domain);
  await service.initialize();
  await domain.put(DETERMINATION_RECORD_TYPES.VERIFIED_VALUE,'VVR-1',{ verifiedValueRecordId:'VVR-1', determinationId:'DET-1', snapshotId:'SNP-1', state:'CANONICAL', immutable:true, permittedUses:['CONTRACT_REFERENCE'] });
  await domain.put('SRA_INSTRUMENT','I-1',{ instrumentId:'I-1', state:'DRAFT', issuanceStatus:'NOT_ISSUED', reviewDecision:'APPROVED_FOR_ISSUANCE_REQUEST', verifiedRecordId:'FVRD-1', canonicalVerifiedValueRecordId:'VVR-1', settlementRule:'ON_MATURITY', governingDocumentId:'DOC-1' });
  await domain.put('FUNDING_INSTRUMENT_ISSUANCE_REQUEST','R-1',{ issuanceRequestId:'R-1', instrumentId:'I-1', status:'PENDING', issuerParticipantId:'P-1', faceValue:100, currency:'USD' });
  const assessment = service.assessRequest('R-1');
  assert.equal(assessment.checks.canonicalVvrReferenceValid, true);
  assert.equal(assessment.valueReference.mode, 'CANONICAL_VVR_REFERENCE');
  assert.equal(assessment.valueReference.determinationId, 'DET-1');
  assert.equal(assessment.readyForAuthorization, true);
});
