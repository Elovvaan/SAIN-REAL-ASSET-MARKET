import express from 'express';
import { ExternalDexAdapterService } from '../services/external-dex-adapter-service.js';
import { ExternalDexExecutorService } from '../services/external-dex-executor-service.js';
import { SolanaTransferService } from '../services/solana-transfer-service.js';

function actorId(req) { return req.get('x-sra-actor-id') || req.body?.actorId || null; }
function handle(res, error) {
  const status = ['PROJECTION_INELIGIBLE','DEX_EXPORT_INELIGIBLE'].includes(error.code) ? 422 : ['DEX_EXECUTOR_NOT_READY','SOLANA_EXECUTOR_NOT_READY'].includes(error.code) ? 503 : ['DEX_EXECUTOR_REJECTED','SOLANA_EXECUTOR_REJECTED'].includes(error.code) ? 502 : /not found/i.test(error.message) ? 404 : 400;
  return res.status(status).json({ error:error.message, code:error.code || 'ON_CHAIN_PROJECTION_ERROR', assessment:error.assessment || null, executorStatus:error.executorStatus || null });
}

export function createOnChainProjectionRouter(service) {
  const router = express.Router();
  const dex = new ExternalDexAdapterService(service.domain, service);
  const dexExecutor = new ExternalDexExecutorService();
  const solana = new SolanaTransferService();

  router.get('/status', (_req,res) => res.json(service.status()));
  router.get('/eligibility/:instrumentId', (req,res) => res.json(service.evaluateInstrument(req.params.instrumentId)));
  router.get('/projections', (req,res) => res.json({ records:service.listProjections({ status:req.query.status, instrumentId:req.query.instrumentId, network:req.query.network }) }));
  router.get('/projections/:projectionId', (req,res) => { const record=service.getProjection(req.params.projectionId); return record ? res.json(record) : res.status(404).json({error:'Projection not found.'}); });
  router.post('/projections', async (req,res) => { try { return res.status(201).json(await service.createProjection(req.body,actorId(req))); } catch(error){ return handle(res,error); } });
  router.post('/projections/:projectionId/approve', async (req,res) => { try { return res.json(await service.approveProjection(req.params.projectionId,actorId(req))); } catch(error){ return handle(res,error); } });
  router.post('/projections/:projectionId/mint', async (req,res) => { try { return res.status(201).json(await service.createMint(req.params.projectionId,req.body,actorId(req))); } catch(error){ return handle(res,error); } });
  router.post('/projections/:projectionId/allocate', async (req,res) => { try { return res.status(201).json(await service.allocate(req.params.projectionId,req.body,actorId(req))); } catch(error){ return handle(res,error); } });
  router.get('/wallets', (req,res) => res.json({ records:service.listWallets({ participantId:req.query.participantId,status:req.query.status }) }));
  router.post('/wallets', async (req,res) => { try { return res.status(201).json(await service.registerWallet(req.body,actorId(req))); } catch(error){ return handle(res,error); } });
  router.post('/wallets/:walletId/approve', async (req,res) => { try { return res.json(await service.approveWallet(req.params.walletId,req.body,actorId(req))); } catch(error){ return handle(res,error); } });
  router.get('/events', (req,res) => res.json({ records:service.listChainEvents(req.query.projectionId || null) }));
  router.post('/events', async (req,res) => { try { return res.status(201).json(await service.recordChainEvent(req.body,actorId(req))); } catch(error){ return handle(res,error); } });
  router.post('/events/:eventId/reconcile', async (req,res) => { try { return res.json(await service.reconcileEvent(req.params.eventId,actorId(req))); } catch(error){ return handle(res,error); } });
  router.get('/reconciliations', (req,res) => res.json({ records:service.listReconciliations(req.query.projectionId || null) }));

  router.get('/solana/status', (_req,res) => res.json(solana.status()));
  router.get('/solana/wallet', async (_req,res) => { try { return res.json(await solana.wallet()); } catch(error){ return handle(res,error); } });
  router.post('/solana/transfers', async (req,res) => { try { return res.status(201).json(await solana.send(req.body || {})); } catch(error){ return handle(res,error); } });

  router.get('/dex/status', async (_req,res) => { try { return res.json({ ...(await dex.status()),executor:dexExecutor.status() }); } catch(error){ return handle(res,error); } });
  router.get('/dex/executor/status', (_req,res) => res.json(dexExecutor.status()));
  router.get('/dex/venues', (_req,res) => res.json({records:dex.venues()}));
  router.get('/dex/exports', async (req,res) => { try { return res.json({records:await dex.listExports({state:req.query.state,venue:req.query.venue,exportPackageId:req.query.exportPackageId})}); } catch(error){ return handle(res,error); } });
  router.get('/dex/exports/:dexExportId', async (req,res) => { try { const record=await dex.getExport(req.params.dexExportId); return record ? res.json(record) : res.status(404).json({error:'DEX export was not found.'}); } catch(error){ return handle(res,error); } });
  router.post('/dex/exports/preview', (req,res) => { try { return res.json(dex.preview(req.body || {})); } catch(error){ return handle(res,error); } });
  router.post('/dex/exports', async (req,res) => { try { return res.status(201).json(await dex.prepare(req.body || {},actorId(req))); } catch(error){ return handle(res,error); } });
  router.post('/dex/exports/:dexExportId/execute', async (req,res) => {
    try {
      const record=await dex.getExport(req.params.dexExportId); if(!record) return res.status(404).json({error:'DEX export was not found.'});
      const execution=await dexExecutor.execute(record,req.body || {}); const submitted=await dex.markSubmitted(record.dexExportId,{connectorReference:execution.connectorReference},actorId(req));
      if(execution.transactionSignature && execution.poolAddress){ const confirmed=await dex.confirm(record.dexExportId,{transactionSignature:execution.transactionSignature,poolAddress:execution.poolAddress,executedQuantity:execution.executedQuantity ?? record.quantity,observedMarketPrice:execution.observedMarketPrice},actorId(req)); return res.status(201).json({execution,submitted,confirmed}); }
      return res.status(202).json({execution,submitted,confirmationPending:true});
    } catch(error){ return handle(res,error); }
  });
  router.post('/dex/exports/:dexExportId/submitted', async (req,res) => { try { return res.json(await dex.markSubmitted(req.params.dexExportId,req.body || {},actorId(req))); } catch(error){ return handle(res,error); } });
  router.post('/dex/exports/:dexExportId/confirm', async (req,res) => { try { return res.status(201).json(await dex.confirm(req.params.dexExportId,req.body || {},actorId(req))); } catch(error){ return handle(res,error); } });
  return router;
}
