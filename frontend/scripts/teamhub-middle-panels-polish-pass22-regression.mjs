import fs from "node:fs";
import path from "node:path";

const cssPath = path.join(process.cwd(), "frontend/src/components/TeamHub.module.css");

function fail(message) { console.error(`FAIL: ${message}`); process.exit(1); }
if (!fs.existsSync(cssPath)) fail("Could not find frontend/src/components/TeamHub.module.css");
const css = fs.readFileSync(cssPath, "utf8");

const required = [
  "/* TEAM HUB MIDDLE PANELS POLISH PASS 22 */",
  ".topGrid > .panel",
  "border-bottom-color: rgba(255, 255, 255, 0.026);",
  "Segoe UI Variable Text",
  "font-weight: 610;",
  "rgba(104, 80, 27, 0.50)",
  "grid-auto-rows: 1fr;"
];
for (const token of required) if (!css.includes(token)) fail(`Missing expected token: ${token}`);
console.log("PASS: Team Hub Middle Panels Polish Pass 22 is present.");
