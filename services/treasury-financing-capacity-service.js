const SOURCE_REFERENCES = new Set([
  'SRA_PLATFORM_TREASURY',
  'SRA_PLATFORM_TREASURY_CASH',
  'TRSY-1000-CASH-USD',
  'TRSY-1050-INSTRUMENT-USD',
]);

const AUTHORIZATION_TYPE = 'FUNDING_MARKETPLACE_SETTLEMENT_AUTHORIZATION';
const TRANSACTION_TYPE = 'SRA_TRANSACTION';
const FUNDING_DEPOSIT_TYPE = 'PLATFORM_FUNDING_INSTRUMENT_DEPOSIT';

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function round(value) { return Number(n(value).toFixed(8)); }
function isTreasurySource(value) { return SOURCE_REFERENCES.has(String(value || '').trim().toUpperCase()); }

export class TreasuryFinancingCapacityService {
  constructor(domain) { this.domain = domain; }

  isTreasurySource(value) { return isTreasurySource(value); }

  canonicalDeposit() {
    return this.domain.list(TRANSACTION_TYPE)
      .find((record) => record.transactionType === FUNDING_DEPOSIT_TYPE
        && record.isCanonicalPlatformFundingInstrument
        && record.state === 'DEPOSITED_RECOGNIZED_USD') || null;
  }

  treasuryAuthorizations() {
    return this.domain.list(AUTHORIZATION_TYPE)
      .filter((record) => isTreasurySource(record.paymentSourceReference));
  }

  treasurySettlements() {
    return this.domain.list(TRANSACTION_TYPE)
      .filter((record) => record.transactionType === 'MARKETPLACE_SETTLEMENT'
        && isTreasurySource(record.paymentSourceReference)
        && ['SETTLED', 'RECORDED', 'COMPLETED'].includes(String(record.status || record.state || '').toUpperCase()));
  }

  summary() {
    const deposit = this.canonicalDeposit();
    const totalCapacityUsd = round(deposit?.faceValueUsd || 0);
    const authorizations = this.treasuryAuthorizations();
    const settlements = this.treasurySettlements();
    const deployedAuthorizationIds = new Set(settlements.map((item) => item.settlementAuthorizationId).filter(Boolean));
    const heldAuthorizations = authorizations.filter((record) =>
      !record.consumedAt
      && !deployedAuthorizationIds.has(record.settlementAuthorizationId)
      && ['AWAITING_CONFIRMATION', 'CONFIRMATION_RECEIVED', 'CONFIRMED'].includes(String(record.status || '').toUpperCase()));
    const committedUsd = round(heldAuthorizations.reduce((sum, item) => sum + n(item.amount), 0));
    const deployedUsd = round(settlements.reduce((sum, item) => sum + n(item.amount), 0));
    const usedUsd = round(committedUsd + deployedUsd);
    const availableFinancingCapacityUsd = round(Math.max(0, totalCapacityUsd - usedUsd));
    const overcommittedUsd = round(Math.max(0, usedUsd - totalCapacityUsd));

    return {
      model: 'TREASURY_FINANCING_CAPACITY_BRIDGE',
      sourceInstrumentDepositId: deposit?.transactionId || null,
      totalFundingCapacityUsd: totalCapacityUsd,
      committedFinancingUsd: committedUsd,
      deployedFinancingUsd: deployedUsd,
      usedFinancingCapacityUsd: usedUsd,
      availableFinancingCapacityUsd,
      overcommittedUsd,
      authorizationCount: heldAuthorizations.length,
      deployedSettlementCount: settlements.length,
      treasurySourceReferences: [...SOURCE_REFERENCES],
      states: {
        available: availableFinancingCapacityUsd,
        held: committedUsd,
        deployed: deployedUsd,
      },
      heldAuthorizations: heldAuthorizations.slice(0, 25),
      deployedSettlements: settlements.slice(0, 25),
    };
  }

  assertAvailable(amountUsd) {
    const requested = round(amountUsd);
    if (requested <= 0) throw new Error('Financing amount must be greater than zero.');
    const summary = this.summary();
    if (requested > summary.availableFinancingCapacityUsd) {
      const error = new Error('Treasury financing capacity is insufficient for this authorization.');
      error.code = 'TREASURY_FINANCING_CAPACITY_INSUFFICIENT';
      error.capacity = summary;
      throw error;
    }
    return { requestedAmountUsd: requested, ...summary };
  }
}

export { SOURCE_REFERENCES as TREASURY_FINANCING_SOURCE_REFERENCES };
