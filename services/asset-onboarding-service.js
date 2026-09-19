import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const classifications = [
  'OPERATING_BUSINESS',
  'REAL_ESTATE',
  'MIXED_USE_REAL_ESTATE',
  'AI_COMPUTE_INFRASTRUCTURE',
  'POWER_ENERGY_INFRASTRUCTURE',
  'FIBER_COMMUNICATIONS_INFRASTRUCTURE',
  'EQUIPMENT',
  'VEHICLE',
  'AGRICULTURE',
  'RENEWABLE_ENERGY',
  'INFRASTRUCTURE',
  'CONTRACT_RECEIVABLE',
  'DIGITAL_ASSET',
  'CREATIVE_RIGHTS',
  'INTELLECTUAL_PROPERTY',
  'MINERALS_NATURAL_RESOURCES',
  'OTHER'
];

const creativeRightTypes = ['MASTER_RECORDING', 'COMPOSITION_PUBLISHING', 'PERFORMANCE', 'MECHANICAL', 'SYNC', 'NEIGHBORING_RIGHTS', 'ROYALTY_PARTICIPATION', 'CATALOG_BUNDLE'];
const creativeWorkTypes = ['MUSIC', 'FILM_TELEVISION', 'PODCAST', 'SPORTS_MEDIA', 'LITERARY', 'OTHER'];
const creativeRevenueSources = ['STREAMING', 'DOWNLOADS', 'PERFORMANCE_ROYALTIES', 'MECHANICAL_ROYALTIES', 'SYNC_LICENSES', 'PHYSICAL_SALES', 'BROADCAST', 'OTHER'];

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
  constructor(domainStore, documentService, persistentDomain = null) {
    this.domainStore = domainStore;
    this.documentService = documentService;
    this.persistentDomain = persistentDomain;
    this.applications = new Map();
  }

  async initialize() {
    if (!this.persistentDomain) return;
    for (const application of this.persistentDomain.list(RECORD_TYPES.ONBOARDING_APPLICATION)) {
      this.applications.set(application.applicationId, application);
    }
  }

  getConfiguration() {
    return {
      classifications,
      specializedSchemas: {
        CREATIVE_RIGHTS: {
          workTypes: creativeWorkTypes,
          rightTypes: creativeRightTypes,
          revenueSources: creativeRevenueSources,
          identifiers: ['ISRC', 'ISWC', 'UPC', 'PRO_WORK_ID', 'DISTRIBUTOR_RELEASE_ID', 'CATALOG_REFERENCE'],
          verificationBasis: ['CHAIN_OF_TITLE', 'REGISTRATION_RECORDS', 'ROYALTY_STATEMENTS', 'COUNTERPARTY_CONFIRMATIONS', 'LICENSE_AND_ENCUMBRANCE_REVIEW']
        }
      },
      ownershipTypes: ['INDIVIDUAL', 'BUSINESS', 'TRUST', 'NONPROFIT', 'PARTNERSHIP', 'OTHER'],
      documentTypes: ['TITLE_OR_DEED', 'OWNERSHIP_AGREEMENT', 'REGISTRATION', 'OPERATING_RECORD', 'INSPECTION', 'VALUATION', 'TAX_RECORD', 'CONTRACT', 'CHAIN_OF_TITLE', 'ROYALTY_STATEMENT', 'DISTRIBUTION_AGREEMENT', 'PRO_REGISTRATION', 'LICENSE', 'LIEN_RELEASE', 'COUNTERPARTY_CONFIRMATION', 'OTHER'],
      acceptedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'text/plain'],
      maximumFileSizeMb: 15,
      steps: ['ONBOARDING', 'IDENTITY', 'DOCUMENTS', 'OWNERSHIP', 'CLASSIFICATION', 'SUBMITTER_ATTESTATION', 'SUBMITTED'],
      verificationFlow: ['SUBMITTER_ATTESTED', 'INSTITUTIONAL_REVIEW_PENDING', 'INSTITUTIONALLY_VERIFIED', 'VERIFIED_VALUE_BASELINE'],
      privacy: {
        sourceDocuments: 'PRIVATE',
        institutionalReview: 'RESTRICTED',
        publicRepresentation: 'DERIVED_ONLY'
      }
    };
  }

  async onboard(payload = {}, actor = {}) {
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
    const creativeInput = payload.creativeRights || {};
    const creativeRights = classification === 'CREATIVE_RIGHTS' ? {
      workType: clean(creativeInput.workType, 40).toUpperCase(),
      rightTypes: [...new Set((Array.isArray(creativeInput.rightTypes) ? creativeInput.rightTypes : []).map((value) => clean(value, 60).toUpperCase()).filter((value) => creativeRightTypes.includes(value)))],
      revenueSources: [...new Set((Array.isArray(creativeInput.revenueSources) ? creativeInput.revenueSources : []).map((value) => clean(value, 60).toUpperCase()).filter((value) => creativeRevenueSources.includes(value)))],
      rightsBundleDescription: clean(creativeInput.rightsBundleDescription, 1200),
      ownershipPercentage: Number(creativeInput.ownershipPercentage),
      territory: clean(creativeInput.territory, 160),
      termStart: clean(creativeInput.termStart, 20),
      termEnd: clean(creativeInput.termEnd, 20),
      identifiers: {
        isrc: clean(creativeInput.identifiers?.isrc, 40),
        iswc: clean(creativeInput.identifiers?.iswc, 40),
        upc: clean(creativeInput.identifiers?.upc, 40),
        proWorkId: clean(creativeInput.identifiers?.proWorkId, 80),
        distributorReleaseId: clean(creativeInput.identifiers?.distributorReleaseId, 80),
        catalogReference: clean(creativeInput.identifiers?.catalogReference, 120)
      },
      collectionSources: clean(creativeInput.collectionSources, 600),
      existingLicenses: clean(creativeInput.existingLicenses, 1200),
      encumbrances: clean(creativeInput.encumbrances, 1200),
      clearanceState: 'PENDING_INSTITUTIONAL_REVIEW'
    } : null;

    const errors = [];
    if (!name) errors.push('Asset name is required.');
    if (!region) errors.push('Asset region is required.');
    if (!classifications.includes(classification)) errors.push('A supported asset classification is required.');
    if (!ownerName) errors.push('Owner name is required.');
    if (!ownershipType) errors.push('Ownership type is required.');
    if (!attestation.attested) errors.push('Submitter attestation is required.');
    if (documents.length === 0) errors.push('At least one private supporting document is required.');
    if (classification === 'CREATIVE_RIGHTS') {
      if (!creativeWorkTypes.includes(creativeRights.workType)) errors.push('A supported creative work type is required.');
      if (!creativeRights.rightTypes.length) errors.push('At least one specific creative right is required.');
      if (!creativeRights.revenueSources.length) errors.push('At least one included revenue source is required.');
      if (!creativeRights.rightsBundleDescription) errors.push('The exact creative rights bundle must be described.');
      if (!Number.isFinite(creativeRights.ownershipPercentage) || creativeRights.ownershipPercentage <= 0 || creativeRights.ownershipPercentage > 100) errors.push('Creative-rights ownership percentage must be greater than 0 and no more than 100.');
      if (!creativeRights.territory) errors.push('Creative-rights territory is required.');
      if (!Object.values(creativeRights.identifiers).some(Boolean)) errors.push('At least one creative-work or catalog identifier is required.');
    }

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
    // This internal candidate identifier is not the permanent SRA Asset ID.
    // The permanent identity is issued only after an authorized admin review.
    const assetId = createId('CANDIDATE');
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
      evidencePackageId,
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
      institutionalReviewId,
      evidencePackageId,
      assetId,
      status: 'INSTITUTIONAL_REVIEW_PENDING',
      reviewerId: null,
      findings: [],
      requestedEvidence: [],
      verificationChecklist: creativeRights ? [
        { item: 'CHAIN_OF_TITLE', status: 'PENDING' },
        { item: 'REGISTRATION_AND_ADMINISTRATOR_RECORDS', status: 'PENDING' },
        { item: 'ROYALTY_AND_DISTRIBUTION_STATEMENTS', status: 'PENDING' },
        { item: 'COUNTERPARTY_CONFIRMATIONS', status: 'PENDING' },
        { item: 'LICENSES_LIENS_AND_PARTICIPATIONS', status: 'PENDING' }
      ] : [],
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
      id: applicationId,
      applicationId,
      assetId,
      participantId,
      identity: { name, region, description, externalReference: clean(identity.externalReference, 160) },
      ownership: { ownerName, ownershipType },
      classification,
      evidencePackageId,
      institutionalReviewId,
      specializedAssetData: creativeRights ? { creativeRights } : null,
      submittedByUserId: clean(actor.userId, 120) || null,
      status: 'INSTITUTIONAL_REVIEW_PENDING',
      createdAt: now
    };

    const asset = this.domainStore.addAsset({
      id: assetId,
      name,
      classification,
      region,
      ownerId: participantId,
      lifecycleRecordId,
      status: 'ONBOARDING_REVIEW_PENDING',
      metadata: {
        onboardingApplicationId: applicationId,
        description,
        externalReference: clean(identity.externalReference, 160),
        evidencePackageId,
        institutionalReviewId,
        specializedAssetData: creativeRights ? { creativeRights } : null,
        documents: normalizedDocuments,
        publicRepresentation: null
      }
    });

    const recordHash = hashRecord(onboardingRecord);
    asset.hash = recordHash;
    lifecycle.hash = hashRecord(lifecycle.events);
    participant.hash = hashRecord({ id: participant.id, displayName: participant.displayName, roles: participant.roles });
    const persistedApplication = { ...onboardingRecord, recordHash };
    this.applications.set(applicationId, persistedApplication);

    if (this.persistentDomain) {
      const actorId = clean(actor.userId, 120) || participantId;
      await Promise.all([
        this.persistentDomain.put(RECORD_TYPES.PARTICIPANT, participantId, participant, { actorId, eventType: 'ASSET_OWNER_RECORDED' }),
        this.persistentDomain.put(RECORD_TYPES.ONBOARDING_APPLICATION, applicationId, persistedApplication, { actorId, eventType: 'ONBOARDING_APPLICATION_CREATED' }),
        this.persistentDomain.put(RECORD_TYPES.EVIDENCE_PACKAGE, evidencePackageId, evidencePackage, { actorId, eventType: 'PRIVATE_EVIDENCE_PACKAGE_CREATED' }),
        this.persistentDomain.put(RECORD_TYPES.V4V_PACKAGE, evidencePackageId, { ...evidencePackage, packageId: evidencePackageId, stage: 'EVIDENCE_SUBMITTED' }, { actorId, eventType: 'V4V_PACKAGE_OPENED' }),
        this.persistentDomain.put(RECORD_TYPES.INSTITUTIONAL_REVIEW, institutionalReviewId, institutionalReview, { actorId, eventType: 'INSTITUTIONAL_REVIEW_OPENED' }),
        this.persistentDomain.put(RECORD_TYPES.ASSET_ACCOUNT, assetId, { ...asset, assetId, permanentAssetId: null, registrationState: 'PROVISIONAL' }, { actorId, eventType: 'ASSET_CANDIDATE_CREATED' })
      ]);
      for (const event of lifecycle.events) {
        await this.persistentDomain.lifecycle({
          objectType: RECORD_TYPES.ASSET_ACCOUNT,
          objectId: assetId,
          eventType: event.type,
          actorId,
          payload: event.payload
        });
      }
    }

    return {
      ok: true,
      applicationId,
      evidencePackage,
      institutionalReview,
      assetCandidate: { ...asset, permanentAssetId: null, registrationState: 'PROVISIONAL' },
      // Compatibility alias for earlier clients. This remains provisional and
      // is not the permanent SRA Asset Account issued by admin verification.
      assetAccount: { ...asset, permanentAssetId: null, registrationState: 'PROVISIONAL' },
      ownerParticipant: participant,
      lifecycleRecord: lifecycle,
      recordHash,
      nextAction: 'INSTITUTIONAL_EVIDENCE_REVIEW',
      futureFlow: ['INSTITUTIONALLY_VERIFIED', 'ISSUE_PERMANENT_SRA_ASSET_ID', 'REGISTER_IN_INSTRUMENTS', 'BEGIN_VERIFIED_VALUE_BASELINE', 'CREATE_DIGITAL_REPRESENTATION_IF_AUTHORIZED']
    };
  }

  listApplications() {
    return [...this.applications.values()];
  }
}
