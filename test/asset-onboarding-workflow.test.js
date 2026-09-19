import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const service = read('../services/asset-onboarding-service.js');
const publicUi = read('../public/onboarding.js');
const access = read('../public/access.js');
const funding = read('../public/funding-operations-ui.js');
const adminUi = read('../public/admin/admin-suite-shell.js');
const adminRouter = read('../routes/private-admin-router.js');
const participantSuite = read('../public/participant-workspace-suite.js');

test('asset onboarding is universal and remains separate from financing intake', () => {
  assert.match(service, /AI_COMPUTE_INFRASTRUCTURE/);
  assert.match(service, /POWER_ENERGY_INFRASTRUCTURE/);
  assert.match(service, /FIBER_COMMUNICATIONS_INFRASTRUCTURE/);
  assert.match(publicUi, /Asset Onboarding/);
  assert.match(publicUi, /separate from financing and Open Opportunity intake/);
  assert.match(access, /nav:\['marketplace','onboarding','positions','activity'\]/);
  assert.match(participantSuite, /\['onboarding', \['＋', 'Asset Onboarding'\]\]/);
  assert.match(participantSuite, /window\.renderOnboarding/);
});

test('submission creates a review reference before permanent asset registration', () => {
  assert.match(service, /createId\('CANDIDATE'\)/);
  assert.match(service, /registrationState: 'PROVISIONAL'/);
  assert.match(publicUi, /r\.applicationId/);
  assert.doesNotMatch(publicUi, /r\.assetAccount\.id/);
});

test('admin verification issues the permanent asset identity and instrument registry record', () => {
  assert.match(adminUi, /Asset Onboarding/);
  assert.match(adminUi, /Verify and issue SRA Asset ID/);
  assert.match(adminRouter, /SRA-AST-/);
  assert.match(adminRouter, /instrumentType:'REGISTERED_ASSET'/);
  assert.match(adminRouter, /financingState:'AVAILABLE_FOR_OPPORTUNITY_INTAKE'/);
  assert.match(adminRouter, /Asset Provider capability must be active before a permanent SRA Asset ID can be issued/);
});

test('opportunity intake can select a registered permanent asset', () => {
  assert.match(funding, /funding-existing-asset/);
  assert.match(funding, /\/api\/onboarding\/registered-assets/);
  assert.match(funding, /payload\.relatedAssetIds/);
});
