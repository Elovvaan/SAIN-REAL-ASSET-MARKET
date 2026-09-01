import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const participant = fs.readFileSync(new URL('../public/participant-workspace-suite.js', import.meta.url), 'utf8');
const legacyHomeProjects = fs.readFileSync(new URL('../public/home-project-workspace.js', import.meta.url), 'utf8');

test('participant workspace suite declares one public presentation owner', () => {
  assert.match(participant, /publicPresentationOwner = 'participant-workspace-suite'/);
  assert.match(participant, /delete document\.body\.dataset\.publicPresentationOwner/);
  assert.match(participant, /event\.stopImmediatePropagation\(\)/);
});

test('legacy Home Projects cannot race the participant Home renderer', () => {
  assert.match(legacyHomeProjects, /function participantHomeOwnsPresentation\(\)/);
  assert.match(legacyHomeProjects, /if \(!forcePresentation && participantHomeOwnsPresentation\(\)\) return false;/);
  assert.match(legacyHomeProjects, /await loadProjects\(\);\s*if \(!forcePresentation && participantHomeOwnsPresentation\(\)\) return false;/);
  assert.match(legacyHomeProjects, /if \(!nav \|\| participantHomeOwnsPresentation\(\)\) return;/);
});
