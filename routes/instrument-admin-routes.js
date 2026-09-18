import multer from 'multer';
import { PrivateDocumentService } from '../services/private-document-service.js';
import { InstrumentApprovalService } from '../services/instrument-approval-service.js';
import { InstrumentRepresentationApprovalService, INSTRUMENT_REPRESENTATION_APPROVAL_TYPE } from '../services/instrument-representation-approval-service.js';
import { InstrumentCoinPositionLinkageService } from '../services/instrument-coin-position-linkage-service.js';
import { CoinMarketPropagationService } from '../services/coin-market-propagation-service.js';

const PENDING_STATES = new Set(['DRAFT', 'PENDING', 'PENDING_REVIEW', 'IN_REVIEW', 'REVIEW_REQUIRED', 'AWAITING_APPROVAL', 'RECORDED']);
const REPRESENTATION_STATES = new Set(['APPROVED', 'ISSUED', 'ACTIVE']);
const recoveryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 10 } });

function stateOf(record) { return String(record?.state || record?.status || '').toUpperCase(); }
function idOf(record) { return record?.instrumentId || record?.id || null; }
function workflowFor(instrument, representationApproved, marketplaceState = 'NOT_PREPARED') {
  const state = stateOf(instrument);
  const instrumentApproved = REPRESENTATION_STATES.has(state);
  const internalMarketLive = marketplaceState === 'LIVE';
  return {
    instrumentApproval: instrumentApproved ? 'COMPLETE' : 'REQUIRED',
    representationApproval: instrumentApproved ? (representationApproved ? 'COMPLETE' : 'REQUIRED') : 'WAITING',
    internalMarketplace: internalMarketLive ? 'LIVE' : marketplaceState,
    onChainPreparation: representationApproved ? (internalMarketLive ? 'READY' : 'WAITING_FOR_INTERNAL_MARKET') : 'WAITING',
    currentStage: !instrumentApproved
      ? 'INSTRUMENT_APPROVAL'
      : !representationApproved
        ? 'REPRESENTATION_APPROVAL'
        : !internalMarketLive
          ? 'INTERNAL_MARKETPLACE'
          : 'ON_CHAIN_PREPARATION',
  };
}

export async function installInstrumentAdminRoutes({ router, domain, requireAdmin, database = null }) {
  await domain.hydrate?.([INSTRUMENT_REPRESENTATION_APPROVAL_TYPE]);
  const approvals = new InstrumentApprovalService(domain);
  const representations = new InstrumentRepresentationApprovalService(domain);
  const linkages = new InstrumentCoinPositionLinkageService(domain);
  const marketPropagation = new CoinMarketPropagationService(domain);

  router.post('/api/admin/records/recovery-documents', recoveryUpload.array('documents', 10), async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ error:'Select at least one existing SRA package or transaction document.' });
      const documents = new PrivateDocumentService({ database: database || domain?.database || null });
      const invalid = files.map((file,index)=>({ index, error:documents.validateFile(file) })).filter((item)=>item.error);
      if (invalid.length) return res.status(400).json({ error:'The recovery package contains an unsupported file.', invalidFiles:invalid.map(({index,error})=>({ name:files[index]?.originalname || null, error })) });
      const extracted = [];
      for (const file of files) {
        const stored = await documents.store({ file, documentType:'HISTORICAL_RECORD_RECOVERY', uploaderId:session.id, retentionPolicy:'ADMIN_RECORD_RECOVERY', deferExtraction:false });
        if (!stored.ok) throw new Error(stored.error);
        extracted.push({ document:stored.document, facts:stored.document?.extraction?.facts || null, extractionStatus:stored.document?.extraction?.status || null });
      }
      if (database?.audit) await database.audit({ actorId:session.id, eventType:'ADMIN_RECOVERY_PACKAGE_INGESTED', objectType:'HISTORICAL_RECORD_RECOVERY', objectId:extracted[0]?.document?.id || 'RECOVERY_PACKAGE', payload:{ documentIds:extracted.map((item)=>item.document?.id).filter(Boolean), count:extracted.length } });
      return res.status(201).json({ records:extracted, extractedFacts:extracted.map((item)=>item.facts).filter(Boolean) });
    } catch (error) {
      return res.status(422).json({ error:error.message, code:error.code || 'RECOVERY_PACKAGE_INGESTION_FAILED' });
    }
  });

  router.post('/api/admin/records/recover', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const recoveryType = String(req.body?.recoveryType || '').trim().toUpperCase();
      const mode = String(req.body?.mode || 'PREVIEW').trim().toUpperCase();
      if (!['SRA_RECORD','ON_CHAIN_ASSET'].includes(recoveryType)) return res.status(400).json({ error:'Recovery type must be SRA_RECORD or ON_CHAIN_ASSET.' });
      if (!['PREVIEW','RESTORE'].includes(mode)) return res.status(400).json({ error:'Recovery mode must be PREVIEW or RESTORE.' });
      const source = req.body?.record && typeof req.body.record === 'object' ? req.body.record : {};
      const network = String(req.body?.network || source.network || source.blockchain || '').trim().toUpperCase();
      const originalId = String(req.body?.originalId || source.transactionId || source.instrumentId || source.coinPositionId || source.id || '').trim();
      if (!originalId) return res.status(400).json({ error:'Original record identifier is required. Recovery never generates a replacement identifier.' });
      const recordType = String(req.body?.recordType || '').trim().toUpperCase();
      const allowedRecordTypes = new Set(['SRA_TRANSACTION','SRA_INSTRUMENT','COIN_POSITION','ASSET_RAIL_REPRESENTATION','CANONICAL_ASSET']);
      if (!allowedRecordTypes.has(recordType)) return res.status(400).json({ error:'Select a supported durable record type for recovery.' });
      if (recoveryType === 'ON_CHAIN_ASSET' && !network) return res.status(400).json({ error:'Network is required for on-chain asset recovery.' });
      const existing = await domain.hydrateRecord(recordType, originalId);
      const extractedFacts = Array.isArray(source.extractedFacts) ? source.extractedFacts : [];
      const evidenceOther = extractedFacts.flatMap((facts) => Array.isArray(facts?.identifiers?.other) ? facts.identifiers.other : []);
      const evidenceValue = (label) => evidenceOther.find((item) => String(item?.label || '').trim().toUpperCase() === label)?.value || null;
      const principalAmount = extractedFacts.map((facts) => facts?.economicTerms?.principalAmount ?? facts?.economicTerms?.financedAmount).find((value) => value !== null && value !== undefined) ?? null;
      const recoveredTransaction = recordType === 'SRA_TRANSACTION' ? {
        transactionId: originalId,
        transactionType: String(source.transactionType || '').trim() || (originalId.toUpperCase().startsWith('LFA-') ? 'LOAN_FINANCING_AUTHORIZATION' : 'RECOVERED_SRA_TRANSACTION'),
        state: String(source.state || '').trim() || (originalId.toUpperCase().startsWith('LFA-') ? 'POSTED' : 'RECOVERED'),
        amount: source.amount ?? principalAmount,
        currency: source.currency || extractedFacts.map((facts) => facts?.economicTerms?.currency).find(Boolean) || 'USD',
        opportunityId: source.opportunityId || evidenceValue('FUNDING OPPORTUNITY REFERENCE') || evidenceValue('OPPORTUNITY REFERENCE') || null,
        closingId: source.closingId || evidenceValue('FINANCING CLOSING REFERENCE') || null,
        fundingPackageReference: source.fundingPackageReference || evidenceValue('SRA FUNDING PACKAGE REFERENCE') || null,
        settlementReference: source.settlementReference || extractedFacts.map((facts) => facts?.identifiers?.settlementReference).find(Boolean) || null,
      } : {};
      const recovered = { ...source, ...recoveredTransaction, ...(recordType === 'SRA_INSTRUMENT' ? { instrumentId: originalId } : {}), ...(recordType === 'COIN_POSITION' ? { coinPositionId: originalId } : {}), id: source.id || originalId, recovery: { recoveryType, network: network || null, restoredFromExistingEvidence: true, recoveredAt: new Date().toISOString(), recoveredBy: session.id } };
      const preview = { recoveryType, recordType, originalId, network: network || null, existingRecordFound: Boolean(existing), action: existing ? 'NO_CHANGE_EXISTING_RECORD' : 'RESTORE_ORIGINAL_RECORD', record: recovered };
      if (mode === 'PREVIEW' || existing) return res.json({ preview, restored:false, existing: existing || null });
      if (String(req.body?.approval || '').toUpperCase() !== 'RESTORE') return res.status(409).json({ error:'Explicit RESTORE approval is required after preview.', requiredApproval:'RESTORE', preview });
      await domain.put(recordType, originalId, recovered, { actorId:session.id, eventType:'HISTORICAL_RECORD_RESTORED', auditPayload:{ recoveryType, network:network || null, originalId, restoredFromExistingEvidence:true } });
      if (database?.audit) await database.audit({ actorId:session.id, eventType:'ADMIN_HISTORICAL_RECORD_RECOVERY', objectType:recordType, objectId:originalId, payload:{ recoveryType, network:network || null } });
      return res.status(201).json({ restored:true, recordType, originalId, record:recovered });
    } catch (error) {
      return res.status(422).json({ error:error.message, code:error.code || 'HISTORICAL_RECORD_RECOVERY_FAILED' });
    }
  });

  router.get('/api/admin/instrument-coin-position-linkages', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json(linkages.read());
  });

  router.post('/api/admin/instruments/:instrumentId/coin-position-linkage', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    if (String(req.body?.approval || '').toUpperCase() !== 'LINK') {
      return res.status(409).json({ error: 'Explicit administrator Coin Position linkage approval is required.', requiredApproval: 'LINK' });
    }
    try {
      const result = await linkages.link(req.params.instrumentId, String(req.body?.coinPositionId || '').trim(), session.id);
      const marketplace = await marketPropagation.propagate(req.params.instrumentId, 'SRA-COIN-AGENT');
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'INSTRUMENT_COIN_POSITION_LINKED', objectType: 'SRA_INSTRUMENT', objectId: req.params.instrumentId, payload: { changed: result.changed, coinPositionId: result.coinPosition?.coinPositionId, marketplaceState: marketplace.marketplaceState } });
      return res.status(result.changed ? 201 : 200).json({ ...result, marketplace });
    } catch (error) {
      return res.status(422).json({ error: error.message, code: error.code || 'INSTRUMENT_COIN_POSITION_LINKAGE_FAILED', assessment: error.assessment || null });
    }
  });

  router.get('/api/admin/instruments/approval-status', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    const instruments = domain.list('SRA_INSTRUMENT');
    const pending = instruments.filter((instrument) => PENDING_STATES.has(stateOf(instrument)));
    const representationReady = instruments.filter((instrument) => REPRESENTATION_STATES.has(stateOf(instrument)));
    const representationApprovals = representations.list();
    const approvedIds = new Set(representationApprovals.filter((item) => item.state === 'APPROVED').map((item) => item.instrumentId));
    const assessments = new Map(representations.evaluateMany(representationReady).map((assessment) => [assessment.instrumentId, assessment]));
    return res.json({
      pending,
      pendingCount: pending.length,
      representationReady: representationReady.map((instrument) => {
        const instrumentId = idOf(instrument);
        const representationApproved = approvedIds.has(instrumentId);
        const marketplace = marketPropagation.statusFor(instrumentId);
        return {
          instrument,
          assessment: assessments.get(instrumentId),
          representationApproved,
          marketplace: {
            listingId: marketplace.listingId || null,
            state: marketplace.marketplaceState || 'NOT_PREPARED',
            blockers: marketplace.blockers || [],
          },
          workflow: workflowFor(instrument, representationApproved, marketplace.marketplaceState || 'NOT_PREPARED'),
        };
      }),
      representationApprovalCount: approvedIds.size,
      representationApprovals,
    });
  });

  router.get('/api/admin/instruments/:instrumentId/internal-market', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json(marketPropagation.statusFor(req.params.instrumentId));
  });

  router.post('/api/admin/instruments/internal-market/reconcile', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(await marketPropagation.reconcile({ limit: req.body?.limit || 500, actorId: 'SRA-COIN-AGENT' })); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'COIN_INTERNAL_MARKET_RECONCILIATION_FAILED' }); }
  });

  router.post('/api/admin/instruments/:instrumentId/approve', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    if (String(req.body?.approval || '').toUpperCase() !== 'APPROVE') {
      return res.status(409).json({ error: 'Explicit administrator instrument approval is required.', requiredApproval: 'APPROVE' });
    }
    try {
      const result = await approvals.approve(req.params.instrumentId, session.id);
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'SRA_INSTRUMENT_APPROVED', objectType: 'SRA_INSTRUMENT', objectId: req.params.instrumentId, payload: { changed: result.changed } });
      return res.status(result.changed ? 201 : 200).json(result);
    } catch (error) {
      return res.status(422).json({ error: error.message, code: error.code || 'SRA_INSTRUMENT_APPROVAL_FAILED' });
    }
  });

  router.post('/api/admin/instruments/:instrumentId/representation/approve', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    if (String(req.body?.approval || '').toUpperCase() !== 'APPROVE') {
      return res.status(409).json({ error: 'Explicit administrator representation approval is required.', requiredApproval: 'APPROVE' });
    }
    try {
      const result = await representations.approve(req.params.instrumentId, session.id);
      const marketplace = await marketPropagation.propagate(req.params.instrumentId, 'SRA-COIN-AGENT');
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'INSTRUMENT_REPRESENTATION_APPROVED', objectType: 'SRA_INSTRUMENT', objectId: req.params.instrumentId, payload: { changed: result.changed, approvalId: result.approval.approvalId, marketplaceState: marketplace.marketplaceState } });
      return res.status(result.changed ? 201 : 200).json({ ...result, marketplace });
    } catch (error) {
      return res.status(422).json({ error: error.message, code: error.code || 'INSTRUMENT_REPRESENTATION_APPROVAL_FAILED', assessment: error.assessment || null });
    }
  });

  return { approvals, representations, linkages, marketPropagation };
}
