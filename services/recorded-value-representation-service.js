import { RECORD_TYPES } from './persistent-domain-service.js';

const EPSILON = 0.00000001;

function recordedUsd(record, observation) {
  const candidates = [
    record?.recordedValue?.amount,
    record?.recognizedRecordedValue?.amount,
    record?.recognizedPosition?.unit === 'USD' ? record?.recognizedPosition?.amount : null,
    record?.measurement?.unit === 'USD' ? record?.measurement?.value : null,
    observation?.rawValues?.notional,
    Number(observation?.rawValues?.price || 0) * Number(observation?.rawValues?.size || 0)
  ];
  const value = candidates.map(Number).find((item) => Number.isFinite(item) && item > 0);
  return value ? Number(value.toFixed(8)) : 0;
}
function difference(left, right) { return Math.abs(Number(left || 0) - Number(right || 0)) > EPSILON; }

export class RecordedValueRepresentationService {
  constructor(domain) { this.domain = domain; }

  chains() {
    const observations = new Map(this.domain.list(RECORD_TYPES.MARKET_OBSERVATION).map((item) => [item.observationId, item]));
    const positions = this.domain.list(RECORD_TYPES.COIN_POSITION).filter((item) => item.symbol === 'SRA' && item.state !== 'RETIRED');
    return positions.map((position) => {
      const record = this.domain.get(RECORD_TYPES.FINANCIAL_RECORD, position.financialRecordId);
      const observation = observations.get(position.observationId || record?.observationId) || null;
      const targetQuantity = recordedUsd(record, observation);
      const currentQuantity = Number(position.quantity || 0);
      return { position, record, observation, currentQuantity, targetQuantity, requiresCorrection: targetQuantity > 0 && difference(currentQuantity, targetQuantity) };
    });
  }

  preview() {
    const chains = this.chains();
    const correctable = chains.filter((item) => item.requiresCorrection);
    return {
      action: 'CORRECT_SRA_REPRESENTATION_TO_RECORDED_USD_VALUE',
      readOnly: true,
      inspectedPositionCount: chains.length,
      correctablePositionCount: correctable.length,
      currentRepresentedQuantity: Number(chains.reduce((sum, item) => sum + item.currentQuantity, 0).toFixed(8)),
      targetRepresentedQuantity: Number(chains.reduce((sum, item) => sum + (item.targetQuantity || item.currentQuantity), 0).toFixed(8)),
      sample: correctable.slice(0, 25).map((item) => ({
        coinPositionId: item.position.coinPositionId,
        financialRecordId: item.record?.financialRecordId || null,
        sourceAmount: item.position.sourcePosition?.amount ?? item.record?.recognizedPosition?.amount ?? null,
        sourceUnit: item.position.sourcePosition?.unit ?? item.record?.recognizedPosition?.unit ?? null,
        currentQuantity: item.currentQuantity,
        targetQuantity: item.targetQuantity
      })),
      parReference: { asset: 'SRA Coin', market: 'SRA/USD', rate: 1, rule: 'SRA_QUANTITY_EQUALS_RECOGNIZED_RECORDED_USD_VALUE' },
      approvalRequired: true,
      effect: 'Restates SRA Coin Positions to the recognized recorded USD value at par while preserving the native source quantity and unit separately.',
      doesNot: ['CREATE_VALUE_WITHOUT_A_RECOGNIZED_FINANCIAL_RECORD', 'CREATE_OR_MODIFY_INSTRUMENTS', 'CREATE_OR_MODIFY_MARKETPLACE_LISTINGS', 'CHANGE_OWNERSHIP', 'CREATE_TRANSACTIONS', 'SETTLE', 'EXPORT']
    };
  }

  async approve(input = {}, actorId = 'SRA_PLATFORM_ADMIN') {
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator approval is required.');
    const correctable = this.chains().filter((item) => item.requiresCorrection);
    let corrected = 0;
    const failures = [];
    for (const chain of correctable) {
      try {
        const timestamp = new Date().toISOString();
        const priorQuantity = chain.currentQuantity;
        const target = chain.targetQuantity;
        const availableBase = chain.position.availableQuantity == null ? priorQuantity : Number(chain.position.availableQuantity || 0);
        const reserved = Number(chain.position.reservedQuantity || 0);
        const externalized = Number(chain.position.externalizedQuantity || chain.position.externallyTransferredQuantity || 0);
        const unencumberedPrior = Math.max(0, priorQuantity - reserved - externalized);
        const availableRatio = unencumberedPrior > 0 ? Math.min(1, Math.max(0, availableBase / unencumberedPrior)) : 1;
        const availableQuantity = Number((Math.max(0, target - reserved - externalized) * availableRatio).toFixed(8));
        const sourcePosition = chain.position.sourcePosition || (chain.record?.recognizedPosition ? { ...chain.record.recognizedPosition } : null);
        const changes = [];
        if (chain.record) {
          changes.push({ type: RECORD_TYPES.FINANCIAL_RECORD, id: chain.record.financialRecordId, actorId, eventType: 'FINANCIAL_RECORD_RECORDED_VALUE_CONFIRMED', payload: {
            ...chain.record,
            recordedValue: { amount: target, currency: 'USD', basis: chain.record.recognizedPosition?.basis || chain.record.measurement?.method || 'RECOGNIZED_RECORDED_VALUE', asOf: chain.record.recognizedPosition?.asOf || chain.record.measurement?.asOf || null },
            recognizedRecordedValue: { amount: target, currency: 'USD' },
            representation: { representedAmount: target, unrepresentedAmount: 0, coinUnit: 'SRA', parRate: 1 },
            updatedAt: timestamp
          } });
        }
        changes.push({ type: RECORD_TYPES.COIN_POSITION, id: chain.position.coinPositionId, actorId, eventType: 'COIN_POSITION_RESTATED_TO_RECORDED_VALUE', payload: {
          ...chain.position,
          sourcePosition,
          representationBasis: { amount: target, unit: 'USD', basis: chain.record?.recordedValue?.basis || chain.record?.recognizedPosition?.basis || chain.record?.measurement?.method || 'RECOGNIZED_RECORDED_VALUE', asOf: chain.record?.recordedValue?.asOf || chain.record?.recognizedPosition?.asOf || chain.record?.measurement?.asOf || null },
          recordedValue: { amount: target, currency: 'USD' },
          quantity: target,
          availableQuantity,
          conversionRule: { ...(chain.position.conversionRule || {}), method: 'RECORDED_USD_VALUE_AT_PAR', rate: 1, sourceUnit: 'USD', coinUnit: 'SRA', methodologyReference: 'ONE_SRA_PER_RECOGNIZED_RECORDED_USD' },
          statusHistory: [...(chain.position.statusHistory || []), { state: chain.position.state, actorId, occurredAt: timestamp, reason: `Quantity restated from ${priorQuantity} to ${target} SRA using recognized recorded USD value at par.` }],
          updatedAt: timestamp
        } });
        if (chain.position.coinAccountId) {
          const account = this.domain.get(RECORD_TYPES.COIN_ACCOUNT, chain.position.coinAccountId);
          if (account) {
            const representedQuantity = Number((Math.max(0, Number(account.representedQuantity || 0) - priorQuantity + target)).toFixed(8));
            changes.push({ type: RECORD_TYPES.COIN_ACCOUNT, id: chain.position.coinAccountId, actorId, eventType: 'COIN_ACCOUNT_REPRESENTED_QUANTITY_RESTATED', payload: {
              ...account,
              representedQuantity,
              updatedAt: timestamp
            } });
          }
        }
        await this.domain.atomicPut(changes);
        corrected += 1;
      } catch (error) {
        failures.push({ coinPositionId: chain.position.coinPositionId, error: error.message || String(error) });
      }
    }
    return { state: failures.length ? 'COMPLETED_WITH_EXCEPTIONS' : 'COMPLETED', correctedPositionCount: corrected, failedPositionCount: failures.length, failures, remaining: this.preview(), parReference: { asset: 'SRA Coin', market: 'SRA/USD', rate: 1 } };
  }
}