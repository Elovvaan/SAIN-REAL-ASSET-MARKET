const SKILL_REGISTRY = {
  MARKETPLACE: {
    id: 'MARKETPLACE',
    label: 'Marketplace Skill',
    description: 'Discovers, compares, and opens productive opportunities.',
    tiers: ['UNIVERSAL','ASSET_PROVIDER','MARKET_PROFESSIONAL','INSTITUTIONAL_OPERATOR','PLATFORM_ADMIN'],
    keywords: ['marketplace','opportunity','opportunities','browse','compare','market','watchlist']
  },
  V4V: {
    id: 'V4V',
    label: 'V4V Skill',
    description: 'Receives private evidence and moves an asset or contribution through Verified Value intake.',
    tiers: ['ASSET_PROVIDER','INSTITUTIONAL_OPERATOR'],
    keywords: ['v4v','verified value','evidence','documents','upload','verify','verification']
  },
  ASSET: {
    id: 'ASSET',
    label: 'Asset Skill',
    description: 'Registers, locates, and manages permanent Asset Accounts and lifecycle records.',
    tiers: ['ASSET_PROVIDER','INSTITUTIONAL_OPERATOR'],
    keywords: ['asset','property','restaurant','warehouse','equipment','business','portfolio']
  },
  PARTICIPATION: {
    id: 'PARTICIPATION',
    label: 'Participation Skill',
    description: 'Creates participation tickets and positions using approved contribution media.',
    tiers: ['UNIVERSAL','MARKET_PROFESSIONAL','INSTITUTIONAL_OPERATOR'],
    keywords: ['participate','position','contribute','contribution','usd','capital','service','materials','equipment']
  },
  PROJECT: {
    id: 'PROJECT',
    label: 'Project Skill',
    description: 'Creates and manages project accounts, milestones, schedules, jobs, and completion paths.',
    tiers: ['ASSET_PROVIDER','MARKET_PROFESSIONAL','INSTITUTIONAL_OPERATOR'],
    keywords: ['project','remodel','expand','build','milestone','schedule','job','assignment']
  },
  TRUE_BILL: {
    id: 'TRUE_BILL',
    label: 'True Bill Skill',
    description: 'Prepares and tracks purpose-bound True Bill workflows linked to Verified Value.',
    tiers: ['ASSET_PROVIDER','INSTITUTIONAL_OPERATOR'],
    keywords: ['true bill','instrument','pledge','discount','capital formation']
  },
  ASSIGNMENT: {
    id: 'ASSIGNMENT',
    label: 'Assignment Skill',
    description: 'Transfers all or part of a recognized SRA position and updates holder, custody, and settlement routing records.',
    tiers: ['ASSET_PROVIDER','MARKET_PROFESSIONAL','INSTITUTIONAL_OPERATOR'],
    keywords: ['assign','assignment','transfer position','new holder','payment right','contract right','partial interest']
  },
  CREATIVE_FINANCE: {
    id: 'CREATIVE_FINANCE',
    label: 'Creative Finance Skill',
    description: 'Identifies verified value, project gaps, transferable positions, and contribution media to assemble an executable project structure.',
    tiers: ['ASSET_PROVIDER','MARKET_PROFESSIONAL','INSTITUTIONAL_OPERATOR'],
    keywords: ['creative finance','structure financing','assemble value','funding gap','project gap','transferable position','payment right','future production','completion capacity']
  },
  SETTLEMENT: {
    id: 'SETTLEMENT',
    label: 'Settlement Skill',
    description: 'Reconciles positions and records the delivery or receipt of settlement value.',
    tiers: ['UNIVERSAL','MARKET_PROFESSIONAL','INSTITUTIONAL_OPERATOR'],
    keywords: ['settlement','settle','return','payment','proceeds','balance']
  },
  DISCHARGE: {
    id: 'DISCHARGE',
    label: 'Discharge Skill',
    description: 'Records setoff, satisfaction, discharge, and accounting closure of an open position.',
    tiers: ['INSTITUTIONAL_OPERATOR'],
    keywords: ['discharge','setoff','satisfaction','release','close obligation','filing']
  },
  COMPLETION: {
    id: 'COMPLETION',
    label: 'Completion Skill',
    description: 'Detects project gaps and coordinates the Completion Participant protection path.',
    tiers: ['ASSET_PROVIDER','INSTITUTIONAL_OPERATOR'],
    keywords: ['completion','complete','gap','finish','stalled','delay','safety net']
  },
  IDENTITY: {
    id: 'IDENTITY',
    label: 'Identity Skill',
    description: 'Reads the Universal Account, active capabilities, operating tier, and permissions.',
    tiers: ['UNIVERSAL','ASSET_PROVIDER','MARKET_PROFESSIONAL','INSTITUTIONAL_OPERATOR','PLATFORM_ADMIN'],
    keywords: ['identity','account','capability','tier','workspace','permission','access']
  }
};

const TIER_DEFAULTS = {
  UNIVERSAL: ['IDENTITY','MARKETPLACE'],
  ASSET_PROVIDER: ['IDENTITY','ASSET','V4V'],
  MARKET_PROFESSIONAL: ['IDENTITY','MARKETPLACE','PARTICIPATION'],
  INSTITUTIONAL_OPERATOR: ['IDENTITY','V4V','SETTLEMENT'],
  PLATFORM_ADMIN: ['IDENTITY','MARKETPLACE']
};

function normalizeTier(value) {
  return typeof value === 'string' && TIER_DEFAULTS[value] ? value : 'UNIVERSAL';
}

function cleanMessage(value) {
  return typeof value === 'string' ? value.trim().slice(0, 4000) : '';
}

function detectSkills(message, tier) {
  const lower = message.toLowerCase();
  const matches = Object.values(SKILL_REGISTRY)
    .filter((skill) => skill.tiers.includes(tier))
    .map((skill) => ({
      skill,
      score: skill.keywords.reduce((total, keyword) => total + (lower.includes(keyword) ? 1 : 0), 0)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.skill.id);

  const defaults = TIER_DEFAULTS[tier];
  return [...new Set(matches.length ? matches : defaults)].slice(0, 6);
}

function expandPlan(skillIds) {
  const plan = [...skillIds];
  if (plan.includes('CREATIVE_FINANCE')) {
    ['ASSET','V4V','TRUE_BILL','ASSIGNMENT','PARTICIPATION','PROJECT','COMPLETION','SETTLEMENT','DISCHARGE'].forEach((id) => {
      if (!plan.includes(id)) plan.push(id);
    });
  }
  if (plan.includes('ASSIGNMENT')) {
    ['PARTICIPATION','SETTLEMENT'].forEach((id) => {
      if (!plan.includes(id)) plan.push(id);
    });
  }
  if (plan.includes('COMPLETION')) {
    ['PROJECT','PARTICIPATION','SETTLEMENT','DISCHARGE'].forEach((id) => {
      if (!plan.includes(id)) plan.push(id);
    });
  }
  if (plan.includes('PROJECT') && plan.includes('ASSET') && !plan.includes('MARKETPLACE')) plan.push('MARKETPLACE');
  if (plan.includes('TRUE_BILL') && !plan.includes('V4V')) plan.unshift('V4V');
  if (plan.includes('DISCHARGE') && !plan.includes('SETTLEMENT')) plan.unshift('SETTLEMENT');
  return plan.slice(0, 10);
}

function buildReply(message, tier, skills) {
  const labels = skills.map((id) => SKILL_REGISTRY[id].label);
  const skillLine = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
  const lower = message.toLowerCase();

  if (lower.includes('what skills') || lower.includes('your skills') || lower.includes('skill registry')) {
    return `I am one Sane agent operating in the ${tier.replaceAll('_',' ')} tier. My available abilities here are ${skillLine}. I select and combine them according to the outcome you describe.`;
  }
  if (skills.includes('CREATIVE_FINANCE')) {
    return `I will use ${skillLine} as one creative-finance plan: identify verified value, measure the project gap, locate transferable positions and contribution media, assemble the execution structure, reconcile every movement, then settle and preserve discharge where applicable.`;
  }
  if (skills.includes('ASSIGNMENT')) {
    return `I will use ${skillLine}: identify the current holder and transferable amount, record the assignment, update custody and settlement routing, preserve any retained position, and reconcile the new holder's position.`;
  }
  if (skills.includes('COMPLETION')) {
    return `I will use ${skillLine} as one coordinated plan: identify the project gap, confirm the supporting position, route completion capacity, reconcile settlement, and preserve the discharge record when the position is extinguished.`;
  }
  if (skills.includes('ASSET') && skills.includes('PROJECT')) {
    return `I will use ${skillLine}: identify the asset, confirm its current V4V state, create or open the project account, and prepare the marketplace path without making you operate each module separately.`;
  }
  if (skills.includes('PARTICIPATION')) {
    return `I will use ${skillLine}: open the opportunity, identify an available position, capture the contribution medium, prepare the participation ticket, and create the position after authorization.`;
  }
  if (skills.includes('DISCHARGE')) {
    return `I will use ${skillLine}: reconcile the open position, apply authorized settlement or setoff, post the discharge record, and update the permanent lifecycle history.`;
  }
  return `I understood the request through the ${tier.replaceAll('_',' ')} operating tier. I am calling on ${skillLine} to organize the next authorized step.`;
}

export class SaneSkillService {
  listSkills(tier = 'UNIVERSAL') {
    const normalizedTier = normalizeTier(tier);
    return Object.values(SKILL_REGISTRY)
      .filter((skill) => skill.tiers.includes(normalizedTier))
      .map(({ keywords, ...skill }) => skill);
  }

  dispatch(input = {}) {
    const message = cleanMessage(input.message);
    if (!message) throw new Error('A message is required.');
    const operatingTier = normalizeTier(input.operatingTier);
    const selected = expandPlan(detectSkills(message, operatingTier))
      .filter((id) => SKILL_REGISTRY[id]?.tiers.includes(operatingTier));
    const executionPlan = selected.map((id, index) => ({
      order: index + 1,
      skillId: id,
      skillLabel: SKILL_REGISTRY[id].label,
      purpose: SKILL_REGISTRY[id].description,
      state: 'SELECTED'
    }));
    return {
      agent: 'SANE',
      architectureVersion: 'V15',
      operatingTier,
      selectedSkills: selected,
      executionPlan,
      reply: buildReply(message, operatingTier, selected)
    };
  }
}

export { SKILL_REGISTRY };
