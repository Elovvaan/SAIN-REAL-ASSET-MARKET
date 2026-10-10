import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthlyAmortizationSchedule } from '../services/acquisition-amortization.js';

test('builds a 48 month schedule with payment dates, interest and a zero ending balance', () => {
  const schedule = buildMonthlyAmortizationSchedule({
    principal: 3500000,
    annualRatePercent: 8,
    termMonths: 48,
    firstPaymentDate: '2027-01-31',
  });
  assert.equal(schedule.payments.length, 48);
  assert.equal(schedule.payments[0].dueDate, '2027-01-31');
  assert.equal(schedule.payments[1].dueDate, '2027-02-28');
  assert.equal(schedule.maturityDate, '2030-12-31');
  assert.ok(schedule.regularPaymentAmount > 0);
  assert.equal(schedule.payments.at(-1).endingBalance, 0);
});

test('supports zero rate and rejects incomplete or invalid repayment terms', () => {
  const schedule = buildMonthlyAmortizationSchedule({
    principal: 1200,
    annualRatePercent: 0,
    termMonths: 12,
    firstPaymentDate: '2026-11-15',
  });
  assert.equal(schedule.regularPaymentAmount, 100);
  assert.equal(schedule.totalInterest, 0);
  assert.throws(() => buildMonthlyAmortizationSchedule({ principal: 1200, annualRatePercent: 8, termMonths: 0, firstPaymentDate: '2026-11-15' }), /whole number/);
  assert.throws(() => buildMonthlyAmortizationSchedule({ principal: 1200, annualRatePercent: 8, termMonths: 12, firstPaymentDate: '' }), /valid date/);
  assert.throws(() => buildMonthlyAmortizationSchedule({ principal: 1200, annualRatePercent: '', termMonths: 12, firstPaymentDate: '2026-11-15' }), /required/);
});
