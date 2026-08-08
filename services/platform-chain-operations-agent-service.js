const CHAIN_TYPE = 'SRA_COIN_CHAIN_PROJECTION';

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function activeSra(position) {
  return String(position?.state || '').toUpperCase() !== 'RETIRED'
    && String(position?.symbol || 'SRA').toUpperCase() === 'SRA';
}

function snapshotVersion(snapshot) {
  return [
    Number(snapshot.platformSupply || 0).toFixed(8),
    Number(snapshot.issuedOnChainSupply || 0).toFixed(8),
    snapshot.mintAddress || 'NO_MINT',
  ].join(':');
}

export class PlatformChainOperationsAgentService {
  constructor({ domain, chainService = null, database = null }) {
    this.domain = domain;
    this.chainService = chainService;
    this.database = database;
  }

  capabilities() {
    return {
      agent: 'SRA_PLATFORM_CHAIN_OPERATIONS_AGENT',
      role: 'PLATFORM_CHAIN_OPERATIONS',
      mode: 'PREPARE_EXECUTE_RECONCILE',
      authority: 'HUMAN_IN_THE_LOOP',
      can: [
        'OBSERVE_SRA_SUPPLY',
        'DETECT_PENDING_ON_CHAIN_ISSUANCE',
        'PREPARE_SRA_CHAIN_SYNCHRONIZATION',
        'RECONCILE_CHAIN_PROJECTION',
        'REPORT_CHAIN_RESULT',
      ],
      cannotWithoutApproval: [
        'MINT_SRA_ON_CHAIN',
        'TRANSFER_SRA_ON_CHAIN',
        'TRANSFER_NATIVE_CHAIN_ASSET',
      ],
    };
  }

  snapshot() {
    const platformSupply = Number(this.domain.list('COIN_POSITION')
      .filter(activeSra)
      .reduce((sum, position) => sum + number(position.quantity), 0)
      .toFixed(8));
    const projection = this.domain.get(CHAIN_TYPE, 'SRA-SOLANA') || null;
    const issuedOnChainSupply = number(projection?.issuedOnChainSupply);
    const pendingQuantity = Number(Math.max(0, platformSupply - issuedOnChainSupply).toFixed(8));
    const reconciliationRequired = issuedOnChainSupply > platformSupply;
    const snapshot = {
      platformSupply,
      issuedOnChainSupply,
      pendingQuantity,
      reconciliationRequired,
      mintAddress: projection?.mintAddress || null,
      transactionSignature: projection?.transactionSignature || null,
      lastSynchronizedAt: projection?.lastSynchronizedAt || projection?.updatedAt || null,
      state: reconciliationRequired
        ? 'RECONCILIATION_REQUIRED'
        : pendingQuantity > 0
          ? (projection ? 'SYNC_AVAILABLE' : 'NOT_ON_CHAIN')
          : projection
            ? 'SYNCHRONIZED'
            : 'NO_SUPPLY',
    };
    return { ...snapshot, snapshotVersion: snapshotVersion(snapshot) };
  }

  workQueue() {
    const snapshot = this.snapshot();
    const queue = [];
    if (snapshot.reconciliationRequired) {
      queue.push({
        jobId: `CHAIN-SRA-RECONCILE:${snapshot.snapshotVersion}`,
        jobType: 'RECONCILE_SRA_CHAIN_SUPPLY',
        priority: 'BLOCKING',
        authority: 'ADMIN_REVIEW_REQUIRED',
        executable: false,
        reason: 'On-chain issued SRA exceeds current authoritative platform supply.',
        snapshotVersion: snapshot.snapshotVersion,
        snapshot,
      });
    } else if (snapshot.pendingQuantity > 0) {
      queue.push({
        jobId: `CHAIN-SRA-SYNC:${snapshot.snapshotVersion}`,
        jobType: snapshot.mintAddress ? 'SYNC_SRA_SUPPLY' : 'PUT_SRA_ON_CHAIN',
        priority: 'READY',
        authority: 'ADMIN_APPROVAL_REQUIRED',
        executable: Boolean(this.chainService),
        requestedQuantity: snapshot.pendingQuantity,
        targetSupply: snapshot.platformSupply,
        approvedIssuedOnChainSupply: snapshot.issuedOnChainSupply,
        snapshotVersion: snapshot.snapshotVersion,
        network: 'SOLANA',
        snapshot,
      });
    }
    return { agent: this.capabilities().agent, state: queue.length ? 'WORK_AVAILABLE' : 'CLEAR', queue, snapshot };
  }

  async execute(jobId, input = {}, actor = {}) {
    const queue = this.workQueue();
    const job = queue.queue.find((item) => item.jobId === String(jobId || ''));
    if (!job) {
      const error = new Error('The reviewed Chain Operations job is stale or no longer available. Refresh Workflow Approvals and review the current SRA quantity.');
      error.code = 'SRA_CHAIN_APPROVAL_SNAPSHOT_STALE';
      throw error;
    }
    if (job.authority !== 'ADMIN_APPROVAL_REQUIRED') throw new Error('This chain operations job cannot be executed automatically.');
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit administrator approval is required.');
    if (!this.chainService) throw new Error('SRA chain service is unavailable.');

    const approvedTargetSupply = number(input.targetSupply);
    if (!approvedTargetSupply || approvedTargetSupply !== job.targetSupply) {
      const error = new Error('The approved SRA target does not match the reviewed Chain Operations job. Refresh Workflow Approvals and review the current quantity.');
      error.code = 'SRA_CHAIN_APPROVAL_SNAPSHOT_STALE';
      throw error;
    }

    const result = await this.chainService.putOnChain({
      targetSupply: job.targetSupply,
      expectedIssuedOnChainSupply: job.approvedIssuedOnChainSupply,
      snapshotVersion: job.snapshotVersion,
    }, actor.id || actor.actorId || 'SRA_PLATFORM_ADMIN');
    const reconciled = this.snapshot();
    if (this.database?.audit) await this.database.audit({
      actorId: actor.id || actor.actorId || 'SRA_PLATFORM_ADMIN',
      eventType: 'SRA_CHAIN_OPERATIONS_AGENT_JOB_EXECUTED',
      objectType: 'SRA_PLATFORM_CHAIN_OPERATIONS_AGENT',
      objectId: job.jobId,
      payload: {
        jobType: job.jobType,
        requestedQuantity: job.requestedQuantity,
        approvedTargetSupply: job.targetSupply,
        approvedIssuedOnChainSupply: job.approvedIssuedOnChainSupply,
        approvedSnapshotVersion: job.snapshotVersion,
        issuedOnChainSupply: reconciled.issuedOnChainSupply,
        mintAddress: result.mintAddress || null,
        transactionSignature: result.transactionSignature || null,
      },
    });
    return { agent: this.capabilities().agent, job, result, reconciliation: reconciled, state: reconciled.reconciliationRequired ? 'RECONCILIATION_REQUIRED' : 'COMPLETED' };
  }
}
