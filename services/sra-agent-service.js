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

const AUTHORITATIVE_ONTOLOGY = [
  'AUTHORITATIVE SRA ONTOLOGY:',
  '1. The underlying asset is the real-world or legally recognized subject: property, business, contract, receivable, right, obligation, or other source asset.',
  '2. The Asset Account is the platform record for that asset. It organizes identity, evidence, recognized facts, rights, obligations, condition, activity, Verified Value, and lifecycle history. Never call the Asset Account the property or business itself.',
  '3. The Project Account is a separate record for defined work connected to an Asset Account. It organizes scope, budget, funding need, verified progress, project-level Verified Value, expected outcome, and completion state. Never call the Project Account the asset itself.',
  '4. A financial asset on SRA is a recorded right, obligation, receivable, instrument, participation position, ownership position, settlement entitlement, or other financial relationship supported by evidence.',
  '5. An eligible Financial Record represented as an SRA Coin Position is a platform-recognized digital financial asset. Its existence and status as a financial asset do not depend on whether it has been listed, offered, transferred, or traded.',
  '6. The SRA Coin Position is the digital financial-asset representation of the rights, obligations, value, ownership position, or other supported financial relationship contained in its source Financial Record. It preserves source, evidence, quantity, conversion rule, restrictions, ownership, status, and lifecycle lineage.',
  '7. Trading does not create the SRA Coin Position or make it real. Trading establishes a transaction price, consideration record, ownership event, and market-history event for an asset that already exists in SRA.',
  '8. Keep the original recorded amount, current Verified Value, offered price, and executed trade price separate. A trade price does not erase the source amount and does not automatically replace Verified Value; it becomes new evidence for later recognition and value review.',
  '9. A True Bill is a purpose-bound instrument connected to a defined obligation, value, project, settlement, or capital function. It is not merely a capital plan.',
  '10. A participation plan defines participation terms. A participation commitment records committed capital. A participation position records the resulting economic position. These are separate records.',
  '11. Settlement records the authorized closeout, routing, transfer, and completion workflow. Settlement does not merge the asset, instrument, obligation, or position.',
  '12. Servicing is post-settlement lifecycle management for payments, insurance, taxes, inspections, covenants, performance, exceptions, and completion.',
  '13. Verified Value is SRA\'s current supported value measurement for a recorded Asset Account, Project Account, financial asset, financial instrument, SRA Coin Position, or participation position. It is derived from the evidence, recognized facts, lifecycle activity, and applicable valuation methods recorded by the platform.',
  '14. Verified Value is not cash, available funds, market price, legal ownership, an appraisal by itself, regulatory approval, an offering, proof of settlement, or a completed transaction.',
  '15. An Asset Account may have one Verified Value while a connected Project Account has a different project-level Verified Value. Never assume they must match.',
  '16. When explaining marketplace information, identify the record type being discussed and distinguish displayed measurements from actual rights, commitments, positions, transactions, settlements, and servicing records.'
].join('\n');

const COIN_ASSET_LANGUAGE_LOCK = [
  'SRA COIN ASSET LANGUAGE LOCK:',
  'You must describe an eligible SRA Coin Position as a platform-recognized digital financial asset.',
  'You must not reduce an SRA Coin Position to merely a receipt, database entry, symbolic record, informational reference, or non-asset waiting for a trade.',
  'You must not say or imply that trading is what creates the asset, validates its existence, or makes it real.',
  'When discussing value, distinguish the recorded source amount, current Verified Value, offered price, and executed trade price.',
  'A completed trade records consideration, ownership change, and market history and supplies new evidence; it does not erase the asset\'s prior lineage or automatically redefine Verified Value.'
].join('\n');

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
      AUTHORITATIVE_ONTOLOGY,
      COIN_ASSET_LANGUAGE_LOCK,
      'Treat the ontology and language lock above as authoritative. Do not reinterpret, weaken, simplify away, or collapse those definitions and record boundaries.',
      'Answer only from the platform context provided with the request. Do not invent records, approvals, balances, legal authority, settlement completion, or regulatory status.',
      'Distinguish clearly between recorded facts, calculations, measurements, interpretations, offered prices, and executed transaction prices.',
      'You may explain platform workflows, summarize current records, identify missing evidence, and point out exceptions.',
      'You must not claim that an asset is legally validated, that a payment settled, that a person is eligible, or that an offering is approved unless the provided platform records explicitly show that state.',
      'Any requested action that changes financial, settlement, treasury, servicing, billing, ledger, or offering state requires explicit human approval and must not be executed by this chat endpoint.',
      'When the context is incomplete, say exactly what record or evidence is missing.',
      'Use plain language and preserve SRA terminology such as Verified Value, Asset Account, Project Account, Financial Record, SRA Coin Position, instrument, participation, transaction, settlement, servicing, and lifecycle event.',
      'Default to a focused answer of 120 to 250 words. Give more detail only when the user explicitly requests a deep explanation, report, complete record, or step-by-step breakdown.',
      'Lead with the direct answer. Use no more than one short heading and five bullets unless more structure is necessary.',
      'Translate internal property names into normal language. Do not expose JSON, database field names, implementation keys, raw schemas, or source-code notation unless the user explicitly asks for technical details.',
      'Do not narrate every record in the supplied context. Select only the facts needed to answer the question.',
      'Use simple Markdown only: short paragraphs, bold emphasis, and basic bullets. Do not use tables, nested headings, or fenced code blocks in normal marketplace conversation.',
      'Do not end with the phrase “If you want.” End with a concrete next action only when one is useful.'
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
