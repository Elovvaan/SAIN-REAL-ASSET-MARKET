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

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'SAIN Real Asset Market',
    version: '0.1.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/marketplace', (_req, res) => {
  res.json({
    marketStatus: 'LIVE',
    verifiedValue: 12840000,
    activeProjects: 18,
    participatingAssets: 42,
    openPositions: 27,
    completionCandidates: 3,
    projects: [
      {
        id: 'SRA-RE-0014',
        title: '14-Unit Residential Recovery',
        region: 'Northern Utah',
        stage: 'SERVICES_SCHEDULED',
        progress: 62,
        verifiedValue: 1860000,
        fundingTarget: 420000,
        fundingProgress: 74,
        signal: '+4.8%',
        status: 'OPEN'
      },
      {
        id: 'SRA-RE-0021',
        title: 'Neighborhood Grocery Expansion',
        region: 'Ogden, Utah',
        stage: 'PRODUCTION_BEGINS',
        progress: 39,
        verifiedValue: 735000,
        fundingTarget: 185000,
        fundingProgress: 91,
        signal: '+2.1%',
        status: 'OPEN'
      },
      {
        id: 'SRA-RE-0033',
        title: 'Mixed-Use Rehabilitation',
        region: 'Weber County, Utah',
        stage: 'VERIFIED_VALUE',
        progress: 78,
        verifiedValue: 2480000,
        fundingTarget: 610000,
        fundingProgress: 83,
        signal: '+6.3%',
        status: 'OPEN'
      }
    ],
    assets: [
      {
        id: 'A-1042',
        name: 'North District Market',
        type: 'OPERATING_BUSINESS',
        state: 'ACTIVE',
        lifecycleEvents: 418,
        verifiedCycles: 392,
        valueSignal: 'STABLE'
      },
      {
        id: 'A-2088',
        name: 'Weber Residential Portfolio',
        type: 'REAL_ESTATE',
        state: 'UNDER_PROJECT',
        lifecycleEvents: 96,
        verifiedCycles: 81,
        valueSignal: 'GROWING'
      }
    ],
    activity: [
      { time: '10:42', label: 'Inspection milestone verified', project: 'SRA-RE-0014' },
      { time: '10:36', label: 'Capital participant joined pool', project: 'SRA-RE-0033' },
      { time: '10:21', label: 'Material supply position assigned', project: 'SRA-RE-0021' },
      { time: '09:58', label: 'Verified Value package frozen', project: 'SRA-RE-0033' }
    ]
  });
});

app.post('/api/sane/message', (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

  if (!message) {
    return res.status(400).json({ error: 'A message is required.' });
  }

  const lower = message.toLowerCase();
  let reply = 'I can organize that through the SRA marketplace. Tell me which asset or project you want to work with, and I will shape the next step.';

  if (lower.includes('remodel') || lower.includes('renovate')) {
    reply = 'I can begin a project draft from the asset record, identify the completion scope, and organize service and capital participation around it.';
  } else if (lower.includes('invest') || lower.includes('capital')) {
    reply = 'I found three active productive projects with open capital participation. I can compare their stage, Verified Value, timing window, and completion path.';
  } else if (lower.includes('asset')) {
    reply = 'Your Asset Account is the permanent record. I can show its lifecycle, active projects, Verified Value state, and current marketplace opportunities.';
  } else if (lower.includes('gap') || lower.includes('complete')) {
    reply = 'I can evaluate whether the project has reached a completion gap and whether SRA should prepare a Completion Participant path.';
  }

  return res.json({ reply });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`SRA is running on port ${port}`);
});
