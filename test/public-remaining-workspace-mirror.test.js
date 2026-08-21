import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const suite = fs.readFileSync(new URL('../public/participant-workspace-suite.js', import.meta.url), 'utf8');
const financing = fs.readFileSync(new URL('../public/participant-financing-ui.js', import.meta.url), 'utf8');
const liquidity = fs.readFileSync(new URL('../public/hybrid-liquidity-market.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../public/public-bootstrap.js', import.meta.url), 'utf8');
const access = fs.readFileSync(new URL('../public/access.js', import.meta.url), 'utf8');

test('remaining participant workspaces use their authoritative capability owners', () => {
  assert.match(suite, /renderParticipantFundingOperations/);
  assert.match(suite, /renderHybridLiquidityWorkspace/);
  assert.match(suite, /renderCapabilities/);
  assert.match(suite, /window\.accessState\?\.session\?\.capabilities/);
  assert.match(suite, /Issuance boundary/);
  assert.match(financing, /window\.renderParticipantFundingOperations = render/);
});

test('participant suite mounts after Financing and Liquidity capabilities are available', () => {
  const fundingIndex = bootstrap.indexOf("'/participant-financing-ui.js'");
  const liquidityIndex = bootstrap.indexOf("'/hybrid-liquidity-market.js'");
  const suiteIndex = bootstrap.indexOf("'/participant-workspace-bootstrap.js'");
  assert.ok(fundingIndex >= 0 && liquidityIndex >= 0 && suiteIndex >= 0);
  assert.ok(suiteIndex > fundingIndex);
  assert.ok(suiteIndex > liquidityIndex);
});

test('participant financing is self-service and separated from the admin workstation', () => {
  assert.match(financing, /Submit financing request/);
  assert.match(financing, /\/api\/funding\/opportunities/);
  assert.match(financing, /signed-in account is attached automatically/i);
  assert.doesNotMatch(financing, /funding-operations\/dashboard/);
  assert.doesNotMatch(financing, /Manual applicant entry/);
});

test('liquidity capability is explicit and observer-free', () => {
  assert.match(bootstrap, /\/hybrid-liquidity-market\.js/);
  assert.match(liquidity, /window\.renderHybridLiquidityWorkspace = render/);
  assert.match(liquidity, /\/api\/sane\/hybrid-liquidity\/markets/);
  assert.doesNotMatch(liquidity, /MutationObserver/);
  assert.doesNotMatch(liquidity, /DOMContentLoaded/);
});

test('Account uses the current capacity API and live session capability records', () => {
  assert.match(access, /\/api\/access\/capacity\/apply/);
  assert.match(access, /\/api\/access\/capacity\/activate/);
  assert.match(access, /accessState\.session\?\.capabilities/);
  assert.match(access, /renderCapabilities/);
});

test('participant suite keeps internal records separate from participant products and execution', () => {
  assert.match(suite, /Marketplace only shows products that have completed publication/);
  assert.match(suite, /Creating or reviewing a proposal here is not issuance/);
  assert.match(liquidity, /Reference markets do not imply executed trades/);
});
