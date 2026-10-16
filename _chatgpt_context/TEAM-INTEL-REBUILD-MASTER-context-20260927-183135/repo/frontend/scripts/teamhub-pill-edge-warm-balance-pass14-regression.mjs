import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(process.cwd(), "..");
const cssPath = path.join(repo, "src/components/TeamHub.module.css");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(cssPath)) fail("frontend/src/components/TeamHub.module.css not found from frontend directory.");

const css = fs.readFileSync(cssPath, "utf8");

if (!css.includes("TEAM HUB PILL EDGE / WARM BALANCE PASS 14")) {
  fail("Pass 14 marker not found in TeamHub.module.css");
}

if (!css.includes(".teamBanner::before") || !css.includes(".teamBanner::after")) {
  fail("Expected pill edge refinement pseudo-elements were not found.");
}

if (!css.includes("filter: saturate(0.20) brightness(0.50) contrast(0.95);")) {
  fail("Expected watermark refinement was not found.");
}

console.log("PASS: Team Hub Pill Edge / Warm Balance Pass 14 is present.");
