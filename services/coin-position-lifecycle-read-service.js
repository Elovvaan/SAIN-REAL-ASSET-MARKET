import { RECORD_TYPES } from './persistent-domain-service.js';

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const idOf = (record) => record?.coinPositionId || record?.positionId || record?.id || null;
const stateOf = (record) => String(record?.state || 'UNKNOWN').toUpperCase();
const sourceUnit = (record) => String(record?.sourcePosition?.unit || record?.nativeUnit || record?.sourceUnit || 'SOURCE').toUpperCase();
const sourceAmount = (record) => n(record?.sourcePosition?.amount ?? record?.nativeQuantity ?? record?.sourceQuantity);
const CHAIN_TYPE = 'SRA_COIN_CHAIN_PROJECTION';

function isDerivative(record) {
  const id = idOf(record);
  return Boolean(record?.parentPositionId
    || record?.segmentationState === 'ACTIVE_CHILD'
    || (record?.sourcePositionId && record.sourcePositionId !== id));
}

function representedUsd(position, financialRecord) {
  const candidates = [
    position?.recordedValue?.amount,
    position?.representedValueUsd,
    financialRecord?.recordedValue?.amount,
    financialRecord?.recognizedRecordedValue?.amount,
    financialRecord?.recognizedPosition?.unit === 'USD' ? financialRecord?.recognizedPosition?.amount : null,
    financialRecord?.measurement?.unit === 'USD' ? financialRecord?.measurement?.value : null,
  ];
  return candidates.map(Number).find((value) => Number.isFinite(value) && value > 0) || 0;
}

function uniquePositions(domain) {
  const types = [...new Set([RECORD_TYPES.COIN_POSITION, 'SRA_COIN_POSITION'])];
  const byId = new Map();
  for (const type of types) {
    for (const record of domain.list(type)) {
      const id = idOf(record);
      if (id && !byId.has(id)) byId.set(id, record);
    }
  }
  return [...byId.values()].filter((record) => String(record.symbol || '').toUpperCase() === 'SRA');
}

export class CoinPositionLifecycleReadService {
  constructor(domain) { this.domain = domain; }

  read() {
    const positions = uniquePositions(this.domain);
    const financialRecords = this.domain.list(RECORD_TYPES.FINANCIAL_RECORD);
    const recordsById = new Map(financialRecords.map((record) => [record.financialRecordId, record]));
    const coinAccounts = this.domain.list(RECORD_TYPES.COIN_ACCOUNT);
    const lifecycleEvents = this.domain.list(RECORD_TYPES.LIFECYCLE_EVENT || 'LIFECYCLE_EVENT');
    const chainProjection = this.domain.get(CHAIN_TYPE, 'SRA-SOLANA') || null;

    const roots = positions.filter((position) => !isDerivative(position));
    const derivatives = positions.filter(isDerivative);
    const activeRoots = roots.filter((position) => stateOf(position) !== 'RETIRED');
    const retiredRoots = roots.filter((position) => stateOf(position) === 'RETIRED');

    const rows = activeRoots.map((position) => {
      const record = recordsById.get(position.financialRecordId) || null;
      const basisUsd = representedUsd(position, record);
      return {
        coinPositionId: idOf(position),
        financialRecordId: position.financialRecordId || null,
        state: stateOf(position),
        sourceAmount: sourceAmount(position),
        sourceUnit: sourceUnit(position),
        recognizedUsd: basisUsd,
        representedSra: n(position.quantity),
        availableSra: n(position.availableQuantity ?? Math.max(0, n(position.quantity) - n(position.reservedQuantity) - n(position.externalizedQuantity ?? position.externallyTransferredQuantity))),
        reservedSra: n(position.reservedQuantity),
        externalizedSra: n(position.externalizedQuantity ?? position.externallyTransferredQuantity),
        childPositionCount: Array.isArray(position.childPositionIds) ? position.childPositionIds.length : 0,
      };
    });

    const representedSra = rows.reduce((sum, row) => sum + row.representedSra, 0);
    const recognizedUsd = rows.reduce((sum, row) => sum + row.recognizedUsd, 0);
    const missingBasis = rows.filter((row) => !row.recognizedUsd).length;
    const mismatch = rows.filter((row) => row.recognizedUsd > 0 && Math.abs(row.representedSra - row.recognizedUsd) > 0.00000001).length;
    const positionReserved = rows.reduce((sum, row) => sum + row.reservedSra, 0);
    const positionExternalized = rows.reduce((sum, row) => sum + row.externalizedSra, 0);
    const chainExternalized = Math.max(0, n(chainProjection?.issuedOnChainSupply));
    const externalized = Math.max(positionExternalized, chainExternalized);
    const reserved = positionReserved;
    const available = Math.max(0, representedSra - reserved - externalized);
    const retired = retiredRoots.reduce((sum, position) => sum + n(position.quantity), 0);
    const accountIssuance = coinAccounts.filter((account) => String(account.symbol || '').toUpperCase() === 'SRA').reduce((sum, account) => sum + n(account.representedQuantity), 0);

    const sourceMix = {};
    for (const row of rows) sourceMix[row.sourceUnit] = (sourceMix[row.sourceUnit] || 0) + 1;
    const restricted = activeRoots.filter((position) => stateOf(position) === 'RESTRICTED').length;
    const eventText = (event) => String(event?.eventType || JSON.stringify(event));

    return {
      model: 'COIN_POSITION_LIFECYCLE_AGGREGATE',
      completePersistentDomainRead: true,
      supply: {
        activeSra: representedSra,
        availableSra: available,
        reservedSra: reserved,
        externalizedSra: externalized,
        retiredSra: retired,
        accountIssuedSra: accountIssuance,
        recognizedUsd,
      },
      onChain: chainProjection ? {
        network: chainProjection.network || 'SOLANA',
        mintAddress: chainProjection.mintAddress || null,
        issuedSra: chainExternalized,
        pendingSra: Math.max(0, representedSra - chainExternalized),
        lastSynchronizedAt: chainProjection.lastSynchronizedAt || chainProjection.updatedAt || chainProjection.createdAt || null,
      } : null,
      reconciliation: {
        rootPositionCount: roots.length,
        activeRootPositionCount: activeRoots.length,
        derivativePositionCount: derivatives.length,
        missingUsdBasisCount: missingBasis,
        mismatchCount: mismatch,
        parDeltaSra: representedSra - recognizedUsd,
        representationCoveragePct: rows.length ? ((rows.length - missingBasis) / rows.length) * 100 : 100,
        restrictedRootPositionCount: restricted,
        chainSupplyDeltaSra: representedSra - chainExternalized,
      },
      sourceMix,
      history: {
        representationEventCount: lifecycleEvents.filter((event) => /COIN_POSITION_REPRESENTED|COIN_REPRESENTATION_CREATED|MINT/i.test(eventText(event))).length,
        adjustmentEventCount: lifecycleEvents.filter((event) => /ADJUST|RESTAT|CORRECT/i.test(eventText(event))).length,
        retirementEventCount: lifecycleEvents.filter((event) => /RETIR/i.test(eventText(event))).length,
        chainSynchronizationEventCount: lifecycleEvents.filter((event) => /SRA_COIN_PUT_ON_CHAIN|SRA_COIN_ON_CHAIN_SUPPLY_SYNCHRONIZED/i.test(eventText(event))).length,
      },
      counts: {
        coinPositionCount: positions.length,
        financialRecordCount: financialRecords.length,
        coinAccountCount: coinAccounts.length,
      },
      sample: rows.slice(0, 12),
    };
  }
}