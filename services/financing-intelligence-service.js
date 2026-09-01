import crypto from 'node:crypto';
import { normalizeFinancingStage } from './financing-lifecycle-service.js';

const OPPORTUNITY_TYPE = 'FUNDING_OPPORTUNITY';
const now = () => new Date().toISOString();

function present(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function first(...values) {
  for (const value of values) if (present(value)) return value;
  return null;
}

function normalized(value) {
  if (!present(value)) return null;
  if (typeof value === 'number') return Number(value.toFixed(8));
  return String(value).trim().toUpperCase();
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Number(number.toFixed(2)) : null;
}

function sourceRef(fact = {}) {
  return {
    documentId: fact.sourceDocument?.documentId || null,
    sha256: fact.sourceDocument?.sha256 || null,
    documentType: fact.documentType || fact.sourceDocument?.documentType || null,
    extractedAt: fact.sourceDocument?.extractedAt || null,
  };
}

function uniqueValues(values = []) {
  const map = new Map();
  for (const entry of values) {
    const value = normalized(entry.value);
    if (!value) continue;
    if (!map.has(value)) map.set(value, { value: entry.value, sources: [] });
    if (entry.source) map.get(value).sources.push(entry.source);
  }
  return [...map.values()];
}

function factValues(facts, selector) {
  return facts.map((fact) => ({ value: selector(fact), source: sourceRef(fact) })).filter((entry) => present(entry.value));
}

function conflict(name, values) {
  const unique = uniqueValues(values);
  return unique.length > 1 ? { field: name, values: unique } : null;
}

function evidenceSummary(opportunity, facts) {
  const profile = opportunity.transactionProfile || {};
  const purchaser = first(profile.purchaserName, ...facts.map((fact) => fact.parties?.find((party) => ['BUYER','BORROWER','PURCHASER','DEBTOR','OBLIGOR'].includes(String(party?.role || '').toUpperCase()))?.legalName));
  const payee = first(profile.payeeName, ...facts.map((fact) => fact.settlement?.payee), ...facts.map((fact) => fact.parties?.find((party) => ['SELLER','DEALER','PAYEE','CREDITOR','LENDER'].includes(String(party?.role || '').toUpperCase()))?.legalName));
  const requestedAmount = money(opportunity.requestedAmount);
  const documentedAmount = money(first(profile.financedAmount, profile.principalAmount, profile.settlementAmount, ...facts.map((fact) => fact.economicTerms?.financedAmount), ...facts.map((fact) => fact.economicTerms?.principalAmount), ...facts.map((fact) => fact.settlement?.amount)));
  const assetIdentity = first(profile.vin, profile.serialNumber, profile.propertyAddress, profile.assetDescription, ...facts.map((fact) => fact.asset?.vin), ...facts.map((fact) => fact.asset?.serialNumber), ...facts.map((fact) => fact.asset?.propertyAddress), ...facts.map((fact) => fact.asset?.description));
  const agreementNumber = first(profile.agreementNumber, profile.loanNumber, profile.fileNumber, ...facts.map((fact) => fact.identifiers?.agreementNumber), ...facts.map((fact) => fact.identifiers?.contractNumber), ...facts.map((fact) => fact.identifiers?.loanNumber), ...facts.map((fact) => fact.identifiers?.fileNumber));
  return { purchaser, payee, requestedAmount, documentedAmount, assetIdentity, agreementNumber };
}

function evidenceConflicts(facts) {
  return [
    conflict('PURCHASER', factValues(facts, (fact) => fact.parties?.find((party) => ['BUYER','BORROWER','PURCHASER','DEBTOR','OBLIGOR'].includes(String(party?.role || '').toUpperCase()))?.legalName)),
    conflict('PAYEE', factValues(facts, (fact) => first(fact.settlement?.payee, fact.parties?.find((party) => ['SELLER','DEALER','PAYEE','CREDITOR','LENDER'].includes(String(party?.role || '').toUpperCase()))?.legalName))),
    conflict('ASSET_IDENTITY', factValues(facts, (fact) => first(fact.asset?.vin, fact.asset?.serialNumber, fact.asset?.propertyAddress))),
    conflict('AGREEMENT_NUMBER', factValues(facts, (fact) => first(fact.identifiers?.agreementNumber, fact.identifiers?.contractNumber, fact.identifiers?.loanNumber, fact.identifiers?.fileNumber))),
    conflict('TRANSACTION_AMOUNT', factValues(facts, (fact) => first(fact.economicTerms?.financedAmount, fact.economicTerms?.principalAmount, fact.settlement?.amount))),
  ].filter(Boolean);
}

function unresolvedFields(summary, facts) {
  const unresolved = [];
  if (!summary.requestedAmount) unresolved.push('REQUESTED_AMOUNT');
  if (!facts.length) unresolved.push('TRANSACTION_EVIDENCE');
  if (!summary.purchaser) unresolved.push('PURCHASER');
  if (!summary.payee) unresolved.push('PAYEE_OR_RECIPIENT');
  if (!summary.assetIdentity && !summary.agreementNumber) unresolved.push('ASSET_OR_AGREEMENT_REFERENCE');
  return unresolved;
}

function buildConclusion({ summary, facts, conflicts, unresolved }) {
  const evidenceCount = facts.length;
  if (conflicts.length) {
    return `SRA reviewed ${evidenceCount} extracted transaction record${evidenceCount === 1 ? '' : 's'} and identified conflicting material facts in ${conflicts.map((item) => item.field).join(', ')}. Resolve those conflicts before the financing decision is presented.`;
  }
  if (unresolved.length) {
    return `SRA reviewed ${evidenceCount} extracted transaction record${evidenceCount === 1 ? '' : 's'}. The underwriting record remains incomplete because ${unresolved.join(', ')} ${unresolved.length === 1 ? 'is' : 'are'} unresolved.`;
  }
  const amountText = summary.documentedAmount ? ` Documented transaction amount: $${summary.documentedAmount.toFixed(2)}.` : '';
  return `SRA reviewed ${evidenceCount} extracted transaction record${evidenceCount === 1 ? '' : 's'} and found the recorded purchaser, recipient, transaction reference and asset/agreement identity sufficiently aligned for administrator decision review.${amountText}`;
}

function buildRationale({ summary, facts, conflicts, unresolved, recommendation }) {
  const refs = facts.map((fact) => fact.sourceDocument?.documentId).filter(Boolean);
  const established = [
    summary.purchaser ? `purchaser ${summary.purchaser}` : null,
    summary.payee ? `recipient ${summary.payee}` : null,
    summary.assetIdentity ? `asset/reference ${summary.assetIdentity}` : null,
    summary.agreementNumber ? `agreement ${summary.agreementNumber}` : null,
    summary.documentedAmount ? `documented amount $${summary.documentedAmount.toFixed(2)}` : null,
  ].filter(Boolean);
  const issues = [
    ...conflicts.map((item) => `conflict:${item.field}`),
    ...unresolved.map((item) => `missing:${item}`),
  ];
  return `Decision rationale prepared from recorded SRA evidence${refs.length ? ` (${refs.join(', ')})` : ''}. Established facts: ${established.length ? established.join('; ') : 'none yet'}. ${issues.length ? `Open issues: ${issues.join('; ')}.` : 'No material evidence conflict is presently recorded.'} Recommended administrative disposition: ${recommendation}.`;
}

export class FinancingIntelligenceService {
  constructor(domain) {
    if (!domain) throw new Error('Financing intelligence requires the SRA domain store.');
    this.domain = domain;
  }

  get(opportunityId) {
    return this.domain.get(OPPORTUNITY_TYPE, opportunityId);
  }

  analyze(opportunityId) {
    const opportunity = this.get(opportunityId);
    if (!opportunity) throw new Error('Funding opportunity was not found.');
    const facts = Array.isArray(opportunity.transactionFacts) ? opportunity.transactionFacts : [];
    const summary = evidenceSummary(opportunity, facts);
    const conflicts = evidenceConflicts(facts);
    const unresolved = unresolvedFields(summary, facts);
    const stage = normalizeFinancingStage(opportunity);
    const recommendation = conflicts.length || unresolved.length ? 'REVIEW_EVIDENCE' : 'READY_FOR_ADMIN_DECISION';
    const recommendedAmount = summary.requestedAmount && summary.documentedAmount
      ? Math.min(summary.requestedAmount, summary.documentedAmount)
      : money(first(summary.requestedAmount, summary.documentedAmount));
    const evidenceRefs = facts.map(sourceRef).filter((ref) => ref.documentId || ref.sha256);
    const sourceFingerprint = crypto.createHash('sha256').update(JSON.stringify({
      opportunityId,
      stage,
      requestedAmount: opportunity.requestedAmount || null,
      summary,
      conflicts,
      unresolved,
      evidenceRefs,
    })).digest('hex');
    const analysis = {
      agentId: 'SRA-UNDERWRITING-AGENT',
      opportunityId,
      financingStage: stage,
      evidenceCount: facts.length,
      evidenceRefs,
      establishedFacts: summary,
      conflicts,
      unresolvedFields: unresolved,
      recommendedAmount,
      recommendation,
      readyForAdminDecision: recommendation === 'READY_FOR_ADMIN_DECISION',
      conclusion: null,
      decisionRationale: null,
      sourceFingerprint,
      preparedAt: now(),
    };
    analysis.conclusion = buildConclusion({ summary, facts, conflicts, unresolved });
    analysis.decisionRationale = buildRationale({ summary, facts, conflicts, unresolved, recommendation });
    return analysis;
  }

  async refresh(opportunityId, actorId = 'SRA-UNDERWRITING-AGENT') {
    const current = this.get(opportunityId);
    if (!current) throw new Error('Funding opportunity was not found.');
    const prepared = this.analyze(opportunityId);
    if (current.neuralUnderwriting?.sourceFingerprint === prepared.sourceFingerprint) {
      return { opportunity: current, analysis: current.neuralUnderwriting, changed: false };
    }
    const timestamp = now();
    const updated = {
      ...current,
      neuralUnderwriting: prepared,
      decisionPreparation: {
        agentId: prepared.agentId,
        recommendation: prepared.recommendation,
        recommendedAmount: prepared.recommendedAmount,
        rationale: prepared.decisionRationale,
        evidenceRefs: prepared.evidenceRefs,
        conflicts: prepared.conflicts,
        unresolvedFields: prepared.unresolvedFields,
        sourceFingerprint: prepared.sourceFingerprint,
        preparedAt: prepared.preparedAt,
      },
      updatedAt: timestamp,
    };
    await this.domain.put(OPPORTUNITY_TYPE, opportunityId, updated, { actorId, eventType: 'FINANCING_NEURAL_REASONING_PREPARED' });
    if (typeof this.domain.lifecycle === 'function') {
      await this.domain.lifecycle({
        objectType: OPPORTUNITY_TYPE,
        objectId: opportunityId,
        eventType: 'FINANCING_NEURAL_REASONING_PREPARED',
        actorId,
        payload: {
          recommendation: prepared.recommendation,
          readyForAdminDecision: prepared.readyForAdminDecision,
          evidenceCount: prepared.evidenceCount,
          conflictCount: prepared.conflicts.length,
          unresolvedFields: prepared.unresolvedFields,
          sourceFingerprint: prepared.sourceFingerprint,
        },
      });
    }
    return { opportunity: updated, analysis: prepared, changed: true };
  }
}
