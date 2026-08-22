import test from 'node:test';
import assert from 'node:assert/strict';
import { AchSettlementPacketService } from '../services/ach-settlement-packet-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  put(type, id, record) { this.records.set(this.key(type, id), record); }
}

test('financing export package produces a dealership-completion ACH settlement PDF', async () => {
  const domain = new Domain();
  domain.put('PARTICIPANT', 'P-1', { participantId: 'P-1', displayName: 'House Morris Trust' });
  domain.put('FUNDING_OPPORTUNITY', 'FOR-1', {
    opportunityId: 'FOR-1', applicantParticipantId: 'P-1', title: '2026 Audi Q5',
    metadata: { vehicleYear: '2026', vehicleMake: 'Audi', vehicleModel: 'Q5', vin: 'WA1EXAMPLE1234567' },
  });
  domain.put('FINANCING_CLOSING', 'FCL-1', {
    closingId: 'FCL-1', opportunityId: 'FOR-1', beneficiaryName: 'Example Audi Dealer',
    documentaryEvidence: {
      documentReference: 'DOC-PURCHASE-1',
      documentSha256: 'a'.repeat(64),
      signatureEvidenceReference: 'SIG-1',
      auditTrailReference: 'AUD-1',
    },
  });
  domain.put('EXPORT_PACKAGE', 'EXP-1', {
    exportPackageId: 'EXP-1', exportKind: 'FINANCING_DISBURSEMENT', financingTransactionId: 'LFA-1',
    closingId: 'FCL-1', opportunityId: 'FOR-1', borrowerParticipantId: 'P-1', beneficiaryName: 'Example Audi Dealer',
    amount: 50000, currency: 'USD', documentaryEvidence: {
      documentReference: 'DOC-PURCHASE-1', documentSha256: 'a'.repeat(64), signatureEvidenceReference: 'SIG-1', auditTrailReference: 'AUD-1',
    },
  });

  const service = new AchSettlementPacketService(domain);
  const source = service.source('EXP-1');
  assert.equal(source.purchaserName, 'House Morris Trust');
  assert.equal(source.dealershipName, 'Example Audi Dealer');
  assert.equal(source.vehicleMake, 'Audi');
  assert.equal(source.vehicleModel, 'Q5');
  assert.equal(source.vin, 'WA1EXAMPLE1234567');
  assert.equal(source.evidence.documentReference, 'DOC-PURCHASE-1');

  const pdf = await service.render('EXP-1');
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 1000);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
