import test from 'node:test';
import assert from 'node:assert/strict';
import { TransactionDocumentExtractionService } from '../services/transaction-document-extraction-service.js';

function mockResponse(body) {
  return { ok: true, status: 200, async json() { return body; } };
}

test('transaction document extraction preserves real identifiers in universal facts', async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  let requestBody = null;
  const service = new TransactionDocumentExtractionService({
    model: 'test-model',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return mockResponse({
        output_text: JSON.stringify({
          documentType: 'VEHICLE_PURCHASE_AGREEMENT',
          transactionType: 'VEHICLE_PURCHASE',
          identifiers: { agreementNumber: 'PA-88421', contractNumber: null, loanNumber: null, invoiceNumber: null, fileNumber: null, applicationNumber: null, accountReference: null, settlementReference: null, other: [] },
          parties: [{ role: 'SELLER', legalName: 'Example Motors LLC', identifier: null, address: null }],
          asset: { type: 'VEHICLE', description: '2026 Example Q5', vin: 'WA1TESTVIN1234567', year: '2026', make: 'Example', model: 'Q5', serialNumber: null, propertyAddress: null, apn: null, legalDescription: null, otherIdentifiers: [] },
          economicTerms: { purchasePrice: '52125.00', principalAmount: null, financedAmount: null, downPayment: null, interestRate: null, apr: null, paymentAmount: null, paymentFrequency: null, term: null, maturityAmount: null, fees: null, taxes: null, closingCosts: null, currency: 'USD' },
          dates: { agreementDate: '2026-08-22', effectiveDate: null, closingDate: null, fundingDate: null, maturityDate: null, firstPaymentDate: null, settlementDate: null },
          obligations: [], settlement: { amount: null, payee: null, rail: null, routingNumber: null, accountNumber: null, accountType: null, remittanceReference: null }, execution: { signers: [], notary: null, executionStatus: null },
          sourceEvidence: [{ field: 'asset.vin', value: 'WA1TESTVIN1234567', page: 1, sourceLabel: 'VIN' }]
        })
      });
    }
  });
  try {
    const result = await service.extract({ buffer: Buffer.from('%PDF test'), mimeType: 'application/pdf', filename: 'purchase-agreement.pdf', documentId: 'DOC-1', sha256: 'abc' });
    assert.equal(result.status, 'EXTRACTED');
    assert.equal(result.facts.identifiers.agreementNumber, 'PA-88421');
    assert.equal(result.facts.asset.vin, 'WA1TESTVIN1234567');
    assert.equal(result.facts.economicTerms.purchasePrice, '52125.00');
    assert.equal(requestBody.input[0].content[1].type, 'input_file');
    assert.match(requestBody.input[0].content[1].file_data, /^data:application\/pdf;base64,/);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;
  }
});
