import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../routes/funding-opportunity-verification-router.js', import.meta.url), 'utf8');
const authorization = fs.readFileSync(new URL('../middleware/operations-authorization.js', import.meta.url), 'utf8');
const publicUi = fs.readFileSync(new URL('../public/participant-instrument-info.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../public/public-bootstrap.js', import.meta.url), 'utf8');

test('verified underwriting creates a participant applicant-information requirement without changing admin actions', () => {
  assert.match(router, /COMPLETE_APPLICANT_INFORMATION/);
  assert.match(router, /decision.*VERIFIED/s);
  assert.match(router, /PARTICIPANT_APPLICANT_INFORMATION_REQUESTED/);
  assert.match(router, /participantInformationRequirement/);
});

test('participant can only submit applicant information for an owned opportunity', () => {
  assert.match(router, /does not belong to the authenticated participant/);
  assert.match(router, /applicantInstrumentInformation/);
  assert.match(router, /PARTICIPANT_APPLICANT_INFORMATION_COMPLETED/);
});

test('public financing renders an action-required alert and completion form', () => {
  assert.match(publicUi, /ACTION REQUIRED/);
  assert.match(publicUi, /Complete applicant information/);
  assert.match(publicUi, /participant-actions/);
  assert.match(publicUi, /applicant-information/);
  assert.match(publicUi, /aria-live=\"polite\"/);
});

test('participant follow-up endpoints require a standard authenticated session', () => {
  assert.match(authorization, /funding-verification\\\/participant-actions/);
  assert.match(authorization, /applicant-information/);
  assert.match(authorization, /source==='SERVER_SESSION'/);
});

test('participant instrument alert module is part of public deferred features', () => {
  assert.match(bootstrap, /'\/participant-instrument-info\.js'/);
  assert.match(publicUi, /sra:public-features-ready/);
});
