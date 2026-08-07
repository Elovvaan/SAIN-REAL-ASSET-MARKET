import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const routerSource = fs.readFileSync(new URL('../routes/private-admin-router.js', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../routes/determination-admin-routes.js', import.meta.url), 'utf8');
const engineSource = fs.readFileSync(new URL('../services/determination-engine-service.js', import.meta.url), 'utf8');

test('private Administration initializes the determination engine once at runtime', () => {
  assert.match(routerSource, /import \{ DeterminationEngineService \} from '\.\.\/services\/determination-engine-service\.js'/);
  assert.match(routerSource, /const determinationEngine = new DeterminationEngineService\(domain\)/);
  assert.match(routerSource, /await determinationEngine\.initialize\(\)/);
  assert.match(routerSource, /installDeterminationAdminRoutes\(\{ router, service: determinationEngine, requireAdmin \}\)/);
});

test('determination API exposes the complete canonical pipeline behind requireAdmin', () => {
  for (const route of [
    '/api/admin/determinations/status',
    '/api/admin/determinations/subjects',
    '/api/admin/determinations/observations',
    '/api/admin/determinations/snapshots',
    '/api/admin/determinations/determine',
    '/api/admin/determinations/subjects/:subjectId/history',
  ]) assert.match(apiSource, new RegExp(route.replaceAll('/', '\\/')));

  assert.match(apiSource, /const session = await requireAdmin\(req, res\)/);
  assert.match(apiSource, /service\.registerSubject/);
  assert.match(apiSource, /service\.recordObservation/);
  assert.match(apiSource, /service\.createSnapshot/);
  assert.match(apiSource, /service\.determine/);
  assert.match(apiSource, /service\.subjectHistory/);
});

test('determination runtime remains on the verification side of contract formation', () => {
  assert.match(engineSource, /referenceOnly: true/);
  assert.match(engineSource, /createsAgreement: false/);
  assert.match(engineSource, /createsRights: false/);
  assert.match(engineSource, /createsOwnership: false/);
  assert.match(engineSource, /createsInstrument: false/);
  assert.doesNotMatch(apiSource, /settlement|exportPackage|SRA_INSTRUMENT|agreement/i);
});

test('Administration summary surfaces determination-engine health and protects the new domain', () => {
  assert.match(routerSource, /determinationEngine: determinationAdministration\.status\(\)/);
  assert.match(routerSource, /'DETERMINATIONS'/);
});
