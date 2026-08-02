export const enterpriseId = 'ENT-TEST-001';
export const actorId = 'TEST-ACTOR-001';
export const connectorDefinitionId = 'EDX-CD-TEST';
export const connectionId = 'EDX-EC-TEST';
export const policyId = 'EDX-EP-TEST';

export const connectorDefinition = {
  connectorDefinitionId,
  name: 'Structured Test Connector',
  connectorType: 'STRUCTURED_FILE_IMPORT',
  provider: 'SRA Test Fixture',
  version: '1.0.0',
  authenticationMethod: 'SIGNED_FILE',
  supportedRecordCategories: ['DAILY_NET_REVENUE'],
  extractionModes: ['MANUAL'],
  supportedRefreshSchedules: ['MANUAL']
};

export const connection = {
  connectionId,
  enterpriseId,
  connectorDefinitionId,
  sourceSystemIdentifier: 'fixture://daily-books',
  displayName: 'Daily Books Test Source',
  credentialReference: 'TEST-CREDENTIAL-REFERENCE',
  approvedScopes: ['READ_REVENUE'],
  approvedRecordCategories: ['DAILY_NET_REVENUE'],
  refreshSchedule: 'MANUAL'
};

export const policy = {
  policyId,
  connectionId,
  recordCategory: 'DAILY_NET_REVENUE',
  permittedFields: ['posting_date', 'currency', 'net_total'],
  excludedFields: ['customer_name', 'customer_email'],
  aggregationLevel: 'DAILY_SUMMARY',
  extractionFrequency: 'MANUAL',
  purpose: 'Generate the verified daily operating snapshot',
  recipientClass: 'APPROVED_MARKETPLACE_PARTICIPANTS',
  visibility: 'MARKETPLACE',
  retentionDays: 365
};

export const sourceRecords = [
  {
    posting_date: '2026-08-02T12:00:00.000Z',
    currency: 'USD',
    net_total: 125000,
    customer_name: 'Must not persist',
    customer_email: 'private@example.com'
  }
];
