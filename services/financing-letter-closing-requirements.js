const REQUIREMENTS = Object.freeze({
  BUSINESS_ACQUISITION: [
    'Fully executed purchase agreement and related acquisition documents',
    'Seller financial statements and operating records applicable to the acquisition',
    'Current property or asset valuation or appraisal, where applicable',
    'Evidence of required insurance coverage',
    'Applicable leases, rent rolls, title, property, or asset records',
    'Final beneficiary, escrow, title, or settlement instructions',
    'Entity and authorization documents required to complete the closing',
  ],
  REAL_ESTATE_ACQUISITION: [
    'Fully executed purchase agreement and transaction amendments',
    'Current appraisal or other applicable property valuation',
    'Title, escrow, and property records required for closing',
    'Evidence of required property and liability insurance coverage',
    'Applicable leases and current rent roll',
    'Final beneficiary, escrow, title, and settlement instructions',
    'Entity and authorization documents required to complete the closing',
  ],
  COMMERCIAL_REAL_ESTATE: [
    'Fully executed purchase agreement and transaction amendments',
    'Current appraisal or other applicable property valuation',
    'Title, escrow, and property records required for closing',
    'Evidence of required property and liability insurance coverage',
    'Applicable leases and current rent roll',
    'Final beneficiary, escrow, title, and settlement instructions',
    'Entity and authorization documents required to complete the closing',
  ],
  STARTUP_BUSINESS: [
    'Final entity formation and authorization documents applicable to the financing',
    'Final use-of-funds documentation and applicable vendor or equipment agreements',
    'Evidence of required business insurance coverage',
    'Applicable licenses, permits, lease, or occupancy documentation',
    'Final beneficiary and settlement instructions',
  ],
  BUSINESS_EXPANSION: [
    'Final use-of-funds documentation for the approved expansion',
    'Applicable vendor, equipment, construction, or lease agreements',
    'Evidence of required business or property insurance coverage',
    'Entity and authorization documents required to complete the financing',
    'Final beneficiary and settlement instructions',
  ],
  WORKING_CAPITAL: [
    'Final use-of-funds documentation applicable to the approved financing',
    'Current business and entity authorization documents required for closing',
    'Evidence of required business insurance coverage, where applicable',
    'Final beneficiary and settlement instructions',
  ],
});

const PURCHASE_REQUIREMENTS = Object.freeze([
  'Fully executed purchase agreement and related transaction documents',
  'Current valuation or appraisal where applicable to the financed property or assets',
  'Evidence of required insurance coverage',
  'Final beneficiary, escrow, title, or settlement instructions applicable to the transaction',
  'Entity and authorization documents required to complete the closing',
]);

const GENERAL_REQUIREMENTS = Object.freeze([
  'Final transaction documents applicable to the approved financing',
  'Evidence of required insurance coverage, where applicable',
  'Entity and authorization documents required to complete the closing',
  'Final beneficiary and settlement instructions',
]);

function key(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function financingLetterClosingRequirements(opportunity = {}, closing = null) {
  const opportunityType = key(opportunity.opportunityType);
  const purpose = key(opportunity.purpose);
  const base = REQUIREMENTS[opportunityType] || (purpose === 'PURCHASE' ? PURCHASE_REQUIREMENTS : GENERAL_REQUIREMENTS);
  const recorded = Array.isArray(closing?.conditions)
    ? closing.conditions
        .filter((condition) => String(condition.status || '').toUpperCase() !== 'CANCELLED')
        .map((condition) => String(condition.description || condition.requirement || condition.title || '').trim())
        .filter(Boolean)
    : [];
  return [...new Set([...base, ...recorded])];
}
