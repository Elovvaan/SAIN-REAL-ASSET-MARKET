import express from 'express';
import { FinancedPositionDistributionService } from '../services/financed-position-distribution-service.js';
import { GovernedLoanFinancingService } from '../services/governed-loan-financing-service.js';
import { AchSettlementPacketService } from '../services/ach-settlement-packet-service.js';
import { normalizeFinancingStage } from '../services/financing-lifecycle-service.js';
import { financingLetterClosingRequirements } from '../services/financing-letter-closing-requirements.js';

function actorId(req) { return req.sraOperationsAuth?.actorId || req.sraIdentity?.actorId || null; }
function fail(res, error) { const message = error?.message || 'Unexpected financing closing error.'; return res.status(/not found/i.test(message) ? 404 : 422).json({ error: message, code: error?.code || 'FINANCING_CLOSING_ERROR', assessment: error?.assessment || null }); }
function html(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
function usd(value) { return Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function dateLabel(value) { const date = new Date(value || Date.now()); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }

export function createFinancingClosingRouter(service) {
  const router = express.Router();
  const positionDistribution = new FinancedPositionDistributionService(service.domain);
  const distributionReady = positionDistribution.initialize();
  const loanFinancing = new GovernedLoanFinancingService(service.domain);
  const loanFinancingReady = loanFinancing.initialize();
  const achSettlementPacket = new AchSettlementPacketService(service.domain);

  router.get('/status', (_req, res) => res.json({ ...service.status(), positionDistribution: positionDistribution.status(), loanFinancing: loanFinancing.status() }));
  router.get('/authorizations', (req, res) => {
    const opportunityId = String(req.query.opportunityId || '').trim();
    if (!opportunityId) return res.status(400).json({ error: 'opportunityId is required.' });
    return res.json({ record: service.financingAuthorizationForOpportunity(opportunityId) });
  });
  router.get('/letters/opportunities/:opportunityId', (req, res) => {
    try {
      if (!req.sraOperationsAuth?.actorId) return res.status(401).send('An authenticated financing-operations staff session is required.');
      const opportunityId = String(req.params.opportunityId || '').trim();
      const opportunity = service.domain.get('FUNDING_OPPORTUNITY', opportunityId);
      if (!opportunity) return res.status(404).send('Funding opportunity was not found.');
      const stage = normalizeFinancingStage(opportunity);
      const decision = String(opportunity.creditDecision?.decision || '').toUpperCase();
      if (decision !== 'APPROVE' || !['CLOSING', 'READY_TO_FUND', 'FUNDED', 'SERVICING'].includes(stage)) return res.status(409).send('A financing availability letter is available only after an approved credit decision.');
      const financing = service.financingAuthorizationForOpportunity(opportunityId);
      if (!financing) return res.status(409).send('A posted financing authorization is required before a financing availability letter can be issued.');
      const closing = service.list({ opportunityId }).find((record) => record.status !== 'CANCELLED') || null;
      const participantId = opportunity.applicantParticipantId || financing.borrowerParticipantId || null;
      const participant = participantId ? service.domain.get('PARTICIPANT', participantId) : null;
      const customerName = participant?.displayName || participant?.metadata?.legalName || opportunity.applicantDisplayName || participantId || 'Financing applicant';
      const approvedAmount = Number(financing.amount || 0);
      const creditApprovalLimit = Number(opportunity.creditDecision?.approvedAmount || opportunity.requestedAmount || 0);
      const statusLabel = stage === 'READY_TO_FUND' ? 'READY TO FUND' : stage === 'FUNDED' || stage === 'SERVICING' ? 'FUNDED' : 'APPROVED / CLOSING';
      const issuedAt = new Date().toISOString();
      const reference = financing.transactionId;
      const purpose = String(opportunity.purpose || opportunity.opportunityType || 'Financing').replaceAll('_', ' ');
      const title = stage === 'READY_TO_FUND' ? 'Financing Availability Letter — Ready to Fund' : 'Financing Availability Letter';
      const creditLimitRow = creditApprovalLimit > approvedAmount ? `<div><span>Credit Approval Limit</span><strong>${html(usd(creditApprovalLimit))}</strong></div>` : '';
      const signerName = req.sraIdentity?.displayName || 'Authorized Financing Representative';
      const signerEmail = req.sraIdentity?.email || '';
      const platformAddress = '2522 Orchard Ave, Ogden, UT 84401';
      const platformPhone = '(801) 923-3680';
      const requirements = financingLetterClosingRequirements(opportunity, closing);
      const requirementsList = requirements.map((requirement) => `<li>${html(requirement)}</li>`).join('');
      const document = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title><style>
        :root{font-family:Arial,Helvetica,sans-serif;color:#171717;background:#efefef}*{box-sizing:border-box}body{margin:0;padding:32px}.sheet{max-width:850px;margin:0 auto;background:#fff;padding:58px 64px;box-shadow:0 3px 24px rgba(0,0,0,.14)}.brand{display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid #b68b16;padding-bottom:18px}.brand-left{display:flex;align-items:center;gap:14px}.brand img{width:58px;height:58px;object-fit:contain}.brand h1{margin:0;font-size:24px}.brand small{display:block;color:#666;margin-top:5px}.date{font-size:13px;text-align:right}.title{font-size:20px;margin:34px 0 22px}.lead{font-size:15px;line-height:1.65}.grid{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #ddd;margin:26px 0}.grid div{padding:13px 15px;border-bottom:1px solid #e5e5e5}.grid span{display:block;font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.08em}.grid strong{display:block;margin-top:5px;font-size:14px}.status{font-weight:700;color:#80600d}.requirements{margin:28px 0}.requirements h3{font-size:16px;margin:0 0 10px}.requirements p,.requirements li{font-size:13px;line-height:1.55}.requirements ul{margin:10px 0 12px;padding-left:22px}.notice{margin-top:24px;padding:16px;border-left:4px solid #b68b16;background:#faf7ed;font-size:12px;line-height:1.55;color:#444}.signature{margin-top:42px;display:grid;grid-template-columns:1fr 1fr;gap:28px}.signature-line{border-top:1px solid #333;padding-top:8px;margin-top:34px}.signature strong,.signature span,.contact span{display:block}.contact{font-size:12px;line-height:1.55;color:#444}.footer{margin-top:46px;border-top:1px solid #ddd;padding-top:13px;font-size:10px;color:#666;line-height:1.5}.print{max-width:850px;margin:0 auto 12px;text-align:right}.print button{background:#111;color:white;border:0;border-radius:6px;padding:10px 16px;cursor:pointer}@media print{body{background:#fff;padding:0}.sheet{box-shadow:none;max-width:none;padding:40px 50px}.print{display:none}@page{size:letter;margin:.45in}}
      </style></head><body><div class="print"><button onclick="window.print()">Print / Save as PDF</button></div><main class="sheet"><header class="brand"><div class="brand-left"><img src="/brand-logo" alt="SAIN Platform"><div><h1>SAIN Platform</h1><small>Financing Operations</small></div></div><div class="date">${html(dateLabel(issuedAt))}</div></header><h2 class="title">${html(title)}</h2><p class="lead">To whom it may concern:</p><p class="lead">This letter confirms that SAIN Platform records reflect posted financing availability for <strong>${html(customerName)}</strong> in the amount of <strong>${html(usd(approvedAmount))}</strong> for the referenced ${html(purpose.toLowerCase())} transaction. The financing has completed credit decision and this amount is the financing authorization currently recorded in the SAIN financing ledger.</p><section class="grid"><div><span>Applicant / Customer</span><strong>${html(customerName)}</strong></div><div><span>Posted Financing Amount</span><strong>${html(usd(approvedAmount))}</strong></div>${creditLimitRow}<div><span>Opportunity Reference</span><strong>${html(opportunityId)}</strong></div><div><span>Financing Authorization</span><strong>${html(reference)}</strong></div><div><span>Financing Status</span><strong class="status">${html(statusLabel)}</strong></div><div><span>Closing Reference</span><strong>${html(closing?.closingId || 'Not yet opened')}</strong></div></section><p class="lead">This letter may be used as evidence of the financing availability recorded for the transaction identified above. This is not a final funding notice. Funding remains subject to completion of the applicable closing requirements identified below and funding authorization unless the financing status above is shown as FUNDED.</p><section class="requirements"><h3>Closing Requirements / Next Steps</h3><p>Before funding may be authorized and disbursed, SAIN Financing Operations requires receipt and review of the final transaction documents applicable to this financing, including:</p><ul>${requirementsList}</ul><p>Once the required closing documentation has been received and the applicable closing conditions have been satisfied, the financing may proceed to Ready to Fund, funding authorization, and disbursement.</p></section><div class="notice"><strong>Important distinction:</strong> This is a financing-availability confirmation generated from SAIN's authoritative financing records. It is not a depository account statement, bank balance verification, or representation that external settlement has already occurred.</div><section class="signature"><div><div class="signature-line"><strong>${html(signerName)}</strong><span>Authorized Financing Representative</span><span>SAIN Platform · Financing Operations</span><span>Signed ${html(dateLabel(issuedAt))}</span></div></div><div class="contact"><strong>SAIN Platform</strong><span>${html(platformAddress)}</span><span>${html(platformPhone)}</span>${signerEmail ? `<span>${html(signerEmail)}</span>` : ''}</div></section><div class="footer">Issued ${html(dateLabel(issuedAt))} · Opportunity ${html(opportunityId)} · Financing authorization ${html(reference)} · Generated from current SAIN financing records.</div></main></body></html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `inline; filename="SAIN-Financing-Availability-${opportunityId}.html"`);
      return res.send(document);
    } catch (error) { return fail(res, error); }
  });
  router.get('/exports/:exportPackageId/ach-settlement-packet', async (req, res) => {
    try {
      if (!actorId(req)) return res.status(401).json({ error: 'An authenticated financing-operations identity is required.' });
      const exportPackageId = String(req.params.exportPackageId || '').trim();
      const pdf = await achSettlementPacket.renderSettlementPage(exportPackageId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="SRA-ACH-Settlement-${exportPackageId}.pdf"`);
      return res.send(pdf);
    } catch (error) { return fail(res, error); }
  });
  router.get('/exports/:exportPackageId/funding-package', async (req, res) => {
    try {
      if (!actorId(req)) return res.status(401).json({ error: 'An authenticated financing-operations identity is required.' });
      const exportPackageId = String(req.params.exportPackageId || '').trim();
      const pdf = await achSettlementPacket.renderFundingPackage(exportPackageId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="SRA-Funding-Package-${exportPackageId}.pdf"`);
      return res.send(pdf);
    } catch (error) { return fail(res, error); }
  });
  router.post('/authorizations/opportunities/:opportunityId/approve', async (req, res) => { const administrator = actorId(req); if (!administrator) return res.status(401).json({ error: 'An authenticated administrator identity is required.' }); try { await loanFinancingReady; return res.status(201).json(await loanFinancing.approveOpportunity(req.params.opportunityId, req.body || {}, administrator)); } catch (error) { return fail(res, error); } });
  router.get('/closings', (req, res) => res.json({ records: service.list({ status: req.query.status, opportunityId: req.query.opportunityId }) }));
  router.get('/closings/:closingId', (req, res) => { const detail = service.detail(req.params.closingId); return detail ? res.json(detail) : res.status(404).json({ error: 'Financing closing was not found.' }); });
  router.post('/closings', async (req, res) => { try { return res.status(201).json(await service.open(req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.post('/closings/:closingId/conditions', async (req, res) => { try { return res.status(201).json(await service.addCondition(req.params.closingId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.post('/closings/:closingId/conditions/:conditionId/satisfy', async (req, res) => { try { return res.json(await service.satisfyCondition(req.params.closingId, req.params.conditionId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.post('/closings/:closingId/ready', async (req, res) => { try { return res.json(await service.markReady(req.params.closingId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.post('/closings/:closingId/authorize', async (req, res) => { try { return res.status(201).json(await service.authorize(req.params.closingId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.post('/closings/:closingId/disbursements/:disbursementId/submit', async (req, res) => { try { return res.json(await service.submitDisbursement(req.params.closingId, req.params.disbursementId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.post('/closings/:closingId/disbursements/:disbursementId/settlement', async (req, res) => { try { return res.json(await service.recordSettlement(req.params.closingId, req.params.disbursementId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.post('/closings/:closingId/board-servicing', async (req, res) => { try { return res.status(201).json(await service.boardToServicing(req.params.closingId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  router.get('/positions', async (req, res) => { try { await distributionReady; return res.json({ records: positionDistribution.listPositions({ status: req.query.status, distributionStatus: req.query.distributionStatus, opportunityId: req.query.opportunityId }) }); } catch (error) { return fail(res, error); } });
  router.get('/positions/:positionId', async (req, res) => { try { await distributionReady; const detail = positionDistribution.detail(req.params.positionId); return detail ? res.json(detail) : res.status(404).json({ error: 'Financed position was not found.' }); } catch (error) { return fail(res, error); } });
  router.get('/positions/:positionId/distribution-assessment', async (req, res) => { try { await distributionReady; return res.json(positionDistribution.assessDistributionEligibility(req.params.positionId)); } catch (error) { return fail(res, error); } });
  router.post('/positions/:positionId/make-available', async (req, res) => { try { await distributionReady; return res.status(201).json(await positionDistribution.makeAvailable(req.params.positionId, req.body || {}, actorId(req))); } catch (error) { return fail(res, error); } });
  return router;
}
