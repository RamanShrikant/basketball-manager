import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const shell = fs.readFileSync(path.join(root, "src/components/PersistentGameShell.jsx"), "utf8");
const shellCss = fs.readFileSync(path.join(root, "src/components/PersistentGameShell.module.css"), "utf8");
const sidebarCss = fs.readFileSync(path.join(root, "src/components/TeamHubSidebar.module.css"), "utf8");

const checks = [];
const check = (condition, id, detail) => checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(shell.includes('useGame') && shell.includes('Boolean(selectedTeam)'), "sidebar.after_team_selection", "Sidebar requires a selected team.");
check(shell.includes('"/league-editor"'), "sidebar.league_editor_hidden", "League Editor is full-screen/pre-league.");
check(shellCss.includes(".bmGlobalRouteNav") && shellCss.includes("display: none !important"), "sidebar.old_bottom_nav_hidden", "Old floating bottom navigation is hidden.");
check(shellCss.includes(".bmLegacyRouteBack"), "sidebar.legacy_back_hidden", "Legacy back/Season controls are hidden.");
check(sidebarCss.includes(".navItem {\\n  box-sizing: border-box;"), "sidebar.no_label_clip", "Nav buttons use border-box sizing.");
check(sidebarCss.includes("background: #d65316 !important;"), "sidebar.solid_orange_active", "Selected row is solid orange.");
check(sidebarCss.includes("color: #e2a16f;"), "sidebar.light_orange_headings", "Section headings use a lighter orange.");
check(sidebarCss.includes("scrollbar-color: #f97316"), "sidebar.orange_scrollbar_preserved", "Orange scrollbar remains intact.");

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Sidebar polish Stage 2C regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Sidebar polish Stage 2C regression passed: ${checks.length}/${checks.length} checks.`);
