const TYPE = 'INSTRUMENT_REPRESENTATION_APPROVAL';
const ELIGIBLE_STATES = new Set(['APPROVED', 'ISSUED', 'ACTIVE', 'RECORDED']);

function now() { return new Date().toISOString(); }
function text(value) { return String(value ?? '').trim(); }
function stateOf(record) { return String(record?.state || record?.status || '').toUpperCase(); }
function approvalId(instrumentId) { return `IRA-${text(instrumentId)}`; }

export class InstrumentRepresentationApprovalService {
  constructor(domain) { this.domain = domain; }

  get(instrumentId) {
    return this.domain.get(TYPE, approvalId(instrumentId)) || null;
  }

  list() {
    return this.domain.list(TYPE).sort((a, b) => String(b.approvedAt || '').localeCompare(String(a.approvedAt || '')));
  }

  evaluate(instrumentId) {
    const instrument = this.domain.get('SRA_INSTRUMENT', instrumentId);
    if (!instrument) return { eligible: false, instrumentId, state: 'NOT_FOUND', blockers: ['INSTRUMENT_NOT_FOUND'] };
    const state = stateOf(instrument);
    const blockers = [];
    if (!ELIGIBLE_STATES.has(state)) blockers.push('INSTRUMENT_NOT_APPROVED_OR_ISSUED');
    return {
      eligible: blockers.length === 0,
      instrumentId,
      state,
      blockers,
      existingApproval: this.get(instrumentId),
      linkedCoinPositionIds: this.domain.list('COIN_POSITION')
        .filter((position) => position.instrumentId === instrumentId || position.sraInstrumentId === instrumentId || position.linkedInstrumentId === instrumentId)
        .map((position) => position.coinPositionId || position.positionId || position.id)
        .filter(Boolean),
    };
  }

  async approve(instrumentId, actorId = 'SRA_PLATFORM_ADMIN') {
    const assessment = this.evaluate(instrumentId);
    if (!assessment.eligible) {
      const error = new Error(`Instrument ${instrumentId} is not ready for representation approval: ${assessment.blockers.join(', ')}`);
      error.code = 'INSTRUMENT_REPRESENTATION_NOT_ELIGIBLE';
      error.assessment = assessment;
      throw error;
    }
    if (assessment.existingApproval?.state === 'APPROVED') return { approval: assessment.existingApproval, changed: false, assessment };

    const approvedAt = now();
    const record = {
      id: approvalId(instrumentId),
      approvalId: approvalId(instrumentId),
      instrumentId,
      state: 'APPROVED',
      coinRepresentation: 'APPROVED',
      onChainPreparation: 'APPROVED',
      linkedCoinPositionIds: assessment.linkedCoinPositionIds,
      approvedBy: actorId,
      approvedAt,
      updatedAt: approvedAt,
      effect: 'Authorizes this instrument to support SRA coin representation and later on-chain preparation.',
      doesNot: ['CREATE_COIN_POSITION', 'MINT_ON_CHAIN', 'SEND_ON_CHAIN', 'PUBLISH_MARKETPLACE'],
    };

    await this.domain.put(TYPE, record.approvalId, record, { actorId, eventType: 'INSTRUMENT_REPRESENTATION_APPROVED' });
    await this.domain.lifecycle({
      objectType: TYPE,
      objectId: record.approvalId,
      eventType: 'INSTRUMENT_REPRESENTATION_APPROVED',
      actorId,
      payload: { instrumentId, linkedCoinPositionIds: record.linkedCoinPositionIds },
    });
    return { approval: record, changed: true, assessment };
  }
}

export { TYPE as INSTRUMENT_REPRESENTATION_APPROVAL_TYPE, ELIGIBLE_STATES as REPRESENTATION_ELIGIBLE_INSTRUMENT_STATES };
