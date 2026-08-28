import { Router } from 'express';
import multer from 'multer';
import { PrivateDocumentService } from '../services/private-document-service.js';
import { CounterpartyOperationsService } from '../services/counterparty-operations-service.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
function credentials(req){return{packageReference:req.body?.packageReference||req.query?.packageReference||req.get('x-sra-package-reference'),windowId:req.body?.windowId||req.query?.windowId||req.get('x-sra-participation-window'),accessCode:req.body?.accessCode||req.query?.accessCode||req.get('x-sra-participation-code')}}
function requestInput(req){return{...(req.body||{}),idempotencyKey:req.get('idempotency-key')||req.get('x-idempotency-key')||req.body?.idempotencyKey||null};}
function failure(res,error){const message=error?.message||String(error);const status=error?.code==='SRA_IDEMPOTENCY_CONFLICT'?409:/not found/i.test(message)?404:/access|expired|verified/i.test(message)?403:400;return res.status(status).json({error:message,code:error?.code||null});}

export function createTransactionParticipationGatewayRouter(service,database=null){
 const router=Router();
 const documents=new PrivateDocumentService({database});
 const counterparty=new CounterpartyOperationsService(service.domain,{gateway:service});
 router.post('/access',async(req,res)=>{try{return res.json(await service.access(credentials(req)));}catch(error){return failure(res,error);}});
 router.post('/receipt',async(req,res)=>{try{return res.json(await service.confirmReceipt(credentials(req),requestInput(req)));}catch(error){return failure(res,error);}});
 router.post('/contact',async(req,res)=>{try{return res.json(await service.identifyContact(credentials(req),requestInput(req)));}catch(error){return failure(res,error);}});
 router.post('/questions',async(req,res)=>{try{const recorded=await service.askQuestion(credentials(req),requestInput(req));const response=await counterparty.resolveParticipationEvent(recorded.event.eventId);return res.json({...recorded,response});}catch(error){return failure(res,error);}});
 router.post('/issues',async(req,res)=>{try{const recorded=await service.reportIssue(credentials(req),requestInput(req));const response=await counterparty.resolveParticipationEvent(recorded.event.eventId);return res.json({...recorded,response});}catch(error){return failure(res,error);}});
 router.post('/processing-confirmation',async(req,res)=>{try{return res.json(await service.confirmProcessing(credentials(req),requestInput(req)));}catch(error){return failure(res,error);}});
 router.post('/conversation/latest',async(req,res)=>{try{await service.ensureHydrated();const verified=service.authenticate(credentials(req));const response=await counterparty.resolveLatest(verified.pkg.exportPackageId);return res.json({response,status:counterparty.statusForPackage(verified.pkg.exportPackageId)});}catch(error){return failure(res,error);}});
 router.post('/documents',upload.single('document'),async(req,res)=>{try{await service.ensureHydrated();const input=requestInput(req);const replay=await service.documentReplay(credentials(req),input);if(replay){const priorDocument=typeof documents.get==='function'?await documents.get(replay.event.documentId):null;return res.status(200).json({document:priorDocument||{id:replay.event.documentId,replayed:true},...replay,replayed:true});}const verified=service.authenticate(credentials(req));const documentType=String(req.body?.documentType||'TRANSACTION_PARTICIPANT_DOCUMENT').toUpperCase();const stored=await documents.store({file:req.file,documentType,uploaderId:req.body?.contactName||verified.record.windowId,retentionPolicy:'TRANSACTION_PARTICIPATION_EVIDENCE',retentionReferenceId:verified.pkg.exportPackageId});if(!stored.ok)return res.status(400).json({error:stored.error});const result=await service.recordDocument(credentials(req),stored.document,input);return res.status(201).json({document:stored.document,...result});}catch(error){return failure(res,error);}});
 return router;
}
