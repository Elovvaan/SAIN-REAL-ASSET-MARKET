export function createSraCoreEngineRegistry({ marketplaceListingService = null } = {}) {
  return [
    {
      name: 'RECOGNITION_ENGINE',
      async run({ domain }) {
        return { recordsObserved: domain.list('OBSERVATION').length, recognitionRecords: domain.list('RECOGNITION_ASSESSMENT').length };
      },
    },
    {
      name: 'VERIFIED_VALUE_ENGINE',
      async run({ domain }) {
        return { financialRecords: domain.list('FINANCIAL_RECORD').length, coinPositions: domain.list('COIN_POSITION').length };
      },
    },
    {
      name: 'INSTRUMENT_ENGINE',
      async run({ domain }) {
        return { instruments: domain.list('SRA_INSTRUMENT').length };
      },
    },
    {
      name: 'RELATIONSHIP_ENGINE',
      async run({ domain }) {
        return { relationships: domain.list('ASSET_RELATIONSHIP').length };
      },
    },
    {
      name: 'MARKET_ENGINE',
      async run({ domain }) {
        const listings = domain.list('MARKETPLACE_LISTING');
        return {
          listings: listings.length,
          live: listings.filter((item) => ['PUBLISHED', 'ACTIVE'].includes(item.state)).length,
          prepared: listings.filter((item) => item.state === 'PREPARED').length,
          marketplaceStatus: marketplaceListingService?.status?.() || null,
        };
      },
    },
    {
      name: 'HYBRID_REFERENCE_ENGINE',
      async run({ domain }) {
        return {
          marketDefinitions: domain.list('SRA_HYBRID_MARKET_DEFINITION').length,
          referenceObservations: domain.list('SRA_HYBRID_MARKET_REFERENCE').length,
        };
      },
    },
    {
      name: 'INTELLIGENCE_ENGINE',
      async run({ domain }) {
        const cycles = domain.list('SRA_CORE_HEARTBEAT_CYCLE');
        return { priorCycleCount: cycles.length, explanationReady: true };
      },
    },
  ];
}
