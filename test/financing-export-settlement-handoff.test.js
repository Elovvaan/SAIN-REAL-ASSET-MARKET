import test from 'node:test';
import assert from 'node:assert/strict';
import { FinancingClosingService } from '../services/financing-closing-service.js';
import { SettlementRailGatewayService } from '../services/settlement-rail-gateway-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  async hydrate() { return {}; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { const prefix = `${type}:`; return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value); }
  async put(type, id, payload) { this.records.set(this.key(type, id), payload); return payload; }
  async atomicPut(changes) { for (const change of changes) this.records.set(this.key(change.type, change.id), change.payload); return changes.map((change) => change.payload); }
  async lifecycle(event) { this.events.push(event); return event; }
}

function seedFinancing(domain) {
  const record = {
    transactionId: 'LFA-EXPORT-1',
    transactionType: 'LOAN_FINANCING_AUTHORIZATION',
    issuanceTransactionId: 'TX-ISSUE-EXPORT-1',
    instrumentId: 'INS-EXPORT-1',
    opportunityId: 'FOR-EXPORT-1',
    borrowerParticipantId: 'P-BORROWER-1',
    amount: 250000,
    currency: 'USD',
    state: 'POSTED',
    status: 'FUNDING_CREDITED_PENDING_DISBURSEMENT',
    externalDisbursementAuthorized: false,
  };
  domain.records.set(domain.key(RECORD_TYPES.SRA_TRANSACTION, record.transactionId), record);
}

const agreementEvidence = {
  documentReference: 'DOC-VEHICLE-PA-1',
  documentHash: 'a'.repeat(64),
  documentType: 'VEHICLE_PURCHASE_AGREEMENT',
  auditTrailReference: 'AUDIT-VEHICLE-PA-1',
  signatureEvidenceReference: 'SIG-VEHICLE-PA-1',
  consentEvidenceReference: 'CONSENT-VEHICLE-PA-1',
  executedAt: '2026-08-22T15:30:00.000Z',
};

test('authorized financing becomes an export package before a bank rail is selected', async () => {
  const domain = new Domain();
  seedFinancing(domain);
  const service = new FinancingClosingService(domain);
  await service.initialize();

  const { closing } = await service.open({ financingTransactionId: 'LFA-EXPORT-1' }, 'ADMIN');
  const ready = await service.markReady(closing.closingId, { beneficiaryName: 'Closing Escrow' }, 'ADMIN');
  assert.equal(ready.status, 'READY_TO_FUND');
  assert.equal(ready.settlementMethod, null);

  const authorized = await service.authorize(closing.closingId, { approval: 'APPROVE' }, 'ADMIN');
  assert.equal(authorized.disbursement.status, 'AUTHORIZED');
  assert.equal(authorized.exportPackage.exportKind, 'FINANCING_DISBURSEMENT');
  assert.equal(authorized.exportPackage.financingTransactionId, 'LFA-EXPORT-1');
  assert.equal(authorized.exportPackage.amount, 250000);
  assert.equal(authorized.exportPackage.state, 'READY_FOR_SETTLEMENT_INSTRUCTION');
  assert.equal(authorized.exportPackage.selectedRail, null);
});

test('executed agreement evidence is preserved from closing through the financing export package', async () => {
  const domain = new Domain();
  seedFinancing(domain);
  const service = new FinancingClosingService(domain);
  await service.initialize();

  const { closing } = await service.open({ financingTransactionId: 'LFA-EXPORT-1' }, 'ADMIN');
  const ready = await service.markReady(closing.closingId, {
    beneficiaryName: 'Vehicle Seller',
    documentaryEvidence: agreementEvidence,
  }, 'ADMIN');

  assert.equal(ready.documentaryEvidence.documentReference, 'DOC-VEHICLE-PA-1');
  assert.equal(ready.documentaryEvidence.hashAlgorithm, 'SHA-256');

  const authorized = await service.authorize(closing.closingId, { approval: 'APPROVE' }, 'ADMIN');
  assert.deepEqual(authorized.disbursement.documentaryEvidence, ready.documentaryEvidence);
  assert.deepEqual(authorized.exportPackage.documentaryEvidence, ready.documentaryEvidence);
});

test('settlement instruction can be prepared from the financing export package before any execution adapter is selected', async () => {
  const domain = new Domain();
  seedFinancing(domain);
  const closingService = new FinancingClosingService(domain);
  await closingService.initialize();
  const { closing } = await closingService.open({ financingTransactionId: 'LFA-EXPORT-1' }, 'ADMIN');
  await closingService.markReady(closing.closingId, { beneficiaryName: 'Closing Escrow' }, 'ADMIN');
  const authorized = await closingService.authorize(closing.closingId, { approval: 'APPROVE' }, 'ADMIN');

  const gateway = new SettlementRailGatewayService(domain, null, null);
  const instruction = await gateway.createInstruction({
    exportPackageId: authorized.exportPackage.exportPackageId,
    rail: 'ACH',
    receivingInstitutionReference: 'Receiving Bank',
    receivingAccountReference: '1234567890',
    routingNumber: '123456789',
    accountType: 'CHECKING',
  }, 'ADMIN');

  assert.equal(instruction.sourceType, 'FINANCING_DISBURSEMENT');
  assert.equal(instruction.financingTransactionId, 'LFA-EXPORT-1');
  assert.equal(instruction.exportPackageId, authorized.exportPackage.exportPackageId);
  assert.equal(instruction.amount, 250000);
  assert.equal(instruction.rail, 'ACH');
  assert.equal(instruction.adapterId, null);
  assert.equal(instruction.executionMode, null);
  assert.equal(instruction.messageStandard, 'NACHA');
  assert.equal(instruction.standardDetails.receivingDfiIdentification, '12345678');
  assert.equal(instruction.standardDetails.checkDigit, '9');
  assert.equal(instruction.state, 'READY');

  const updatedPackage = domain.get('EXPORT_PACKAGE', authorized.exportPackage.exportPackageId);
  assert.equal(updatedPackage.state, 'SETTLEMENT_INSTRUCTION_READY');
  assert.equal(updatedPackage.selectedRail, 'ACH');
  assert.equal(updatedPackage.settlementInstructionId, instruction.instructionId);
});

test('ACH settlement instruction inherits executed agreement evidence without changing payment semantics', async () => {
  const domain = new Domain();
  seedFinancing(domain);
  const closingService = new FinancingClosingService(domain);
  await closingService.initialize();
  const { closing } = await closingService.open({ financingTransactionId: 'LFA-EXPORT-1' }, 'ADMIN');
  await closingService.markReady(closing.closingId, {
    beneficiaryName: 'Vehicle Seller',
    documentaryEvidence: agreementEvidence,
  }, 'ADMIN');
  const authorized = await closingService.authorize(closing.closingId, { approval: 'APPROVE' }, 'ADMIN');

  const gateway = new SettlementRailGatewayService(domain, null, null);
  const instruction = await gateway.createInstruction({
    exportPackageId: authorized.exportPackage.exportPackageId,
    rail: 'ACH',
    receivingInstitutionReference: 'Receiving Bank',
    receivingAccountReference: '1234567890',
    routingNumber: '123456789',
    accountType: 'CHECKING',
  }, 'ADMIN');

  assert.equal(instruction.documentaryEvidence.documentReference, 'DOC-VEHICLE-PA-1');
  assert.equal(instruction.supportingDocumentHash, agreementEvidence.documentHash);
  assert.equal(instruction.amount, 250000);
  assert.equal(instruction.purpose, 'SRA_FINANCING_DISBURSEMENT');
});

test('an active execution adapter can still be attached when one is actually available', async () => {
  const domain = new Domain();
  seedFinancing(domain);
  const closingService = new FinancingClosingService(domain);
  await closingService.initialize();
  const { closing } = await closingService.open({ financingTransactionId: 'LFA-EXPORT-1' }, 'ADMIN');
  await closingService.markReady(closing.closingId, { beneficiaryName: 'Closing Escrow' }, 'ADMIN');
  const authorized = await closingService.authorize(closing.closingId, { approval: 'APPROVE' }, 'ADMIN');

  const gateway = new SettlementRailGatewayService(domain, null, null);
  const adapter = await gateway.registerAdapter({
    institutionId: 'BANK-1',
    institutionName: 'Settlement Bank',
    rail: 'ACH',
    endpointReference: 'provider://ach',
    senderAccountReference: 'SRA-OPERATING-1',
  }, 'ADMIN');
  const instruction = await gateway.createInstruction({
    exportPackageId: authorized.exportPackage.exportPackageId,
    adapterId: adapter.adapterId,
    rail: 'ACH',
    receivingInstitutionReference: 'Receiving Bank',
    receivingAccountReference: '1234567890',
    routingNumber: '123456789',
    accountType: 'CHECKING',
  }, 'ADMIN');

  assert.equal(instruction.adapterId, adapter.adapterId);
  assert.equal(instruction.institutionId, 'BANK-1');
  assert.equal(instruction.executionMode, 'BANK_PARTNER');
});