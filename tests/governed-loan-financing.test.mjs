import assert from 'node:assert/strict';
import test from 'node:test';
import { GovernedLoanFinancingService } from '../services/governed-loan-financing-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

class Domain {
  constructor() { this.records = new Map(); }
  key(t, i) { return `${t}:${i}`; }
  get(t, i) { return this.records.get(this.key(t, i)) || null; }
  list(t) { return [...this.records.entries()].filter(([k]) => k.startsWith(`${t}:`)).map(([, v]) => v); }
  async put(t, i, p) { this.records.set(this.key(t, i), structuredClone(p)); return p; }
  async atomicPut(changes) { for (const c of changes) await this.put(c.type, c.id, c.payload); return changes.map((c) => c.payload); }
}

test('issued loan financing posts balanced receivable and borrower funding liability', async () => {
  const domain = new Domain();
  await domain.put(RECORD_TYPES.SRA_INSTRUMENT, 'INS-1', { instrumentId: 'INS-1', issuanceStatus: 'ISSUED', borrowerParticipantId: 'BORROWER-1' });
  await domain.put(RECORD_TYPES.SRA_TRANSACTION, 'TX-ISSUE', { transactionId: 'TX-ISSUE', transactionType: 'INSTRUMENT_ISSUANCE', instrumentId: 'INS-1', amount: 100000, currency: 'USD' });
  const service = new GovernedLoanFinancingService(domain);
  await service.initialize();
  const preview = service.preview({ issuanceTransactionId: 'TX-ISSUE' });
  assert.equal(preview.journal.debit.accountId, 'TRSY-1200-LOANS-RECEIVABLE');
  assert.equal(preview.journal.credit.accountId, 'TRSY-2100-BORROWER-FUNDING');
  const result = await service.approve({ issuanceTransactionId: 'TX-ISSUE', approval: 'APPROVE' }, 'ADMIN-1');
  assert.equal(result.financing.status, 'FUNDING_CREDITED_PENDING_DISBURSEMENT');
  assert.equal(result.treasury.totalDebits, result.treasury.totalCredits);
  assert.equal(result.treasury.accounts.find((a) => a.accountId === 'TRSY-1200-LOANS-RECEIVABLE').balance, 100000);
  assert.equal(result.treasury.accounts.find((a) => a.accountId === 'TRSY-2100-BORROWER-FUNDING').balance, 100000);
});

test('financing cannot exceed issued face value or self-approve', async () => {
  const domain = new Domain();
  await domain.put(RECORD_TYPES.SRA_INSTRUMENT, 'INS-2', { instrumentId: 'INS-2', issuanceStatus: 'ISSUED', borrowerParticipantId: 'BORROWER-2' });
  await domain.put(RECORD_TYPES.SRA_TRANSACTION, 'TX-2', { transactionId: 'TX-2', transactionType: 'INSTRUMENT_ISSUANCE', instrumentId: 'INS-2', amount: 50000, currency: 'USD' });
  const service = new GovernedLoanFinancingService(domain);
  await service.initialize();
  assert.throws(() => service.preview({ issuanceTransactionId: 'TX-2', amount: 50001 }), /exceed/);
  await assert.rejects(() => service.approve({ issuanceTransactionId: 'TX-2' }, 'ADMIN-1'), /approval/);
});
