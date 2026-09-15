import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const cssPath = path.join(root, "frontend/src/components/TeamHub.module.css");
const configPath = path.join(root, "frontend/src/config/teamHubBannerLayout.js");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(cssPath)) fail("Could not find frontend/src/components/TeamHub.module.css");
if (!fs.existsSync(configPath)) fail("Could not find frontend/src/config/teamHubBannerLayout.js");

const css = fs.readFileSync(cssPath, "utf8");
const config = fs.readFileSync(configPath, "utf8");

const requiredCss = [
  "/* TEAM HUB SOURCE FIX PASS 19 */",
  ".playerCard .playerPositionBadge {",
  "position: absolute !important;",
  "right: 10px !important;",
  "left: auto !important;",
  ".bannerWatermark {",
  "width: 330px;",
  "brightness(1.72)",
  ".teamBanner::after {",
  "box-shadow: none !important;",
  "border-bottom: 4px solid rgba(150, 158, 170, 0.40);"
];

for (const fragment of requiredCss) {
  if (!css.includes(fragment)) fail(`Missing expected CSS fragment: ${fragment}`);
}

const requiredManualValues = [
  "banner: { height: 80 }",
  "logo: { x: 40, y: 0, size: 73 }",
  "teamCity: { x: 40, y: 0, size: 23 }",
  "teamName: { x: 40, y: 0, size: 39 }",
  "watermark: { x: 70, y: 0, scale: 1, opacity: 0.038, rotation: -5 }"
];

for (const fragment of requiredManualValues) {
  if (!config.includes(fragment)) fail(`Manual banner setting changed or missing: ${fragment}`);
}

console.log("PASS: Team Hub Source Fix Pass 19 is present and manual banner settings are preserved.");
