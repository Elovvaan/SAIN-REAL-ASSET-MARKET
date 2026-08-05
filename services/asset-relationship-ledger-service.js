import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const PUBLIC_RELATIONSHIP_TYPES = new Set(['ISSUER', 'ORIGINAL_OWNER', 'CURRENT_OWNER', 'CURRENT_HOLDER', 'CUSTODIAN']);

function now() { return new Date().toISOString(); }
function relationshipId() { return `REL-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function keyOf(input) { return [input.instrumentId, input.relationshipType, input.partyId, input.sourceType, input.sourceId].map((value) => String(value || '')).join('|'); }
function findBy(domain, type, field, value) { return domain.list(type).filter((record) => record?.[field] === value); }

export class AssetRelationshipLedgerService {
  constructor(domain) { this.domain = domain; }

  list(instrumentId, filters = {}) {
    return this.domain.list(RECORD_TYPES.ASSET_RELATIONSHIP)
      .filter((record) => !instrumentId || record.instrumentId === instrumentId)
      .filter((record) => !filters.relationshipType || record.relationshipType === String(filters.relationshipType).toUpperCase())
      .filter((record) => !filters.partyId || record.partyId === filters.partyId)
      .sort((a, b) => String(a.recognizedAt).localeCompare(String(b.recognizedAt)));
  }

  async append(input = {}, actorId = 'SRA_PLATFORM') {
    const required = ['instrumentId', 'relationshipType', 'partyId', 'sourceType', 'sourceId'];
    for (const field of required) if (!String(input[field] || '').trim()) throw new Error(`${field} is required.`);
    const normalized = {
      instrumentId: String(input.instrumentId),
      assetId: input.assetId || null,
      listingId: input.listingId || null,
      relationshipType: String(input.relationshipType).toUpperCase(),
      partyId: String(input.partyId),
      partyType: String(input.partyType || 'PARTICIPANT').toUpperCase(),
      sourceType: String(input.sourceType).toUpperCase(),
      sourceId: String(input.sourceId),
      quantity: input.quantity == null ? null : Number(input.quantity),
      amount: input.amount == null ? null : Number(input.amount),
      currency: input.currency || null,
      rights: Array.isArray(input.rights) ? input.rights : [],
      restrictions: Array.isArray(input.restrictions) ? input.restrictions : [],
      state: String(input.state || 'RECOGNIZED').toUpperCase(),
      recognizedAt: input.recognizedAt || now(),
      recognizedBy: actorId,
      internalOnly: true,
    };
    const relationshipKey = keyOf(normalized);
    const existing = this.domain.list(RECORD_TYPES.ASSET_RELATIONSHIP).find((record) => record.relationshipKey === relationshipKey);
    if (existing) return { created: false, relationship: existing };
    const relationship = { relationshipId: relationshipId(), relationshipKey, ...normalized };
    await this.domain.put(RECORD_TYPES.ASSET_RELATIONSHIP, relationship.relationshipId, relationship, { actorId, eventType: 'ASSET_RELATIONSHIP_RECOGNIZED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.ASSET_RELATIONSHIP, objectId: relationship.relationshipId, eventType: 'SRA_ASSET_RELATIONSHIP_APPENDED', actorId, payload: { instrumentId: relationship.instrumentId, relationshipType: relationship.relationshipType, partyId: relationship.partyId, sourceType: relationship.sourceType, sourceId: relationship.sourceId } });
    return { created: true, relationship };
  }

  async synchronizeInstrument(instrumentId, actorId = 'SRA_PLATFORM') {
    const instrument = this.domain.get(RECORD_TYPES.SRA_INSTRUMENT, instrumentId) || findBy(this.domain, RECORD_TYPES.SRA_INSTRUMENT, 'instrumentId', instrumentId)[0];
    if (!instrument) throw new Error('Instrument not found.');
    const listing = findBy(this.domain, RECORD_TYPES.MARKETPLACE_LISTING, 'instrumentId', instrumentId)[0] || null;
    const participations = listing ? findBy(this.domain, RECORD_TYPES.PARTICIPATION_POSITION, 'listingId', listing.listingId) : [];
    const commitments = listing ? findBy(this.domain, RECORD_TYPES.FUNDING_MARKETPLACE_COMMITMENT, 'listingId', listing.listingId) : [];
    const allocations = findBy(this.domain, RECORD_TYPES.FUNDING_MARKETPLACE_POSITION, 'instrumentId', instrumentId);
    const settlements = findBy(this.domain, RECORD_TYPES.SRA_SETTLEMENT_RECORD, 'instrumentId', instrumentId);
    const ownerships = findBy(this.domain, RECORD_TYPES.OWNERSHIP_RECOGNITION, 'instrumentId', instrumentId);
    const exports = ownerships.flatMap((ownership) => findBy(this.domain, RECORD_TYPES.EXPORT_PACKAGE, 'ownershipRecognitionId', ownership.ownershipRecognitionId));
    const inputs = [];
    if (instrument.issuerId) inputs.push({ instrumentId, assetId: instrument.assetId, listingId: listing?.listingId, relationshipType: 'ISSUER', partyId: instrument.issuerId, partyType: 'ISSUER', sourceType: 'SRA_INSTRUMENT', sourceId: instrument.instrumentId, rights: instrument.rights });
    if (instrument.issuerId) inputs.push({ instrumentId, assetId: instrument.assetId, listingId: listing?.listingId, relationshipType: 'ORIGINAL_OWNER', partyId: instrument.issuerId, partyType: 'OWNER', sourceType: 'SRA_INSTRUMENT', sourceId: instrument.instrumentId });
    for (const record of participations) inputs.push({ instrumentId, listingId: listing?.listingId, relationshipType: 'PARTICIPANT', partyId: record.participantId, sourceType: 'PARTICIPATION_POSITION', sourceId: record.positionId, quantity: record.quantity, state: record.state });
    for (const record of commitments) inputs.push({ instrumentId, listingId: listing?.listingId, relationshipType: 'COMMITTER', partyId: record.participantId, sourceType: 'FUNDING_MARKETPLACE_COMMITMENT', sourceId: record.commitmentId, quantity: record.quantity, amount: record.amount, state: record.state });
    for (const record of allocations) inputs.push({ instrumentId, listingId: record.listingId, relationshipType: 'ALLOCATED_HOLDER', partyId: record.participantId, sourceType: 'FUNDING_MARKETPLACE_POSITION', sourceId: record.positionId, quantity: record.quantity || record.allocatedQuantity, amount: record.amount, state: record.state });
    for (const record of settlements) inputs.push({ instrumentId, listingId: record.listingId, relationshipType: 'SETTLED_PARTY', partyId: record.participantId, sourceType: 'SRA_SETTLEMENT_RECORD', sourceId: record.settlementRecordId, quantity: record.quantity, amount: record.amount, state: record.state });
    for (const record of ownerships) inputs.push({ instrumentId, listingId: record.listingId, relationshipType: 'CURRENT_OWNER', partyId: record.ownerId, partyType: record.ownerType || 'OWNER', sourceType: 'OWNERSHIP_RECOGNITION', sourceId: record.ownershipRecognitionId, quantity: record.quantity, rights: record.rights, restrictions: record.restrictions, state: record.state });
    for (const record of exports) inputs.push({ instrumentId, listingId: listing?.listingId, relationshipType: 'EXPORT_ORIGIN', partyId: 'SRA', partyType: 'SOURCE_SYSTEM', sourceType: 'EXPORT_PACKAGE', sourceId: record.exportPackageId, state: record.state });
    let created = 0;
    for (const input of inputs) { const result = await this.append(input, actorId); if (result.created) created += 1; }
    return { instrumentId, created, relationshipCount: this.list(instrumentId).length, relationships: this.list(instrumentId) };
  }

  publicView(instrumentId) {
    const relationships = this.list(instrumentId);
    const publicRelationships = relationships.filter((record) => PUBLIC_RELATIONSHIP_TYPES.has(record.relationshipType)).map((record) => ({ relationshipType: record.relationshipType, partyId: record.partyId, partyType: record.partyType, quantity: record.quantity, state: record.state, recognizedAt: record.recognizedAt, sourceReference: { type: record.sourceType, id: record.sourceId } }));
    const participantCount = new Set(relationships.filter((record) => ['PARTICIPANT', 'COMMITTER', 'ALLOCATED_HOLDER', 'SETTLED_PARTY'].includes(record.relationshipType)).map((record) => record.partyId)).size;
    return { schema: 'SRA_PUBLIC_RELATIONSHIP_VIEW', schemaVersion: 1, instrumentId, relationshipCount: relationships.length, participantCount, relationships: publicRelationships };
  }
}
