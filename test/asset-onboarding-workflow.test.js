import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AssetOnboardingService } from '../services/asset-onboarding-service.js';
import { DomainStore } from '../services/domain-store.js';

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

test('creative rights use a specialized rights-bundle schema without changing universal onboarding', () => {
  assert.match(service, /'CREATIVE_RIGHTS'/);
  assert.match(service, /MASTER_RECORDING/);
  assert.match(service, /COMPOSITION_PUBLISHING/);
  assert.match(service, /rightsBundleDescription/);
  assert.match(service, /ownershipPercentage/);
  assert.match(service, /CHAIN_OF_TITLE/);
  assert.match(service, /ROYALTY_STATEMENT/);
  assert.match(publicUi, /Creative-rights bundle/);
  assert.match(publicUi, /it does not treat the entire song, production, or catalog as one undivided asset/);
});

test('creative rights require institutional clearance before registration', () => {
  assert.match(adminRouter, /rightsClearanceConfirmed/);
  assert.match(adminRouter, /chain of title, registrations, revenue records, counterparties, licenses, liens, and participation claims/);
  assert.match(adminUi, /Confirm institutional review of chain of title/);
  assert.match(adminRouter, /clearanceState:'INSTITUTIONALLY_VERIFIED'/);
});

test('creative-rights submissions persist the exact verified-review candidate bundle', async () => {
  const documentService = { get: (id) => ({ id, documentType:'CHAIN_OF_TITLE', originalName:'chain.pdf', sha256:'a'.repeat(64), mimeType:'application/pdf', size:1024 }) };
  const onboarding = new AssetOnboardingService(new DomainStore(), documentService);
  const result = await onboarding.onboard({
    identity:{ name:'Independent Music Catalog', region:'United States' },
    ownership:{ ownerName:'Independent Artist', ownershipType:'INDIVIDUAL' },
    classification:'CREATIVE_RIGHTS',
    creativeRights:{
      workType:'MUSIC', rightTypes:['MASTER_RECORDING','SYNC'], revenueSources:['STREAMING','SYNC_LICENSES'],
      rightsBundleDescription:'Five percent of defined master and sync receipts.', ownershipPercentage:5,
      territory:'Worldwide', identifiers:{ catalogReference:'CAT-001' }, collectionSources:'Distributor statements',
      existingLicenses:'None disclosed', encumbrances:'None disclosed'
    },
    documents:[{ uploadId:'DOC-1', type:'CHAIN_OF_TITLE' }],
    attestation:{ attested:true }
  }, { userId:'USER-1' });
  assert.equal(result.ok,true);
  assert.equal(result.assetCandidate.registrationState,'PROVISIONAL');
  assert.equal(result.assetCandidate.metadata.specializedAssetData.creativeRights.ownershipPercentage,5);
  assert.deepEqual(result.assetCandidate.metadata.specializedAssetData.creativeRights.rightTypes,['MASTER_RECORDING','SYNC']);
  assert.equal(result.institutionalReview.verificationChecklist.length,5);
});
