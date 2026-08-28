import { Router } from 'express';
import { ParticipationService, participationConfiguration } from '../services/participation-service.js';
import { TransactionParticipationGatewayService } from '../services/transaction-participation-gateway-service.js';
import { createTransactionParticipationGatewayRouter } from './transaction-participation-gateway-router.js';

function readCookie(req,name){
  const cookie=req.headers.cookie||'';
  const entry=cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith(`${name}=`));
  return entry?decodeURIComponent(entry.slice(name.length+1)):'';
}

export function createParticipationRouter(marketplace,accessService,domain){
  const router=Router();
  const service=new ParticipationService(marketplace,accessService,domain);
  const transactionParticipation=new TransactionParticipationGatewayService(domain);

  router.get('/configuration',(_req,res)=>res.json(participationConfiguration));
  router.get('/opportunities',(_req,res)=>res.json({opportunities:service.listOpportunities()}));
  router.get('/opportunities/:projectId',(req,res)=>{
    const opportunity=service.getOpportunity(req.params.projectId);
    if(!opportunity)return res.status(404).json({error:'Opportunity not found.'});
    return res.json({opportunity});
  });
  router.get('/positions',async(req,res)=>{
    const session=await accessService.getSession(readCookie(req,'sra_session'));
    if(!session)return res.status(401).json({error:'Sign in to view positions.'});
    return res.json({positions:service.listPositions(session)});
  });
  router.post('/positions',async(req,res)=>{
    const session=await accessService.getSession(readCookie(req,'sra_session'));
    const result=await service.createPosition({session,...req.body});
    return res.status(result.status).json(result.ok?{position:result.position,nextAction:result.nextAction}:{error:result.error});
  });

  router.use('/transaction', createTransactionParticipationGatewayRouter(transactionParticipation, domain?.database || null));

  return router;
}
