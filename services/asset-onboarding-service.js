import crypto from 'node:crypto';

const classifications = [
  'OPERATING_BUSINESS',
  'REAL_ESTATE',
  'MIXED_USE_REAL_ESTATE',
  'EQUIPMENT',
  'AGRICULTURE',
  'RENEWABLE_ENERGY',
  'INFRASTRUCTURE',
  'INTELLECTUAL_PROPERTY',
  'OTHER'
];

function clean(value, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function hashRecord(record) {
  return crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

export class AssetOnboardingService {
  constructor(domainStore, documentService) {
    this.domainStore = domainStore;
    this.documentService = documentService;
    this.applications = new Map();
  }

  getConfiguration() {
    return {
      classifications,
      ownershipTypes: ['INDIVIDUAL', 'BUSINESS', 'TRUST', 'NONPROFIT', 'PARTNERSHIP', 'OTHER'],
      documentTypes: ['TITLE_OR_DEED', 'OWNERSHIP_AGREEMENT', 'REGISTRATION', 'OPERATING_RECORD', 'INSPECTION', 'VALUATION', 'TAX_RECORD', 'CONTRACT', 'OTHER'],
      acceptedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'text/plain'],
      maximumFileSizeMb: 15,
      steps: ['REGISTER', 'IDENTITY', 'DOCUMENTS', 'OWNERSHIP', 'CLASSIFICATION', 'SUBMITTER_ATTESTATION', 'CREATED'],
      verificationFlow: ['SUBMITTER_ATTESTED', 'INSTITUTIONAL_REVIEW_PENDING', 'INSTITUTIONALLY_VERIFIED', 'VERIFIED_VALUE_BASELINE'],
      privacy: {
        sourceDocuments: 'PRIVATE',
        institutionalReview: 'RESTRICTED',
        publicRepresentation: 'DERIVED_ONLY'
      }
    };
  }

  onboard(payload = {}) {
    const identity = payload.identity || {};
    const ownership = payload.ownership || {};
    const attestation = payload.attestation || payload.verification || {};
    const documents = Array.isArray(payload.documents) ? payload.documents : [];

    const name = clean(identity.name, 120);
    const region = clean(identity.region, 120);
    const description = clean(identity.description, 1200);
    const classification = clean(payload.classification, 80).toUpperCase();
    const ownerName = clean(ownership.ownerName, 120);
    const ownershipType = clean(ownership.ownershipType, 40).toUpperCase();

    const errors = [];
    if (!name) errors.push('Asset name is required.');
    if (!region) errors.push('Asset region is required.');
    if (!classifications.includes(classification)) errors.push('A supported asset classification is required.');
    if (!ownerName) errors.push('Owner name is required.');
    if (!ownershipType) errors.push('Ownership type is required.');
    if (!attestation.attested) errors.push('Submitter attestation is required.');
    if (documents.length === 0) errors.push('At least one private supporting document is required.');

    const normalizedDocuments = documents.map((doc, index) => {
      const uploadId = clean(doc.uploadId, 80);
      const storedRecord = uploadId && this.documentService ? this.documentService.get(uploadId) : null;
      if (!storedRecord) errors.push(`Document ${index + 1} has not been uploaded into the private evidence store.`);
      return {
        id: storedRecord?.id || uploadId,
        type: clean(doc.type || storedRecord?.documentType, 60).toUpperCase() || 'OTHER',
        name: clean(doc.name || storedRecord?.originalName, 180) || `Document ${index + 1}`,
        uploadId,
        sha256: storedRecord?.sha256 || null,
        mimeType: storedRecord?.mimeType || null,
        size: storedRecord?.size || null,
        privacy: 'PRIVATE_EVIDENCE',
        reviewState: 'SUBMITTED'
      };
    });

    if (errors.length) return { ok: false, errors };

    const participantId = createId('P');
    const assetId = createId('A');
    const lifecycleRecordId = `LR-${assetId}`;
    const applicationId = createId('AO');
    const evidencePackageId = createId('EP');
    const institutionalReviewId = createId('IR');
    const now = new Date().toISOString();

    const participant = this.domainStore.addParticipant({
      id: participantId,
      displayName: ownerName,
      type: ownershipType === 'INDIVIDUAL' ? 'PERSON' : 'ORGANIZATION',
      roles: ['ASSET_OWNER'],
      metadata: {
        ownershipType,
        contactEmail: clean(ownership.contactEmail, 160),
        contactPhone: clean(ownership.contactPhone, 60)
      }
    });

    const evidencePackage = {
      id: evidencePackageId,
      applicationId,
      assetId,
      documentIds: normalizedDocuments.map((document) => document.id),
      documentHashes: normalizedDocuments.map((document) => document.sha256),
      privacy: 'PRIVATE',
      status: 'SUBMITTED',
      createdAt: now,
      submitterAttestation: {
        participantId,
        statement: clean(attestation.statement, 500) || 'I attest that these documents and statements are the evidence I am presenting for institutional review.',
        attestedAt: now
      }
    };
    evidencePackage.hash = hashRecord(evidencePackage);

    const institutionalReview = {
      id: institutionalReviewId,
      evidencePackageId,
      assetId,
      status: 'INSTITUTIONAL_REVIEW_PENDING',
      reviewerId: null,
      findings: [],
      requestedEvidence: [],
      decisionAt: null,
      createdAt: now
    };

    const lifecycle = this.domainStore.addLifecycleRecord({
      id: lifecycleRecordId,
      assetId,
      events: [
        { id: `${lifecycleRecordId}-EV-1`, type: 'ASSET_PRESENTED', recordedAt: now, payload: { applicationId } },
        { id: `${lifecycleRecordId}-EV-2`, type: 'OWNERSHIP_CLAIM_RECORDED', recordedAt: now, payload: { participantId, ownershipType } },
        { id: `${lifecycleRecordId}-EV-3`, type: 'PRIVATE_EVIDENCE_PACKAGE_CREATED', recordedAt: now, payload: { evidencePackageId, documentCount: normalizedDocuments.length } },
        { id: `${lifecycleRecordId}-EV-4`, type: 'SUBMITTER_ATTESTATION_RECORDED', recordedAt: now, payload: { participantId } },
        { id: `${lifecycleRecordId}-EV-5`, type: 'INSTITUTIONAL_REVIEW_OPENED', recordedAt: now, payload: { institutionalReviewId } }
      ]
    });

    const onboardingRecord = {
      applicationId,
      assetId,
      participantId,
      identity: { name, region, description, externalReference: clean(identity.externalReference, 160) },
      ownership: { ownerName, ownershipType },
      classification,
      evidencePackage,
      institutionalReview,
      createdAt: now
    };

    const asset = this.domainStore.addAsset({
      id: assetId,
      name,
      classification,
      region,
      ownerId: participantId,
      lifecycleRecordId,
      status: 'PENDING_INSTITUTIONAL_VERIFICATION',
      metadata: {
        onboardingApplicationId: applicationId,
        description,
        externalReference: clean(identity.externalReference, 160),
        evidencePackageId,
        institutionalReviewId,
        documents: normalizedDocuments,
        publicRepresentation: null
      }
    });

    const recordHash = hashRecord(onboardingRecord);
    asset.hash = recordHash;
    lifecycle.hash = hashRecord(lifecycle.events);
    participant.hash = hashRecord({ id: participant.id, displayName: participant.displayName, roles: participant.roles });

    this.applications.set(applicationId, { ...onboardingRecord, recordHash });

    return {
      ok: true,
      applicationId,
      evidencePackage,
      institutionalReview,
      assetAccount: asset,
      ownerParticipant: participant,
      lifecycleRecord: lifecycle,
      recordHash,
      nextAction: 'INSTITUTIONAL_EVIDENCE_REVIEW',
      futureFlow: ['INSTITUTIONALLY_VERIFIED', 'BEGIN_VERIFIED_VALUE_BASELINE', 'CREATE_DIGITAL_REPRESENTATION_IF_AUTHORIZED']
    };
  }

  listApplications() {
    return [...this.applications.values()];
  }
}
