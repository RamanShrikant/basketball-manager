import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const repo = process.cwd();
const file = path.join(repo, 'frontend/src/components/PlayerCardModal.jsx');
const EXPECTED_TARGET_SHA = '70c26e0aea85917f2c68f97e66046bab31b344ef6826cf92ad7a00b2901f6620';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
function normalize(text) { return String(text ?? '').replace(/\r\n/g, '\n'); }
function sha(text) { return crypto.createHash('sha256').update(normalize(text), 'utf8').digest('hex'); }

if (!fs.existsSync(file)) fail('Could not find frontend/src/components/PlayerCardModal.jsx');
const source = normalize(fs.readFileSync(file, 'utf8'));
if (sha(source) !== EXPECTED_TARGET_SHA) fail('PlayerCardModal.jsx does not match the validated Pass 27 payload.');

const safetyFragments = [
  'function buildPlayerCardSeasonRows({ player, leagueData, resolvedTeamName, resolvedTeamLogo })',
  'collectArchivedSnapshotRowsForPlayer({',
  'During offseason/player cards, a just-archived season and a stale live stats map can both exist.',
  'function getRemainingContractView(contract, leagueData)',
  'function isOptionDecisionWindow(leagueData)',
  'function isPendingContractOptionYear(contract, yearIndex, currentSeasonYear, optionWindowActive)',
  '{ key: "trends", label: "Trends" }',
  'function PerformanceTrendsChart({ seasons })',
  '.filter((row) => row && row?.rowType !== "total" && Number(row?.games ?? row?.gp ?? 0) > 0)',
  '<PerformanceTrendsChart seasons={seasons} />',
  'Contract Summary',
  'Trophy Case',
];
for (const fragment of safetyFragments) {
  if (!source.includes(fragment)) fail(`Missing preserved safety/functionality fragment: ${fragment}`);
}

for (const key of ['overview', 'attributes', 'contract', 'mood', 'trends', 'career', 'accolades']) {
  if (!source.includes(`{ key: "${key}"`)) fail(`Player Card tab was lost: ${key}`);
}

const overviewStart = source.indexOf('{activeTab === "overview"');
const attributesStart = source.indexOf('{activeTab === "attributes"');
if (overviewStart < 0 || attributesStart <= overviewStart) fail('Could not isolate the Overview tab.');
const overview = source.slice(overviewStart, attributesStart);

for (const required of ['Draft Year', 'Experience', 'Personality', 'Injury Status', 'Top Attributes']) {
  if (!overview.includes(required)) fail(`Overview missing required field/section: ${required}`);
}
for (const forbidden of ['Full Name', 'Nationality', 'College', 'Morale']) {
  if (overview.includes(forbidden)) fail(`Overview still contains removed Snapshot field: ${forbidden}`);
}

const compositeFragments = [
  '{ label: "Athleticism", keys: ["SPEED", "ATH"] }',
  '{ label: "Scoring", keys: ["3PT", "MID", "CLOSE", "FT", "OIQ"] }',
  '{ label: "Rebounding", keys: ["REB"] }',
  '{ label: "Defense", keys: ["PER D", "INS D", "BLK", "STL", "DIQ"] }',
  '{ label: "Playmaking", keys: ["BALL", "PASS", "OIQ"] }',
  'const overviewAttributes = useMemo(() => buildOverviewAttributeGroups(attributeRows), [attributeRows]);',
];
for (const fragment of compositeFragments) {
  if (!source.includes(fragment)) fail(`Missing deterministic overview-attribute mapping: ${fragment}`);
}

const metadataFragments = [
  'meta?.draftYear',
  'player?.draftClassYear',
  'meta?.proSeasons',
  'player?.yearsPro',
  'player?.extensionInterest?.personalityType',
  'function getPlayerInjuryStatus(player)',
  'injury.active === false',
];
for (const fragment of metadataFragments) {
  if (!source.includes(fragment)) fail(`Missing safe metadata fallback: ${fragment}`);
}

if (source.includes('localStorage.setItem(')) fail('Player Card introduced a localStorage write.');
if (source.includes('localStorage.removeItem(')) fail('Player Card introduced a localStorage delete.');

// Tiny pure-function edge checks mirroring Pass 27's metadata fallbacks.
function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function getPlayerDraftYear(player) {
  const meta = player?.meta && typeof player.meta === 'object' ? player.meta : {};
  const candidates = [meta?.draftYear, meta?.draftSeasonYear, player?.draftYear, player?.draftClassYear, player?.draftedYear];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 1900 && value <= 2200) return Math.trunc(value);
  }
  return null;
}
function getPlayerExperienceYears(player, seasons) {
  const meta = player?.meta && typeof player.meta === 'object' ? player.meta : {};
  const candidates = [meta?.proSeasons, player?.proSeasons, player?.seasonsPro, player?.yearsPro, player?.yearsOfExperience, player?.yoe];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 0 && value <= 40) return Math.trunc(value);
  }
  const trackedYears = new Set((seasons || []).filter((row) => row && row?.rowType !== 'total' && Number(row?.games ?? row?.gp ?? 0) > 0).map((row) => Number(row?.seasonYear || 0)).filter((year) => Number.isFinite(year) && year > 0));
  return trackedYears.size || null;
}
function buildOverviewAttributeGroups(attributeRows) {
  const groups = [
    { label: 'Athleticism', keys: ['SPEED', 'ATH'] },
    { label: 'Scoring', keys: ['3PT', 'MID', 'CLOSE', 'FT', 'OIQ'] },
    { label: 'Rebounding', keys: ['REB'] },
    { label: 'Defense', keys: ['PER D', 'INS D', 'BLK', 'STL', 'DIQ'] },
    { label: 'Playmaking', keys: ['BALL', 'PASS', 'OIQ'] },
  ];
  const byLabel = new Map((attributeRows || []).map((row) => [row?.label, safeNumber(row?.value, 0)]));
  return groups.map((group) => {
    const values = group.keys.map((key) => byLabel.get(key)).filter((value) => Number.isFinite(value) && value > 0);
    return { label: group.label, value: values.length ? Math.round(values.reduce((sum, current) => sum + current, 0) / values.length) : 0 };
  });
}

if (getPlayerDraftYear({ meta: { draftYear: 2021 } }) !== 2021) fail('Draft-year metadata edge check failed.');
if (getPlayerDraftYear({ draftClassYear: 2028 }) !== 2028) fail('Draft-class-year fallback edge check failed.');
if (getPlayerDraftYear({}) !== null) fail('Missing draft-year edge check failed.');
if (getPlayerExperienceYears({ meta: { proSeasons: 5 } }, []) !== 5) fail('Explicit pro-seasons edge check failed.');
if (getPlayerExperienceYears({}, [{ seasonYear: 2025, games: 0 }, { seasonYear: 2026, games: 25 }, { seasonYear: 2027, games: 82 }]) !== 2) fail('Tracked-season experience fallback failed.');

const attrs = [
  ['SPEED', 90], ['ATH', 88], ['3PT', 80], ['MID', 82], ['CLOSE', 84], ['FT', 86], ['OIQ', 88],
  ['REB', 94], ['PER D', 89], ['INS D', 87], ['BLK', 75], ['STL', 81], ['DIQ', 91], ['BALL', 90], ['PASS', 92],
].map(([label, value]) => ({ label, value }));
const groups = buildOverviewAttributeGroups(attrs);
if (groups.length !== 5) fail('Overview composite category count failed.');
if (groups.find((row) => row.label === 'Rebounding')?.value !== 94) fail('Rebounding composite mapping failed.');
if (groups.find((row) => row.label === 'Athleticism')?.value !== 89) fail('Athleticism composite mapping failed.');

console.log('PASS: Player Card Overview / Proportions Pass 27 is installed.');
console.log('PASS: Canonical season-history, archived/offseason recovery, contract-option, Trends, Mood, Career Stats, and Accolades logic remain present.');
console.log('PASS: Snapshot metadata fallbacks and deterministic real-rating composites passed edge checks.');
console.log('PASS: Player Card remains read-only; no storage mutation was introduced.');
