import test from 'node:test';
import assert from 'node:assert/strict';

const baseUrl = process.env.SRA_BASE_URL || 'http://127.0.0.1:3000';

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: 'application/json', 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `${response.status} ${response.statusText}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function unique(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

test('funding engine completes intake through recognized ownership', async () => {
  const participantId = unique('PARTICIPANT');
  const actorId = unique('TEST-ACTOR');
  const headers = { 'x-sra-actor-id': actorId };

  const created = await api('/api/funding/opportunities', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      applicantParticipantId: participantId,
      title: 'Integration Test Funding Opportunity',
      description: 'Automated end-to-end validation of the SRA funding lifecycle.',
      opportunityType: 'PROJECT',
      purpose: 'BUILD',
      requestedAmount: 100000,
      currency: 'USD',
      relatedParticipantIds: [participantId],
      supportingDocumentIds: ['DOC-INTEGRATION-1'],
      relatedAgreementIds: ['AGR-INTEGRATION-1'],
      sourceTransactionIds: ['TX-INTEGRATION-1'],
    }),
  });
  assert.ok(created.opportunityId);

  await api(`/api/funding/opportunities/${created.opportunityId}/evidence`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      evidenceType: 'DOCUMENT',
      title: 'Integration evidence',
      sourceReference: 'DOC-INTEGRATION-1',
      documentId: 'DOC-INTEGRATION-1',
      provenance: { source: 'automated-integration-test' },
    }),
  });

  const completeness = await api(`/api/funding/opportunities/${created.opportunityId}/completeness`);
  assert.equal(completeness.intakeComplete, true);

  await api(`/api/funding/opportunities/${created.opportunityId}/complete-intake`, {
    method: 'POST',
    headers,
    body: '{}',
  });

  const verification = await api(`/api/funding/opportunities/${created.opportunityId}/verification-requests`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  assert.ok(verification.verificationRequestId);

  const startedVerification = await api(`/api/funding-verification/requests/${verification.verificationRequestId}/start`, {
    method: 'POST',
    headers,
    body: '{}',
  });

  for (const checkType of startedVerification.requestedChecks || []) {
    await api(`/api/funding-verification/requests/${verification.verificationRequestId}/findings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ checkType, result: 'VERIFIED', note: 'Automated integration verification.' }),
    });
  }

  await api(`/api/funding-verification/requests/${verification.verificationRequestId}/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision: 'VERIFIED', rationale: 'All automated checks passed.' }),
  });

  const preparation = await api(`/api/funding-value/opportunities/${created.opportunityId}/preparations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      valueDimensions: {
        existingVerifiedValue: 100000,
        productiveCapacity: 100000,
        revenueCapacity: 100000,
        completionCapacity: 100000,
        collateralOrAssetSupport: 100000,
        agreementSupport: 100000,
        transactionSupport: 100000,
      },
      assumptions: ['Automated integration assumptions'],
      exclusions: [],
    }),
  });
  assert.ok(preparation.preparationId);

  await api(`/api/funding-value/preparations/${preparation.preparationId}/complete`, {
    method: 'POST',
    headers,
    body: '{}',
  });

  const assessment = await api(`/api/funding-value/preparations/${preparation.preparationId}/model-assessment`);
  assert.ok(Array.isArray(assessment.assessments));
  assert.ok(assessment.assessments.length > 0);
  const selectedModel = assessment.assessments[0].model;

  const modelSelection = await api(`/api/funding-model/opportunities/${created.opportunityId}/selections`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ selectedModel, selectionRationale: 'Highest automated assessment score.' }),
  });
  assert.ok(modelSelection.selectionId);

  const instrumentRequest = await api(`/api/funding-model/selections/${modelSelection.selectionId}/instrument-request`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  assert.ok(instrumentRequest.instrumentSelectionRequestId);

  const instrumentAssessment = await api(`/api/funding-instrument/requests/${instrumentRequest.instrumentSelectionRequestId}/assessment`);
  assert.ok(instrumentAssessment.candidates?.length);
  const selectedInstrumentFamily = instrumentAssessment.candidates[0].instrumentFamily;

  const instrumentSelection = await api(`/api/funding-instrument/requests/${instrumentRequest.instrumentSelectionRequestId}/selection`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ selectedInstrumentFamily, selectionRationale: 'Highest automated compatibility score.' }),
  });
  assert.ok(instrumentSelection.instrumentSelectionId);

  const instrument = await api(`/api/funding-instrument/selections/${instrumentSelection.instrumentSelectionId}/draft-instrument`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      faceValue: 100000,
      denomination: 'USD',
      maturityDate: '2030-12-31',
      transferabilityStatus: 'RESTRICTED',
      settlementRule: 'SRA_STANDARD_SETTLEMENT',
      governingDocumentId: 'DOC-INTEGRATION-1',
      verifiedValuePackageId: preparation.preparationId,
    }),
  });
  assert.ok(instrument.instrumentId);

  const draftReview = await api(`/api/funding-instrument-review/instruments/${instrument.instrumentId}/reviews`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  for (const checkType of draftReview.reviewScope || []) {
    await api(`/api/funding-instrument-review/reviews/${draftReview.reviewId}/findings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ checkType, result: 'PASS', note: 'Automated integration review.' }),
    });
  }

  await api(`/api/funding-instrument-review/reviews/${draftReview.reviewId}/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision: 'APPROVED_FOR_ISSUANCE_REQUEST', rationale: 'All automated draft checks passed.' }),
  });

  const issuanceRequest = await api(`/api/funding-instrument-review/reviews/${draftReview.reviewId}/issuance-request`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requestedIssueDate: '2026-08-05', requestedMaturityDate: '2030-12-31' }),
  });
  const issuanceReview = await api(`/api/funding-instrument-issuance/requests/${issuanceRequest.issuanceRequestId}/reviews`, {
    method: 'POST',
    headers,
    body: '{}',
  });

  const issuanceDecision = await api(`/api/funding-instrument-issuance/reviews/${issuanceReview.issuanceReviewId}/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision: 'AUTHORIZED', rationale: 'Automated issuance authorization.' }),
  });
  assert.ok(issuanceDecision.issuanceAuthorizationId || issuanceDecision.authorizationId);

  const authorizationId = issuanceDecision.issuanceAuthorizationId || issuanceDecision.authorizationId;
  await api(`/api/funding-instrument-issuance/authorizations/${authorizationId}/issue`, {
    method: 'POST',
    headers,
    body: '{}',
  });

  const marketplacePreparation = await api(`/api/funding-marketplace/instruments/${instrument.instrumentId}/preparations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      listingTitle: 'Integration Test Offering',
      publicSummary: 'Automated test offering.',
      pricingModel: 'FIXED_PRICE',
      unitPrice: 100,
      minimumParticipation: 100,
      maximumParticipation: 100000,
      visibility: 'PUBLIC',
      marketAccessRules: ['VERIFIED_PARTICIPANT'],
      allowedTransactionTypes: ['PRIMARY_SUBSCRIPTION'],
      settlementRoute: 'SRA_STANDARD_SETTLEMENT',
      disclosures: ['Automated integration disclosure'],
    }),
  });

  await api(`/api/funding-marketplace/preparations/${marketplacePreparation.preparationId}/review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision: 'APPROVED', rationale: 'Automated marketplace preparation approval.' }),
  });

  const listing = await api(`/api/funding-marketplace/preparations/${marketplacePreparation.preparationId}/listing`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  assert.ok(listing.listingId);

  const publicationReview = await api(`/api/funding-marketplace-publication/listings/${listing.listingId}/reviews`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const publicationDecision = await api(`/api/funding-marketplace-publication/reviews/${publicationReview.reviewId}/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision: 'AUTHORIZED', rationale: 'Automated publication approval.' }),
  });
  const publicationAuthorizationId = publicationDecision.publicationAuthorizationId || publicationDecision.authorizationId;
  await api(`/api/funding-marketplace-publication/authorizations/${publicationAuthorizationId}/publish`, {
    method: 'POST',
    headers,
    body: '{}',
  });

  const window = await api(`/api/funding-marketplace-commitment/listings/${listing.listingId}/windows`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ opensAt: '2026-08-05T00:00:00.000Z', closesAt: '2027-08-05T00:00:00.000Z' }),
  });

  const commitment = await api(`/api/funding-marketplace-commitment/windows/${window.windowId}/commitments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ participantId, quantity: 10, amount: 1000, currency: 'USD' }),
  });
  await api(`/api/funding-marketplace-commitment/commitments/${commitment.commitmentId}/confirm`, {
    method: 'POST',
    headers,
    body: '{}',
  });

  await api(`/api/funding-marketplace-allocation/windows/${window.windowId}/close`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const allocationReview = await api(`/api/funding-marketplace-allocation/windows/${window.windowId}/reviews`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  await api(`/api/funding-marketplace-allocation/reviews/${allocationReview.reviewId}/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision: 'APPROVED', rationale: 'Automated allocation approval.' }),
  });
  const positions = await api(`/api/funding-marketplace-allocation/reviews/${allocationReview.reviewId}/positions`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const position = positions.records?.[0] || positions.positions?.[0] || positions[0] || positions;
  assert.ok(position.positionId);

  const settlementPreparation = await api(`/api/funding-marketplace-allocation/positions/${position.positionId}/settlement-preparation`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ settlementRoute: 'SRA_STANDARD_SETTLEMENT', settlementReference: 'INTEGRATION-SETTLEMENT-1' }),
  });

  const settlementReview = await api(`/api/funding-marketplace-settlement/preparations/${settlementPreparation.settlementPreparationId}/reviews`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const settlementDecision = await api(`/api/funding-marketplace-settlement/reviews/${settlementReview.reviewId}/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision: 'AUTHORIZED', rationale: 'Automated settlement authorization.' }),
  });
  const settlementAuthorizationId = settlementDecision.settlementAuthorizationId || settlementDecision.authorizationId;
  const settled = await api(`/api/funding-marketplace-settlement/authorizations/${settlementAuthorizationId}/settle`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ settlementReference: 'INTEGRATION-SETTLEMENT-1' }),
  });

  assert.ok(settled);

  const explanation = await api(`/api/sain/intelligence/opportunities/${created.opportunityId}`);
  assert.equal(explanation.opportunityId, created.opportunityId);
});
