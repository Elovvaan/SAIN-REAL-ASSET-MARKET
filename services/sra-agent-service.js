import OpenAI from 'openai';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.1';

function compact(value, maxItems = 20) {
  return Array.isArray(value) ? value.slice(0, maxItems) : value;
}

export class SraAgentService {
  constructor({
    persistentDomain,
    marketplace,
    ledgerService,
    treasuryService,
    financialStatementsService,
    assetServicingService,
    institutionBillingService,
    economicsService,
    homeFinancingService,
    settlementService,
    model = DEFAULT_MODEL,
    client = null
  }) {
    this.domain = persistentDomain;
    this.marketplace = marketplace;
    this.ledger = ledgerService;
    this.treasury = treasuryService;
    this.statements = financialStatementsService;
    this.servicing = assetServicingService;
    this.billing = institutionBillingService;
    this.economics = economicsService;
    this.financing = homeFinancingService;
    this.settlement = settlementService;
    this.model = model;
    this.client = client || (process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null);
  }

  available() {
    return Boolean(this.client);
  }

  instructions() {
    return [
      'You are SANE, the operating intelligence agent for the SAIN Real Asset Market platform.',
      'Answer only from the platform context provided with the request. Do not invent records, approvals, balances, legal authority, settlement completion, or regulatory status.',
      'Distinguish clearly between recorded facts, calculations, and interpretations.',
      'You may explain platform workflows, summarize current records, identify missing evidence, and point out exceptions.',
      'You must not claim that an asset is legally validated, that a payment settled, that a person is eligible, or that an offering is approved unless the provided platform records explicitly show that state.',
      'Any requested action that changes financial, settlement, treasury, servicing, billing, ledger, or offering state requires explicit human approval and must not be executed by this chat endpoint.',
      'When the context is incomplete, say exactly what record or evidence is missing.',
      'Use plain language and preserve SRA terminology such as Verified Value, Asset Account, Project Account, settlement, participation, treasury, servicing, and lifecycle event.'
    ].join('\n');
  }

  buildContext(scope = {}) {
    const context = {
      generatedAt: new Date().toISOString(),
      activeView: scope.activeView || null,
      operatingTier: scope.operatingTier || null,
      domainCounts: this.domain?.snapshot?.() || null
    };

    if (scope.includeMarketplace !== false && this.marketplace) {
      context.marketplace = {
        marketStatus: this.marketplace.marketStatus,
        verifiedValue: this.marketplace.verifiedValue,
        projectedMarketplaceGain: this.marketplace.projectedMarketplaceGain,
        assets: compact(this.marketplace.assets),
        projects: compact(this.marketplace.projects)
      };
    }

    if (scope.ledgerAccountId && this.ledger) context.ledgerAccount = this.ledger.balance(scope.ledgerAccountId);
    if (scope.includeTrialBalance && this.ledger) context.trialBalance = this.ledger.trialBalance();
    if (scope.treasuryProfileId && this.treasury) context.treasuryPosition = this.treasury.position(scope.treasuryProfileId);
    if (scope.accountingPeriodId && this.statements) context.financialStatements = this.statements.generate(scope.accountingPeriodId);
    if (scope.servicingAccountId && this.servicing) context.servicingSummary = this.servicing.summary(scope.servicingAccountId);
    if (scope.institutionId && this.billing) context.institutionBilling = this.billing.summary(scope.institutionId);
    if (scope.settlementId && this.settlement?.getSettlement) context.settlement = this.settlement.getSettlement(scope.settlementId);
    if (scope.homeProjectId && this.financing?.getHomeProject) context.homeProject = this.financing.getHomeProject(scope.homeProjectId);
    if (scope.recordType && scope.recordId) context.requestedRecord = this.domain.get(scope.recordType, scope.recordId);

    return context;
  }

  async chat(input) {
    if (!this.client) {
      const error = new Error('SRA agent is unavailable because OPENAI_API_KEY is not configured in the runtime environment.');
      error.statusCode = 503;
      throw error;
    }

    const message = typeof input?.message === 'string' ? input.message.trim() : '';
    if (!message) throw new Error('message is required.');

    const context = this.buildContext(input.scope || {});
    const response = await this.client.responses.create({
      model: this.model,
      instructions: this.instructions(),
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: message },
            { type: 'input_text', text: `\nSRA PLATFORM CONTEXT\n${JSON.stringify(context)}` }
          ]
        }
      ],
      store: false
    });

    return {
      agent: 'SANE',
      model: this.model,
      responseId: response.id,
      message: response.output_text || '',
      contextScope: input.scope || {},
      writeAccess: 'DISABLED',
      approvalRequiredForStateChanges: true,
      generatedAt: new Date().toISOString()
    };
  }
}
