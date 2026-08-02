import { RECORD_TYPES } from './persistent-domain-service.js';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class PersistentMarketplaceService {
  constructor(persistentDomain, seed = {}) {
    this.persistentDomain = persistentDomain;
    this.seed = seed;
  }

  get assets() {
    return this.persistentDomain.list(RECORD_TYPES.ASSET_ACCOUNT);
  }

  get projects() {
    return this.persistentDomain.list(RECORD_TYPES.PROJECT_ACCOUNT);
  }

  get completionWatch() {
    return Array.isArray(this.seed.completionWatch) ? this.seed.completionWatch : [];
  }

  get activity() {
    const lifecycle = this.persistentDomain.list(RECORD_TYPES.LIFECYCLE_EVENT)
      .slice(-20)
      .reverse()
      .map((event) => ({
        time: new Date(event.occurredAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        kind: event.eventType,
        label: event.eventType.replaceAll('_', ' '),
        project: event.objectType === 'PROJECT_ACCOUNT' ? event.objectId : event.payload?.projectId || null,
        amount: event.payload?.amount || null
      }));
    return lifecycle.length ? lifecycle : (Array.isArray(this.seed.activity) ? this.seed.activity : []);
  }

  get marketStatus() {
    return 'LIVE';
  }

  get verifiedValue() {
    return this.assets.reduce((total, asset) => total + number(asset.verifiedValue ?? asset.value), 0);
  }

  get projectedMarketplaceGain() {
    return this.projects.reduce((total, project) => total + number(project.projectedGain), 0);
  }

  get activeProjects() {
    return this.projects.filter((project) => project.status !== 'CLOSED').length;
  }

  get participatingAssets() {
    return this.assets.length;
  }

  get openPositions() {
    return this.persistentDomain.list(RECORD_TYPES.PARTICIPATION_POSITION)
      .filter((position) => !['CLOSED', 'SETTLED', 'DISCHARGED'].includes(position.state)).length;
  }

  get completionCandidates() {
    return this.projects.filter((project) => ['WATCH', 'ELIGIBLE', 'PENDING'].includes(project.completionState)).length;
  }

  get instrumentsActive() {
    return this.projects.filter((project) => project.trueBill && project.trueBill.state !== 'CLOSED').length;
  }

  get completionNeed() {
    return this.completionWatch.reduce((total, item) => total + number(item.gap), 0);
  }

  get completionReturn() {
    return this.completionWatch.reduce((total, item) => total + number(item.platformReturn), 0);
  }

  snapshot() {
    return {
      marketStatus: this.marketStatus,
      verifiedValue: this.verifiedValue,
      projectedMarketplaceGain: this.projectedMarketplaceGain,
      activeProjects: this.activeProjects,
      participatingAssets: this.participatingAssets,
      openPositions: this.openPositions,
      completionCandidates: this.completionCandidates,
      instrumentsActive: this.instrumentsActive,
      completionNeed: this.completionNeed,
      completionReturn: this.completionReturn,
      assets: this.assets,
      projects: this.projects,
      completionWatch: this.completionWatch,
      activity: this.activity
    };
  }
}
