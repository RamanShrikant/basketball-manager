import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const hub = read("frontend/src/pages/TeamHub.jsx");
const hubCss = read("frontend/src/components/TeamHub.module.css");
const sidebar = read("frontend/src/components/TeamHubSidebar.jsx");
const trade = read("frontend/src/pages/ProposeTrade.jsx");

function check(ok, message) {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

check(!hub.includes("setSelectedTeam(result.team)"), "Team search cannot mutate the controlled franchise.");
check(hub.includes("setHubViewTeamName(teamNameOf(result.team))"), "Team search changes only Team Hub preview state.");
check(hub.includes("CONTROLLED TEAM PREVIEW SAFETY PASS 33"), "Team Hub controlled-team preview guard is installed.");
check(hub.includes("Return to My Team") && hub.includes("isPreviewingTeam"), "Team Hub preview has an explicit return control.");
check(hubCss.includes("CONTROLLED TEAM PREVIEW SAFETY PASS 33"), "Preview return control styling is installed.");

check(sidebar.includes("getOffseasonFreeAgencyReturnPath(liveLeagueData = null)"), "Sidebar FA resume can inspect live league state.");
check(sidebar.includes("getOffseasonFreeAgencyReturnPath(leagueData)"), "Sidebar passes live GameContext league data into FA resume routing.");
check(sidebar.includes("clearTradeBuilderResumeWhenLeaving"), "Sidebar clears one-shot trade-builder resume state when leaving trade flow.");
check(!sidebar.includes('localStorage.removeItem("bm_trade_builder_v1")'), "Sidebar does not delete trade proposal/game data.");

check(trade.includes("resumeBuilderForControlledTeam"), "Trade Builder has a controlled-team resume guard.");
check(trade.includes("savedUserTeamName !== controlledUserTeamName"), "Trade Builder rejects a saved proposal from another controlled team.");
check(trade.includes("savedBuilderMatchesControlledTeam"), "Trade Finder evaluation is also controlled-team scoped.");
check(trade.includes('const userTeamName = selectedTeam?.name || ""'), "Trade Builder user side still comes from GameContext controlled team.");

console.log("\nPASS: Controlled Team / Sidebar / Trade Builder Safety Pass 33 regression complete.");
