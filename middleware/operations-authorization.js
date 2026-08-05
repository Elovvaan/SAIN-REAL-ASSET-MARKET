import { DatabaseService } from '../services/database-service.js';
import { AccessService } from '../services/access-service.js';

const STAFF_ROLES = new Set([
  'PLATFORM_ADMIN','OPERATIONS_ADMIN','FUNDING_OPERATIONS','FUNDING_ANALYST','VERIFICATION_REVIEWER','INSTRUMENT_REVIEWER','ISSUANCE_REVIEWER','MARKETPLACE_OPERATOR','SETTLEMENT_OPERATOR','AUDITOR',
]);
const WRITE_METHODS = new Set(['POST','PUT','PATCH','DELETE']);
let databasePromise = null;

function readCookie(req,name){const cookie=req.headers.cookie||'';const entry=cookie.split(';').map((part)=>part.trim()).find((part)=>part.startsWith(`${name}=`));return entry?decodeURIComponent(entry.slice(name.length+1)):'';}
function isConnectorCallback(path){return path==='/api/funding-marketplace-settlement/confirmations/external';}
function isProtectedOperationsPath(path){return ['/api/funding','/api/funding-verification','/api/funding-value','/api/funding-model','/api/funding-instrument','/api/funding-instrument-review','/api/funding-instrument-issuance','/api/funding-marketplace','/api/funding-marketplace-publication','/api/funding-marketplace-commitment','/api/funding-marketplace-allocation','/api/funding-marketplace-settlement','/api/funding-operations','/api/sain/intelligence'].some((prefix)=>path===prefix||path.startsWith(`${prefix}/`));}
function requiredRoles(path){if(path.startsWith('/api/funding-verification'))return new Set(['PLATFORM_ADMIN','OPERATIONS_ADMIN','VERIFICATION_REVIEWER','FUNDING_OPERATIONS']);if(path.startsWith('/api/funding-instrument-review'))return new Set(['PLATFORM_ADMIN','OPERATIONS_ADMIN','INSTRUMENT_REVIEWER','FUNDING_OPERATIONS']);if(path.startsWith('/api/funding-instrument-issuance'))return new Set(['PLATFORM_ADMIN','OPERATIONS_ADMIN','ISSUANCE_REVIEWER','FUNDING_OPERATIONS']);if(path.startsWith('/api/funding-marketplace-settlement'))return new Set(['PLATFORM_ADMIN','OPERATIONS_ADMIN','SETTLEMENT_OPERATOR']);if(path.startsWith('/api/funding-marketplace'))return new Set(['PLATFORM_ADMIN','OPERATIONS_ADMIN','MARKETPLACE_OPERATOR','FUNDING_OPERATIONS']);return STAFF_ROLES;}
async function productionDatabase(){if(!databasePromise){databasePromise=(async()=>{const database=new DatabaseService();await database.initialize();return database;})();}return databasePromise;}
async function defaultAccessService(){const service=new AccessService({database:await productionDatabase()});await service.initialize();return service;}

export function createOperationsAuthorization({accessServiceProvider=defaultAccessService}={}){
  return async function authorizeOperationsRequest(req,res,next){
    if(!isProtectedOperationsPath(req.path)||!WRITE_METHODS.has(req.method)||isConnectorCallback(req.path))return next();
    try{
      const token=readCookie(req,'sra_session');
      const service=await accessServiceProvider();
      const session=token?await service.getSession(token):null;
      if(!session)return res.status(401).json({error:'An active authenticated SRA session is required.',code:'SRA_AUTHENTICATION_REQUIRED'});
      const roles=[...new Set([session.activeCapacity,...(session.capacities||[]).map((capacity)=>capacity.id||capacity),...(session.roles||[]).map((role)=>role.id||role)].filter(Boolean).map((role)=>String(role).toUpperCase()))];
      const required=requiredRoles(req.path);
      if(!roles.some((role)=>required.has(role)))return res.status(403).json({error:'The authenticated account is not authorized for this SRA operation.',code:'SRA_SERVER_ROLE_REQUIRED',requiredRoles:[...required]});
      req.sraIdentity={actorId:session.id,universalAccountId:session.universalAccountId,email:session.email,activeCapacity:session.activeCapacity};
      req.sraOperationsAuth={actorId:session.id,roles,source:'SERVER_SESSION'};
      return next();
    }catch{return res.status(500).json({error:'SRA could not validate the authenticated session.',code:'SRA_SESSION_VALIDATION_FAILED'});}
  };
}

export const authorizeOperationsRequest=createOperationsAuthorization();
export { STAFF_ROLES as SRA_OPERATIONS_STAFF_ROLES };
