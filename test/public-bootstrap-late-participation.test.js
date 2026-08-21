import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../public/public-bootstrap.js', import.meta.url), 'utf8');

test('late-loaded participation is initialized after DOM ready before Tier One loads', () => {
  assert.match(
    bootstrap,
    /await loadScript\('\/participation\.js'\);\s*if \(document\.readyState !== 'loading' && typeof window\.initializeParticipation === 'function'\) \{\s*await window\.initializeParticipation\(\);\s*\}\s*await loadScript\('\/marketplace-tier-one\.js'\);/
  );
});
