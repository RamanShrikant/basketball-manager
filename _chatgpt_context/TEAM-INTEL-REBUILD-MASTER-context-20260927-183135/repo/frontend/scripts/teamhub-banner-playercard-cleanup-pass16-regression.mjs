import fs from "node:fs";
import path from "node:path";

const repo = process.cwd();
const jsxPath = path.join(repo, "src/pages/TeamHub.jsx");
const cssPath = path.join(repo, "src/components/TeamHub.module.css");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

for (const file of [jsxPath, cssPath]) {
  if (!fs.existsSync(file)) fail(`Missing file: ${file}`);
}

const jsx = fs.readFileSync(jsxPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

if (!jsx.includes("playerPositionBadge")) fail("playerPositionBadge markup not found in TeamHub.jsx");
if (!css.includes("TEAM HUB STARTING FIVE / BANNER CLEANUP PASS 16")) fail("Pass 16 CSS marker missing");
if (!css.includes(".playerPositionBadge")) fail("playerPositionBadge styles missing");
if (!css.includes("border-bottom: 2px solid rgba(160, 168, 180, 0.30);")) fail("Thicker portrait/name divider not found");
if (!css.includes("rgba(124, 56, 28, 0.16)")) fail("Expected softened warm pill treatment not found");

console.log("PASS: Team Hub Pass 16 regression checks succeeded.");
