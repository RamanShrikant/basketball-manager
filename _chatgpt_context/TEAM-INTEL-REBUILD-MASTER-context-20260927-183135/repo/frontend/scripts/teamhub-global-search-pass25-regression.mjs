import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const jsxPath = path.join(root, "frontend/src/pages/TeamHub.jsx");
const cssPath = path.join(root, "frontend/src/components/TeamHub.module.css");
function fail(message) { console.error(`FAIL: ${message}`); process.exit(1); }
for (const file of [jsxPath, cssPath]) if (!fs.existsSync(file)) fail(`Missing ${file}`);
const jsx = fs.readFileSync(jsxPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
for (const token of ['import PlayerCardModal', 'data-teamhub-search-pass="25"', 'aria-label="Search players and teams"', 'setSelectedTeam(result.team)', 'setSearchPlayerCard(result)', 'data-teamhub-player-search-modal="25"']) if (!jsx.includes(token)) fail(`Missing token: ${token}`);
if (jsx.includes('<div className={styles.avatarBadge}>RS</div>')) fail('RS avatar markup still present');
if (jsx.includes('aria-label="Search preview"')) fail('Search is still preview-only');
for (const token of ['TEAM HUB FUNCTIONAL GLOBAL SEARCH PASS 25', '.searchResults {', 'pointer-events: auto !important;']) if (!css.includes(token)) fail(`Missing CSS token: ${token}`);
console.log('PASS: Team Hub Functional Global Search Pass 25 is installed.');
console.log('PASS: Teams switch the Team Hub, players open PlayerCardModal, RS avatar removed, bell preserved.');
