import { FinancingIntelligenceService } from './financing-intelligence-service.js';

function present(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function first(...values) {
  for (const value of values) if (present(value)) return value;
  return null;
}

function partyByRole(parties = [], roles = []) {
  const wanted = new Set(roles.map((role) => String(role).toUpperCase()));
  return (Array.isArray(parties) ? parties : []).find((party) => wanted.has(String(party?.role || '').toUpperCase())) || null;
}

function compactObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function agreementIdentifier(facts = {}, current = null) {
  const type = String(facts.documentType || '').toUpperCase();
  const identifiers = facts.identifiers || {};
  const contractDocument = /BUYER.?S?_?ORDER|SALES?_?CONTRACT|PURCHASE_?AGREEMENT|RETAIL_?INSTALLMENT|PROMISSORY_?NOTE|LOAN_?AGREEMENT|MORTGAGE/.test(type);
  if (contractDocument) return first(identifiers.contractNumber, identifiers.agreementNumber, current);
  return first(identifiers.agreementNumber, identifiers.contractNumber, current);
}

export class TransactionFactsMappingService {
  constructor(domain) {
    this.domain = domain;
    this.financingIntelligence = new FinancingIntelligenceService(domain);
  }

  async applyToOpportunity(opportunityId, document, actorId = null) {
    const opportunity = this.domain.get('FUNDING_OPPORTUNITY', opportunityId);
    if (!opportunity) throw new Error('Funding opportunity was not found.');
    const extraction = document?.extraction || null;
    if (extraction?.status !== 'EXTRACTED' || !extraction.facts) {
      return { opportunity, mapped: false, reason: extraction?.status || 'NO_EXTRACTION' };
    }

    const facts = extraction.facts;
    const asset = facts.asset || {};
    const economicTerms = facts.economicTerms || {};
    const settlement = facts.settlement || {};
    const buyer = partyByRole(facts.parties, ['BUYER','BORROWER','PURCHASER','DEBTOR','OBLIGOR']);
    const seller = partyByRole(facts.parties, ['SELLER','DEALER','PAYEE','CREDITOR','LENDER']);
    const sourceDocument = {
      documentId: document.id,
      sha256: document.sha256,
      documentType: document.documentType,
      originalName: document.originalName,
      extractedAt: extraction.extractedAt || null,
      model: extraction.model || null,
    };

    const canonicalFacts = compactObject({
      documentType: facts.documentType || null,
      transactionType: facts.transactionType || null,
      identifiers: facts.identifiers || {},
      parties: Array.isArray(facts.parties) ? facts.parties : [],
      asset: facts.asset || {},
      economicTerms: facts.economicTerms || {},
      dates: facts.dates || {},
      obligations: Array.isArray(facts.obligations) ? facts.obligations : [],
      settlement: facts.settlement || {},
      execution: facts.execution || {},
      sourceEvidence: Array.isArray(facts.sourceEvidence) ? facts.sourceEvidence : [],
      sourceDocument,
    });

    const transactionFacts = Array.isArray(opportunity.transactionFacts) ? opportunity.transactionFacts : [];
    const withoutSameDocument = transactionFacts.filter((item) => item?.sourceDocument?.documentId !== document.id);
    const updated = {
      ...opportunity,
      transactionFacts: [...withoutSameDocument, canonicalFacts],
      transactionProfile: {
        ...(opportunity.transactionProfile || {}),
        transactionType: first(facts.transactionType, opportunity.transactionProfile?.transactionType),
        agreementNumber: agreementIdentifier(facts, opportunity.transactionProfile?.agreementNumber),
        loanNumber: first(facts.identifiers?.loanNumber, opportunity.transactionProfile?.loanNumber),
        fileNumber: first(facts.identifiers?.fileNumber, opportunity.transactionProfile?.fileNumber),
        purchaserName: first(buyer?.legalName, opportunity.transactionProfile?.purchaserName),
        payeeName: first(settlement.payee, seller?.legalName, opportunity.transactionProfile?.payeeName),
        assetType: first(asset.type, opportunity.transactionProfile?.assetType),
        assetDescription: first(asset.description, opportunity.transactionProfile?.assetDescription),
        vin: first(asset.vin, opportunity.transactionProfile?.vin),
        vehicleYear: first(asset.year, opportunity.transactionProfile?.vehicleYear),
        vehicleMake: first(asset.make, opportunity.transactionProfile?.vehicleMake),
        vehicleModel: first(asset.model, opportunity.transactionProfile?.vehicleModel),
        serialNumber: first(asset.serialNumber, opportunity.transactionProfile?.serialNumber),
        propertyAddress: first(asset.propertyAddress, opportunity.transactionProfile?.propertyAddress),
        apn: first(asset.apn, opportunity.transactionProfile?.apn),
        legalDescription: first(asset.legalDescription, opportunity.transactionProfile?.legalDescription),
        purchasePrice: first(economicTerms.purchasePrice, opportunity.transactionProfile?.purchasePrice),
        principalAmount: first(economicTerms.principalAmount, opportunity.transactionProfile?.principalAmount),
        financedAmount: first(economicTerms.financedAmount, opportunity.transactionProfile?.financedAmount),
        currency: first(economicTerms.currency, opportunity.currency, opportunity.transactionProfile?.currency),
        agreementDate: first(facts.dates?.agreementDate, opportunity.transactionProfile?.agreementDate),
        closingDate: first(facts.dates?.closingDate, opportunity.transactionProfile?.closingDate),
        settlementAmount: first(settlement.amount, opportunity.transactionProfile?.settlementAmount),
        settlementRail: first(settlement.rail, opportunity.transactionProfile?.settlementRail),
        sourceDocumentId: document.id,
        sourceDocumentSha256: document.sha256,
      },
      updatedAt: new Date().toISOString(),
    };

    await this.domain.put('FUNDING_OPPORTUNITY', opportunityId, updated, { actorId, eventType: 'TRANSACTION_DOCUMENT_FACTS_MAPPED' });

    const relatedAssetIds = Array.isArray(updated.relatedAssetIds) ? updated.relatedAssetIds : [];
    const assetUpdates = [];
    for (const assetId of relatedAssetIds) {
      const currentAsset = this.domain.get('ASSET_ACCOUNT', assetId);
      if (!currentAsset) continue;
      const metadata = {
        ...(currentAsset.metadata || {}),
        type: first(asset.type, currentAsset.metadata?.type),
        description: first(asset.description, currentAsset.metadata?.description),
        vin: first(asset.vin, currentAsset.metadata?.vin),
        year: first(asset.year, currentAsset.metadata?.year),
        make: first(asset.make, currentAsset.metadata?.make),
        model: first(asset.model, currentAsset.metadata?.model),
        serialNumber: first(asset.serialNumber, currentAsset.metadata?.serialNumber),
        propertyAddress: first(asset.propertyAddress, currentAsset.metadata?.propertyAddress),
        apn: first(asset.apn, currentAsset.metadata?.apn),
        legalDescription: first(asset.legalDescription, currentAsset.metadata?.legalDescription),
        sourceDocumentId: document.id,
        sourceDocumentSha256: document.sha256,
      };
      const assetUpdated = { ...currentAsset, metadata, updatedAt: new Date().toISOString() };
      await this.domain.put('ASSET_ACCOUNT', assetId, assetUpdated, { actorId, eventType: 'ASSET_TRANSACTION_FACTS_MAPPED' });
      assetUpdates.push(assetUpdated);
    }

    await this.domain.lifecycle({
      objectType: 'FUNDING_OPPORTUNITY',
      objectId: opportunityId,
      eventType: 'TRANSACTION_DOCUMENT_FACTS_MAPPED',
      actorId,
      payload: {
        documentId: document.id,
        sha256: document.sha256,
        documentType: facts.documentType || null,
        transactionType: facts.transactionType || null,
        identifiers: facts.identifiers || {},
        relatedAssetIds: assetUpdates.map((item) => item.assetId || item.id).filter(Boolean),
      },
    });

    const reasoning = await this.financingIntelligence.refresh(opportunityId, 'SRA-UNDERWRITING-AGENT');
    return {
      opportunity: reasoning.opportunity,
      mapped: true,
      transactionProfile: reasoning.opportunity.transactionProfile,
      assets: assetUpdates,
      neuralUnderwriting: reasoning.analysis,
    };
  }
}
