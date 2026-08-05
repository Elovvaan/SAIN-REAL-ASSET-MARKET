const TYPES = Object.freeze({
  PRODUCT_DEFINITION: 'SRA_PRODUCT_DEFINITION',
  INSTRUMENT: 'SRA_INSTRUMENT',
  LISTING: 'MARKETPLACE_LISTING',
  PARTICIPATION: 'PARTICIPATION_POSITION',
  COMMITMENT: 'FUNDING_MARKETPLACE_COMMITMENT',
  ALLOCATION: 'FUNDING_MARKETPLACE_POSITION',
  SETTLEMENT: 'SRA_SETTLEMENT_RECORD',
  OWNERSHIP: 'OWNERSHIP_RECOGNITION',
  EXPORT: 'EXPORT_PACKAGE',
});

function value(record, fields = []) {
  for (const field of fields) if (record?.[field] != null && record[field] !== '') return record[field];
  return null;
}

function matches(record, fields, candidates) {
  const accepted = new Set(candidates.filter(Boolean).map(String));
  return fields.some((field) => record?.[field] != null && accepted.has(String(record[field])));
}

function family(record) {
  return String(record?.instrumentFamily || record?.instrumentType || '').toUpperCase();
}

function uniqueUpper(values = []) {
  return [...new Set(values.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean))];
}

function activeProductDefinition(domain, productCode) {
  const direct = domain.get?.(TYPES.PRODUCT_DEFINITION, productCode) || null;
  const definition = direct || domain.list(TYPES.PRODUCT_DEFINITION).find((record) => String(record?.productCode || record?.productDefinitionId || record?.id || '').toUpperCase() === productCode) || null;
  return definition && String(definition.state || '').toUpperCase() === 'ACTIVE' ? definition : null;
}

function resolveInstrumentFamilies(domain, productCode) {
  const definition = activeProductDefinition(domain, productCode);
  const configured = uniqueUpper(definition?.instrumentFamilies || []);
  return configured.length ? { definition, instrumentFamilies: configured } : { definition: null, instrumentFamilies: [productCode] };
}

function recordSummary(record, idFields) {
  if (!record) return null;
  return {
    id: value(record, idFields),
    state: record.state || record.status || record.issuanceStatus || null,
  };
}

export function scanProductLifecycleProgress(domain, productCode) {
  const code = String(productCode || '').trim().toUpperCase();
  if (!code) throw new Error('productCode is required.');

  const { definition, instrumentFamilies } = resolveInstrumentFamilies(domain, code);
  const acceptedFamilies = new Set(instrumentFamilies);
  const instruments = domain.list(TYPES.INSTRUMENT).filter((record) => acceptedFamilies.has(family(record)));
  const listings = domain.list(TYPES.LISTING);
  const participations = domain.list(TYPES.PARTICIPATION);
  const commitments = domain.list(TYPES.COMMITMENT);
  const allocations = domain.list(TYPES.ALLOCATION);
  const settlements = domain.list(TYPES.SETTLEMENT);
  const ownerships = domain.list(TYPES.OWNERSHIP);
  const exports = domain.list(TYPES.EXPORT);

  const chains = instruments.map((instrument) => {
    const instrumentId = value(instrument, ['instrumentId', 'id']);
    const instrumentFamily = family(instrument);
    const listing = listings.find((record) => matches(record, ['instrumentId'], [instrumentId])) || null;
    const listingId = value(listing, ['listingId', 'id']);
    const participation = participations.find((record) => matches(record, ['instrumentId', 'listingId'], [instrumentId, listingId])) || null;
    const participantId = value(participation, ['participantId', 'ownerId', 'accountId']);
    const commitment = commitments.find((record) => matches(record, ['instrumentId', 'listingId'], [instrumentId, listingId]) && (!participantId || matches(record, ['participantId', 'ownerId'], [participantId]))) || null;
    const commitmentId = value(commitment, ['commitmentId', 'id']);
    const allocation = allocations.find((record) => matches(record, ['instrumentId', 'listingId', 'commitmentId'], [instrumentId, listingId, commitmentId])) || null;
    const allocationId = value(allocation, ['positionId', 'allocationPositionId', 'id']);
    const allocationParticipant = value(allocation, ['participantId', 'ownerId']) || participantId;
    const settlement = settlements.find((record) => matches(record, ['instrumentId', 'listingId', 'commitmentId', 'allocationPositionId', 'sourcePositionId', 'positionId'], [instrumentId, listingId, commitmentId, allocationId]) && (!allocationParticipant || matches(record, ['participantId', 'ownerId'], [allocationParticipant]))) || null;
    const settlementId = value(settlement, ['settlementRecordId', 'settlementId', 'id']);
    const ownership = ownerships.find((record) => matches(record, ['instrumentId', 'listingId', 'commitmentId', 'allocationPositionId', 'settlementRecordId'], [instrumentId, listingId, commitmentId, allocationId, settlementId])) || null;
    const ownershipId = value(ownership, ['ownershipRecognitionId', 'id']);
    const exportPackage = exports.find((record) => record?.manifest?.references?.instrument === instrumentId || record?.ownershipRecognitionId === ownershipId || record?.manifest?.references?.ownershipRecognition === ownershipId) || null;

    const stages = {
      instrument: recordSummary(instrument, ['instrumentId', 'id']),
      listing: recordSummary(listing, ['listingId', 'id']),
      participation: recordSummary(participation, ['positionId', 'id']),
      commitment: recordSummary(commitment, ['commitmentId', 'id']),
      allocation: recordSummary(allocation, ['positionId', 'allocationPositionId', 'id']),
      settlement: recordSummary(settlement, ['settlementRecordId', 'settlementId', 'id']),
      ownershipRecognition: recordSummary(ownership, ['ownershipRecognitionId', 'id']),
      exportPackage: recordSummary(exportPackage, ['exportPackageId', 'id']),
    };
    const ordered = Object.entries(stages);
    const firstMissing = ordered.find(([, stage]) => !stage)?.[0] || null;
    const completedStages = ordered.filter(([, stage]) => Boolean(stage)).map(([name]) => name);
    return { instrumentId, instrumentFamily, completedStages, firstMissing, readyForExport: Boolean(exportPackage), stages };
  });

  const stageCounts = {};
  for (const stage of ['instrument', 'listing', 'participation', 'commitment', 'allocation', 'settlement', 'ownershipRecognition', 'exportPackage']) {
    stageCounts[stage] = chains.filter((chain) => chain.stages[stage]).length;
  }

  return {
    productCode: code,
    productDefinitionId: definition ? value(definition, ['productDefinitionId', 'id', 'productCode']) : null,
    instrumentFamilies,
    instrumentCount: instruments.length,
    stageCounts,
    furthestStage: [...Object.keys(stageCounts)].reverse().find((stage) => stageCounts[stage] > 0) || null,
    chains: chains.sort((a, b) => b.completedStages.length - a.completedStages.length || String(a.instrumentId).localeCompare(String(b.instrumentId))),
    scannedAt: new Date().toISOString(),
  };
}
