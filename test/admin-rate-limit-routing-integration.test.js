import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../middleware/production-runtime.js', import.meta.url), 'utf8');

test('dashboard polling cannot consume the protected admin write bucket', () => {
  assert.match(source, /if \(path\.startsWith\('\/api\/admin'\)\) return String\(method\)\.toUpperCase\(\) === 'GET' \? 'ADMIN_READ' : 'ADMIN_WRITE'/);
  assert.match(source, /const key = `\$\{kind\}:\$\{clientKey\(req\)\}`/);
});
