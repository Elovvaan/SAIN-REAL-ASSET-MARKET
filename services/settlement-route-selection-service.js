import { EscrowSettlementService } from './escrow-settlement-service.js';

const EXPORT_PACKAGE_TYPE = 'EXPORT_PACKAGE';
const DISBURSEMENT_TYPE = 'FINANCING_DISBURSEMENT';
const SELECTION_TYPE = 'SETTLEMENT_ROUTE_SELECTION';
const now = () => new Date().toISOString();
const normalize = (value) => String(value || '').trim().toUpperCase();
const selectionId = (exportPackageId) => `SRS-${exportPackageId}`;
const routes = Object.freeze([
  { route: 'DIRECT_SETTLEMENT', label: 'Direct Settlement' },
  { route: 'ESCROW_CUSTODIAL_SETTLEMENT', label: 'Escrow / Custodial Settlement' },
  { route: 'ON_CHAIN_SETTLEMENT', label: 'On-Chain Settlement' },
]);
const allowedRoutes = new Set(routes.map((entry) => entry.route));

export class SettlementRouteSelectionService {
  constructor(domain) {
    this.domain = domain;
    this.escrow = new EscrowSettlementService(domain);
  }

  async initialize() {
    await this.domain.hydrate([EXPORT_PACKAGE_TYPE, DISBURSEMENT_TYPE, SELECTION_TYPE]);
    await this.escrow.initialize();
    return this.status();
  }

  status() {
    return {
      service: 'SETTLEMENT_ROUTE_SELECTION',
      routes,
      selections: this.domain.list(SELECTION_TYPE).length,
      escrow: this.escrow.status(),
    };
  }

  availableRoutes() { return routes; }

  current(exportPackageId) {
    const pkg = this.domain.get(EXPORT_PACKAGE_TYPE, exportPackageId);
    const selection = this.domain.get(SELECTION_TYPE, selectionId(exportPackageId));
    const escrowSettlement = selection?.route === 'ESCROW_CUSTODIAL_SETTLEMENT' ? this.escrow.existingForPackage(exportPackageId) : null;
    return { exportPackage: pkg || null, selection: selection || null, escrowSettlement };
  }

  async ensureEscrow(selection, input, actorId) {
    const existing = this.escrow.existingForPackage(selection.exportPackageId);
    if (existing) return existing;
    const result = await this.escrow.prepare({
      exportPackageId: selection.exportPackageId,
      route: input.escrowRoute,
      escrowAgentName: input.escrowAgentName,
      escrowAgentReference: input.escrowAgentReference,
      escrowInstructionsReference: input.escrowInstructionsReference,
      releaseConditions: input.releaseConditions,
      returnConditions: input.returnConditions,
      settlementAsset: input.settlementAsset,
      network: input.network,
    }, actorId);
    return result.settlement;
  }

  async select(exportPackageId, input = {}, actorId = null) {
    const pkg = this.domain.get(EXPORT_PACKAGE_TYPE, exportPackageId);
    if (!pkg || normalize(pkg.exportKind) !== 'FINANCING_DISBURSEMENT') throw new Error('Financing disbursement export package was not found.');
    const disbursement = this.domain.get(DISBURSEMENT_TYPE, pkg.disbursementId);
    if (!disbursement) throw new Error('Authoritative financing disbursement was not found.');
    if (!['AUTHORIZED', 'SUBMITTED'].includes(disbursement.status)) throw new Error(`Settlement route cannot be selected from disbursement status ${disbursement.status}.`);
    if (pkg.externalSettlementReference || disbursement.settledAt) throw new Error('Settlement route is locked after external settlement has been recorded.');

    const route = normalize(input.route);
    if (!allowedRoutes.has(route)) throw new Error('route must be DIRECT_SETTLEMENT, ESCROW_CUSTODIAL_SETTLEMENT, or ON_CHAIN_SETTLEMENT.');
    const id = selectionId(exportPackageId);
    const existing = this.domain.get(SELECTION_TYPE, id);
    if (existing && existing.route !== route) throw new Error(`Settlement route is already selected as ${existing.route}.`);

    let selection = existing;
    if (!selection) {
      const timestamp = now();
      const settlementAsset = input.settlementAsset ? normalize(input.settlementAsset) : null;
      selection = {
        settlementRouteSelectionId: id,
        exportPackageId,
        closingId: pkg.closingId,
        disbursementId: pkg.disbursementId,
        financingTransactionId: pkg.financingTransactionId,
        opportunityId: pkg.opportunityId || null,
        instrumentId: pkg.instrumentId || null,
        route,
        settlementAsset,
        network: route === 'ON_CHAIN_SETTLEMENT' ? (input.network ? normalize(input.network) : null) : null,
        selectedBy: actorId,
        selectedAt: timestamp,
        updatedAt: timestamp,
      };
      const updatedPackage = {
        ...pkg,
        settlementRoute: route,
        settlementAsset,
        settlementRouteSelectionId: id,
        settlementRouteSelectedBy: actorId,
        settlementRouteSelectedAt: timestamp,
        updatedAt: timestamp,
      };
      await this.domain.atomicPut([
        { type: SELECTION_TYPE, id, payload: selection, actorId, eventType: 'SETTLEMENT_ROUTE_SELECTED' },
        { type: EXPORT_PACKAGE_TYPE, id: exportPackageId, payload: updatedPackage, actorId, eventType: 'FINANCING_EXPORT_SETTLEMENT_ROUTE_SELECTED' },
      ]);
    }

    const escrowSettlement = route === 'ESCROW_CUSTODIAL_SETTLEMENT' ? await this.ensureEscrow(selection, input, actorId) : null;
    return { selection, escrowSettlement, routes };
  }
}
