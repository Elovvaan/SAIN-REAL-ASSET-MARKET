import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TreasuryLedgerService } from '../services/treasury-ledger-service.js';
import { PlatformFundingInstrumentDepositService } from '../services/platform-funding-instrument-deposit-service.js';
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

async function setup() {
  const domain = new Domain({
    [RECORD_TYPES.SRA_INSTRUMENT]: {
      'INS-PLATFORM-18M': { instrumentId: 'INS-PLATFORM-18M', name: 'SRA Platform Three-Year Commercial Instrument', state: 'ACTIVE', principalQuantity: 18000000, issuer: { type: 'SRA_PLATFORM', id: 'SAIN_REAL_ASSET_MARKET' } }
    }
  });
  const treasury = new TreasuryLedgerService(domain);
  await treasury.initialize();
  const createdAt = new Date().toISOString();
  await domain.atomicPut([
    { type: RECORD_TYPES.LEDGER_ACCOUNT, id: 'TRSY-1050-INSTRUMENT-USD', payload: { accountId: 'TRSY-1050-INSTRUMENT-USD', code: '1050', name: 'Platform Commercial Instrument — USD', category: 'ASSET', normalSide: 'DEBIT', currency: 'USD', treasuryProfileId: 'SRA_PLATFORM_TREASURY', state: 'ACTIVE', balance: 0, totalDebits: 0, totalCredits: 0, createdAt, updatedAt: createdAt } },
    { type: RECORD_TYPES.LEDGER_ACCOUNT, id: 'TRSY-2200-PLATFORM-INSTRUMENT-FUNDING', payload: { accountId: 'TRSY-2200-PLATFORM-INSTRUMENT-FUNDING', code: '2200', name: 'Platform Commercial Instrument Funding', category: 'LIABILITY', normalSide: 'CREDIT', currency: 'USD', treasuryProfileId: 'SRA_PLATFORM_TREASURY', state: 'ACTIVE', balance: 0, totalDebits: 0, totalCredits: 0, createdAt, updatedAt: createdAt } }
  ]);
  return { domain, treasury, service: new PlatformFundingInstrumentDepositService(domain, treasury) };
}

test('commercial instrument deposit establishes USD financing capacity without owner-contributed capital', async () => {
  const { domain, service } = await setup();
  const input = { instrumentId: 'INS-PLATFORM-18M', faceValueUsd: 18000000, termMonths: 36, depositReference: 'SRA-3YR-18M-001' };
  const preview = service.preview(input);
  assert.equal(preview.financingCapacityUsd, 18000000);
  assert.equal(preview.treasuryEffect.debit.accountId, 'TRSY-1050-INSTRUMENT-USD');
  assert.equal(preview.treasuryEffect.credit.accountId, 'TRSY-2200-PLATFORM-INSTRUMENT-FUNDING');
  assert.ok(preview.doesNot.includes('RECORD_OWNER_CONTRIBUTED_CAPITAL'));
  const result = await service.approve({ ...input, approval: 'APPROVE' }, 'ADMIN-1');
  assert.equal(result.deposit.faceValueUsd, 18000000);
  assert.equal(result.deposit.representedSraQuantity, 18000000);
  assert.equal(result.deposit.financingState, 'AVAILABLE_FOR_GOVERNED_FINANCING');
  assert.equal(domain.get(RECORD_TYPES.LEDGER_ACCOUNT, 'TRSY-1050-INSTRUMENT-USD').balance, 18000000);
  assert.equal(domain.get(RECORD_TYPES.LEDGER_ACCOUNT, 'TRSY-2200-PLATFORM-INSTRUMENT-FUNDING').balance, 18000000);
  assert.equal(domain.get(RECORD_TYPES.LEDGER_ENTRY, result.deposit.ledgerEntryId).totalDebits, 18000000);
  assert.equal(domain.get(RECORD_TYPES.SRA_INSTRUMENT, 'INS-PLATFORM-18M').treasuryState, 'DEPOSITED_RECOGNIZED_USD');
  assert.equal(service.summary().availableFinancingCapacityUsd, 18000000);
  const duplicate = await service.approve({ ...input, approval: 'APPROVE' }, 'ADMIN-1');
  assert.equal(duplicate.created, false);
  assert.equal(service.summary().depositCount, 1);
});

test('production routes and UI expose the commercial instrument deposit workflow', () => {
  const routes = fs.readFileSync(new URL('../routes/treasury-admin-routes.js', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../public/admin/treasury-ledger-ui.js', import.meta.url), 'utf8');
  assert.match(routes, /funding-instrument-deposits\/preview/);
  assert.match(routes, /funding-instrument-deposits\/approve/);
  assert.match(ui, /Deposit Platform Commercial Instrument/);
  assert.match(ui, /18000000/);
  assert.match(ui, /This is not owner-contributed capital/);
});
