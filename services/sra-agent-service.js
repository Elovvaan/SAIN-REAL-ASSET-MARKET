const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.1';
const RESPONSES_API_URL = 'https://api.openai.com/v1/responses';

function compact(value, maxItems = 20) {
  return Array.isArray(value) ? value.slice(0, maxItems) : value;
}

function extractOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  const parts = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
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
    client = null,
    fetchImpl = globalThis.fetch
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
    this.client = client;
    this.fetch = fetchImpl;
  }

  available() {
    return Boolean(this.client || process.env.OPENAI_API_KEY);
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
      'Use plain language and preserve SRA terminology such as Verified Value, Asset Account, Project Account, settlement, participation, treasury, servicing, and lifecycle event.',
      'Respect strict record separation throughout every answer. Never collapse the underlying asset, Asset Account, Project Account, financial instrument, participation position, settlement record, or servicing account into one thing.',
      'An underlying asset is the property, business, contract, receivable, or other subject being represented. An Asset Account is the platform record that identifies that asset and preserves its verified lifecycle.',
      'A Project Account is a separate operating record for defined work, funding need, production activity, progress, and completion connected to an Asset Account. A project is not automatically a financial asset or financial instrument.',
      'A financial asset on SRA is a recognized right, obligation, position, receivable, instrument, or other recorded financial relationship connected to supported evidence. Do not define every operating project or underlying property as a financial asset.',
      'A True Bill is a purpose-bound instrument connected to a defined obligation, value, project, settlement, or capital function. Do not describe it merely as a capital plan.',
      'A participation plan describes available participation terms. A participation commitment records committed capital. A participation position records the resulting economic position. Keep all three separate.',
      'Settlement records the closeout and transfer workflow. It does not erase or merge the underlying asset, instrument, obligation, or resulting servicing relationship.',
      'Servicing begins after settlement and separately records continuing payments, insurance, taxes, inspections, covenants, performance, exceptions, and completion.',
      'Verified Value is a supported platform measurement attached to a record. It is not automatically cash, market price, legal ownership, an approved offering, or proof of settlement.',
      'When explaining a marketplace screen, identify which displayed item is an Asset Account, which is a Project Account, which is an instrument, and whether any actual participation position or settlement record exists.',
      'Default to a focused answer of 120 to 250 words. Give more detail only when the user explicitly requests a deep explanation, report, complete record, or step-by-step breakdown.',
      'Lead with the direct answer. Use no more than one short heading and five bullets unless more structure is necessary.',
      'Translate internal property names into normal language. Do not expose JSON, database field names, implementation keys, raw schemas, or source-code notation unless the user explicitly asks for technical details.',
      'Do not narrate every record in the supplied context. Select only the facts needed to answer the question.',
      'Use simple Markdown only: short paragraphs, bold emphasis, and basic bullets. Do not use tables, nested headings, or fenced code blocks in normal marketplace conversation.'
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

  async requestResponse(payload) {
    if (this.client?.responses?.create) return this.client.responses.create(payload);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const error = new Error('SRA agent is unavailable because OPENAI_API_KEY is not configured in the runtime environment.');
      error.statusCode = 503;
      throw error;
    }
    if (typeof this.fetch !== 'function') {
      const error = new Error('SRA agent is unavailable because the runtime does not provide fetch.');
      error.statusCode = 503;
      throw error;
    }

    const result = await this.fetch(RESPONSES_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const response = await result.json().catch(() => ({}));
    if (!result.ok) {
      const error = new Error(response?.error?.message || `OpenAI request failed with status ${result.status}.`);
      error.statusCode = result.status >= 500 ? 502 : 400;
      throw error;
    }
    return response;
  }

  async chat(input) {
    const message = typeof input?.message === 'string' ? input.message.trim() : '';
    if (!message) throw new Error('message is required.');

    const context = this.buildContext(input.scope || {});
    const response = await this.requestResponse({
      model: this.model,
      instructions: this.instructions(),
      max_output_tokens: 700,
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
      message: extractOutputText(response),
      contextScope: input.scope || {},
      writeAccess: 'DISABLED',
      approvalRequiredForStateChanges: true,
      generatedAt: new Date().toISOString()
    };
  }
}
