import { CounterpartyOperationsService } from './counterparty-operations-service.js';
export class CounterpartyOperationsStatusService{
 constructor(domain,options={}){this.operations=options.operations||new CounterpartyOperationsService(domain,options);}
 async forExportPackage(exportPackageId){await this.operations.ensureHydrated();return this.operations.statusForPackage(exportPackageId);}
 async listActive(){await this.operations.ensureHydrated();const ids=new Set(this.operations.records('COUNTERPARTY_OPERATION_CASE').map(r=>r.exportPackageId).filter(Boolean));return [...ids].map(exportPackageId=>({exportPackageId,...this.operations.statusForPackage(exportPackageId)})).filter(x=>x.status!=='AWAITING_COUNTERPARTY_REQUEST');}
}
