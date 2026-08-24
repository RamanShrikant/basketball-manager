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
const draftPicks = await import(
  `${pathToFileURL(path.join(root, "src/utils/draftPicks.js")).href}?reg=${Date.now()}`
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
      player("Scottie Barnes", 89, 26, {
        pos: "PF",
        potential: 91,
        contract: { startYear: 2027, salaryByYear: [38_000_000], originalTermYears: 4 },
      }),
      player("Donovan Mitchell", 87, 31, { pos: "SG", "3PT": 86, PASS: 80, BALL: 88 }),
      player("New Shooter", 80, 29, { pos: "SG", "3PT": 90, OFF: 79 }),
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
  { name: "Dallas Mavericks", conference: "West", players: [player("Kawhi Leonard", 84, 36, { contract: { startYear: 2027, salaryByYear: [34_000_000], originalTermYears: 3 } }), player("Dallas Star", 90, 28),player("D3",83,27),player("D4",81,27),player("D5",79,26),player("D6",78,25),player("D7",77,27),player("D8",76,25),player("D9",75,24)] },
  { name: "Sacramento Kings", conference: "West", players: [player("Immanuel Quickley", 81, 28, { pos: "PG", contract: { startYear: 2027, salaryByYear: [24_000_000], originalTermYears: 4 } }), player("Kings Star", 86, 27),player("S3",80,27),player("S4",79,27),player("S5",78,26),player("S6",77,25),player("S7",76,27),player("S8",75,25),player("S9",74,24)] },
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
      id: "trade_tor_sac_2027",
      seasonYear: 2027,
      date: "2027-02-08",
      currentDate: "2027-02-08",
      movedPlayers: [
        { name: "Donovan Mitchell", fromTeam: "Sacramento Kings", toTeam: "Toronto Raptors" },
        { name: "Immanuel Quickley", fromTeam: "Toronto Raptors", toTeam: "Sacramento Kings" },
      ],
      teamPackages: [
        {
          teamName: "Toronto Raptors",
          sent: [{ type: "player", playerName: "Immanuel Quickley", overall: 81, age: 28 }],
          received: [{ type: "player", playerName: "Donovan Mitchell", overall: 87, age: 31 }],
        },
        {
          teamName: "Sacramento Kings",
          sent: [{ type: "player", playerName: "Donovan Mitchell", overall: 87, age: 31 }],
          received: [{ type: "player", playerName: "Immanuel Quickley", overall: 81, age: 28 }],
        },
      ],
    },
  ],
  freeAgencyState: {
    seasonYear: 2027,
    signedPlayersLog: [
      { playerName: "Kawhi Leonard", teamName: "Dallas Mavericks", overall: 84, years: 3 },
      { playerName: "New Shooter", teamName: "Toronto Raptors", overall: 80, years: 2 },
    ],
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

const moodData = {
  ok: true,
  players: [
    { playerName: "Scottie Barnes", moodScore: 76, moodLabel: "Positive", trend: "rising", reasons: [] },
    { playerName: "Donovan Mitchell", moodScore: 68, moodLabel: "Positive", trend: "stable", reasons: [] },
    { playerName: "Allen Graves", moodScore: 44, moodLabel: "Frustrated", trend: "falling", reasons: [{ category: "Team Results", impact: -9, detail: "The playoff exit still bothers him" }] },
  ],
};

const result = briefing.buildSeasonBriefingData(league, "Toronto Raptors", 2027, { moodData });
const teamText = result?.tabs?.team?.paragraphs?.join(" ") || "";
const leagueText = result?.tabs?.league?.paragraphs?.join(" ") || "";
const outlookText = result?.tabs?.outlook?.paragraphs?.join(" ") || "";
const allText = Object.values(result?.tabs || {}).flatMap((tab) => tab?.paragraphs || []).join(" ");

check(result?.source === "event_dossier_v7", "new_chapter.y2_event_dossier", "Y2+ must use the asset-lineage and outside-pick storytelling dossier engine.");
check(teamText.includes("51-31") && /second round/i.test(teamText), "new_chapter.previous_result", "Team chapter must preserve exact prior record and finish.");
check(teamText.includes("Scottie Barnes") && /about 24 points/i.test(teamText) && !teamText.includes("24.2 PPG"), "new_chapter.previous_stats", "Team chapter should translate archived production into natural rounded prose instead of a stat-table sentence.");
check(teamText.includes("Donovan Mitchell") && teamText.includes("Immanuel Quickley"), "new_chapter.team_transactions", "Team chapter must name actual additions/departures.");
check(teamText.includes("Donovan Mitchell") && teamText.includes("Immanuel Quickley") && /traded|acquired/i.test(teamText), "new_chapter.trade_aging_story", "A saved trade must be narrated as a connected roster move.");
check(teamText.includes("New Shooter") && /floor spacing|open market|free agency/i.test(teamText), "new_chapter.fa_fit_story", "A new free-agent addition must explain how his actual ratings change the basketball fit.");
check(teamText.includes("Kawhi Leonard") && /lost|free agency/i.test(teamText), "new_chapter.fa_loss_story", "A meaningful free-agent loss from last year's rotation must be narrated in plain language.");
check(teamText.includes("Kawhi Leonard") && teamText.includes("Dallas Mavericks"), "new_chapter.roster_turnover_fallback", "Roster comparison must recover a major departure even when the old signing log is incomplete.");
check(teamText.includes("Allen Graves") && /improved by 5 OVR/i.test(teamText), "new_chapter.team_progression", "Team chapter must narrate meaningful progression clearly.");
check(leagueText.includes("New York Knicks") && /championship/i.test(leagueText), "new_chapter.champion", "League tab must carry the actual champion.");
check(leagueText.includes("Cooper Flagg") && /MVP/i.test(leagueText), "new_chapter.mvp", "League tab must carry the actual MVP.");
check(leagueText.includes("Kawhi Leonard") || leagueText.includes("Donovan Mitchell"), "new_chapter.league_movement", "League tab must use actual major movement.");
check(outlookText.includes("3 listed first-round picks") || outlookText.includes("3 listed first-round pick"), "new_chapter.draft_capital", "Outlook must use actual future draft capital.");
check(result?.dossier?.previousRecord === "51-31" && result?.dossier?.significantTeamMoves?.length >= 2 && result?.dossier?.transactionStories?.length >= 2, "new_chapter.saved_dossier", "Snapshot dossier must preserve only the compact facts/story beats used to write the chapter.");
check((result?.tabs?.league?.sections || []).some((section) => section.title === "Major trades" && section.items.some((item) => item.includes("Donovan Mitchell"))), "new_chapter.major_trade_list", "League tab must list major saved trades.");
check((result?.tabs?.league?.sections || []).some((section) => section.title === "Free agency" && section.items.some((item) => item.includes("Kawhi Leonard"))), "new_chapter.free_agency_list", "League tab must list major offseason free-agent signings.");
check((result?.tabs?.league?.sections || []).some((section) => section.title === "Franchise shifts" && section.items.some((item) => item.includes("Toronto Raptors"))), "new_chapter.franchise_shift", "League tab must detect major roster resets/collapse-style shifts.");
check((result?.tabs?.outlook?.sections || []).some((section) => section.title === "Potential expiring trade targets" && section.items.some((item) => item.includes("Kawhi Leonard") || item.includes("Immanuel Quickley"))), "new_chapter.expiring_market", "Outlook must surface useful outside players on one-year/expiring deals.");
check((result?.tabs?.outlook?.sections || []).some((section) => section.title.includes("contract decisions") && section.items.some((item) => item.includes("Scottie Barnes"))), "new_chapter.extension_watch", "Outlook must surface the user's own extension-window players.");
check((result?.dossier?.majorTrades || []).length >= 1 && (result?.dossier?.majorSignings || []).length >= 1 && (result?.dossier?.expiringTradeTargets || []).length >= 1, "new_chapter.dossier_market_intel", "Frozen dossier must preserve the compact transaction/market facts used by the briefing.");
check(!/annual briefing will keep using|season should provide clarity|current roster rather than the archive/i.test(allText), "new_chapter.no_old_generic_copy", "Old generic briefing filler must not return.");
check(!allText.includes("?") && !/management question|central question/i.test(allText), "new_chapter.no_questions", "Generated Y2+ copy must be declarative and contain no management questions.");
check(!/rotation averaging|roughly #|competitive map/i.test(leagueText), "new_chapter.no_rank_fluff", "League copy must not fall back to numerical roster-rank fluff.");
const conferenceSection = (result?.tabs?.league?.sections || []).find((section) => /Conference competition/i.test(section.title));
check(Boolean(conferenceSection) && conferenceSection.items.every((item) => !/Dallas Mavericks|Sacramento Kings/i.test(item)), "new_chapter.same_conference_rivals", "Competitive comparison must stay inside Toronto's conference.");
check((conferenceSection?.items || []).some((item) => /improved|regressed|slipped|strengthened|steady/i.test(item)), "new_chapter.conference_trajectory", "Conference rivals must be described by direction, not just roster rank.");
check((result?.tabs?.team?.sections || []).some((section) => section.title === "Locker room pulse" && section.items.some((item) => /locker room|unsettled|Frustrated|playoff exit/i.test(item))), "new_chapter.locker_room_wired", "Team briefing must consume Locker Room mood output.");
check((result?.tabs?.team?.sections || []).some((section) => section.title === "How the roster changed" && section.items.length >= 2), "new_chapter.transaction_story_section", "Team tab must expose the saved roster-change story beats in a dedicated section.");
check((result?.tabs?.team?.sections || []).some((section) => section.title === "Pressure points"), "new_chapter.team_pressure_points", "Team briefing must surface aging/contract/mood concerns.");
check((result?.tabs?.team?.sections || []).some((section) => section.title === "Contract watch"), "new_chapter.contract_watch", "Team briefing must surface extension and free-agency pressure.");
check(result?.dossier?.moodPulse?.average > 0 && Array.isArray(result?.dossier?.conferenceCompetition), "new_chapter.compact_mood_conference_dossier", "Frozen dossier must preserve compact mood and conference intelligence only.");
check(result?.dossier?.version === 6 && Boolean(result?.dossier?.franchiseDirection), "new_chapter.direction_dossier", "Y2+ dossier must freeze an inferred franchise direction.");
check(result?.dossier?.tradeLedger?.rootOutgoingPlayers?.some((row) => row.playerName === "Immanuel Quickley"), "new_chapter.asset_ledger", "Trade dossier must preserve outgoing player assets instead of only isolated transaction headlines.");

// ---------------------------------------------------------------------------
// Franchise-direction regression: Booker -> Fox -> picks must read as one story.
// ---------------------------------------------------------------------------
const phxPlayer = (name, overall, age, pos = "PG", extra = {}) => ({
  name, overall, potential: Math.max(overall, Number(extra.potential || overall + 2)), age, pos, ...extra,
});
const phoenixLeague = {
  leagueId: "phoenix-story-regression",
  seasonStartYear: 2027,
  seasonYear: 2027,
  currentSeasonYear: 2027,
  currentDraftYear: 2028,
  teams: [
    {
      name: "Phoenix Suns", conference: "West", players: [
        phxPlayer("Stephon Castle", 81, 23), phxPlayer("Payton Pritchard", 77, 29),
        phxPlayer("Koa Peat", 76, 20, "PF"), phxPlayer("Ryan Dunn", 73, 24, "SF"),
        phxPlayer("PHX Five", 72, 25), phxPlayer("PHX Six", 71, 24), phxPlayer("PHX Seven", 70, 23),
        phxPlayer("PHX Eight", 69, 22), phxPlayer("PHX Nine", 68, 21),
      ],
    },
    {
      name: "San Antonio Spurs", conference: "West", players: [
        phxPlayer("Devin Booker", 91, 30, "SG", { history: { accolades: [{ seasonYear: 2027, type: "all_nba_second", label: "All-NBA Second Team" }] } }), phxPlayer("Victor Wembanyama", 95, 23, "C"),
        phxPlayer("SAS Three", 84, 25), phxPlayer("SAS Four", 82, 25), phxPlayer("SAS Five", 80, 26),
        phxPlayer("SAS Six", 79, 27), phxPlayer("SAS Seven", 78, 27), phxPlayer("SAS Eight", 77, 27), phxPlayer("SAS Nine", 76, 27),
      ],
    },
    {
      name: "Boston Celtics", conference: "East", players: [
        phxPlayer("De'Aaron Fox", 86, 29), phxPlayer("BOS Two", 84, 28), phxPlayer("BOS Three", 82, 27),
        phxPlayer("BOS Four", 80, 26), phxPlayer("BOS Five", 78, 25), phxPlayer("BOS Six", 77, 25),
        phxPlayer("BOS Seven", 76, 25), phxPlayer("BOS Eight", 75, 25), phxPlayer("BOS Nine", 74, 25),
      ],
    },
  ],
  seasonHistory: [{
    seasonYear: 2026,
    champion: "New York Knicks",
    teams: [
      { teamName: "Phoenix Suns", wins: 39, losses: 43, madePlayIn: true, playoffResult: "play_in" },
      { teamName: "San Antonio Spurs", wins: 55, losses: 27, madePlayoffs: true, conferenceFinals: true, playoffResult: "conference_finals" },
      { teamName: "Boston Celtics", wins: 48, losses: 34, madePlayoffs: true, playoffResult: "second_round" },
    ],
    statsArchive: {
      regular: {
        playerRows: [
          { name: "Stephon Castle", teamName: "Phoenix Suns", overall: 81, age: 23, stats: { GP: 82, PTS: 20.1, REB: 6.0, AST: 8.0 } },
          { name: "Devin Booker", teamName: "San Antonio Spurs", overall: 91, age: 30, stats: { GP: 70, PTS: 27.8, REB: 4.6, AST: 6.2 } },
        ],
        stintRows: [
          { name: "Devin Booker", teamName: "San Antonio Spurs", stats: { GP: 70, PTS: 27.8, REB: 4.6, AST: 6.2 } },
          { name: "De'Aaron Fox", teamName: "Phoenix Suns", stats: { GP: 24, PTS: 21.1, REB: 4.0, AST: 7.2 } },
          { name: "De'Aaron Fox", teamName: "Boston Celtics", stats: { GP: 31, PTS: 19.2, REB: 3.5, AST: 6.1 } },
        ],
      },
    },
  }],
  leagueHistory: { champions: [], awards: {} },
  tradeHistory: [
    {
      id: "booker_to_spurs",
      seasonYear: 2026,
      date: "2026-11-15",
      teamContextAtTrade: {
        "Phoenix Suns": { wins: 18, losses: 24, phase: "retool" },
        "San Antonio Spurs": { wins: 24, losses: 17, phase: "playoff" },
      },
      teamPackages: [
        {
          teamName: "Phoenix Suns",
          sent: [{ type: "player", playerName: "Devin Booker", overall: 91, age: 30 }],
          received: [
            { type: "player", playerName: "De'Aaron Fox", overall: 88, age: 29 },
            { type: "pick", pickId: "sas29", year: 2029, round: 1, originalTeam: "San Antonio Spurs", protection: "Unprotected" },
            { type: "pick", pickId: "sas31", year: 2031, round: 1, originalTeam: "San Antonio Spurs", protection: "Unprotected" },
          ],
        },
        {
          teamName: "San Antonio Spurs",
          sent: [
            { type: "player", playerName: "De'Aaron Fox", overall: 88, age: 29 },
            { type: "pick", pickId: "sas29", year: 2029, round: 1, originalTeam: "San Antonio Spurs", protection: "Unprotected" },
            { type: "pick", pickId: "sas31", year: 2031, round: 1, originalTeam: "San Antonio Spurs", protection: "Unprotected" },
          ],
          received: [{ type: "player", playerName: "Devin Booker", overall: 91, age: 30 }],
        },
      ],
    },
    {
      id: "fox_flip",
      seasonYear: 2026,
      date: "2027-02-08",
      teamContextAtTrade: {
        "Phoenix Suns": { wins: 24, losses: 33, phase: "retool" },
        "Boston Celtics": { wins: 30, losses: 25, phase: "playoff" },
      },
      teamPackages: [
        {
          teamName: "Phoenix Suns",
          sent: [{ type: "player", playerName: "De'Aaron Fox", overall: 88, age: 29 }],
          received: [
            { type: "pick", pickId: "bos28", year: 2028, round: 1, originalTeam: "Boston Celtics", protection: "Unprotected" },
            { type: "pick", pickId: "bos30", year: 2030, round: 1, originalTeam: "Boston Celtics", protection: "Top 4" },
          ],
        },
        {
          teamName: "Boston Celtics",
          sent: [
            { type: "pick", pickId: "bos28", year: 2028, round: 1, originalTeam: "Boston Celtics", protection: "Unprotected" },
            { type: "pick", pickId: "bos30", year: 2030, round: 1, originalTeam: "Boston Celtics", protection: "Top 4" },
          ],
          received: [{ type: "player", playerName: "De'Aaron Fox", overall: 88, age: 29 }],
        },
      ],
    },
  ],
  draftPicks: [
    { id: "sas29", ownerTeam: "Phoenix Suns", year: 2029, round: 1, originalTeam: "San Antonio Spurs", status: "active", protections: "Unprotected" },
    { id: "sas31", ownerTeam: "Phoenix Suns", year: 2031, round: 1, originalTeam: "San Antonio Spurs", status: "active", protections: "Unprotected" },
    { id: "bos28", ownerTeam: "Phoenix Suns", year: 2028, round: 1, originalTeam: "Boston Celtics", status: "active", protections: "Unprotected" },
    { id: "bos30", ownerTeam: "Phoenix Suns", year: 2030, round: 1, originalTeam: "Boston Celtics", status: "active", protections: "Top 4" },
  ],
};

const phoenixBriefing = briefing.buildSeasonBriefingData(phoenixLeague, "Phoenix Suns", 2027, {
  moodData: { players: [{ name: "Stephon Castle", moodScore: 64 }, { name: "Payton Pritchard", moodScore: 60 }] },
});
const phoenixText = phoenixBriefing?.tabs?.team?.paragraphs?.join(" ") || "";
check(phoenixBriefing?.dossier?.franchiseDirection?.type === "rebuilding", "new_chapter.phoenix_rebuild_direction", "Booker -> Fox -> picks must be understood as a rebuild rather than isolated player moves.");
check(phoenixBriefing?.dossier?.tradeLedger?.netFirsts === 4, "new_chapter.pick_value_in_direction", "Franchise direction must count the actual net first-round capital gained through linked trades.");
check(/Devin Booker/.test(phoenixText) && /De'Aaron Fox/.test(phoenixText) && /24 games/.test(phoenixText), "new_chapter.bridge_player_stint", "A short-lived intermediate player must be described by his actual stint length before being flipped again.");
check(/four additional first-round picks|4 additional first-round picks|gained 4 more first-round picks/i.test(phoenixText), "new_chapter.rebuild_pick_story", "The team briefing must explain that the star trade chain produced additional first-round capital.");
check(/Booker/.test(phoenixText) && /70 games/.test(phoenixText) && /28 points/.test(phoenixText) && /55-27/.test(phoenixText) && /conference finals/i.test(phoenixText), "new_chapter.trade_partner_aftermath", "The briefing must follow a major outgoing star to his new team and describe both his performance and that team's result.");
check(/All-NBA Second Team/.test(phoenixText), "new_chapter.outgoing_star_accolades", "Trade aftermath should include major saved accolades such as All-NBA when player-card history has them.");
check(/18-24/.test(phoenixText) && /24-17/.test(phoenixText), "new_chapter.trade_time_team_context", "When the save has a trade-time team record, New Chapter should preserve that checkpoint for both sides of the deal.");
check((phoenixBriefing?.tabs?.team?.sections || []).some((section) => section.title === "What happened after the trades" && section.items.some((item) => /Booker/.test(item))), "new_chapter.aftermath_section", "Trade aftermath must be available as structured story context as well as prose.");
check((phoenixBriefing?.dossier?.pickLineage || []).some((row) => row.originalTeam === "San Antonio Spurs"), "new_chapter.future_pick_lineage", "Future firsts acquired in major trades must retain their original-team lineage.");
check(!/blank slate|mixed emotions|room is not fractured|changed the shape of the roster|pressure entering camp is less abstract/i.test(phoenixText), "new_chapter.no_writerly_team_templates", "Year 2+ team prose must stay natural and avoid the old essay-like templates.");
const phoenixProspectsText = phoenixBriefing?.tabs?.prospects?.paragraphs?.join(" ") || "";
const phoenixOutlookText = phoenixBriefing?.tabs?.outlook?.paragraphs?.join(" ") || "";
check(/San Antonio Spurs/.test(phoenixProspectsText) && /unprotected 2029 first/i.test(phoenixProspectsText) && /55-27/.test(phoenixProspectsText), "new_chapter.external_pick_team_context", "Outside picks must name the original team, protection and that team's actual previous result when available.");
check(/Boston Celtics/.test(phoenixProspectsText) && /2030 first \(Top 4\)/i.test(phoenixProspectsText) && /limits the best-case draft position/i.test(phoenixProspectsText), "new_chapter.protected_external_pick_precision", "Protected outside picks must explain how protection changes the franchise's upside.");
check(/outside first-round assets/i.test(phoenixOutlookText) && /San Antonio Spurs|Boston Celtics/.test(phoenixOutlookText), "new_chapter.external_pick_portfolio_outlook", "Season outlook must explain the outside-pick portfolio instead of reporting only a raw count.");
check(phoenixBriefing?.dossier?.externalPickIntel?.count === 4 && phoenixBriefing?.dossier?.externalPickIntel?.teamCount === 2, "new_chapter.external_pick_dossier", "Frozen dossier must preserve compact outside-pick intelligence for stable storytelling.");
check((phoenixBriefing?.tabs?.outlook?.sections || []).some((section) => section.title === "Outside first-round assets" && section.items.some((item) => /San Antonio Spurs/.test(item))), "new_chapter.external_pick_section", "Outlook must expose outside first-round assets as structured franchise context.");

// Split-team stats must survive the completed-season archive in compact form.
const seasonStatsSource = fs.readFileSync(path.join(root, "src/utils/seasonStatsArchive.js"), "utf8");
check(
  seasonStatsSource.includes("function buildMultiTeamStintRows") &&
  seasonStatsSource.includes("preserveMultiTeamStints: true") &&
  seasonStatsSource.includes("{ stintRows }"),
  "new_chapter.compact_split_team_stints",
  "Completed-season archives must preserve compact split-team stints for traded players."
);
const tradeExecutionSource = fs.readFileSync(path.join(root, "src/utils/tradeExecution.js"), "utf8");
check(tradeExecutionSource.includes("teamContextAtTrade") && tradeExecutionSource.includes("buildTeamContextForTrade"), "new_chapter.trade_checkpoint_archive", "New trades must persist compact team records/phases at the moment of the deal for later storytelling.");

// Completed picks must be archived before the live pick asset rolls out of the league.
const draftArchiveLeague = {
  seasonYear: 2028,
  currentDraftYear: 2028,
  teams: phoenixLeague.teams,
  draftPicks: [{
    id: "bos28", ownerTeam: "Phoenix Suns", originalTeam: "Boston Celtics", year: 2028, round: 1,
    status: "active", protections: "Unprotected",
    tradeHistory: [{ fromTeam: "Boston Celtics", toTeam: "Phoenix Suns", seasonYear: 2026, action: "trade" }],
  }],
};
const completedDraftState = {
  completed: true,
  seasonYear: 2028,
  draftOrder: [{ pick: 9, round: 1, pickInRound: 9, currentOwnerTeamName: "Phoenix Suns", originalTeamName: "Boston Celtics", draftPickAssetId: "bos28" }],
  draftedPicks: [{ pick: 9, round: 1, pickInRound: 9, teamName: "Phoenix Suns", originalTeamName: "Boston Celtics", playerId: "future-wing", playerName: "Future Wing", pos: "SF", overall: 76, potential: 88, age: 19 }],
};
const archivedDraftLeague = draftPicks.archiveCompletedDraftHistory(draftArchiveLeague, completedDraftState, 2028);
const archivedPick = archivedDraftLeague?.draftHistory?.find((row) => row.draftYear === 2028)?.picks?.[0];
check(archivedPick?.draftPickAssetId === "bos28" && archivedPick?.playerName === "Future Wing" && archivedPick?.pick === 9, "new_chapter.completed_pick_history", "A completed traded pick must remain linked to the player selected with it after the live pick asset is retired.");
check(Array.isArray(archivedPick?.assetTradeHistory) && archivedPick.assetTradeHistory.some((row) => row.toTeam === "Phoenix Suns"), "new_chapter.pick_trade_history_archive", "Archived draft outcomes must preserve compact pick trade provenance.");

// Several years later, New Chapter should still know what a traded pick became.
const lineageLeague = structuredClone(phoenixLeague);
lineageLeague.seasonStartYear = 2030;
lineageLeague.seasonYear = 2030;
lineageLeague.currentSeasonYear = 2030;
lineageLeague.currentDraftYear = 2031;
lineageLeague.draftHistory = archivedDraftLeague.draftHistory;
lineageLeague.draftPicks = lineageLeague.draftPicks.filter((row) => row.id !== "bos28");
lineageLeague.teams = lineageLeague.teams.map((team) => team.name === "Phoenix Suns"
  ? { ...team, players: [phxPlayer("Future Wing", 82, 21, "SF", { potential: 90 }), ...team.players] }
  : team
);
lineageLeague.seasonHistory = [{
  seasonYear: 2029,
  teams: [
    { teamName: "Phoenix Suns", wins: 34, losses: 48, playoffResult: "missed_playoffs" },
    { teamName: "San Antonio Spurs", wins: 52, losses: 30, madePlayoffs: true, playoffResult: "second_round" },
    { teamName: "Boston Celtics", wins: 45, losses: 37, madePlayoffs: true, playoffResult: "first_round" },
  ],
  statsArchive: { regular: { playerRows: [
    { name: "Future Wing", teamName: "Phoenix Suns", overall: 82, age: 21, stats: { GP: 80, PTS: 17.2, REB: 5.4, AST: 3.2 } },
    { name: "Devin Booker", teamName: "San Antonio Spurs", overall: 89, age: 32, stats: { GP: 72, PTS: 25.4, REB: 4.4, AST: 5.7 } },
  ] } },
}];
const lineageBriefing = briefing.buildSeasonBriefingData(lineageLeague, "Phoenix Suns", 2030);
const lineageText = Object.values(lineageBriefing?.tabs || {}).flatMap((tab) => tab?.paragraphs || []).join(" ");
check(/No\. 9/.test(lineageText) && /Future Wing/.test(lineageText) && /Booker trade/i.test(lineageText) && /17 points/i.test(lineageText), "new_chapter.pick_became_player", "Years later, the story must connect a traded first to its draft slot, the player it became, and how that player is developing.");
check((lineageBriefing?.dossier?.pickLineage || []).some((row) => row.pickNumber === 9 && row.draftedPlayer === "Future Wing"), "new_chapter.lineage_in_frozen_dossier", "Pick-to-player lineage must be frozen into the season dossier for stable storytelling.");

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

const y1League = {
  ...league,
  seasonStartYear: 2026,
  seasonYear: 2026,
  currentSeasonYear: 2026,
  draftPicks: [
    ...(league.draftPicks || []),
    { id: "dal28-y1", ownerTeam: "Toronto Raptors", originalTeam: "Dallas Mavericks", year: 2028, round: 1, status: "active", protections: "Unprotected" },
  ],
};
const y1Result = briefing.buildSeasonBriefingData(y1League, "Toronto Raptors", 2026);
const y1Source = y1.getFirstSeasonBriefing2026("Toronto Raptors");
const y1ProspectText = y1Result?.tabs?.prospects?.paragraphs?.join(" ") || "";
const y1OutlookText = y1Result?.tabs?.outlook?.paragraphs?.join(" ") || "";
check(y1Result?.source === "handcrafted_2026", "new_chapter.y1_isolated", "Y1 must stay on the handcrafted path.");
check(y1Result?.tabs?.team?.paragraphs?.[0] === y1Source?.team?.paragraphs?.[0], "new_chapter.y1_exact_copy", "Y1 team copy must remain handcrafted while pick intelligence is layered into the pick/outlook tabs.");
check(/Dallas Mavericks/.test(y1ProspectText) && /unprotected 2028 first/i.test(y1ProspectText), "new_chapter.y1_external_pick_story", "Y1 must identify meaningful first-round picks owned from other teams with exact year/protection context.");
check(/outside first-round asset/i.test(y1OutlookText) && /Dallas Mavericks/.test(y1OutlookText), "new_chapter.y1_external_pick_impact", "Y1 outlook must explain how outside draft capital changes franchise flexibility.");

const filenames = Object.values(briefing.SEASON_BRIEFING_FILENAMES || {});
check(filenames.length === 30 && new Set(filenames).size === 30 && filenames.every((name) => name.endsWith(".png")), "new_chapter.30_wallpapers", "All 30 teams need unique PNG mappings.");

const appSource = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const hubSource = fs.readFileSync(path.join(root, "src/pages/TeamHub.jsx"), "utf8");
const hostSource = fs.readFileSync(path.join(root, "src/components/SeasonBriefingHost.jsx"), "utf8");
check(appSource.includes("<SeasonBriefingHost />"), "new_chapter.global_host", "App must mount the global host.");
check(hubSource.includes("bm:open-season-briefing") && hostSource.includes("OPEN_SEASON_BRIEFING_EVENT"), "new_chapter.manual_reopen_event", "The existing manual New Chapter event path must remain wired without restoring the removed Team Hub tile.");
check(hostSource.includes('location.pathname !== "/calendar"') && hostSource.includes("isSeasonBriefingOpeningWindow"), "new_chapter.calendar_autopopup", "Automatic popup must be gated to the opening Calendar window.");
check(hostSource.includes("readScheduleFromStorage") && !hostSource.includes('localStorage.getItem("bm_schedule_v3")'), "new_chapter.current_schedule_storage", "New Chapter must use the current IndexedDB-backed schedule bridge.");
check(hostSource.includes("saveLeagueData(nextLeague") && hostSource.includes("storeSeasonBriefingSnapshot"), "new_chapter.indexeddb_league_persistence", "Chapter snapshots must persist through leagueData/IndexedDB.");
check(hostSource.includes("getLockerRoomMoods") && hostSource.includes("moodData"), "new_chapter.locker_room_host", "New Chapter host must read Locker Room moods once when freezing the season snapshot.");

if (failures.length) {
  console.error(`\nNew Chapter regression failed: ${failures.length} failure(s).`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log(`\nNew Chapter regression passed: ${passed}/${passed} checks.`);
