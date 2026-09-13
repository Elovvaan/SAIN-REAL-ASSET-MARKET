import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { financingLetterClosingRequirements } from '../services/financing-letter-closing-requirements.js';

test('participant financing exposes the closed-end SRA home equity intake', async () => {
  const source = await readFile(new URL('../public/participant-financing-ui.js', import.meta.url), 'utf8');
  for (const marker of ['HOME_EQUITY', 'Home equity funding', 'Closed-end secured transaction', 'Fixed return amount', 'Maximum combined LTV %', 'Verified monthly income', 'Repayment-support evidence reference', 'Settlement asset', 'Repayment denomination', "payload.proposedTransactionStructure = 'SECURED_INSTRUMENT'"]) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});

test('home equity closing requirements retain the secured-note and property-recording path', () => {
  const requirements = financingLetterClosingRequirements({ opportunityType: 'HOME_EQUITY', purpose: 'HOME_EQUITY_ACCESS' });
  assert.ok(requirements.some((item) => /Home Equity Funding Note/i.test(item)));
  assert.ok(requirements.some((item) => /mortgage or deed of trust/i.test(item)));
  assert.ok(requirements.some((item) => /settlement-asset delivery instructions/i.test(item)));
});
