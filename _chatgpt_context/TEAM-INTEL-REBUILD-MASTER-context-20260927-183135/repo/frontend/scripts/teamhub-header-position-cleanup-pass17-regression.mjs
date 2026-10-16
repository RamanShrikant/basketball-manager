import fs from "node:fs";
import path from "node:path";

const cssPath = path.join(process.cwd(), "src/components/TeamHub.module.css");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(cssPath)) {
  fail("Could not find src/components/TeamHub.module.css");
}

const css = fs.readFileSync(cssPath, "utf8");

const requiredFragments = [
  "/* TEAM HUB HEADER / POSITION CLEANUP PASS 17 */",
  ".teamBanner {",
  "rgba(88, 43, 23, 0.34)",
  ".bannerWatermark {",
  "opacity: 0.026;",
  ".playerPositionBadge {",
  "border: none;",
  "background: transparent;",
  "right: 10px;",
  ".playerVisual {",
  "border-bottom: 3px solid rgba(144, 152, 164, 0.34);"
];

for (const fragment of requiredFragments) {
  if (!css.includes(fragment)) {
    fail(`Missing expected fragment: ${fragment}`);
  }
}

console.log("PASS: Team Hub Header / Position Cleanup Pass 17 is present.");
