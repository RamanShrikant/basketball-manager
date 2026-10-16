import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const shell = fs.readFileSync(path.join(root, "src/components/PersistentGameShell.jsx"), "utf8");
const shellCss = fs.readFileSync(path.join(root, "src/components/PersistentGameShell.module.css"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "src/components/TeamHubSidebar.jsx"), "utf8");
const sidebarCss = fs.readFileSync(path.join(root, "src/components/TeamHubSidebar.module.css"), "utf8");
const teamHub = fs.readFileSync(path.join(root, "src/pages/TeamHub.jsx"), "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(app.includes("PersistentGameShell") && app.includes("<PersistentGameShell>"), "shell.app_wired", "Persistent shell wraps route content.");
check(shell.includes("<TeamHubSidebar />") && shell.includes("{children}"), "shell.sidebar_persistent", "Sidebar stays outside route content.");
check(shell.includes('"/"') && shell.includes('"/play"') && shell.includes('"/team-selector"'), "shell.setup_routes_excluded", "Studio/setup routes remain full-screen.");
check(shellCss.includes("margin-left: var(--bm-persistent-sidebar-width)"), "shell.content_offset", "Route content is offset from the sidebar.");
check(sidebar.includes("collapsedGroups") && sidebar.includes("toggleGroup"), "sidebar.collapsible_state", "Sidebar groups can collapse independently.");
check(sidebar.includes("GroupChevron") && sidebar.includes("aria-expanded"), "sidebar.chevrons", "Group headings expose reversible chevrons.");
check(sidebar.includes("ACTIVE_ROUTE_ALIASES") && sidebar.includes("useLocation"), "sidebar.active_route", "Active item follows route.");
check(sidebar.includes("isAllStarsAvailable") && sidebar.includes("isDraftStartedForYear"), "sidebar.phase_rules", "Existing availability rules remain.");
check(!teamHub.includes("<TeamHubSidebar"), "team_hub.no_duplicate_sidebar", "Team Hub no longer mounts a second local sidebar.");
check(sidebarCss.includes("#120d09") && sidebarCss.includes("#f97316"), "sidebar.orange_theme", "Orange-black visual theme and orange scrollbar are present.");
check(sidebarCss.includes("::-webkit-scrollbar-thumb"), "sidebar.orange_scrollbar", "Custom orange scrollbar is present.");
check(!sidebar.includes("setSelectedTeam"), "sidebar.no_team_mutation", "Sidebar does not mutate selected team/gameplay state.");

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Orange persistent sidebar regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Orange persistent sidebar regression passed: ${checks.length}/${checks.length} checks.`);
