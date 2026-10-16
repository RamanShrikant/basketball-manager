import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..");
const repositoryRoot = path.resolve(frontendRoot, "..");
const enginePath = path.join(frontendRoot, "src/api/cpuTradeEngine.js");
const pythonModuleDir = path.join(frontendRoot, "public/python");
const { compactCpuTradeHistoryForWorker } = await import(`${pathToFileURL(enginePath).href}?parity=${Date.now()}`);

function readLeagueFixture() {
  const candidates = ["19.json", "18.5.json", "13 6.json"];
  for (const name of candidates) {
    const candidate = path.join(repositoryRoot, name);
    if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, "utf8"));
  }
  throw new Error("No repository league fixture was found (expected 19.json, 18.5.json, or 13 6.json). ");
}

function allTeams(league) {
  if (Array.isArray(league?.teams)) return league.teams;
  return Object.values(league?.conferences || {}).flatMap((teams) => Array.isArray(teams) ? teams : []);
}

function makeHistory(teams) {
  const rows = [];
  const largePresentationSnapshot = "x".repeat(12000);
  const teamNames = teams.map((team) => team?.name).filter(Boolean);

  for (let index = 0; index < 140; index += 1) {
    const fromTeamName = teamNames[index % teamNames.length];
    const toTeamName = teamNames[(index + 7) % teamNames.length];
    const isCpuTrade = index >= 112 && index % 4 === 0;
    const player = teams.find((team) => team?.name === fromTeamName)?.players?.[index % 10];
    rows.push({
      id: `history_${index}`,
      source: isCpuTrade ? "cpu_cpu_trade" : "user_trade",
      cpuCpuTrade: isCpuTrade,
      userTeamName: fromTeamName,
      cpuTeamName: toTeamName,
      fromTeamName,
      toTeamName,
      date: `2027-01-${String((index % 20) + 1).padStart(2, "0")}`,
      currentDate: `2027-01-${String((index % 20) + 1).padStart(2, "0")}`,
      movedPlayers: [{
        name: player?.name || `Player ${index}`,
        fromTeam: fromTeamName,
        toTeam: toTeamName,
        fullPlayerSnapshot: player || null,
      }],
      evaluationSummary: {
        score: index,
        reasons: [largePresentationSnapshot],
      },
      teamPackages: [{
        teamName: fromTeamName,
        reason: largePresentationSnapshot,
        received: [{ fullSnapshot: player || null }],
      }],
      tradeDeskPresentation: largePresentationSnapshot,
    });
  }

  return rows;
}

function findPython() {
  const attempts = [
    { command: "python", prefix: [] },
    { command: "py", prefix: ["-3"] },
    { command: "python3", prefix: [] },
  ];
  for (const attempt of attempts) {
    const probe = spawnSync(attempt.command, [...attempt.prefix, "--version"], { encoding: "utf8" });
    if (probe.status === 0) return attempt;
  }
  throw new Error("Python 3 was not found. Install Python or ensure python/py/python3 is available in PATH.");
}

const fixture = readLeagueFixture();
const teams = allTeams(fixture);
if (teams.length < 8) throw new Error(`League fixture has only ${teams.length} teams; expected at least 8.`);

const fullHistory = makeHistory(teams);
const compactHistory = compactCpuTradeHistoryForWorker(fullHistory);
const leagueBase = {
  ...fixture,
  seasonYear: 2026,
  currentSeasonYear: 2026,
  draftPicks: [],
};
const recordsByTeam = Object.fromEntries(teams.map((team, index) => [
  team.name,
  { wins: 12 + (index % 20), losses: 8 + ((index * 3) % 20) },
]));
const context = {
  currentDate: "2027-01-25",
  tradeDeadlineDate: "2027-02-08",
  userTeamName: teams[0].name,
  maxCandidates: 84,
  inventoryPressure: 1.25,
  foregroundRecommended: true,
  bankGenerationMode: true,
  bankSeed: "history-payload-parity",
  generationNonce: 9,
  dayIndex: 96,
  daysToDeadline: 14,
  seasonProgress: 0.61,
  recordsByTeam,
};
const payloads = [
  { leagueData: { ...leagueBase, tradeHistory: fullHistory.slice(-120) }, context },
  { leagueData: { ...leagueBase, tradeHistory: compactHistory }, context },
];

const pythonCode = String.raw`
import json
import sys
sys.path.insert(0, sys.argv[1])
import cpu_cpu_trade_logic
payloads = json.load(sys.stdin)
results = [cpu_cpu_trade_logic.find_cpu_cpu_trade_candidates(payload) for payload in payloads]
print(json.dumps(results, sort_keys=True, separators=(",", ":")))
`;
const python = findPython();
const run = spawnSync(
  python.command,
  [...python.prefix, "-c", pythonCode, pythonModuleDir],
  {
    input: JSON.stringify(payloads),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }
);
if (run.status !== 0) {
  throw new Error(`Python parity runner failed (${run.status}).\n${run.stderr || run.stdout}`);
}

const [fullResult, compactResult] = JSON.parse(run.stdout);
const fullJson = JSON.stringify(fullResult);
const compactJson = JSON.stringify(compactResult);
if (fullJson !== compactJson) {
  fs.writeFileSync(path.join(repositoryRoot, "bm_cpu_trade_full_history_result.json"), `${JSON.stringify(fullResult, null, 2)}\n`);
  fs.writeFileSync(path.join(repositoryRoot, "bm_cpu_trade_compact_history_result.json"), `${JSON.stringify(compactResult, null, 2)}\n`);
  throw new Error("CPU trade generator parity failed. Full and compact history produced different output.");
}

const fullBytes = Buffer.byteLength(JSON.stringify(payloads[0]));
const compactBytes = Buffer.byteLength(JSON.stringify(payloads[1]));
const savedBytes = fullBytes - compactBytes;
const reductionPct = fullBytes > 0 ? (savedBytes / fullBytes) * 100 : 0;
const candidateCount = Array.isArray(fullResult?.candidates) ? fullResult.candidates.length : 0;
if (candidateCount <= 0) throw new Error("Parity fixture produced no candidates, so the test did not exercise candidate generation.");
if (reductionPct < 50) throw new Error(`Expected at least 50% fixture payload reduction; measured ${reductionPct.toFixed(2)}%.`);

console.log("PASS cpu_trade_history.generator_output_exact");
console.log(`Candidates: ${candidateCount}`);
console.log(`Full payload: ${fullBytes.toLocaleString()} bytes`);
console.log(`Compact payload: ${compactBytes.toLocaleString()} bytes`);
console.log(`Reduction: ${reductionPct.toFixed(2)}% (${savedBytes.toLocaleString()} bytes)`);
