import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
  clear() { this.map.clear(); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();

const briefing = await import(
  `${pathToFileURL(path.join(root, "src/utils/seasonBriefing.js")).href}?reg=${Date.now()}`
);
const y1 = await import(
  `${pathToFileURL(path.join(root, "src/data/seasonBriefingFirstSeason2026.js")).href}?reg=${Date.now()}`
);

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

function player(name, overall, age, extra = {}) {
  return { name, overall, potential: Math.max(overall, Number(extra.potential || overall)), age, pos: extra.pos || "SF", ...extra };
}

const teams = [
  {
    name: "Toronto Raptors",
    conference: "East",
    players: [
      player("Scottie Barnes", 89, 26, { pos: "PF", potential: 91 }),
      player("Donovan Mitchell", 87, 31, { pos: "SG" }),
      player("Allen Graves", 78, 21, { pos: "SF", potential: 87, draftYear: 2027 }),
      player("Jakob Poeltl", 79, 32, { pos: "C" }),
      player("Role Guard", 77, 27, { pos: "PG" }),
      player("Wing Six", 76, 25, { pos: "SG" }),
      player("Forward Seven", 75, 24, { pos: "PF" }),
      player("Center Eight", 74, 28, { pos: "C" }),
      player("Guard Nine", 74, 24, { pos: "PG" }),
    ],
  },
  { name: "New York Knicks", conference: "East", players: [player("Knicks Star", 93, 29), player("Knicks Two", 87, 28), player("K3",84,27),player("K4",82,27),player("K5",80,26),player("K6",79,25),player("K7",78,27),player("K8",77,25),player("K9",76,24)] },
  { name: "Philadelphia 76ers", conference: "East", players: [player("Philly Star", 91, 30), player("P2",88,29),player("P3",84,28),player("P4",82,27),player("P5",80,26),player("P6",79,25),player("P7",78,27),player("P8",77,25),player("P9",76,24)] },
  { name: "Dallas Mavericks", conference: "West", players: [player("Kawhi Leonard", 84, 36), player("Dallas Star", 90, 28),player("D3",83,27),player("D4",81,27),player("D5",79,26),player("D6",78,25),player("D7",77,27),player("D8",76,25),player("D9",75,24)] },
  { name: "Sacramento Kings", conference: "West", players: [player("Immanuel Quickley", 81, 28, { pos: "PG" }), player("Kings Star", 86, 27),player("S3",80,27),player("S4",79,27),player("S5",78,26),player("S6",77,25),player("S7",76,27),player("S8",75,25),player("S9",74,24)] },
];

const league = {
  leagueId: "regression-league",
  seasonStartYear: 2027,
  seasonYear: 2027,
  currentSeasonYear: 2027,
  currentDraftYear: 2028,
  teams,
  seasonHistory: [
    {
      seasonYear: 2026,
      champion: "New York Knicks",
      teams: [
        { teamName: "Toronto Raptors", wins: 51, losses: 31, madePlayoffs: true, playoffResult: "second_round", playoffRoundReached: 2 },
        { teamName: "New York Knicks", wins: 58, losses: 24, champion: true, madePlayoffs: true, playoffResult: "champion" },
        { teamName: "Philadelphia 76ers", wins: 55, losses: 27, madePlayoffs: true, conferenceFinals: true, playoffResult: "conference_finals" },
      ],
      statsArchive: {
        regular: {
          playerRows: [
            { name: "Scottie Barnes", teamName: "Toronto Raptors", overall: 86, stats: { GP: "80", PTS: "24.2", REB: "8.1", AST: "6.3" } },
            { name: "Kawhi Leonard", teamName: "Toronto Raptors", overall: 84, stats: { GP: "62", PTS: "22.8", REB: "6.2", AST: "4.1" } },
            { name: "Immanuel Quickley", teamName: "Toronto Raptors", overall: 81, stats: { GP: "75", PTS: "18.4", REB: "3.8", AST: "6.8" } },
          ],
        },
      },
    },
  ],
  leagueHistory: {
    champions: [
      { seasonYear: 2027, championTeam: "New York Knicks", runnerUp: "Denver Nuggets", source: "sim" },
    ],
    awards: {
      mvp: [{ seasonYear: 2027, player: "Cooper Flagg", team: "Dallas Mavericks", source: "sim" }],
      dpoy: [], sixth_man: [], mip: [], clutch_player: [], roty: [],
    },
  },
  tradeHistory: [
    {
      seasonYear: 2027,
      movedPlayers: [
        { name: "Donovan Mitchell", fromTeam: "Cleveland Cavaliers", toTeam: "Toronto Raptors" },
        { name: "Immanuel Quickley", fromTeam: "Toronto Raptors", toTeam: "Sacramento Kings" },
      ],
    },
  ],
  freeAgencyState: {
    seasonYear: 2027,
    signedPlayersLog: [{ playerName: "Kawhi Leonard", teamName: "Dallas Mavericks", overall: 84 }],
  },
  draftPicks: [
    { owner: "Toronto Raptors", year: 2028, round: 1, status: "active" },
    { owner: "Toronto Raptors", year: 2029, round: 1, status: "active" },
    { owner: "Toronto Raptors", year: 2030, round: 1, status: "active" },
  ],
};

localStorage.setItem("bm_progression_meta_v1", JSON.stringify({ stage: "DONE", deltasSaved: true, appliedForSeasonYear: 2027 }));
localStorage.setItem("bm_progression_deltas_v1", JSON.stringify({
  "Scottie Barnes__Toronto Raptors": { overall: 3 },
  "Allen Graves__Toronto Raptors": { overall: 5 },
  "League Breakout__New York Knicks": { overall: 4 },
}));

const result = briefing.buildSeasonBriefingData(league, "Toronto Raptors", 2027);
const teamText = result?.tabs?.team?.paragraphs?.join(" ") || "";
const leagueText = result?.tabs?.league?.paragraphs?.join(" ") || "";
const outlookText = result?.tabs?.outlook?.paragraphs?.join(" ") || "";
const allText = Object.values(result?.tabs || {}).flatMap((tab) => tab?.paragraphs || []).join(" ");

check(result?.source === "event_dossier_v2", "new_chapter.y2_event_dossier", "Y2+ must use the event dossier engine.");
check(teamText.includes("51-31") && /second round/i.test(teamText), "new_chapter.previous_result", "Team chapter must preserve exact prior record and finish.");
check(teamText.includes("Scottie Barnes") && teamText.includes("24.2 PPG") && teamText.includes("8.1 RPG") && teamText.includes("6.3 APG"), "new_chapter.previous_stats", "Team chapter must quote the archived star stat line.");
check(teamText.includes("Donovan Mitchell") && teamText.includes("Immanuel Quickley"), "new_chapter.team_transactions", "Team chapter must name actual additions/departures.");
check(teamText.includes("Kawhi Leonard") && teamText.includes("Dallas Mavericks"), "new_chapter.roster_turnover_fallback", "Roster comparison must recover a major departure even when the old signing log is incomplete.");
check(teamText.includes("Allen Graves") && /rose 5 OVR/i.test(teamText), "new_chapter.team_progression", "Team chapter must name meaningful actual progression.");
check(leagueText.includes("New York Knicks") && /championship/i.test(leagueText), "new_chapter.champion", "League tab must carry the actual champion.");
check(leagueText.includes("Cooper Flagg") && /MVP/i.test(leagueText), "new_chapter.mvp", "League tab must carry the actual MVP.");
check(leagueText.includes("Kawhi Leonard") || leagueText.includes("Donovan Mitchell"), "new_chapter.league_movement", "League tab must use actual major movement.");
check(outlookText.includes("3 listed first-round picks") || outlookText.includes("3 listed first-round pick"), "new_chapter.draft_capital", "Outlook must use actual future draft capital.");
check(result?.dossier?.previousRecord === "51-31" && result?.dossier?.significantTeamMoves?.length >= 2, "new_chapter.saved_dossier", "Snapshot dossier must preserve the facts used to write the chapter.");
check(!/annual briefing will keep using|season should provide clarity|current roster rather than the archive/i.test(allText), "new_chapter.no_old_generic_copy", "Old generic briefing filler must not return.");

let storedLeague = briefing.storeSeasonBriefingSnapshot(league, "Toronto Raptors", result, 2027);
check(Boolean(briefing.getStoredSeasonBriefingSnapshot(storedLeague, "Toronto Raptors", 2027)), "new_chapter.snapshot_roundtrip", "Generated chapter must round-trip through leagueData.");
check(Object.keys(storedLeague?.seasonBriefingState?.snapshots || {}).length === 1, "new_chapter.snapshot_in_league", "Snapshot must live in leagueData rather than browser blob storage.");
check([...localStorage.map.keys()].every((key) => !key.includes("season_briefing")), "new_chapter.no_localstorage_blob", "New Chapter may not create its own localStorage payload.");

const viewedLeague = briefing.markSeasonBriefingViewed(storedLeague, "Toronto Raptors", 2027);
check(briefing.hasViewedSeasonBriefing(viewedLeague, "Toronto Raptors", 2027), "new_chapter.viewed_state", "Viewed state must be durable in leagueData.");

let bounded = league;
for (let year = 2027; year <= 2037; year += 1) {
  const clone = structuredClone(result);
  clone.seasonYear = year;
  clone.key = `${year}:toronto-raptors`;
  clone.seasonLabel = `${year}-${String(year + 1).slice(-2)}`;
  clone.dossier = { ...(clone.dossier || {}), seasonYear: year, primaryStoryline: { ...(clone.dossier?.primaryStoryline || {}), seasonYear: year } };
  bounded = briefing.storeSeasonBriefingSnapshot({ ...bounded, seasonStartYear: year, seasonYear: year }, "Toronto Raptors", clone, year);
}
check(Object.keys(bounded?.seasonBriefingState?.snapshots || {}).length <= briefing.MAX_SEASON_BRIEFING_SNAPSHOTS, "new_chapter.bounded_snapshots", "Snapshot history must remain bounded.");
check((bounded?.seasonBriefingState?.storylines || []).length <= briefing.MAX_SEASON_BRIEFING_STORYLINES, "new_chapter.bounded_storylines", "Storyline memory must remain bounded.");

const y1League = { ...league, seasonStartYear: 2026, seasonYear: 2026, currentSeasonYear: 2026 };
const y1Result = briefing.buildSeasonBriefingData(y1League, "Toronto Raptors", 2026);
const y1Source = y1.getFirstSeasonBriefing2026("Toronto Raptors");
check(y1Result?.source === "handcrafted_2026", "new_chapter.y1_isolated", "Y1 must stay on the handcrafted path.");
check(y1Result?.tabs?.team?.paragraphs?.[0] === y1Source?.team?.paragraphs?.[0], "new_chapter.y1_exact_copy", "Y1 text must pass through byte-for-byte at the paragraph level.");

const filenames = Object.values(briefing.SEASON_BRIEFING_FILENAMES || {});
check(filenames.length === 30 && new Set(filenames).size === 30 && filenames.every((name) => name.endsWith(".png")), "new_chapter.30_wallpapers", "All 30 teams need unique PNG mappings.");

const appSource = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const hubSource = fs.readFileSync(path.join(root, "src/pages/TeamHub.jsx"), "utf8");
const hostSource = fs.readFileSync(path.join(root, "src/components/SeasonBriefingHost.jsx"), "utf8");
check(appSource.includes("<SeasonBriefingHost />"), "new_chapter.global_host", "App must mount the global host.");
check(hubSource.includes('name: "New Chapter"') && hubSource.includes('action: "openSeasonBriefing"'), "new_chapter.teamhub_reopen", "Team Hub must expose manual reopen.");
check(hostSource.includes('location.pathname !== "/calendar"') && hostSource.includes("isSeasonBriefingOpeningWindow"), "new_chapter.calendar_autopopup", "Automatic popup must be gated to the opening Calendar window.");
check(hostSource.includes("readScheduleFromStorage") && !hostSource.includes('localStorage.getItem("bm_schedule_v3")'), "new_chapter.current_schedule_storage", "New Chapter must use the current IndexedDB-backed schedule bridge.");
check(hostSource.includes("saveLeagueData(nextLeague") && hostSource.includes("storeSeasonBriefingSnapshot"), "new_chapter.indexeddb_league_persistence", "Chapter snapshots must persist through leagueData/IndexedDB.");

if (failures.length) {
  console.error(`\nNew Chapter regression failed: ${failures.length} failure(s).`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log(`\nNew Chapter regression passed: ${passed}/${passed} checks.`);
