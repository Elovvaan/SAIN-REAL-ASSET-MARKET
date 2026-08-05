import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createProductionReadinessRouter } from '../routes/production-readiness-router.js';
import { ProductionReadinessService } from '../services/production-readiness-service.js';

class MemoryDomain {
  constructor(records = []) {
    this.records = new Map(records.map(({ type, id, payload }) => [`${type}:${id}`, structuredClone(payload)]));
    this.hydratedTypes = [];
  }
  key(type, id) { return `${type}:${id}`; }
  async hydrate(types = []) { this.hydratedTypes.push(...types); return this.snapshot(); }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) {
    const prefix = `${type}:`;
    return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value));
  }
  snapshot() { return { counts: {} }; }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return payload; }
  async lifecycle(payload) { return payload; }
}

test('production router matches advertised full /api/production paths when directly dispatched', async () => {
  const readinessService = {
    productQualificationStatus: async () => ({ service: 'SRA Product Qualification', qualifications: 2 }),
  };
  const app = express();
  app.use(express.json());
  app.use(createProductionReadinessRouter({ readinessService, database: {} }));

  const response = await request(app).get('/api/production/products/status').expect(200);
  assert.equal(response.body.service, 'SRA Product Qualification');
  assert.equal(response.body.qualifications, 2);
});

test('production readiness hydrates persisted product definitions and qualifications before reads', async () => {
  const domain = new MemoryDomain([
    {
      type: 'SRA_PRODUCT_DEFINITION',
      id: 'SECURITY',
      payload: {
        id: 'SECURITY', productDefinitionId: 'SECURITY', productCode: 'SECURITY', name: 'Security',
        category: 'SECURITY_INSTRUMENT', instrumentFamilies: ['SECURITY'], requiredLifecycle: [],
        requiredEvidence: ['OFFERING_TERMS'], state: 'ACTIVE', builtIn: false,
      },
    },
    {
      type: 'SRA_PRODUCT_QUALIFICATION',
      id: 'PQ-1',
      payload: {
        id: 'PQ-1', productQualificationId: 'PQ-1', productCode: 'TRUE_BILL',
        exportPackageId: 'EXP-1', state: 'QUALIFIED', qualifiedAt: '2026-08-05T00:00:00.000Z',
      },
    },
  ]);
  const database = { health: async () => ({ ready: true, persistent: true }) };
  const service = new ProductionReadinessService({ database, domain, intelligence: null });

  const products = await service.listProducts();
  const qualifications = await service.listProductQualifications({ state: 'QUALIFIED' });

  assert.ok(domain.hydratedTypes.includes('SRA_PRODUCT_DEFINITION'));
  assert.ok(domain.hydratedTypes.includes('SRA_PRODUCT_QUALIFICATION'));
  assert.equal(products.some((product) => product.productCode === 'SECURITY'), true);
  assert.equal(qualifications.length, 1);
  assert.equal(qualifications[0].productQualificationId, 'PQ-1');
});
