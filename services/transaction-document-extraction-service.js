const DEFAULT_MODEL = process.env.OPENAI_DOCUMENT_MODEL || process.env.OPENAI_MODEL || 'gpt-5.1';
const RESPONSES_API_URL = 'https://api.openai.com/v1/responses';

function outputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  const parts = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function parseJson(text) {
  const raw = String(text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(raw);
}

function clean(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  return value;
}

const EXTRACTION_INSTRUCTIONS = `You extract transaction facts from financial and commercial documents for SRA.
Return JSON only. Extract facts that are actually present in the supplied source. Never infer, calculate, fabricate, complete, normalize into a different legal value, or supply a missing identifier.
Use null when a field is absent. Preserve identifying numbers exactly as printed except surrounding whitespace.
The same schema is used across vehicle purchases and financing, mortgages and real-estate closings, commercial credit, promissory notes, invoices, equipment finance, payment instructions, and other financial transactions.
For transaction identifiers, use the value printed next to the document's explicit transaction label. Examples include Contract #, Contract Number, Agreement #, Agreement Number, Loan #, Loan Number, Invoice #, File #, Application #, Account Reference, and Settlement Reference.
Do not classify form numbers, form-template identifiers, revision numbers, footer/page codes, printer/control strings, stock numbers, dealer numbers, customer numbers, permit numbers, or document publication identifiers as agreementNumber or contractNumber unless the source itself explicitly labels that value as the transaction agreement/contract identifier.
When a sales contract, buyer's order, purchase agreement, retail installment contract, mortgage, promissory note, or similar agreement has an explicit Contract # or Contract Number, place that exact value in identifiers.contractNumber. When it has an explicit Agreement # or Agreement Number, place that exact value in identifiers.agreementNumber. Do not substitute a nearby unlabeled number.
For each important extracted fact include sourceEvidence entries with field, value, page when available, and a short sourceLabel describing the printed label or nearby text.
Return this shape:
{
  "documentType": null,
  "transactionType": null,
  "identifiers": {"agreementNumber":null,"contractNumber":null,"loanNumber":null,"invoiceNumber":null,"fileNumber":null,"applicationNumber":null,"accountReference":null,"settlementReference":null,"other":[]},
  "parties": [{"role":null,"legalName":null,"identifier":null,"address":null}],
  "asset": {"type":null,"description":null,"vin":null,"year":null,"make":null,"model":null,"serialNumber":null,"propertyAddress":null,"apn":null,"legalDescription":null,"otherIdentifiers":[]},
  "economicTerms": {"purchasePrice":null,"principalAmount":null,"financedAmount":null,"downPayment":null,"interestRate":null,"apr":null,"paymentAmount":null,"paymentFrequency":null,"term":null,"maturityAmount":null,"fees":null,"taxes":null,"closingCosts":null,"currency":null},
  "dates": {"agreementDate":null,"effectiveDate":null,"closingDate":null,"fundingDate":null,"maturityDate":null,"firstPaymentDate":null,"settlementDate":null},
  "obligations": [{"obligor":null,"obligee":null,"description":null,"amount":null,"frequency":null,"collateral":null}],
  "settlement": {"amount":null,"payee":null,"rail":null,"routingNumber":null,"accountNumber":null,"accountType":null,"remittanceReference":null},
  "execution": {"signers":[{"name":null,"capacity":null,"signedDate":null}],"notary":null,"executionStatus":null},
  "sourceEvidence": []
}`;

export class TransactionDocumentExtractionService {
  constructor({ model = DEFAULT_MODEL, fetchImpl = globalThis.fetch } = {}) {
    this.model = model;
    this.fetch = fetchImpl;
  }

  available() {
    return Boolean(process.env.OPENAI_API_KEY && typeof this.fetch === 'function');
  }

  async extract({ buffer, mimeType, filename, documentId = null, sha256 = null }) {
    if (!this.available()) return { status: 'NOT_CONFIGURED', documentId, sha256, facts: null };
    const fileData = `data:${mimeType || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
    const content = [{ type: 'input_text', text: EXTRACTION_INSTRUCTIONS }];
    if (String(mimeType || '').startsWith('image/')) {
      content.push({ type: 'input_image', image_url: fileData });
    } else {
      content.push({ type: 'input_file', filename: filename || 'transaction-document.pdf', file_data: fileData });
    }
    const result = await this.fetch(RESPONSES_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: [{ role: 'user', content }] }),
    });
    const response = await result.json().catch(() => ({}));
    if (!result.ok) throw new Error(response?.error?.message || `Document extraction failed with status ${result.status}.`);
    const facts = clean(parseJson(outputText(response)));
    return {
      status: 'EXTRACTED',
      documentId,
      sha256,
      model: this.model,
      extractedAt: new Date().toISOString(),
      facts,
    };
  }
}
