import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectValueAccountService } from '../services/direct-value-account-service.js';
import { ProductiveBasketService } from '../services/productive-basket-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  key(type, id) { return `${type}:${id}`; }
  get(type, id) { return structuredClone(this.records.get(this.key(type, id)) || null); }
  list(type) { return [...this.records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => structuredClone(value)); }
  async put(type, id, payload) { this.records.set(this.key(type, id), structuredClone(payload)); return payload; }
  async atomicPut(changes) { for (const change of changes) await this.put(change.type, change.id, change.payload); return changes.map((change) => change.payload); }
}

async function fixture() {
  const domain = new Domain();
  const accounts = new DirectValueAccountService(domain); await accounts.initialize();
  const baskets = new ProductiveBasketService(domain, accounts);
  const account1 = await accounts.ensureAccount({ participantId:'P-1', universalAccountId:'UA-1' });
  const account2 = await accounts.ensureAccount({ participantId:'P-2', universalAccountId:'UA-2' });
  await domain.put(RECORD_TYPES.SRA_TRANSACTION, 'F-1', { transactionId:'F-1', transactionType:'LOAN_FINANCING_AUTHORIZATION', borrowerParticipantId:'P-1', amount:600, currency:'USD', state:'POSTED' });
  await domain.put(RECORD_TYPES.SRA_TRANSACTION, 'F-2', { transactionId:'F-2', transactionType:'LOAN_FINANCING_AUTHORIZATION', borrowerParticipantId:'P-2', amount:400, currency:'USD', state:'POSTED' });
  await accounts.creditAuthorizedFunding({ financingTransactionId:'F-1', universalAccountId:'UA-1' }, 'ADMIN');
  await accounts.creditAuthorizedFunding({ financingTransactionId:'F-2', universalAccountId:'UA-2' }, 'ADMIN');
  return { domain, accounts, baskets, account1, account2 };
}

test('productive basket preserves contributed assets and distributes recorded value pro rata', async () => {
  const { accounts, baskets, account1, account2 } = await fixture();
  await assert.rejects(() => baskets.create({ name:'Denied', targetRecognizedValue:100, unitSymbol:'NO' }, { participantId:'P-1', capacity:'UNIVERSAL' }), /not available/);
  const basket = await baskets.create({ name:'SRA Productive 10', model:'FIXED_BUNDLE', targetRecognizedValue:1000, minimumCloseValue:1000, unitSymbol:'SP10' }, { participantId:'MP-1', capacity:'MARKET_PROFESSIONAL' });
  const admission = await baskets.submitAsset(basket.basketId, { canonicalAssetId:'SRA-USD', network:'NATIVE', evidenceReference:'REGISTRY-SNAPSHOT-1' }, { participantId:'AP-1', capacity:'ASSET_PROVIDER' });
  await baskets.decideAdmission(admission.admissionId, { decision:'APPROVE', recognitionRate:1, recognitionEvidenceReference:'VALUATION-1' }, { participantId:'IO-1', capacity:'INSTITUTIONAL_OPERATOR' });
  const first = await baskets.contribute(basket.basketId, { directValueAccountId:account1.directValueAccountId, canonicalAssetId:'SRA-USD', network:'NATIVE', amount:600 }, { participantId:'P-1', capacity:'UNIVERSAL' });
  await baskets.contribute(basket.basketId, { directValueAccountId:account2.directValueAccountId, canonicalAssetId:'SRA-USD', network:'NATIVE', amount:400 }, { participantId:'P-2', capacity:'UNIVERSAL' });
  assert.equal(first.contribution.conversionAuthorized, false);
  assert.equal(accounts.getPosition(account1.directValueAccountId, 'SRA-USD').restricted, 600);
  await baskets.closeFormation(basket.basketId, { closingEvidenceReference:'CLOSE-1' }, { participantId:'IO-1', capacity:'INSTITUTIONAL_OPERATOR' });
  await baskets.recordPerformance(basket.basketId, { currentVerifiedValue:1100, grossValueReceived:100, operatingExpenses:10, requiredCommitments:5, administrationAmount:5, evidenceReference:'PERF-1' }, { participantId:'IO-1', capacity:'INSTITUTIONAL_OPERATOR' });
  const distribution = await baskets.distribute(basket.basketId, { amount:80, settlementReference:'DIST-1' }, { participantId:'ADMIN', capacity:'PLATFORM_ADMIN' });
  assert.deepEqual(distribution.distribution.allocations.map((item) => item.amount), [48, 32]);
  assert.equal(accounts.getPosition(account1.directValueAccountId, 'SRA-USD').available, 48);
  const duplicate = await baskets.distribute(basket.basketId, { amount:80, settlementReference:'DIST-1' }, { participantId:'ADMIN', capacity:'PLATFORM_ADMIN' });
  assert.equal(duplicate.created, false);
  await assert.rejects(() => baskets.reconstitute(basket.basketId, { action:'REMOVE', admissionId:admission.admissionId, decisionRationale:'test', evidenceReference:'E-1' }, { participantId:'IO-1', capacity:'INSTITUTIONAL_OPERATOR' }), /fixed/);
});
