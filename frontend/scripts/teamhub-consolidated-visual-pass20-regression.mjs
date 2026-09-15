import fs from "node:fs";
import path from "node:path";

const repo = process.cwd();
const cssPath = path.join(repo, "frontend/src/components/TeamHub.module.css");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(cssPath)) fail("Could not find frontend/src/components/TeamHub.module.css");
const css = fs.readFileSync(cssPath, "utf8");

const required = [
  "/* TEAM HUB CONSOLIDATED VISUAL PASS 20 */",
  ".teamBanner::before,",
  "content: none !important;",
  ".bannerWatermark {",
  "right: 215px;",
  "width: 430px;",
  "brightness(2.55)",
  ".playerCard .playerPositionBadge {",
  "right: 10px !important;",
  "border-bottom: 4px solid rgba(149, 157, 170, 0.38);"
];

for (const fragment of required) {
  if (!css.includes(fragment)) fail(`Missing expected fragment: ${fragment}`);
}

for (const oldMarker of [
  "TEAM HUB SUBTLE WARM BANNER PASS 13",
  "TEAM HUB PILL EDGE / WARM BALANCE PASS 14",
  "TEAM HUB STARTING FIVE RINGS PASS 15",
  "TEAM HUB STARTING FIVE / BANNER CLEANUP PASS 16",
  "TEAM HUB HEADER / POSITION CLEANUP PASS 17",
  "TEAM HUB WATERMARK / POSITION / EDGE PASS 18",
  "TEAM HUB SOURCE FIX PASS 19"
]) {
  if (css.includes(oldMarker)) fail(`Old stacked override still present: ${oldMarker}`);
}

console.log("PASS: Team Hub Consolidated Visual Pass 20 is authoritative and old override stack is gone.");
