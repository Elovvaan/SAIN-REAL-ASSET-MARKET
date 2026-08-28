import crypto from 'node:crypto';

const WINDOW_TYPE = 'TRANSACTION_PARTICIPATION_WINDOW';
const EVENT_TYPE = 'TRANSACTION_PARTICIPATION_EVENT';

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function upper(value) { return String(value || '').trim().toUpperCase(); }
function clean(value, max = 5000) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

export class TransactionParticipationGatewayService {
  constructor(domain) {
    if (!domain) throw new Error('Transaction participation requires the SRA domain store.');
    this.domain = domain;
    this.hydrated = false;
    this.hydrationPromise = null;
  }

  records(type) { return typeof this.domain.list === 'function' ? this.domain.list(type) : []; }
  async persist(type, recordId, record) {
    if (typeof this.domain.put === 'function') return await this.domain.put(type, recordId, record);
    if (typeof this.domain.create === 'function') return await this.domain.create(type, record);
    if (typeof this.domain.set === 'function') return await this.domain.set(type, recordId, record);
    throw new Error('SRA domain store does not expose a supported persistence method.');
  }

  async ensureHydrated() {
    if (this.hydrated) return;
    if (typeof this.domain.hydrate !== 'function') {
      this.hydrated = true;
      return;
    }
    if (!this.hydrationPromise) {
      this.hydrationPromise = Promise.resolve(this.domain.hydrate([WINDOW_TYPE, EVENT_TYPE]))
        .then(() => { this.hydrated = true; })
        .finally(() => { this.hydrationPromise = null; });
    }
    await this.hydrationPromise;
  }

  async observe(input = {}) {
    const eventId = id('OE');
    const record = {
      id: eventId,
      eventId,
      eventType: input.eventType,
      occurredAt: input.occurredAt || now(),
      source: input.source || 'TRANSACTION_PARTICIPATION_GATEWAY',
      actorType: input.actorType || null,
      actorId: input.actorId || null,
      transactionId: input.transactionId || null,
      financingTransactionId: input.financingTransactionId || null,
      exportPackageId: input.exportPackageId || null,
      payload: input.payload || {},
      correlationId: input.correlationId || input.financingTransactionId || input.transactionId || eventId,
    };
    await this.persist('OPERATIONAL_EVENT', eventId, record);
    return record;
  }

  findPackage(reference) {
    const ref = String(reference || '').trim();
    if (!ref) return null;
    return this.records('EXPORT_PACKAGE').find((pkg) =>
      pkg.exportPackageId === ref || pkg.id === ref || pkg.financingTransactionId === ref
    ) || null;
  }

  findWindow(windowId) {
    return this.records(WINDOW_TYPE).find((record) => record.windowId === windowId || record.id === windowId) || null;
  }

  windowsForPackage(exportPackageId) {
    return this.records(WINDOW_TYPE).filter((record) => record.exportPackageId === exportPackageId);
  }

  async createWindow(exportPackageId, input = {}) {
    await this.ensureHydrated();
    const pkg = this.findPackage(exportPackageId);
    if (!pkg) throw new Error('Funding package was not found.');
    const existing = this.windowsForPackage(pkg.exportPackageId)
      .find((record) => record.state === 'OPEN' && (!record.expiresAt || new Date(record.expiresAt) > new Date()));
    if (existing) {
      return await this.reissueAccessCode(existing.windowId, { actorName: input.createdBy || 'SRA' });
    }

    const accessCode = crypto.randomBytes(6).toString('hex').toUpperCase();
    const windowId = id('TPW');
    const createdAt = now();
    const expiresAt = input.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const record = {
      id: windowId,
      windowId,
      exportPackageId: pkg.exportPackageId,
      financingTransactionId: pkg.financingTransactionId || null,
      opportunityId: pkg.opportunityId || null,
      closingId: pkg.closingId || null,
      recipientName: clean(input.recipientName, 300) || pkg.beneficiaryName || null,
      recipientEmail: clean(input.recipientEmail, 320),
      accessCodeHash: hash(accessCode),
      state: 'OPEN',
      allowedActions: [
        'VIEW_TRANSACTION_SUMMARY',
        'CONFIRM_RECEIPT',
        'IDENTIFY_CONTACT',
        'ASK_PROCESSING_QUESTION',
        'REPORT_PROCESSING_ISSUE',
        'UPLOAD_TRANSACTION_DOCUMENT',
        'CONFIRM_SUBMITTED_FOR_PROCESSING',
      ],
      createdBy: input.createdBy || 'SRA',
      createdAt,
      expiresAt,
      lastAccessedAt: null,
      accessCodeRotatedAt: null,
      closedAt: null,
    };
    await this.persist(WINDOW_TYPE, windowId, record);
    await this.recordEvent(record, 'PARTICIPATION_WINDOW_OPENED', {
      actorType: 'SRA',
      actorName: input.createdBy || 'SRA',
      summary: 'Transaction participation window opened.',
    });
    return { window: this.publicWindow(record, pkg), accessCode, existing: false };
  }

  async reissueAccessCode(windowId, input = {}) {
    await this.ensureHydrated();
    const record = this.findWindow(windowId);
    if (!record) throw new Error('Participation window was not found.');
    if (record.state !== 'OPEN') throw new Error('Participation window is not open.');
    if (record.expiresAt && new Date(record.expiresAt) <= new Date()) throw new Error('Participation access has expired.');
    const accessCode = crypto.randomBytes(6).toString('hex').toUpperCase();
    const updated = {
      ...record,
      accessCodeHash: hash(accessCode),
      accessCodeRotatedAt: now(),
    };
    await this.persist(WINDOW_TYPE, record.windowId, updated);
    await this.recordEvent(updated, 'PARTICIPATION_ACCESS_CODE_REISSUED', {
      actorType: 'SRA',
      actorName: input.actorName || 'SRA',
      summary: 'Transaction participation access code reissued.',
    });
    return {
      window: this.publicWindow(updated, this.findPackage(updated.exportPackageId)),
      accessCode,
      existing: true,
      reissued: true,
    };
  }

  publicWindow(record, pkg = null) {
    const source = pkg || this.findPackage(record.exportPackageId);
    return {
      windowId: record.windowId,
      state: record.state,
      exportPackageId: record.exportPackageId,
      financingTransactionId: record.financingTransactionId,
      recipientName: record.recipientName,
      allowedActions: record.allowedActions || [],
      expiresAt: record.expiresAt,
      transaction: source ? {
        exportPackageId: source.exportPackageId,
        financingTransactionId: source.financingTransactionId || null,
        beneficiaryName: source.beneficiaryName || null,
        amount: Number(source.amount || 0) || null,
        currency: source.currency || null,
        state: source.state || null,
        exportKind: source.exportKind || null,
        opportunityId: source.opportunityId || null,
        closingId: source.closingId || null,
      } : null,
    };
  }

  authenticate({ packageReference, windowId, accessCode }) {
    const pkg = this.findPackage(packageReference);
    if (!pkg) throw new Error('Transaction or funding package was not found.');
    const candidates = windowId ? [this.findWindow(windowId)].filter(Boolean) : this.windowsForPackage(pkg.exportPackageId);
    const record = candidates.find((window) =>
      window.exportPackageId === pkg.exportPackageId &&
      window.state === 'OPEN' &&
      hash(accessCode) === window.accessCodeHash
    );
    if (!record) throw new Error('Participation access could not be verified.');
    if (record.expiresAt && new Date(record.expiresAt) <= new Date()) throw new Error('Participation access has expired.');
    return { record, pkg };
  }

  activity(windowId) {
    return this.records(EVENT_TYPE)
      .filter((event) => event.windowId === windowId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map((event) => ({
        eventId: event.eventId,
        eventType: event.eventType,
        summary: event.summary,
        actorType: event.actorType,
        actorName: event.actorName,
        organization: event.organization,
        createdAt: event.createdAt,
        documentId: event.documentId || null,
      }));
  }

  async access(credentials) {
    await this.ensureHydrated();
    const { record, pkg } = this.authenticate(credentials);
    const updated = { ...record, lastAccessedAt: now() };
    await this.persist(WINDOW_TYPE, record.windowId, updated);
    return { window: this.publicWindow(updated, pkg), activity: this.activity(record.windowId) };
  }

  async recordEvent(window, eventType, input = {}) {
    const eventId = id('TPE');
    const event = {
      id: eventId,
      eventId,
      windowId: window.windowId,
      exportPackageId: window.exportPackageId,
      financingTransactionId: window.financingTransactionId || null,
      eventType,
      actorType: upper(input.actorType || 'EXTERNAL_PARTICIPANT'),
      actorName: clean(input.actorName, 300),
      organization: clean(input.organization, 300),
      role: clean(input.role, 200),
      summary: clean(input.summary, 1500),
      details: input.details && typeof input.details === 'object' ? input.details : {},
      documentId: input.documentId || null,
      createdAt: now(),
    };
    await this.persist(EVENT_TYPE, eventId, event);
    await this.observe({
      eventType,
      actorType: event.actorType,
      actorId: event.actorName || event.organization || window.windowId,
      transactionId: window.financingTransactionId || window.exportPackageId,
      financingTransactionId: window.financingTransactionId || null,
      exportPackageId: window.exportPackageId,
      payload: {
        participationWindowId: window.windowId,
        participationEventId: eventId,
        summary: event.summary,
        organization: event.organization,
        role: event.role,
        documentId: event.documentId,
        ...event.details,
      },
      correlationId: window.financingTransactionId || window.exportPackageId,
    });
    return event;
  }

  async confirmReceipt(credentials, input = {}) {
    await this.ensureHydrated();
    const { record } = this.authenticate(credentials);
    const event = await this.recordEvent(record, 'FUNDING_PACKAGE_RECEIPT_CONFIRMED', {
      actorName: input.contactName,
      organization: input.organization,
      role: input.role,
      summary: 'External participant confirmed receipt of the funding package.',
    });
    return { event, activity: this.activity(record.windowId) };
  }

  async identifyContact(credentials, input = {}) {
    await this.ensureHydrated();
    const { record } = this.authenticate(credentials);
    const event = await this.recordEvent(record, 'TRANSACTION_CONTACT_IDENTIFIED', {
      actorName: input.contactName,
      organization: input.organization,
      role: input.role,
      summary: clean(input.summary, 1000) || 'External transaction processing contact identified.',
      details: { email: clean(input.email, 320), phone: clean(input.phone, 100) },
    });
    return { event, activity: this.activity(record.windowId) };
  }

  async askQuestion(credentials, input = {}) {
    await this.ensureHydrated();
    const { record } = this.authenticate(credentials);
    const question = clean(input.question, 5000);
    if (!question) throw new Error('A processing question is required.');
    const event = await this.recordEvent(record, 'PROCESSING_CLARIFICATION_REQUESTED', {
      actorName: input.contactName,
      organization: input.organization,
      role: input.role,
      summary: question,
      details: { topic: upper(input.topic || 'GENERAL_PROCESSING') },
    });
    return { event, activity: this.activity(record.windowId) };
  }

  async reportIssue(credentials, input = {}) {
    await this.ensureHydrated();
    const { record } = this.authenticate(credentials);
    const issue = clean(input.issue, 5000);
    if (!issue) throw new Error('A processing issue is required.');
    const event = await this.recordEvent(record, 'PROCESSING_EXCEPTION_REPORTED', {
      actorName: input.contactName,
      organization: input.organization,
      role: input.role,
      summary: issue,
      details: { topic: upper(input.topic || 'GENERAL_PROCESSING'), blocking: input.blocking !== false },
    });
    return { event, activity: this.activity(record.windowId) };
  }

  async confirmProcessing(credentials, input = {}) {
    await this.ensureHydrated();
    const { record } = this.authenticate(credentials);
    const event = await this.recordEvent(record, 'PACKAGE_SUBMITTED_FOR_PROCESSING', {
      actorName: input.contactName,
      organization: input.organization,
      role: input.role,
      summary: clean(input.summary, 1500) || 'External participant confirmed the package was submitted for processing.',
      details: { externalReference: clean(input.externalReference, 500) },
    });
    return { event, activity: this.activity(record.windowId) };
  }

  async recordDocument(credentials, document, input = {}) {
    await this.ensureHydrated();
    const { record } = this.authenticate(credentials);
    if (!document?.id) throw new Error('Stored document metadata is required.');
    const event = await this.recordEvent(record, 'TRANSACTION_DOCUMENT_UPLOADED', {
      actorName: input.contactName,
      organization: input.organization,
      role: input.role,
      summary: clean(input.summary, 1500) || `Transaction document uploaded: ${document.originalName || document.id}.`,
      documentId: document.id,
      details: { documentType: document.documentType || null, sha256: document.sha256 || null },
    });
    return { event, activity: this.activity(record.windowId) };
  }
}

export { WINDOW_TYPE as TransactionParticipationWindowType, EVENT_TYPE as TransactionParticipationEventType };
