import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routerPath = new URL('../routes/sane-router.js', import.meta.url);
const uiPath = new URL('../public/admin/operations-queue-ui.js', import.meta.url);

test('production SANE router constructs and exposes direct Coin Agent inspection', async () => {
  const source = await readFile(routerPath, 'utf8');
  assert.match(source, /import \{ SraCoinAgentService \}/);
  assert.match(source, /import \{ SraCoinAgentInspectionService \}/);
  assert.match(source, /new SraCoinAgentInspectionService\(new SraCoinAgentService\(domain\)\)/);
  assert.match(source, /router\.get\('\/coin-agents'/);
  assert.match(source, /router\.get\('\/coin-agents\/:coinPositionId'/);
  assert.match(source, /coinAgentInspection\.inspect\(req\.params\.coinPositionId\)/);
});

test('administration UI requests direct inspection from the mounted SANE API', async () => {
  const source = await readFile(uiPath, 'utf8');
  assert.match(source, /\/api\/sane\/coin-agents\/\$\{encodeURIComponent\(value\)\}/);
  assert.doesNotMatch(source, /financial-records\/coin-positions\/\$\{encodeURIComponent\(value\)\}\/agent/);
  assert.match(source, /renderCoinAgent\(result\.agent, result\.actionImpact\)/);
});
