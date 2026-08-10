import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/funding-operations-ui.js', import.meta.url), 'utf8');

test('Financing exposes startup business as a first-class opportunity type', () => {
  assert.match(source, /option value="STARTUP_BUSINESS">Startup business/);
  assert.match(source, /option value="BUSINESS_ACQUISITION">Business acquisition/);
  assert.match(source, /option value="STARTUP_LAUNCH">Startup \/ launch/);
});

test('startup business intake mirrors the funding request package sections', () => {
  for (const marker of [
    '1. Applicant & Business',
    '2. What Are You Building?',
    '3. Funding Request',
    '4. Use of Funds',
    '5. Revenue & Repayment Model',
    '6. Customer & Sales Plan',
    '7. Startup Readiness',
    '8. Supporting Evidence Checklist',
    '10. Applicant Statement',
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('startup intake remains inside the existing Funding Operations renderer', () => {
  assert.match(source, /window\.renderParticipantFundingOperations = render/);
  assert.match(source, /mountFundingVerificationDesk/);
  assert.match(source, /sra:funding-operations-rendered/);
  assert.match(source, /payload\.startupFundingRequest = startupPayload/);
});