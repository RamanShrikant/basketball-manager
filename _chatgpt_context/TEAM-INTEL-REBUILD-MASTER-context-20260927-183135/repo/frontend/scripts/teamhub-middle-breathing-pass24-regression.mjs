import fs from "node:fs";
import path from "node:path";

const cssPath = path.join(process.cwd(), "frontend/src/components/TeamHub.module.css");
function fail(message) { console.error(`FAIL: ${message}`); process.exit(1); }
if (!fs.existsSync(cssPath)) fail("Could not find frontend/src/components/TeamHub.module.css");
const css = fs.readFileSync(cssPath, "utf8");
const required = [
  "/* TEAM HUB MIDDLE BREATHING / TYPOGRAPHY PASS 24 */",
  "font-size: 15.4px;",
  "font-size: 10.9px;",
  "font-size: 11.1px;",
  "height: 134px;",
  "min-height: 96px;",
  "font-size: 10.5px;"
];
for (const token of required) if (!css.includes(token)) fail(`Missing expected token: ${token}`);
console.log("PASS: Team Hub Middle Breathing / Typography Pass 24 is present.");
