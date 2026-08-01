import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT) || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const marketplace = {
  marketStatus: 'LIVE',
  verifiedValue: 12840000,
  activeProjects: 18,
  participatingAssets: 42,
  openPositions: 27,
  completionCandidates: 3,
  instrumentsActive: 9,
  completionNeed: 240000,
  completionReturn: 26000,
  assets: [
    {
      id: 'A-1042',
      name: 'North District Market',
      type: 'OPERATING_BUSINESS',
      region: 'Ogden, Utah',
      state: 'ACTIVE',
      lifecycleEvents: 418,
      verifiedCycles: 392,
      verifiedValue: 735000,
      verifiedScore: 88,
      valueSignal: 'STABLE',
      projectId: 'SRA-RE-0021',
      dimensions: { production: 91, condition: 84, reliability: 93, capacity: 79 }
    },
    {
      id: 'A-2088',
      name: 'Weber Residential Portfolio',
      type: 'REAL_ESTATE',
      region: 'Northern Utah',
      state: 'UNDER_PROJECT',
      lifecycleEvents: 96,
      verifiedCycles: 81,
      verifiedValue: 1860000,
      verifiedScore: 76,
      valueSignal: 'GROWING',
      projectId: 'SRA-RE-0014',
      dimensions: { production: 72, condition: 68, reliability: 82, capacity: 81 }
    },
    {
      id: 'A-3104',
      name: 'Weber Mixed-Use Block',
      type: 'MIXED_USE_REAL_ESTATE',
      region: 'Weber County, Utah',
      state: 'UNDER_PROJECT',
      lifecycleEvents: 147,
      verifiedCycles: 126,
      verifiedValue: 2480000,
      verifiedScore: 92,
      valueSignal: 'ACCELERATING',
      projectId: 'SRA-RE-0033',
      dimensions: { production: 89, condition: 90, reliability: 94, capacity: 95 }
    }
  ],
  projects: [
    {
      id: 'SRA-RE-0014',
      assetId: 'A-2088',
      assetName: 'Weber Residential Portfolio',
      title: '14-Unit Residential Recovery',
      region: 'Northern Utah',
      stage: 'SERVICES_SCHEDULED',
      progress: 62,
      verifiedValue: 1860000,
      fundingTarget: 420000,
      fundingProgress: 74,
      signal: '+4.8%',
      status: 'OPEN',
      completionState: 'WATCH',
      trueBill: { id: 'TB-0014', state: 'ACTIVE', purpose: 'CAPITAL_FORMATION', value: 310000 }
    },
    {
      id: 'SRA-RE-0021',
      assetId: 'A-1042',
      assetName: 'North District Market',
      title: 'Neighborhood Grocery Expansion',
      region: 'Ogden, Utah',
      stage: 'PRODUCTION_BEGINS',
      progress: 39,
      verifiedValue: 735000,
      fundingTarget: 185000,
      fundingProgress: 91,
      signal: '+2.1%',
      status: 'OPEN',
      completionState: 'NORMAL',
      trueBill: { id: 'TB-0021', state: 'ISSUED', purpose: 'ASSET_EXPANSION', value: 168000 }
    },
    {
      id: 'SRA-RE-0033',
      assetId: 'A-3104',
      assetName: 'Weber Mixed-Use Block',
      title: 'Mixed-Use Rehabilitation',
      region: 'Weber County, Utah',
      stage: 'VERIFIED_VALUE',
      progress: 78,
      verifiedValue: 2480000,
      fundingTarget: 610000,
      fundingProgress: 83,
      signal: '+6.3%',
      status: 'OPEN',
      completionState: 'ELIGIBLE',
      trueBill: { id: 'TB-0033', state: 'PLEDGED', purpose: 'COMPLETION_CAPACITY', value: 505000 }
    }
  ],
  completionWatch: [
    { projectId: 'SRA-RE-0014', title: '14-Unit Residential Recovery', gap: 109000, verifiedCoverage: 82, state: 'WATCH', action: 'Wait for market participation' },
    { projectId: 'SRA-RE-0033', title: 'Mixed-Use Rehabilitation', gap: 88000, verifiedCoverage: 94, state: 'ELIGIBLE', action: 'Prepare Completion Participant path' },
    { projectId: 'SRA-RE-0041', title: 'Community Equipment Hub', gap: 43000, verifiedCoverage: 71, state: 'PENDING', action: 'Verify remaining lifecycle events' }
  ],
  activity: [
    { time: '10:42', kind: 'VERIFIED', label: 'Inspection milestone verified', project: 'SRA-RE-0014', amount: 45000 },
    { time: '10:36', kind: 'PARTICIPANT', label: 'Capital participant joined pool', project: 'SRA-RE-0033' },
    { time: '10:21', kind: 'ASSIGNED', label: 'Material supply position assigned', project: 'SRA-RE-0021' },
    { time: '09:58', kind: 'VVP', label: 'Verified Value package frozen', project: 'SRA-RE-0033', amount: 2480000 },
    { time: '09:41', kind: 'TRUE_BILL', label: 'True Bill activated for expansion', project: 'SRA-RE-0021', amount: 168000 }
  ]
};

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'SAIN Real Asset Market', version: '0.2.0', timestamp: new Date().toISOString() });
});

app.get('/api/marketplace', (_req, res) => res.json(marketplace));

app.post('/api/sane/message', (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'A message is required.' });

  const lower = message.toLowerCase();
  let reply = 'I can move that through SRA. Name the asset, project, or outcome, and I will organize the marketplace path behind the conversation.';

  if (lower.includes('remodel') || lower.includes('renovate')) {
    reply = 'I can open the Asset Account, read its lifecycle, draft the project, identify service positions, and prepare the Verified Value path before anything is published.';
  } else if (lower.includes('invest') || lower.includes('capital')) {
    reply = 'There are three live projects with capital participation. I can compare Verified Value, project stage, timing window, True Bill state, and completion exposure.';
  } else if (lower.includes('asset')) {
    reply = 'I can show the asset first: identity, lifecycle, Verified Value dimensions, active project, True Bill position, and current marketplace signal.';
  } else if (lower.includes('gap') || lower.includes('complete')) {
    reply = 'Mixed-Use Rehabilitation is currently eligible for a Completion Participant path. The verified coverage is 94% with an $88,000 completion gap.';
  } else if (lower.includes('true bill') || lower.includes('instrument')) {
    reply = 'I can show each purpose-bound True Bill, its supporting Verified Value Package, current position, authorized workflow, and lifecycle state.';
  } else if (lower.includes('verified value')) {
    reply = 'Verified Value is visible across production, condition, reliability, and available capacity. I can open the full state for any Asset Account.';
  }

  return res.json({ reply });
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(port, '0.0.0.0', () => console.log(`SRA Build V2 is running on port ${port}`));
