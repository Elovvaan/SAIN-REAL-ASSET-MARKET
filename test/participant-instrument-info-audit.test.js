import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../routes/funding-opportunity-verification-router.js', import.meta.url), 'utf8');
const verificationService = fs.readFileSync(new URL('../services/funding-opportunity-verification-service.js', import.meta.url), 'utf8');
const valueRouter = fs.readFileSync(new URL('../routes/funding-opportunity-value-preparation-router.js', import.meta.url), 'utf8');
const authorization = fs.readFileSync(new URL('../middleware/operations-authorization.js', import.meta.url), 'utf8');
const publicUi = fs.readFileSync(new URL('../public/participant-instrument-info.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../public/public-bootstrap.js', import.meta.url), 'utf8');

test('verified underwriting creates the participant applicant-information requirement inside the decision service', () => {
  assert.match(verificationService, /COMPLETE_APPLICANT_INFORMATION/);
  assert.match(verificationService, /PARTICIPANT_APPLICANT_INFORMATION_REQUESTED/);
  assert.match(verificationService, /participantInformationRequirement/);
  assert.match(verificationService, /APPLICANT_INFORMATION_REQUIRED/);
  assert.doesNotMatch(router, /if \(String\(req\.body\?\.decision/);
});

test('participant identity resolution does not claim an ambiguous email match', () => {
  assert.match(router, /const emailMatches = participants\.filter/);
  assert.match(router, /emailMatches\.length === 1 \? emailMatches\[0\] : null/);
});

test('participant can only submit applicant information for an owned opportunity', () => {
  assert.match(router, /does not belong to the authenticated participant/);
  assert.match(router, /applicantInstrumentInformation/);
  assert.match(router, /PARTICIPANT_APPLICANT_INFORMATION_COMPLETED/);
  assert.match(router, /fundingPhase: 'VERIFIED_VALUE_PREPARATION'/);
});

test('value preparation remains blocked while applicant information is required', () => {
  assert.match(valueRouter, /COMPLETE_APPLICANT_INFORMATION/);
  assert.match(valueRouter, /requirement\.status !== 'COMPLETED'/);
  assert.match(valueRouter, /APPLICANT_INFORMATION_REQUIRED/);
  assert.match(valueRouter, /requireApplicantInformationComplete\(service, req\.params\.opportunityId\)/);
});

test('public financing renders an action-required alert and completion form', () => {
  assert.match(publicUi, /ACTION REQUIRED/);
  assert.match(publicUi, /Complete applicant information/);
  assert.match(publicUi, /participant-actions/);
  assert.match(publicUi, /applicant-information/);
  assert.match(publicUi, /aria-live=\"polite\"/);
});

test('late participant action responses are discarded after leaving Financing', () => {
  assert.match(publicUi, /stillFinancingRender/);
  assert.match(publicUi, /sraParticipantInstrumentRenderToken/);
  assert.match(publicUi, /root\.querySelector\('\.participant-financing'\)/);
  assert.match(publicUi, /if \(!stillFinancingRender\(root, renderToken\)\) return/);
});

test('participant follow-up endpoints require a standard authenticated session', () => {
  assert.ok(authorization.includes('/api/funding-verification/participant-actions'));
  assert.match(authorization, /applicant-information/);
  assert.match(authorization, /source==='SERVER_SESSION'/);
});

test('participant instrument alert module is part of public deferred features', () => {
  assert.match(bootstrap, /'\/participant-instrument-info\.js'/);
  assert.match(publicUi, /sra:public-features-ready/);
});
