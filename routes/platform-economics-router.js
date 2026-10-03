import express from 'express';
import { billingAuthorization } from '../middleware/billing-authorization.js';
import { PlatformBillingReportService } from '../services/platform-billing-report-service.js';
import { FeePaymentService } from '../services/fee-payment-service.js';
import { AgentServiceFeeBillingService } from '../services/agent-service-fee-billing-service.js';
function fail(res,error){const message=error?.message||'Unexpected platform economics error.';return res.status(/not found/i.test(message)?404:400).json({error:message});}
export function createPlatformEconomicsRouter(service, accessService){
  const router=express.Router();
  router.use(billingAuthorization(accessService));
  router.use(async(_req,_res,next)=>{try{await service.hydrate();return next();}catch(error){return next(error);}});
  const reports=new PlatformBillingReportService(service.domain,service);
  const payments=new FeePaymentService(service.domain,service,service.ledgerService);
  const run=handler=>async(req,res)=>{try{return await handler(req,res);}catch(error){return fail(res,error);}};
  router.post('/revenue-models',run(async(req,res)=>res.status(201).json(await reports.saveModel(req.body||{},req.billingActorId))));
  router.get('/report',run(async(_req,res)=>res.json(await reports.snapshot())));
  router.post('/agent-schedule',run(async(req,res)=>{const billing=new AgentServiceFeeBillingService(service.domain);return res.json(await billing.initialize(req.billingActorId));}));
  router.get('/catalog',(req,res)=>res.json({items:service.listCatalog({category:req.query.category||null,state:req.query.state||null})}));
  router.post('/catalog',run(async(req,res)=>res.status(201).json(await service.createCatalogItem(req.body||{},req.billingActorId))));
  router.get('/catalog/:feeCode',(req,res)=>{const item=service.getCatalogItem(req.params.feeCode.toUpperCase());return item?res.json(item):res.status(404).json({error:'Fee Catalog Item not found.'});});
  router.get('/schedules',(req,res)=>res.json({schedules:service.listSchedules({state:req.query.state||null})}));
  router.post('/schedules',run(async(req,res)=>res.status(201).json(await service.createSchedule(req.body||{},req.billingActorId))));
  router.get('/schedules/:scheduleId',(req,res)=>{const item=service.getSchedule(req.params.scheduleId);return item?res.json(item):res.status(404).json({error:'Fee Schedule not found.'});});
  router.post('/schedules/:scheduleId/activate',run(async(req,res)=>res.json(await service.activateSchedule(req.params.scheduleId,req.billingActorId))));
  router.post('/calculate',run((req,res)=>res.json(service.calculate(req.body||{}))));
  router.get('/charges',(req,res)=>res.json({charges:service.listCharges({payerId:req.query.payerId||null,subjectId:req.query.subjectId||null,state:req.query.state||null})}));
  router.post('/charges',run(async(req,res)=>{
    const input=req.body||{};
    if(input.scheduleId==='SRA-AGENT-SERVICE-FEES-2026-08-21'){
      await service.domain.hydrate(['SRA_AGENT_WORK_ORDER']);
      const work=service.domain.get('SRA_AGENT_WORK_ORDER',input.subjectId);
      const result=await new AgentServiceFeeBillingService(service.domain).assessAcceptedWork(work,input,req.billingActorId);
      if(!result.charge)throw new Error(result.reason||'The work is not billable.');
      return res.status(result.existing?200:201).json(result.charge);
    }
    return res.status(201).json(await service.assess(input,req.billingActorId));
  }));
  router.get('/charges/:chargeId',(req,res)=>{const item=service.getCharge(req.params.chargeId);return item?res.json(item):res.status(404).json({error:'Fee Charge not found.'});});
  router.post('/charges/:chargeId/waive',run(async(req,res)=>res.json(await service.waive(req.params.chargeId,req.body||{},req.billingActorId))));
  router.get('/invoices',(req,res)=>res.json({invoices:service.listInvoices({payerId:req.query.payerId,state:req.query.state})}));
  router.get('/invoices/:invoiceId',(req,res)=>{const invoice=service.getInvoice(req.params.invoiceId);return invoice?res.json(invoice):res.status(404).json({error:'Fee Invoice not found.'});});
  router.post('/invoices',run(async(req,res)=>res.status(201).json(await service.createInvoice(req.body||{},req.billingActorId))));
  router.post('/invoices/:invoiceId/payments',run(async(req,res)=>res.json(await payments.record(req.params.invoiceId,req.body||{},req.billingActorId))));
  return router;
}
