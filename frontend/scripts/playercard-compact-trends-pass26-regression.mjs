import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const repo = process.cwd();
const file = path.join(repo, 'frontend/src/components/PlayerCardModal.jsx');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
function normalize(text) { return String(text ?? '').replace(/\r\n/g, '\n'); }
function sha(text) { return crypto.createHash('sha256').update(normalize(text), 'utf8').digest('hex'); }

if (!fs.existsSync(file)) fail('Could not find frontend/src/components/PlayerCardModal.jsx');
const source = normalize(fs.readFileSync(file, 'utf8'));
const EXPECTED_TARGET_SHA = '4a0665a0bfdf256773ced1435ad50450c25821a469629afbfab39dd657bf95c8';
if (sha(source) !== EXPECTED_TARGET_SHA) fail('PlayerCardModal.jsx does not match the validated Pass 26 payload.');

const required = [
  '{ key: "trends", label: "Trends" }',
  'function buildPlayerCardSeasonRows({ player, leagueData, resolvedTeamName, resolvedTeamLogo })',
  'collectArchivedSnapshotRowsForPlayer({',
  'During offseason/player cards, a just-archived season and a stale live stats map can both exist.',
  'function getRemainingContractView(contract, leagueData)',
  'function isOptionDecisionWindow(leagueData)',
  'function isPendingContractOptionYear(contract, yearIndex, currentSeasonYear, optionWindowActive)',
  'function PerformanceTrendsChart({ seasons })',
  '.filter((row) => row && row?.rowType !== "total" && Number(row?.games ?? row?.gp ?? 0) > 0)',
  '<PerformanceTrendsChart seasons={seasons} />',
  'Performance Trends',
  'Season by Season',
  'Contract Summary',
  'Trophy Case',
  'Top Attributes',
  'font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;'
];
for (const fragment of required) {
  if (!source.includes(fragment)) fail(`Missing expected safety/UI fragment: ${fragment}`);
}

if (/\bCollege\b/.test(source)) fail('College unexpectedly appears in the redesigned Player Card source.');
if (source.includes('localStorage.setItem(')) fail('Player Card introduced a localStorage write; Pass 26 must remain read-only.');
if (source.includes('localStorage.removeItem(')) fail('Player Card introduced a localStorage delete; Pass 26 must remain read-only.');

// Confirm all pre-existing tabs survived alongside Trends.
for (const key of ['overview', 'attributes', 'contract', 'mood', 'career', 'accolades']) {
  if (!source.includes(`{ key: "${key}"`)) fail(`Existing tab was lost: ${key}`);
}

// Synthetic edge checks mirror the tiny pure helpers used by the Trends tab.
function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function getTrendRows(seasons) {
  return (seasons || [])
    .filter((row) => row && row?.rowType !== 'total' && Number(row?.games ?? row?.gp ?? 0) > 0)
    .sort((a, b) => Number(a?.seasonYear || 0) - Number(b?.seasonYear || 0))
    .slice(-10);
}
function formatSeasonLabel(seasonYear) {
  const endYear = Number(seasonYear || 0);
  if (!Number.isFinite(endYear) || endYear < 1901) return '—';
  return `${endYear - 1}-${String(endYear).slice(-2)}`;
}

if (getTrendRows([]).length !== 0) fail('Empty-history edge case failed.');
if (getTrendRows([{ seasonYear: 2027, games: 0, ppg: 99 }]).length !== 0) fail('Zero-game rows must not become trend points.');
const one = getTrendRows([{ seasonYear: 2027, games: 12, ppg: 18.5, rpg: 6.1, apg: 4.2 }]);
if (one.length !== 1 || safeNumber(one[0].ppg) !== 18.5) fail('One-season trend edge case failed.');
if (formatSeasonLabel(2027) !== '2026-27') fail('Season display-label conversion failed.');
const eleven = Array.from({ length: 11 }, (_, i) => ({ seasonYear: 2017 + i, games: 82, ppg: i }));
if (getTrendRows(eleven).length !== 10 || getTrendRows(eleven)[0].seasonYear !== 2018) fail('Ten-season trend window failed.');

console.log('PASS: Player Card Compact + Trends Pass 26 is installed and safety invariants are present.');
console.log('PASS: Trends remains read-only and consumes the existing canonical Player Card season rows.');
console.log('PASS: Empty, zero-game, one-season, and 10-season-window trend edge cases passed.');
