import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FundingOpportunityIntakeService } from '../services/funding-opportunity-intake-service.js';

class Domain {
  constructor() { this.records = new Map(); this.events = []; }
  key(type, id) { return `${type}:${id}`; }
  async hydrate() {}
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { const prefix = `${type}:`; return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value); }
  async put(type, id, record) { this.records.set(this.key(type, id), structuredClone(record)); return record; }
  async lifecycle(event) { this.events.push(structuredClone(event)); }
}

async function setup() {
  const domain = new Domain();
  await domain.put('PARTICIPANT', 'P-BUYER', { id: 'P-BUYER', type: 'ORGANIZATION' });
  const service = new FundingOpportunityIntakeService(domain);
  await service.initialize();
  return { domain, service };
}

test('business acquisition records the proposed Funding/Settlement Note structure without issuing an instrument', async () => {
  const { service } = await setup();
  const opportunity = await service.create({
    applicantParticipantId: 'P-BUYER',
    title: 'FedEx linehaul acquisition',
    opportunityType: 'BUSINESS_ACQUISITION',
    purpose: 'PURCHASE',
    proposedTransactionStructure: 'FUNDING_SETTLEMENT_NOTE',
    requestedAmount: 3900000,
    currency: 'USD',
  }, 'USR-ADMIN');

  assert.equal(opportunity.proposedTransactionStructure, 'FUNDING_SETTLEMENT_NOTE');
  assert.equal(opportunity.approvedTransactionStructure, null);
  assert.equal(opportunity.status, 'INTAKE_IN_PROGRESS');
});

test('transaction structures are tailored to the selected opportunity type', async () => {
  const { service } = await setup();
  await assert.rejects(() => service.create({
    applicantParticipantId: 'P-BUYER',
    title: 'Acquisition',
    opportunityType: 'BUSINESS_ACQUISITION',
    purpose: 'PURCHASE',
    proposedTransactionStructure: 'DIGITAL_ASSET_SETTLEMENT',
    requestedAmount: 3900000,
    currency: 'USD',
  }, 'USR-ADMIN'), /not available for opportunity type BUSINESS_ACQUISITION/);
});

test('intake completeness requires a proposed transaction structure', async () => {
  const { service } = await setup();
  const opportunity = await service.create({
    applicantParticipantId: 'P-BUYER',
    title: 'Legacy-shaped request',
    opportunityType: 'BUSINESS_ACQUISITION',
    purpose: 'PURCHASE',
    requestedAmount: 100000,
    currency: 'USD',
  }, 'USR-ADMIN');
  assert.equal(service.assessCompleteness(opportunity.opportunityId).required.proposedTransactionStructure, false);
});

test('admin Financing UI exposes the four structures and renders controls before dashboard data resolves', async () => {
  const source = await readFile(new URL('../public/funding-operations-ui.js', import.meta.url), 'utf8');
  for (const value of ['FUNDING_SETTLEMENT_NOTE', 'DOCUMENTARY_SIGHT_DRAFT', 'SECURED_INSTRUMENT', 'DIGITAL_ASSET_SETTLEMENT']) {
    assert.match(source, new RegExp(value));
  }
  assert.match(source, /id="funding-transaction-structure" required disabled/);
  assert.ok(source.indexOf('root.innerHTML = `<section class="funding-ops"') < source.indexOf("const dashboard = await request('/api/funding-operations/dashboard')"));
  assert.match(source, /Financing records could not load/);
  assert.match(source, /data-funding-record-retry/);
});

test('admin loader preloads Funding Operations with timeout, retry, and failed-script removal', async () => {
  const source = await readFile(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
  assert.match(source, /\['\/funding-operations-ui\.js', 'data-sra-admin-funding-operations'\]/);
  assert.match(source, /Timed out loading/);
  assert.match(source, /script\.remove\(\)/);
  assert.match(source, /return await loadScriptOnce/);
});
