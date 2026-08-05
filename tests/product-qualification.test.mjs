import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductQualificationService } from '../services/product-qualification-service.js';

class MemoryDomain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) { const prefix = `${type}:`; return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value)); }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return payload; }
  async lifecycle(payload) { this.events.push(structuredClone(payload)); return payload; }
  async hydrate() { return {}; }
}

function exportPackage(overrides = {}) {
  return {
    exportPackageId: 'EXP-1', state: 'READY_FOR_EXPORT', immutable: true, packageDigest: 'a'.repeat(64),
    manifest: {
      lifecycle: ['OBSERVE','RECOGNIZE','FINANCIAL_RECORD','COIN_POSITION','INSTRUMENT','MARKETPLACE_LISTING','PARTICIPATION','COMMITMENT','ALLOCATION','SETTLEMENT','OWNERSHIP_RECOGNITION','READY_FOR_EXPORT'],
      references: { instrument: 'INS-1', ownershipRecognition: 'OWN-1' },
      records: { instrument: { instrumentId: 'INS-1', instrumentFamily: 'TRUE_BILL', state: 'ISSUED' }, ownershipRecognition: { ownershipRecognitionId: 'OWN-1', state: 'RECOGNIZED' } },
      evidenceIds: ['EVD-1'],
      ...overrides,
    },
  };
}

function serviceWith(pkg = exportPackage(), integrity = { valid: true, storedDigest: 'a'.repeat(64) }) {
  const domain = new MemoryDomain();
  const lifecycle = { getExportPackage: (id) => id === pkg.exportPackageId ? structuredClone(pkg) : null, verifyExportPackage: () => ({ ...integrity }) };
  return { domain, service: new ProductQualificationService(domain, lifecycle) };
}

const evidenceClasses = ['PRODUCT_TERMS','ISSUANCE_OR_CREATION_EVIDENCE','SETTLEMENT_EVIDENCE','OWNERSHIP_EVIDENCE'];

test('built-in product catalog exposes only supported product families', () => {
  const { service } = serviceWith();
  assert.equal(service.listProducts().length, 10);
  assert.equal(service.getProduct('TRUE_BILL').category, 'DEBT_INSTRUMENT');
  assert.equal(service.getProduct('SECURITY'), null);
});

test('product fails when instrument family does not match', () => {
  const pkg = exportPackage({ records: { instrument: { instrumentId: 'INS-1', instrumentFamily: 'COMMERCIAL_PAPER' }, ownershipRecognition: { state: 'RECOGNIZED' } } });
  const { service } = serviceWith(pkg);
  const result = service.qualify({ productCode: 'TRUE_BILL', exportPackageId: 'EXP-1', evidenceClasses });
  assert.equal(result.passed, false);
  assert.equal(result.checks.find((check) => check.id === 'PRODUCT_INSTRUMENT_MATCH').status, 'FAIL');
});

test('product fails when required evidence classes are missing', () => {
  const { service } = serviceWith();
  const result = service.qualify({ productCode: 'TRUE_BILL', exportPackageId: 'EXP-1', evidenceClasses: ['PRODUCT_TERMS'] });
  assert.equal(result.passed, false);
  assert.equal(result.checks.find((check) => check.id === 'EVIDENCE_CLASSES').status, 'FAIL');
});

test('product records one idempotent production qualification', async () => {
  const { domain, service } = serviceWith();
  const first = await service.recordQualification({ productCode: 'TRUE_BILL', exportPackageId: 'EXP-1', evidenceClasses }, 'TEST_AGENT');
  assert.equal(first.created, true);
  assert.equal(first.qualification.state, 'QUALIFIED');
  assert.equal(first.qualification.standard, 'SRA_PRODUCT_QUALIFICATION_V1');
  const second = await service.recordQualification({ productCode: 'TRUE_BILL', exportPackageId: 'EXP-1', evidenceClasses }, 'TEST_AGENT');
  assert.equal(second.created, false);
  assert.equal(second.qualification.productQualificationId, first.qualification.productQualificationId);
  assert.equal(domain.events.some((event) => event.eventType === 'SRA_PRODUCT_PRODUCTION_QUALIFIED'), true);
});

test('new product registration does not claim qualification', async () => {
  const { service } = serviceWith();
  const product = await service.registerProduct({ productCode: 'SECURITY', name: 'Security', category: 'SECURITY_INSTRUMENT', instrumentFamilies: ['SECURITY'], requiredEvidence: ['OFFERING_TERMS','ISSUANCE_EVIDENCE'] }, 'TEST_AGENT');
  assert.equal(product.state, 'ACTIVE');
  assert.equal(product.builtIn, false);
  assert.equal(service.listQualifications({ productCode: 'SECURITY' }).length, 0);
});
