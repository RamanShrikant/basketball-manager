import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const draftPicks = await import(
  `${pathToFileURL(path.join(root, "src/utils/draftPicks.js")).href}?reg=${Date.now()}`
);

const {
  applyDraftPickOwnershipToLotteryResult,
  getExpectedFirstRoundPickCount,
  getExpectedLockedDraftOrderLength,
  getForfeitedDraftPickKeys,
  hasLockedDraftOrderLength,
  isForfeitedDraftPickAsset,
  normalizeDraftPicks,
} = draftPicks;

let passed = 0;
const failures = [];
function check(condition, id, message) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${id}`);
  } else {
    failures.push(`${id}: ${message}`);
    console.error(`FAIL ${id}: ${message}`);
  }
}

const league = JSON.parse(fs.readFileSync(path.join(root, "public/defaults/default_roster.json"), "utf8"));
const teams = Object.values(league.conferences || {}).flat().filter(Boolean);
const teamNames = teams.map((team) => team.name || team.teamName).filter(Boolean);
const pickRows = normalizeDraftPicks(league.draftPicks || [], teamNames);
const rawForfeitedRows = (Array.isArray(league.draftPicks) ? league.draftPicks : []).filter((row) => isForfeitedDraftPickAsset(row));
const visibleForfeitedRows = pickRows.filter((row) => isForfeitedDraftPickAsset(row));
const hiddenRules = Array.isArray(league.draftPickForfeitures) ? league.draftPickForfeitures : [];

const expectedByYear = new Map([
  [2029, { originalTeam: "Indiana Pacers", assetId: "2029_LAC_R1_8_5a939a3a" }],
  [2030, { originalTeam: "Los Angeles Clippers", assetId: "2030_LAC_R1_9_8cc21323" }],
  [2031, { originalTeam: "Los Angeles Clippers", assetId: "2031_LAC_R1_11_ecaa425d" }],
  [2032, { originalTeam: "Los Angeles Clippers", assetId: "2032_LAC_R1_13_e1aa6fca" }],
  [2033, { originalTeam: "Los Angeles Clippers", assetId: "2033_LAC_R1_own_9c7c2f9f" }],
]);

check(rawForfeitedRows.length === 0, "clippers_forfeiture.no_raw_asset_rows", "Forfeited Clippers picks should not exist inside draftPicks.");
check(visibleForfeitedRows.length === 0, "clippers_forfeiture.no_visible_asset_rows", "Normalized draft assets should expose zero forfeited rows.");
check(hiddenRules.length === 5, "clippers_forfeiture.hidden_rule_count", "Exactly five hidden draft-order removal rules should exist.");

for (const [year, expected] of expectedByYear.entries()) {
  const rule = hiddenRules.find((row) => Number(row.year) === year && Number(row.round) === 1);
  check(Boolean(rule), `clippers_forfeiture.${year}.hidden_rule_exists`, `${year} hidden removal rule should exist.`);
  check(rule?.assetId === expected.assetId, `clippers_forfeiture.${year}.asset_id`, `${year} rule should remember the removed asset id for audit only.`);
  check(rule?.originalTeam === expected.originalTeam, `clippers_forfeiture.${year}.original_team`, `${year} rule should remove the intended original team's first-round slot.`);
  check(rule?.tradeable === false, `clippers_forfeiture.${year}.not_tradeable`, `${year} rule must not create a tradeable asset.`);
  check(rule?.countsForStepien === false, `clippers_forfeiture.${year}.stepien`, `${year} rule must not satisfy Stepien.`);
  check(rule?.draftOrderSlotRemoved === true, `clippers_forfeiture.${year}.slot_removed`, `${year} rule must remove one draft slot.`);
  check(String(rule?.visibility || "") === "hidden_system_rule", `clippers_forfeiture.${year}.hidden_visibility`, `${year} rule should be marked hidden from team asset views.`);
}

function teamLogo(name) {
  return teams.find((team) => (team.name || team.teamName) === name)?.logo || "";
}

function makeLotteryResult(year) {
  const firstRoundOrder = teamNames.map((teamName, index) => ({
    pick: index + 1,
    pickNumber: index + 1,
    overallPick: index + 1,
    pickInRound: index + 1,
    round: 1,
    teamName,
    name: teamName,
    currentOwnerTeamName: teamName,
    ownerTeamName: teamName,
    originalTeamName: teamName,
    originalPickTeamName: teamName,
    naturalLotteryTeamName: teamName,
    logo: teamLogo(teamName),
  }));
  const secondRoundOrder = teamNames.map((teamName, index) => ({
    pick: 31 + index,
    pickNumber: 31 + index,
    overallPick: 31 + index,
    pickInRound: index + 1,
    round: 2,
    teamName,
    name: teamName,
    currentOwnerTeamName: teamName,
    ownerTeamName: teamName,
    originalTeamName: teamName,
    originalPickTeamName: teamName,
    naturalLotteryTeamName: teamName,
    logo: teamLogo(teamName),
  }));
  return {
    seasonYear: year,
    firstRoundOrder,
    secondRoundOrder,
    fullDraftOrder: [...firstRoundOrder, ...secondRoundOrder],
  };
}

for (const [year, expected] of expectedByYear.entries()) {
  const expectedKeys = getForfeitedDraftPickKeys(league, year, 1);
  const resolved = applyDraftPickOwnershipToLotteryResult(makeLotteryResult(year), { leagueData: league, seasonYear: year });
  check(expectedKeys.size === 1, `clippers_forfeiture.${year}.key_count`, `${year} should have one removed first-round slot.`);
  check(getExpectedFirstRoundPickCount(league, year) === 29, `clippers_forfeiture.${year}.first_round_count_helper`, `${year} helper should expect 29 first-round selections.`);
  check(getExpectedLockedDraftOrderLength(league, year) === 59, `clippers_forfeiture.${year}.full_count_helper`, `${year} helper should expect a 59-pick full draft.`);
  check(resolved.firstRoundOrder.length === 29, `clippers_forfeiture.${year}.first_round_order`, `${year} first round should have 29 picks after removal.`);
  check(resolved.secondRoundOrder.length === 30, `clippers_forfeiture.${year}.second_round_order`, `${year} second round should stay at 30 picks.`);
  check(resolved.fullDraftOrder.length === 59, `clippers_forfeiture.${year}.full_order`, `${year} full draft should contain 59 picks.`);
  check(hasLockedDraftOrderLength(resolved.fullDraftOrder, league, year), `clippers_forfeiture.${year}.locked_length`, `${year} 59-pick order should count as locked and complete.`);
  check(!resolved.firstRoundOrder.some((row) => row.originalTeamName === expected.originalTeam), `clippers_forfeiture.${year}.removed_original`, `${year} should remove ${expected.originalTeam}'s first-round slot.`);
  check(resolved.firstRoundOrder.every((row, index) => Number(row.pick) === index + 1 && Number(row.pickInRound) === index + 1), `clippers_forfeiture.${year}.renumbered_first`, `${year} first round should be renumbered cleanly 1-29.`);
  check(resolved.secondRoundOrder.every((row, index) => Number(row.pick) === 31 + index && Number(row.pickInRound) === index + 1), `clippers_forfeiture.${year}.second_round_preserved`, `${year} second-round numbering should remain 31-60.`);
  check(!Array.isArray(resolved.forfeitedPicks), `clippers_forfeiture.${year}.no_visible_result_rows`, `${year} lottery result should not expose forfeited asset rows.`);
  check(Number(resolved.meta?.removedFirstRoundPickCount || 0) === 1, `clippers_forfeiture.${year}.meta_count`, `${year} result should record only the hidden removal count.`);
}

const normalYear = applyDraftPickOwnershipToLotteryResult(makeLotteryResult(2028), { leagueData: league, seasonYear: 2028 });
check(getExpectedFirstRoundPickCount(league, 2028) === 30, "clippers_forfeiture.normal_year_first_count", "Normal years still expect 30 first-round picks.");
check(normalYear.fullDraftOrder.length === 60, "clippers_forfeiture.normal_year_full_order", "Normal years still generate 60 draft picks.");
check(Number(normalYear.meta?.removedFirstRoundPickCount || 0) === 0, "clippers_forfeiture.normal_year_no_removed_count", "Normal years record zero hidden first-round removals.");

if (failures.length) {
  console.error(`\nClippers removed-pick regression failed: ${failures.length} failure(s).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nClippers removed-pick regression passed: ${passed}/${passed} checks.`);
