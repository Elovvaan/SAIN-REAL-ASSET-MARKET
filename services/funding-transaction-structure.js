export const FUNDING_TRANSACTION_STRUCTURES = Object.freeze([
  'FUNDING_SETTLEMENT_NOTE',
  'DOCUMENTARY_SIGHT_DRAFT',
  'SECURED_INSTRUMENT',
  'DIGITAL_ASSET_SETTLEMENT',
]);

export const FUNDING_TRANSACTION_STRUCTURE_LABELS = Object.freeze({
  FUNDING_SETTLEMENT_NOTE: 'Funding/Settlement Note',
  DOCUMENTARY_SIGHT_DRAFT: 'Documentary Sight Draft',
  SECURED_INSTRUMENT: 'Secured Instrument',
  DIGITAL_ASSET_SETTLEMENT: 'Digital-Asset Settlement',
});

export const OPPORTUNITY_TRANSACTION_STRUCTURES = Object.freeze({
  STARTUP_BUSINESS: Object.freeze(['FUNDING_SETTLEMENT_NOTE', 'SECURED_INSTRUMENT']),
  BUSINESS_ACQUISITION: Object.freeze(['FUNDING_SETTLEMENT_NOTE', 'DOCUMENTARY_SIGHT_DRAFT', 'SECURED_INSTRUMENT']),
  HOME_EQUITY: Object.freeze(['SECURED_INSTRUMENT']),
  LINE_OF_CREDIT: Object.freeze(['FUNDING_SETTLEMENT_NOTE', 'SECURED_INSTRUMENT']),
  PLATFORM: Object.freeze(['FUNDING_SETTLEMENT_NOTE', 'SECURED_INSTRUMENT', 'DIGITAL_ASSET_SETTLEMENT']),
  PROJECT: Object.freeze(['FUNDING_SETTLEMENT_NOTE', 'SECURED_INSTRUMENT']),
  CONSTRUCTION: Object.freeze(['FUNDING_SETTLEMENT_NOTE', 'SECURED_INSTRUMENT']),
  EQUIPMENT: Object.freeze(['FUNDING_SETTLEMENT_NOTE', 'SECURED_INSTRUMENT']),
  WORKING_CAPITAL: Object.freeze(['FUNDING_SETTLEMENT_NOTE', 'SECURED_INSTRUMENT']),
  INVOICE: Object.freeze(['DOCUMENTARY_SIGHT_DRAFT', 'SECURED_INSTRUMENT']),
  DIGITAL_ASSET: Object.freeze(['DIGITAL_ASSET_SETTLEMENT']),
});

export function normalizeFundingTransactionStructure(value) {
  return String(value || '').trim().toUpperCase();
}

export function transactionStructuresForOpportunity(opportunityType) {
  return OPPORTUNITY_TRANSACTION_STRUCTURES[String(opportunityType || '').trim().toUpperCase()] || FUNDING_TRANSACTION_STRUCTURES;
}

export function assertFundingTransactionStructure(value, opportunityType) {
  const normalized = normalizeFundingTransactionStructure(value);
  if (!FUNDING_TRANSACTION_STRUCTURES.includes(normalized)) {
    throw new Error(`Unsupported proposed transaction structure: ${value || 'none selected'}`);
  }
  if (!transactionStructuresForOpportunity(opportunityType).includes(normalized)) {
    throw new Error(`${FUNDING_TRANSACTION_STRUCTURE_LABELS[normalized]} is not available for opportunity type ${opportunityType}.`);
  }
  return normalized;
}
