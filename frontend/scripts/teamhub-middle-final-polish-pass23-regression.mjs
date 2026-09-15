import fs from "node:fs";
import path from "node:path";

const cssPath = path.join(process.cwd(), "frontend/src/components/TeamHub.module.css");
function fail(message) { console.error(`FAIL: ${message}`); process.exit(1); }
if (!fs.existsSync(cssPath)) fail("Could not find frontend/src/components/TeamHub.module.css");
const css = fs.readFileSync(cssPath, "utf8");
const required = [
  "/* TEAM HUB MIDDLE FINAL POLISH PASS 23 */",
  "border-bottom-color: rgba(255,255,255,0.018);",
  "font-weight: 600;",
  "font-variant-numeric: tabular-nums;",
  "rgba(100, 76, 25, 0.43)",
  "transform: scale(0.82);",
  "border-color: rgba(255,255,255,0.052);"
];
for (const token of required) if (!css.includes(token)) fail(`Missing expected token: ${token}`);
console.log("PASS: Team Hub Middle Final Polish Pass 23 is present.");
