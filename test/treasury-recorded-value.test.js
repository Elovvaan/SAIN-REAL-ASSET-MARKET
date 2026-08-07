import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TreasuryLedgerService } from '../services/treasury-ledger-service.js';
import { RecordedValueRepresentationService } from '../services/recorded-value-representation-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor(seed = {}) {
    this.records = new Map();
    for (const [type, values] of Object.entries(seed)) for (const [id, value] of Object.entries(values)) this.records.set(`${type}:${id}`, structuredClone(value));
  }
  get(type, id) { return structuredClone(this.records.get(`${type}:${id}`) || null); }
  list(type) { const prefix = `${type}:`; return [...this.records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value)); }
  async atomicPut(changes) { for (const change of changes) this.records.set(`${change.type}:${change.id}`, structuredClone(change.payload)); return changes.map((item) => structuredClone(item.payload)); }
}

test('treasury posts only balanced administrator-approved journals', async () => {
  const domain = new Domain();
  const service = new TreasuryLedgerService(domain);
  await service.initialize();
  assert.equal(service.summary().accountCount, 4);
  assert.throws(() => service.preview({ memo: 'bad', lines: [
    { accountId: 'TRSY-1000-CASH-USD', side: 'DEBIT', amount: 100 },
    { accountId: 'TRSY-3000-PLATFORM-CAPITAL', side: 'CREDIT', amount: 90 }
  ] }), /not balanced/i);
  const input = { approval: 'APPROVE', memo: 'Opening platform contribution', reference: 'OPENING-1', idempotencyKey: 'OPENING-1', lines: [
    { accountId: 'TRSY-1000-CASH-USD', side: 'DEBIT', amount: 100 },
    { accountId: 'TRSY-3000-PLATFORM-CAPITAL', side: 'CREDIT', amount: 100 }
  ] };
  const result = await service.approve(input, 'ADMIN-1');
  assert.equal(result.journal.totalDebits, 100);
  assert.equal(result.journal.totalCredits, 100);
  assert.equal(service.summary().cashBalanceUsd, 100);
  assert.equal(service.summary().capitalBalanceUsd, 100);
  assert.equal(service.summary().balanced, true);
  const duplicate = await service.approve(input, 'ADMIN-1');
  assert.equal(duplicate.created, false);
  assert.equal(service.summary().journalCount, 1);
});

test('recorded-value correction preserves native source quantity while restating SRA to recognized USD value', async () => {
  const observation = { observationId: 'OBS-1', rawValues: { price: 50000, size: 0.002, notional: 100 } };
  const financialRecord = { financialRecordId: 'FR-1', observationId: 'OBS-1', recognizedPosition: { amount: 0.002, unit: 'BTC', basis: 'SOURCE_EXECUTED_QUANTITY' }, measurement: { value: 0.002, unit: 'BTC', method: 'SOURCE_EXECUTED_QUANTITY' }, state: 'RECORDED' };
  const coinAccount = { coinAccountId: 'CA-1', financialAccountId: 'FRA-1', symbol: 'SRA', representedQuantity: 0.002, positionCount: 1, state: 'ACTIVE' };
  const position = { coinPositionId: 'CP-1', coinAccountId: 'CA-1', financialRecordId: 'FR-1', observationId: 'OBS-1', symbol: 'SRA', sourcePosition: { amount: 0.002, unit: 'BTC', basis: 'SOURCE_EXECUTED_QUANTITY' }, quantity: 0.002, availableQuantity: 0.002, state: 'REPRESENTED', restrictions: [] };
  const instrument = { instrumentId: 'INS-1', coinPositionId: 'CP-1', state: 'ACTIVE', denomination: { symbol: 'SRA', principalQuantity: 0.002 } };
  const listing = { listingId: 'LIST-1', instrumentId: 'INS-1', coinPositionId: 'CP-1', state: 'PUBLISHED', status: 'LIVE', quantity: 0.002 };
  const domain = new Domain({
    [RECORD_TYPES.MARKET_OBSERVATION]: { 'OBS-1': observation },
    [RECORD_TYPES.FINANCIAL_RECORD]: { 'FR-1': financialRecord },
    [RECORD_TYPES.COIN_ACCOUNT]: { 'CA-1': coinAccount },
    [RECORD_TYPES.COIN_POSITION]: { 'CP-1': position },
    [RECORD_TYPES.SRA_INSTRUMENT]: { 'INS-1': instrument },
    [RECORD_TYPES.MARKETPLACE_LISTING]: { 'LIST-1': listing }
  });
  const service = new RecordedValueRepresentationService(domain);
  const preview = service.preview();
  assert.equal(preview.correctablePositionCount, 1);
  assert.deepEqual(preview.sample[0], {
    coinPositionId: 'CP-1', financialRecordId: 'FR-1', sourceAmount: 0.002, sourceUnit: 'BTC', currentQuantity: 0.002, targetQuantity: 100
  });
  assert.ok(preview.doesNot.includes('CREATE_OR_MODIFY_INSTRUMENTS'));
  assert.ok(preview.doesNot.includes('CREATE_OR_MODIFY_MARKETPLACE_LISTINGS'));

  const result = await service.approve({ approval: 'APPROVE' }, 'ADMIN-1');
  assert.equal(result.correctedPositionCount, 1);
  const corrected = domain.get(RECORD_TYPES.COIN_POSITION, 'CP-1');
  assert.equal(corrected.quantity, 100);
  assert.equal(corrected.availableQuantity, 100);
  assert.deepEqual(corrected.sourcePosition, { amount: 0.002, unit: 'BTC', basis: 'SOURCE_EXECUTED_QUANTITY' });
  assert.equal(corrected.representationBasis.amount, 100);
  assert.equal(corrected.representationBasis.unit, 'USD');
  assert.equal(corrected.conversionRule.method, 'RECORDED_USD_VALUE_AT_PAR');
  assert.equal(domain.get(RECORD_TYPES.COIN_ACCOUNT, 'CA-1').representedQuantity, 100);
  assert.equal(domain.get(RECORD_TYPES.SRA_INSTRUMENT, 'INS-1').denomination.principalQuantity, 0.002);
  assert.equal(domain.get(RECORD_TYPES.MARKETPLACE_LISTING, 'LIST-1').quantity, 0.002);
  assert.deepEqual(domain.get(RECORD_TYPES.FINANCIAL_RECORD, 'FR-1').representation, { representedAmount: 100, unrepresentedAmount: 0, coinUnit: 'SRA', parRate: 1 });
});

test('production private admin wiring exposes treasury and recorded-value correction through Coin Positions', () => {
  const router = fs.readFileSync(new URL('../routes/private-admin-router.js', import.meta.url), 'utf8');
  const routes = fs.readFileSync(new URL('../routes/treasury-admin-routes.js', import.meta.url), 'utf8');
  const bootstrap = fs.readFileSync(new URL('../public/admin/admin-bootstrap.js', import.meta.url), 'utf8');
  const controls = fs.readFileSync(new URL('../public/admin/admin-coin-representation-integrity.js', import.meta.url), 'utf8');
  assert.match(router, /installTreasuryAdminRoutes/);
  assert.match(routes, /\/api\/admin\/treasury\/journals\/approve/);
  assert.match(routes, /\/api\/admin\/recorded-value-representation\/approve/);
  assert.match(bootstrap, /admin-coin-representation-integrity\.js/);
  assert.match(bootstrap, /mountAdminCoinRepresentationIntegrityControls/);
  assert.match(controls, /Legacy Corrections/);
  assert.match(controls, /\/api\/admin\/recorded-value-representation/);
  assert.match(controls, /\/api\/admin\/recorded-value-representation\/approve/);
  assert.match(controls, /Approve USD-at-par correction/);
  assert.doesNotMatch(controls, /MutationObserver/);
  assert.doesNotMatch(controls, /DOMContentLoaded/);
});