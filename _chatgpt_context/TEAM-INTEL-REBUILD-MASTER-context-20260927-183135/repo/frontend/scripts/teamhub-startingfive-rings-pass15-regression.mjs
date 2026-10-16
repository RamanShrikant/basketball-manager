import fs from "node:fs";
import path from "node:path";

const frontend = process.cwd();
const jsxPath = path.join(frontend, "src/pages/TeamHub.jsx");
const cssPath = path.join(frontend, "src/components/TeamHub.module.css");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(jsxPath)) fail("src/pages/TeamHub.jsx not found from frontend directory.");
if (!fs.existsSync(cssPath)) fail("src/components/TeamHub.module.css not found from frontend directory.");

const jsx = fs.readFileSync(jsxPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

if (!jsx.includes('import PlayerRatingRing from "../components/PlayerRatingRing.jsx";')) {
  fail("PlayerRatingRing import not found in TeamHub.jsx.");
}

for (const token of ['styles.playerVisual', 'styles.playerRatingBadge', 'styles.playerCardMeta']) {
  if (!jsx.includes(token)) fail(`Expected ${token} usage not found in TeamHub.jsx.`);
}

if (!css.includes("TEAM HUB STARTING FIVE RINGS PASS 15")) {
  fail("Pass 15 marker not found in TeamHub.module.css.");
}

for (const token of ['.playerVisual', '.playerRatingBadge', '.playerCardMeta', '.overallBubble']) {
  if (!css.includes(token)) fail(`Expected ${token} style not found in TeamHub.module.css.`);
}

console.log("PASS: Team Hub Starting Five Rings Pass 15 is present.");
