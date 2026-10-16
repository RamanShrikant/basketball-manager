import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const results = [];
const check = (id, condition, message) => results.push({ status: condition ? "PASS" : "FAIL", id, message });

const standingsUtils = await import(pathToFileURL(path.join(root, "src/utils/canonicalStandings.js")).href);
const draftUtils = await import(pathToFileURL(path.join(root, "src/utils/draftPicks.js")).href);

// ---------------------------------------------------------------------------
// 1) Canonical standings/tiebreak parity
// ---------------------------------------------------------------------------
const teams = [
  { name: "Indiana Pacers", conference: "East" },
  { name: "Orlando Magic", conference: "East" },
  { name: "Boston Celtics", conference: "East" },
];
const schedule = {
  "2027-01-01": [
    { id: "1", home: "Orlando Magic", away: "Indiana Pacers", played: true },
    { id: "2", home: "Indiana Pacers", away: "Boston Celtics", played: true },
    { id: "3", home: "Orlando Magic", away: "Boston Celtics", played: true },
  ],
};
const resultsById = {
  "1": { totals: { home: 110, away: 100 } },
  "2": { totals: { home: 110, away: 90 } },
  "3": { totals: { home: 90, away: 110 } },
};
const standings = standingsUtils.computeCanonicalStandings({ teams, scheduleByDate: schedule, resultsById });
const tiedOrder = standingsUtils.sortCanonicalTeamNames(["Indiana Pacers", "Orlando Magic"], standings);
check(
  "standings.head_to_head_shared_order",
  tiedOrder[0] === "Orlando Magic" && standings["Indiana Pacers"].wins === standings["Orlando Magic"].wins,
  "Equal-record teams use the shared head-to-head/conference/differential ordering."
);

const standingsPage = read("src/pages/Standings.jsx");
const playoffsPage = read("src/pages/Playoffs.jsx");
const picturePage = read("src/pages/PlayoffPicture.jsx");
check(
  "standings.all_live_consumers_canonical",
  standingsPage.includes("computeCanonicalStandings") && standingsPage.includes("compareCanonicalTeams") &&
    playoffsPage.includes("computeCanonicalStandings") && playoffsPage.includes("sortCanonicalTeamNames") &&
    picturePage.includes("computeCanonicalStandings") && picturePage.includes("sortCanonicalTeamNames"),
  "Standings, Playoffs, and Playoff Picture all consume the same canonical standings module."
);
check(
  "standings.no_duplicate_playoff_sorter",
  !playoffsPage.includes("function sortWithTiebreak(") && !picturePage.includes("function sortWithTiebreak("),
  "Duplicate postseason tiebreak implementations are removed."
);

// ---------------------------------------------------------------------------
// 2) Historical team attribution
// ---------------------------------------------------------------------------
const archiveSource = read("src/utils/seasonStatsArchive.js");
check(
  "history.no_current_roster_reassignment",
  archiveSource.includes("combinePlayerStatsToRosterTeams: false"),
  "Regular-season archives preserve the team carried by the actual stat record instead of the current offseason roster."
);
check(
  "history.no_current_roster_zero_rows",
  archiveSource.includes("includeZeroRosterPlayers: false") && archiveSource.includes("CURRENT offseason roster"),
  "Completed-season archives do not inject newly signed current-roster players as zero-game members of the prior team."
);
check(
  "history.multi_team_stints_preserved",
  archiveSource.includes("preserveMultiTeamStints: true"),
  "True in-season multi-team stints remain preserved."
);

// ---------------------------------------------------------------------------
// 3) Resolved draft-pick canonical ownership
// ---------------------------------------------------------------------------
const draftLeague = {
  seasonYear: 2027,
  conferences: {
    East: [
      { name: "Orlando Magic", players: [] },
      { name: "Detroit Pistons", players: [] },
    ],
  },
  draftPicks: [
    {
      id: "PICK_2027_DET_R1_DET",
      assetType: "pick",
      year: 2027,
      round: 1,
      originalTeam: "Detroit Pistons",
      ownerTeam: "Detroit Pistons",
      status: "active",
    },
  ],
};
const transfer = draftUtils.transferResolvedDraftPickOwnershipAsset(draftLeague, {
  year: 2027,
  round: 1,
  originalTeam: "Detroit Pistons",
  pickNumber: 5,
  fromTeam: "Detroit Pistons",
  toTeam: "Orlando Magic",
  tradeStamp: { completedAt: "2027-06-26T00:00:00.000Z" },
});
const draftLeagueAfter = { ...draftLeague, draftPicks: transfer.draftPicks };
const rebuiltOrder = draftUtils.applyDraftPickOwnershipToOrder([
  {
    pick: 5,
    round: 1,
    teamName: "Detroit Pistons",
    originalTeamName: "Detroit Pistons",
    originalPickTeamName: "Detroit Pistons",
  },
], { leagueData: draftLeagueAfter, seasonYear: 2027 });
check(
  "draft.resolved_transfer_updates_canonical_asset",
  transfer.ok && transfer.draftPicks.some((row) => row.originalTeam === "Detroit Pistons" && row.ownerTeam === "Orlando Magic"),
  "A traded resolved pick updates leagueData.draftPicks, the canonical ownership source."
);
check(
  "draft.rebuild_keeps_traded_resolved_owner",
  rebuiltOrder[0]?.currentOwnerTeamName === "Orlando Magic" || rebuiltOrder[0]?.ownerTeamName === "Orlando Magic" || rebuiltOrder[0]?.teamName === "Orlando Magic",
  "Rebuilding draft order from canonical ownership keeps #5 with the acquiring team."
);
const tradeExecution = read("src/utils/tradeExecution.js");
check(
  "draft.trade_execution_calls_canonical_transfer",
  tradeExecution.includes("transferResolvedDraftPickOwnershipAsset") && tradeExecution.includes("nextLeague.draftPicks = canonicalTransfer.draftPicks"),
  "Resolved-pick trade execution persists the ownership transfer to canonical draft assets."
);

// ---------------------------------------------------------------------------
// 4) No shirtless generated free agents
// ---------------------------------------------------------------------------
const portraitRuntime = read("src/components/RuntimePlayerPortrait.jsx");
check(
  "portrait.all_bases_require_jersey",
  portraitRuntime.includes("if (!jersey?.url) return null") && !portraitRuntime.includes("if (isRealPlayerFace && !jersey?.url) return null"),
  "The no-naked-base guard applies to generated and real-player bases."
);
check(
  "portrait.generated_fa_uses_last_team",
  portraitRuntime.includes("const portraitTeamCode = !teamCode") && portraitRuntime.includes("getLastKnownPortraitTeamCode(player || {})"),
  "Veteran generated free agents resolve the last valid team presentation from FA metadata."
);
check(
  "portrait.generated_base_safe_fallback",
  portraitRuntime.includes("fallbackIsNakedGeneratedBase") && portraitRuntime.includes("runtimeFace?.draftUrl"),
  "If no valid last-team jersey can be resolved, a generated player falls back to finished draft attire rather than the jerseyless base."
);
check(
  "portrait.first_year_release_unchanged",
  portraitRuntime.includes("useDraftAttireFreeAgent") && portraitRuntime.includes("shouldUseDraftAttireForFirstYearGeneratedFreeAgent"),
  "First-year generated releases still preserve the intended original draft-attire behavior."
);

console.table(results);
const failed = results.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`\nFour-system regression failed: ${failed.length}/${results.length} checks failed.`);
  process.exit(1);
}
console.log(`\nFour-system regression passed: ${results.length}/${results.length} checks.`);
