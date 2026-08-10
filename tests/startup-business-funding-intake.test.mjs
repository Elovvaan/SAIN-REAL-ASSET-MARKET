import test from 'node:test';
import assert from 'node:assert/strict';
import { FundingOpportunityIntakeService } from '../services/funding-opportunity-intake-service.js';

class Domain {
  constructor() { this.records = new Map(); this.lifecycleEvents = []; }
  key(type, id) { return `${type}:${id}`; }
  async hydrate() { return {}; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  list(type) { const prefix = `${type}:`; return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value); }
  async put(type, id, payload) { this.records.set(this.key(type, id), payload); return payload; }
  async lifecycle(event) { this.lifecycleEvents.push(event); return event; }
}

function completeStartupPackage(overrides = {}) {
  return {
    applicantBusiness: {
      applicantName: 'Applicant',
      businessLegalEntityName: 'Example Startup LLC',
      businessTradeName: 'Example Startup',
      businessLocation: 'Ogden, Utah',
      emailPhone: 'applicant@example.com',
      businessFormationStatus: 'Formation planned',
    },
    businessDescription: 'A startup that produces and sells custom shirts to local and online customers.',
    requestedLaunchDate: '2026-09-15',
    exactFundingPurpose: 'Launch equipment, inventory, marketing, e-commerce, and initial working capital.',
    useOfFunds: [
      { item: 'Equipment and setup', estimatedCost: 11500, evidenceSource: 'Equipment quotes' },
      { item: 'Inventory and supplies', estimatedCost: 4500, evidenceSource: 'Supplier pricing' },
      { item: 'Marketing and e-commerce', estimatedCost: 2500, evidenceSource: 'Vendor estimates' },
      { item: 'Working capital', estimatedCost: 6500, evidenceSource: 'Startup budget' },
    ],
    revenueRepaymentModel: {
      primaryProductService: 'Custom shirts',
      averageSellingPrice: 25,
      estimatedDirectCostPerSale: 8,
      expectedMonthlySalesVolume: 300,
      expectedMonthlyRevenue: 7500,
      expectedMonthlyOperatingExpenses: 3500,
      expectedMonthlyAvailableBeforeDebtPayments: 4000,
    },
    customerSalesPlan: {
      targetCustomer: 'Local organizations, creators, small businesses, and online apparel buyers.',
      salesChannel: 'Direct outreach, website, social channels, and local orders.',
      demandEvidence: 'Documented customer interest and market evidence.',
    },
    startupReadiness: {
      entityFormation: true,
      equipmentIdentified: true,
      suppliersIdentified: true,
      pricingEstablished: true,
      workspaceIdentified: true,
      salesChannelPlan: true,
      licensesPermitsResearched: true,
      insuranceNeedsIdentified: true,
      initialCustomersOrLeads: true,
      ownerContribution: false,
    },
    supportingEvidenceChecklist: ['EQUIPMENT_INVENTORY_QUOTES', 'SUPPLIER_PRICING', 'STARTUP_BUDGET_CASHFLOW'],
    applicantStatement: { certifiedAccurate: true, printedName: 'Applicant', date: '2026-08-10' },
    ...overrides,
  };
}

test('STARTUP_BUSINESS uses the package fields and becomes complete when the request reconciles', async () => {
  const domain = new Domain();
  domain.records.set(domain.key('PARTICIPANT', 'P-STARTUP'), { participantId: 'P-STARTUP', type: 'BUSINESS' });
  const service = new FundingOpportunityIntakeService(domain);
  await service.initialize();
  const record = await service.create({
    applicantParticipantId: 'P-STARTUP',
    title: 'Startup shirt business',
    opportunityType: 'STARTUP_BUSINESS',
    purpose: 'STARTUP_LAUNCH',
    requestedAmount: 25000,
    currency: 'USD',
    startupFundingRequest: completeStartupPackage(),
  }, 'P-STARTUP');
  assert.equal(record.opportunityType, 'STARTUP_BUSINESS');
  assert.equal(record.startupFundingRequest.useOfFunds.length, 4);
  const completeness = service.assessCompleteness(record.opportunityId);
  assert.equal(completeness.startup.useOfFundsTotal, 25000);
  assert.equal(completeness.startup.useOfFundsDifference, 0);
  assert.equal(completeness.intakeComplete, true);
  const completed = await service.completeIntake(record.opportunityId, 'P-STARTUP');
  assert.equal(completed.status, 'INTAKE_COMPLETE');
});

test('startup intake stays incomplete when use of funds does not equal the funding request', async () => {
  const domain = new Domain();
  domain.records.set(domain.key('PARTICIPANT', 'P-STARTUP'), { participantId: 'P-STARTUP', type: 'BUSINESS' });
  const service = new FundingOpportunityIntakeService(domain);
  await service.initialize();
  const record = await service.create({
    applicantParticipantId: 'P-STARTUP',
    title: 'Startup shirt business',
    opportunityType: 'STARTUP_BUSINESS',
    purpose: 'STARTUP_LAUNCH',
    requestedAmount: 25000,
    currency: 'USD',
    startupFundingRequest: completeStartupPackage({ useOfFunds: [{ item: 'Equipment', estimatedCost: 10000 }] }),
  }, 'P-STARTUP');
  const completeness = service.assessCompleteness(record.opportunityId);
  assert.equal(completeness.startup.useOfFundsMatchesRequest, undefined);
  assert.equal(completeness.required['startup.useOfFundsMatchesRequest'], false);
  assert.equal(completeness.intakeComplete, false);
  await assert.rejects(() => service.completeIntake(record.opportunityId, 'P-STARTUP'), /startup\.useOfFundsMatchesRequest/);
});

test('supporting evidence is recommended rather than fabricated history', async () => {
  const domain = new Domain();
  domain.records.set(domain.key('PARTICIPANT', 'P-STARTUP'), { participantId: 'P-STARTUP', type: 'BUSINESS' });
  const service = new FundingOpportunityIntakeService(domain);
  await service.initialize();
  const pkg = completeStartupPackage({ supportingEvidenceChecklist: [] });
  for (const line of pkg.useOfFunds) line.evidenceSource = null;
  const record = await service.create({ applicantParticipantId: 'P-STARTUP', title: 'Startup', opportunityType: 'STARTUP_BUSINESS', purpose: 'STARTUP_LAUNCH', requestedAmount: 25000, currency: 'USD', startupFundingRequest: pkg }, 'P-STARTUP');
  const completeness = service.assessCompleteness(record.opportunityId);
  assert.equal(completeness.intakeComplete, true);
  assert.equal(completeness.recommended['startup.supportingEvidenceRegistered'], false);
  assert.equal(completeness.recommended['startup.supportingEvidenceChecklist'], false);
});