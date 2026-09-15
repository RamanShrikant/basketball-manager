import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const repo = process.cwd();
const file = path.join(repo, "frontend/src/components/PlayerCardModal.jsx");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(file)) fail("frontend/src/components/PlayerCardModal.jsx was not found.");
const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const hash = crypto.createHash("sha256").update(text).digest("hex");
const expectedHash = "0859f06d4f28c904c73f4abf1f9a85fbf7071ef5caf63f34555fb2a172fa80eb";

if (hash !== expectedHash) fail(`Pass 29 checksum mismatch. Current SHA-256: ${hash}`);

const required = [
  "PLAYER CARD PASS 29: flat roster-style identity header",
  "opacity-[0.055] grayscale",
  "Scoring & Skill",
  "Defense & Rebounding",
  "Physical & IQ",
  "Contract Overview",
  "Salary Breakdown",
  "Rights",
  'activeTab === "trends"',
  'activeTab === "career"',
  'activeTab === "accolades"',
  "buildPlayerCardSeasonRows",
  "getRemainingContractView",
  "isOptionDecisionWindow",
  "getPlayerInjuryStatus",
  "getPlayerExperienceYears",
  "getPlayerDraftYear",
  "getTrendRows",
];

for (const token of required) {
  if (!text.includes(token)) fail(`Required Pass 29/core logic token missing: ${token}`);
}

if (text.includes('{ key: "mood", label: "Mood" }')) fail("Mood tab is still present.");
if (text.includes('activeTab === "mood"')) fail("Mood render surface is still present.");
if (text.includes("localStorage.setItem")) fail("Unexpected localStorage write found in PlayerCardModal.jsx.");
if (text.includes("localStorage.removeItem")) fail("Unexpected localStorage delete found in PlayerCardModal.jsx.");

const hookReturnIndex = text.indexOf("if (!open || !player) return null;");
if (hookReturnIndex < 0) fail("Closed-state return was not found.");
const afterReturn = text.slice(hookReturnIndex);
if (/\buse(?:State|Effect|Memo|Ref|Callback|LayoutEffect)\s*\(/.test(afterReturn)) {
  fail("A React hook appears after the conditional closed-state return.");
}

console.log("PASS: Player Card Pass 29 checksum and visual structure verified.");
console.log("PASS: Mood surface removed while Trends, Career Stats, Accolades, contract, injury, and offseason/history pipelines remain present.");
console.log("PASS: Player Card remains read-only; no localStorage mutation was introduced.");
console.log("PASS: React hook order remains safe around the closed-state return.");
