import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const teamHub = fs.readFileSync(path.join(root, "src/pages/TeamHub.jsx"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "src/components/TeamHubSidebar.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/components/TeamHubSidebar.module.css"), "utf8");

const checks = [];
function check(condition, id, detail) {
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });
}

check(teamHub.includes('import TeamHubSidebar from "../components/TeamHubSidebar.jsx";'), "sidebar.wired", "Team Hub imports the isolated sidebar component.");
check(teamHub.includes("styles.withSidebar"), "sidebar.layout_hook", "Legacy Team Hub receives only the sidebar layout hook.");
check(sidebar.includes('aria-current="page"') && sidebar.includes("Team Hub"), "sidebar.team_hub_active", "Team Hub is the active placeholder destination.");
check(sidebar.includes('sectionTiles?.Team') && sidebar.includes('sectionTiles?.["Front Office"]') && sidebar.includes("sectionTiles?.Season"), "sidebar.core_groups", "Team, Front Office, and Season destinations come from the existing Team Hub tile data.");
check(sidebar.includes("sectionTiles?.Stats") && sidebar.includes("sectionTiles?.Scouting") && sidebar.includes("sectionTiles?.Awards"), "sidebar.secondary_groups", "Stats, Scouting, and Awards destinations come from the existing Team Hub tile data.");
check(sidebar.includes('sectionTiles?.["League History"]'), "sidebar.history_group", "All existing Team Hub history destinations are represented.");
check(sidebar.includes('path: "/league-editor"') && sidebar.includes('path: "/settings"'), "sidebar.system_routes", "Sampler-style League Editor and Settings entries use existing real routes.");
check(!sidebar.includes("localStorage") && !sidebar.includes("sessionStorage") && !sidebar.includes("useGame"), "sidebar.presentation_only", "Sidebar does not own or mutate gameplay/save state.");
check(css.includes("#091422") && css.includes("rgba(74, 55, 139"), "sidebar.visual_language", "Sidebar uses the navy-black background and muted-purple active state.");
check(css.includes("@media (max-height: 720px)"), "sidebar.laptop_density", "Compact laptop-height rules are present.");

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub sidebar regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Team Hub sidebar regression passed: ${checks.length}/${checks.length} checks.`);