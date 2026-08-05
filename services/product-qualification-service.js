import crypto from 'node:crypto';

const PRODUCT_DEFINITION = 'SRA_PRODUCT_DEFINITION';
const PRODUCT_QUALIFICATION = 'SRA_PRODUCT_QUALIFICATION';

const BUILT_IN_PRODUCTS = Object.freeze([
  ['TRUE_BILL', 'DEBT_INSTRUMENT'],
  ['COMMERCIAL_PAPER', 'DEBT_INSTRUMENT'],
  ['PARTICIPATION_POSITION', 'PARTICIPATION_INSTRUMENT'],
  ['REVENUE_PARTICIPATION_INSTRUMENT', 'PARTICIPATION_INSTRUMENT'],
  ['ASSET_BACKED_NOTE', 'DEBT_INSTRUMENT'],
  ['CONSTRUCTION_FUNDING_NOTE', 'DEBT_INSTRUMENT'],
  ['PURCHASE_ORDER_INSTRUMENT', 'COMMERCIAL_INSTRUMENT'],
  ['INVOICE_FINANCE_INSTRUMENT', 'RECEIVABLE_INSTRUMENT'],
  ['WORKING_CAPITAL_NOTE', 'DEBT_INSTRUMENT'],
  ['EQUIPMENT_FINANCE_INSTRUMENT', 'DEBT_INSTRUMENT'],
]);

const REQUIRED_LIFECYCLE = Object.freeze([
  'OBSERVE', 'RECOGNIZE', 'FINANCIAL_RECORD', 'COIN_POSITION', 'INSTRUMENT',
  'MARKETPLACE_LISTING', 'PARTICIPATION', 'COMMITMENT', 'ALLOCATION',
  'SETTLEMENT', 'OWNERSHIP_RECOGNITION', 'READY_FOR_EXPORT',
]);

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function text(value, field) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${field} is required.`);
  return result;
}
function upper(value, field) { return text(value, field).toUpperCase(); }
function unique(values = []) { return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]; }

export class ProductQualificationService {
  constructor(domain, internalLifecycle) {
    this.domain = domain;
    this.internalLifecycle = internalLifecycle;
  }

  async initialize() {
    await this.domain.hydrate([PRODUCT_DEFINITION, PRODUCT_QUALIFICATION]);
    for (const [productCode, category] of BUILT_IN_PRODUCTS) {
      if (this.getProduct(productCode)) continue;
      const definition = {
        id: productCode,
        productDefinitionId: productCode,
        productCode,
        name: productCode.split('_').map((word) => word[0] + word.slice(1).toLowerCase()).join(' '),
        category,
        instrumentFamilies: [productCode],
        requiredLifecycle: [...REQUIRED_LIFECYCLE],
        requiredEvidence: ['PRODUCT_TERMS', 'ISSUANCE_OR_CREATION_EVIDENCE', 'SETTLEMENT_EVIDENCE', 'OWNERSHIP_EVIDENCE'],
        state: 'ACTIVE',
        builtIn: true,
        createdBy: 'SRA_PLATFORM',
        createdAt: now(),
      };
      await this.domain.put(PRODUCT_DEFINITION, productCode, definition, { actorId: 'SRA_PLATFORM', eventType: 'SRA_PRODUCT_DEFINITION_SEEDED' });
    }
    return this.status();
  }

  status() {
    const definitions = this.listProducts();
    const qualifications = this.listQualifications();
    return {
      service: 'SRA Product Qualification',
      standard: 'SRA_PRODUCT_QUALIFICATION_V1',
      activeProducts: definitions.filter((record) => record.state === 'ACTIVE').length,
      qualifiedProducts: new Set(qualifications.filter((record) => record.state === 'QUALIFIED').map((record) => record.productCode)).size,
      qualifications: qualifications.length,
    };
  }

  getProduct(productCode) {
    return this.domain.get(PRODUCT_DEFINITION, String(productCode || '').toUpperCase());
  }

  listProducts(filters = {}) {
    return this.domain.list(PRODUCT_DEFINITION)
      .filter((record) => !filters.state || record.state === String(filters.state).toUpperCase())
      .filter((record) => !filters.category || record.category === String(filters.category).toUpperCase())
      .sort((a, b) => a.productCode.localeCompare(b.productCode));
  }

  async registerProduct(input = {}, actorId = 'SRA_PLATFORM') {
    const productCode = upper(input.productCode, 'productCode');
    if (this.getProduct(productCode)) throw new Error('Product definition already exists.');
    const instrumentFamilies = unique(input.instrumentFamilies || [productCode]).map((value) => value.toUpperCase());
    const requiredEvidence = unique(input.requiredEvidence).map((value) => value.toUpperCase());
    if (!requiredEvidence.length) throw new Error('requiredEvidence must contain at least one evidence class.');
    const definition = {
      id: productCode,
      productDefinitionId: productCode,
      productCode,
      name: text(input.name, 'name'),
      category: upper(input.category, 'category'),
      instrumentFamilies,
      requiredLifecycle: [...REQUIRED_LIFECYCLE],
      requiredEvidence,
      state: 'ACTIVE',
      builtIn: false,
      createdBy: actorId,
      createdAt: now(),
    };
    await this.domain.put(PRODUCT_DEFINITION, productCode, definition, { actorId, eventType: 'SRA_PRODUCT_DEFINITION_REGISTERED' });
    await this.domain.lifecycle({ objectType: PRODUCT_DEFINITION, objectId: productCode, eventType: 'SRA_PRODUCT_REGISTERED', actorId, payload: { category: definition.category } });
    return definition;
  }

  qualify(input = {}, actorId = 'SRA_PLATFORM') {
    const productCode = upper(input.productCode, 'productCode');
    const exportPackageId = text(input.exportPackageId, 'exportPackageId');
    const product = this.getProduct(productCode);
    if (!product || product.state !== 'ACTIVE') throw new Error('Active product definition was not found.');
    const exportPackage = this.internalLifecycle.getExportPackage(exportPackageId);
    if (!exportPackage) throw new Error('Export package was not found.');
    const integrity = this.internalLifecycle.verifyExportPackage(exportPackageId);
    const instrument = exportPackage.manifest?.records?.instrument || null;
    const instrumentFamily = String(instrument?.instrumentFamily || instrument?.instrumentType || '').toUpperCase();
    const lifecycle = exportPackage.manifest?.lifecycle || [];
    const evidenceIds = unique([...(exportPackage.manifest?.evidenceIds || []), ...(input.evidenceIds || [])]);
    const evidenceClasses = unique(input.evidenceClasses).map((value) => value.toUpperCase());

    const checks = [
      { id: 'EXPORT_PACKAGE_INTEGRITY', status: integrity.valid ? 'PASS' : 'FAIL', detail: integrity.valid ? integrity.storedDigest : integrity.reason || 'Digest or immutable state failed.' },
      { id: 'PRODUCT_INSTRUMENT_MATCH', status: product.instrumentFamilies.includes(instrumentFamily) ? 'PASS' : 'FAIL', detail: instrumentFamily || 'Instrument family missing.' },
      { id: 'LIFECYCLE_COMPLETENESS', status: product.requiredLifecycle.every((stage) => lifecycle.includes(stage)) ? 'PASS' : 'FAIL', detail: `${lifecycle.length}/${product.requiredLifecycle.length} required stages represented.` },
      { id: 'EVIDENCE_REFERENCES', status: evidenceIds.length > 0 ? 'PASS' : 'FAIL', detail: `${evidenceIds.length} evidence references supplied.` },
      { id: 'EVIDENCE_CLASSES', status: product.requiredEvidence.every((required) => evidenceClasses.includes(required)) ? 'PASS' : 'FAIL', detail: `Required: ${product.requiredEvidence.join(', ')}.` },
      { id: 'OWNERSHIP_RECOGNITION', status: exportPackage.manifest?.records?.ownershipRecognition?.state === 'RECOGNIZED' ? 'PASS' : 'FAIL', detail: exportPackage.manifest?.references?.ownershipRecognition || null },
    ];
    return { product, exportPackage, integrity, checks, passed: checks.every((check) => check.status === 'PASS'), evidenceIds, evidenceClasses, actorId };
  }

  async recordQualification(input = {}, actorId = 'SRA_PLATFORM') {
    const assessment = this.qualify(input, actorId);
    const existing = this.domain.list(PRODUCT_QUALIFICATION).find((record) => record.productCode === assessment.product.productCode && record.exportPackageId === assessment.exportPackage.exportPackageId && record.state === 'QUALIFIED');
    if (existing) return { qualification: existing, created: false, assessment };
    if (!assessment.passed) throw new Error(`Product qualification failed: ${assessment.checks.filter((check) => check.status === 'FAIL').map((check) => check.id).join(', ')}.`);
    const qualificationId = id('PQ');
    const record = {
      id: qualificationId,
      productQualificationId: qualificationId,
      standard: 'SRA_PRODUCT_QUALIFICATION_V1',
      productCode: assessment.product.productCode,
      productDefinitionId: assessment.product.productDefinitionId,
      exportPackageId: assessment.exportPackage.exportPackageId,
      instrumentId: assessment.exportPackage.manifest?.references?.instrument || null,
      ownershipRecognitionId: assessment.exportPackage.manifest?.references?.ownershipRecognition || null,
      packageDigest: assessment.integrity.storedDigest,
      checks: assessment.checks,
      evidenceIds: assessment.evidenceIds,
      evidenceClasses: assessment.evidenceClasses,
      state: 'QUALIFIED',
      qualifiedBy: actorId,
      qualifiedAt: now(),
    };
    await this.domain.put(PRODUCT_QUALIFICATION, qualificationId, record, { actorId, eventType: 'SRA_PRODUCT_QUALIFIED' });
    await this.domain.lifecycle({ objectType: PRODUCT_QUALIFICATION, objectId: qualificationId, eventType: 'SRA_PRODUCT_PRODUCTION_QUALIFIED', actorId, payload: { productCode: record.productCode, exportPackageId: record.exportPackageId, packageDigest: record.packageDigest } });
    return { qualification: record, created: true, assessment };
  }

  listQualifications(filters = {}) {
    return this.domain.list(PRODUCT_QUALIFICATION)
      .filter((record) => !filters.productCode || record.productCode === String(filters.productCode).toUpperCase())
      .filter((record) => !filters.state || record.state === String(filters.state).toUpperCase())
      .sort((a, b) => String(b.qualifiedAt).localeCompare(String(a.qualifiedAt)));
  }

  getQualification(qualificationId) { return this.domain.get(PRODUCT_QUALIFICATION, qualificationId); }
}

export { PRODUCT_DEFINITION, PRODUCT_QUALIFICATION, BUILT_IN_PRODUCTS, REQUIRED_LIFECYCLE };
