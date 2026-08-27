import { OperationalIntelligenceService } from './operational-intelligence-service.js';

function fingerprint(parts = []) {
  return parts.filter((value) => value !== null && value !== undefined && value !== '').join(':');
}

export class OperationalIntelligenceIntegrationService {
  constructor(domain, intelligence = null) {
    this.domain = domain;
    this.intelligence = intelligence || new OperationalIntelligenceService(domain);
  }

  hasEvent(eventId) {
    return this.intelligence.records('OPERATIONAL_EVENT').some((record) => record.eventId === eventId || record.id === eventId);
  }

  observeOnce(input = {}) {
    const eventId = input.eventId || fingerprint([
      'OE',
      input.eventType,
      input.financingTransactionId || input.transactionId || input.exportPackageId || input.workOrderId || input.instrumentId || input.listingId || 'GLOBAL',
      input.stateAfter || input.state || input.status || 'RECORDED',
    ]);
    if (eventId && this.hasEvent(eventId)) {
      return this.intelligence.records('OPERATIONAL_EVENT').find((record) => record.eventId === eventId || record.id === eventId);
    }
    return this.intelligence.observe({ ...input, eventId });
  }

  rememberOnce(input = {}) {
    const memories = this.intelligence.records('OPERATIONAL_MEMORY');
    const existing = memories.find((record) =>
      record.subjectType === input.subjectType
      && record.subjectId === input.subjectId
      && record.memoryType === (input.memoryType || 'OPERATIONAL_FACT')
      && record.sourceEventId === (input.sourceEventId || null)
      && record.summary === (input.summary || null));
    if (existing) return existing;
    return this.intelligence.remember(input);
  }

  captureQueue(queue = {}) {
    const records = [...(queue.queue || []), ...(queue.exceptions || [])];
    const captured = [];
    for (const entry of records) {
      const event = this.observeOnce({
        eventId: fingerprint(['OE', 'QUEUE', entry.id, entry.stage, entry.state]),
        eventType: 'OPERATIONS_QUEUE_STATE_OBSERVED',
        source: 'UNIFIED_MARKET_OPERATIONS_QUEUE',
        actorType: 'SYSTEM',
        actorId: entry.agentId || null,
        transactionId: entry.transactionId || null,
        participantId: entry.participantId || null,
        instrumentId: entry.instrumentId || null,
        workOrderId: entry.workOrderId || null,
        listingId: entry.listingId || null,
        exportPackageId: entry.exportPackageId || null,
        stateAfter: entry.state || null,
        payload: {
          queueRecordId: entry.id,
          stage: entry.stage,
          nextAction: entry.nextAction || null,
          explanation: entry.explanation || null,
          exception: String(entry.stage || '').includes('EXCEPTION'),
        },
      });
      this.rememberOnce({
        subjectType: entry.exportPackageId ? 'EXPORT_PACKAGE' : entry.instrumentId ? 'INSTRUMENT' : entry.listingId ? 'LISTING' : 'OPERATIONS_RECORD',
        subjectId: entry.exportPackageId || entry.instrumentId || entry.listingId || entry.id,
        memoryType: 'CURRENT_OPERATIONAL_STATE',
        summary: `${entry.stage}: ${entry.state}`,
        facts: {
          stage: entry.stage,
          state: entry.state,
          nextAction: entry.nextAction || null,
          agentId: entry.agentId || null,
        },
        sourceEventId: event.eventId,
        transactionId: entry.transactionId || null,
      });
      captured.push(event);
    }
    return captured;
  }

  captureWorkOrder(work = {}, phase = 'RECORDED') {
    if (!work.workOrderId) return null;
    const event = this.observeOnce({
      eventId: fingerprint(['OE', 'WORK', work.workOrderId, phase, work.state]),
      eventType: `AGENT_WORK_${phase}`,
      source: 'SRA_AGENT_WORKFORCE',
      actorType: 'AGENT',
      actorId: work.agentId || null,
      workOrderId: work.workOrderId,
      participantId: work.participantId || work.serviceFeePayerId || null,
      instrumentId: work.instrumentId || null,
      listingId: work.listingId || null,
      exportPackageId: work.exportPackageId || null,
      stateAfter: work.state || null,
      payload: {
        requestedAction: work.requestedAction || work.action || null,
        sourceRecordId: work.sourceRecordId || null,
        stage: work.stage || null,
      },
    });
    if (phase === 'COMPLETED' || phase === 'ACCEPTED') {
      this.intelligence.recordResult({
        action: work.requestedAction || work.action || phase,
        agentId: work.agentId || null,
        workOrderId: work.workOrderId,
        transactionId: work.transactionId || null,
        status: work.state || phase,
        externalReference: work.resultReference || null,
        data: { sourceEventId: event.eventId, sourceRecordId: work.sourceRecordId || null },
      });
    }
    return event;
  }

  captureFundingPackage(data = {}) {
    const pkg = data.pkg || data;
    if (!pkg?.exportPackageId) return null;
    const financingTransactionId = pkg.financingTransactionId || null;
    const event = this.observeOnce({
      eventId: fingerprint(['OE', 'FUNDING_PACKAGE_GENERATED', pkg.exportPackageId]),
      eventType: 'FUNDING_PACKAGE_GENERATED',
      source: 'FINANCING_DISBURSEMENT_PACKAGE',
      actorType: 'SYSTEM',
      actorId: 'SRA-EXPORT-AGENT',
      financingTransactionId,
      participantId: pkg.borrowerParticipantId || pkg.participantId || null,
      exportPackageId: pkg.exportPackageId,
      stateAfter: 'PACKAGE_GENERATED',
      payload: {
        exportKind: pkg.exportKind || null,
        amount: pkg.amount || null,
        currency: pkg.currency || null,
      },
    });
    this.rememberOnce({
      subjectType: 'FINANCING_TRANSACTION',
      subjectId: financingTransactionId || pkg.exportPackageId,
      memoryType: 'FUNDING_PACKAGE_STATE',
      summary: 'Funding package generated from recorded financing transaction state.',
      facts: { exportPackageId: pkg.exportPackageId, state: 'PACKAGE_GENERATED' },
      sourceEventId: event.eventId,
      transactionId: financingTransactionId,
    });
    return event;
  }

  captureExternalOutcome(input = {}) {
    const event = this.observeOnce({
      eventId: fingerprint(['OE', 'EXTERNAL_OUTCOME', input.transactionId || input.financingTransactionId || input.exportPackageId, input.status, input.externalReference]),
      eventType: 'EXTERNAL_OUTCOME_RECORDED',
      source: input.source || 'EXTERNAL_RESULT',
      actorType: input.actorType || 'EXTERNAL_PARTY',
      actorId: input.actorId || null,
      transactionId: input.transactionId || null,
      financingTransactionId: input.financingTransactionId || null,
      exportPackageId: input.exportPackageId || null,
      stateAfter: input.status,
      payload: { externalReference: input.externalReference || null, observed: input.observed || null },
    });
    const outcome = this.intelligence.evaluateOutcome({
      target: input.target || 'EXTERNAL_PROCESSING',
      status: input.status,
      transactionId: input.transactionId || input.financingTransactionId || null,
      expected: input.expected || null,
      observed: input.observed || null,
      evidence: input.externalReference ? [input.externalReference] : [],
      notes: input.notes || null,
      evaluatedByAgentId: input.evaluatedByAgentId || null,
    });
    return { event, outcome };
  }
}
