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
  constructor(domainStore) {
    this.domainStore = domainStore;
    this.applications = new Map();
  }

  getConfiguration() {
    return {
      classifications,
      ownershipTypes: ['INDIVIDUAL', 'BUSINESS', 'TRUST', 'NONPROFIT', 'PARTNERSHIP', 'OTHER'],
      documentTypes: ['TITLE_OR_DEED', 'OWNERSHIP_AGREEMENT', 'REGISTRATION', 'OPERATING_RECORD', 'INSPECTION', 'VALUATION', 'OTHER'],
      steps: ['REGISTER', 'IDENTITY', 'DOCUMENTS', 'OWNERSHIP', 'CLASSIFICATION', 'VERIFICATION', 'CREATED']
    };
  }

  onboard(payload = {}) {
    const identity = payload.identity || {};
    const ownership = payload.ownership || {};
    const verification = payload.verification || {};
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
    if (!verification.attested) errors.push('Verification attestation is required.');
    if (documents.length === 0) errors.push('At least one supporting document record is required.');
    if (errors.length) return { ok: false, errors };

    const participantId = createId('P');
    const assetId = createId('A');
    const lifecycleRecordId = `LR-${assetId}`;
    const applicationId = createId('AO');
    const now = new Date().toISOString();

    const normalizedDocuments = documents.map((doc, index) => ({
      id: `${applicationId}-DOC-${index + 1}`,
      type: clean(doc.type, 60).toUpperCase() || 'OTHER',
      name: clean(doc.name, 180) || `Document ${index + 1}`,
      reference: clean(doc.reference, 240),
      status: 'RECORDED'
    }));

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

    const lifecycle = this.domainStore.addLifecycleRecord({
      id: lifecycleRecordId,
      assetId,
      events: [
        { id: `${lifecycleRecordId}-EV-1`, type: 'ASSET_REGISTERED', recordedAt: now, payload: { applicationId } },
        { id: `${lifecycleRecordId}-EV-2`, type: 'OWNERSHIP_RECORDED', recordedAt: now, payload: { participantId, ownershipType } },
        { id: `${lifecycleRecordId}-EV-3`, type: 'DOCUMENTS_RECORDED', recordedAt: now, payload: { documentCount: normalizedDocuments.length } },
        { id: `${lifecycleRecordId}-EV-4`, type: 'CLASSIFICATION_ASSIGNED', recordedAt: now, payload: { classification } },
        { id: `${lifecycleRecordId}-EV-5`, type: 'ONBOARDING_VERIFIED', recordedAt: now, payload: { verifierName: clean(verification.verifierName, 120) || 'Self-attested onboarding', method: clean(verification.method, 80) || 'DOCUMENT_REVIEW' } }
      ]
    });

    const onboardingRecord = {
      applicationId,
      assetId,
      participantId,
      identity: { name, region, description, externalReference: clean(identity.externalReference, 160) },
      ownership: { ownerName, ownershipType },
      classification,
      documents: normalizedDocuments,
      verification: {
        status: 'VERIFIED_FOR_ACCOUNT_CREATION',
        method: clean(verification.method, 80) || 'DOCUMENT_REVIEW',
        verifierName: clean(verification.verifierName, 120) || 'Self-attested onboarding',
        attestedAt: now
      },
      createdAt: now
    };

    const asset = this.domainStore.addAsset({
      id: assetId,
      name,
      classification,
      region,
      ownerId: participantId,
      lifecycleRecordId,
      status: 'PENDING_VERIFIED_VALUE',
      metadata: {
        onboardingApplicationId: applicationId,
        description,
        externalReference: clean(identity.externalReference, 160),
        documents: normalizedDocuments,
        verification: onboardingRecord.verification
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
      assetAccount: asset,
      ownerParticipant: participant,
      lifecycleRecord: lifecycle,
      recordHash,
      nextAction: 'BEGIN_VERIFIED_VALUE_BASELINE'
    };
  }

  listApplications() {
    return [...this.applications.values()];
  }
}
