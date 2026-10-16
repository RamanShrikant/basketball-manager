import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const repo = process.cwd();
const file = path.join(repo, "frontend/src/components/PlayerCardModal.jsx");
const EXPECTED = "72c26f8a4da928fb9f399a6d9050fb40bba85bc5d2de5b03593d002c6128fb55";

function fail(message) { console.error(`FAIL: ${message}`); process.exit(1); }
function normalize(text) { return text.replace(/\r\n/g, "\n"); }

if (!fs.existsSync(file)) fail("frontend/src/components/PlayerCardModal.jsx was not found.");
const text = normalize(fs.readFileSync(file, "utf8"));
const hash = crypto.createHash("sha256").update(text).digest("hex");
if (hash !== EXPECTED) fail(`Pass 29.1 checksum mismatch. Current SHA-256: ${hash}`);

const required = [
  "PASS 29.1: critical geometry lives in plain CSS",
  "pc29-card",
  "pc29-hero",
  "pc29-portrait-zone",
  "pc29-watermark",
  "pc29-attribute-row",
  "Attributes vs League Average",
  "ATTRIBUTE_DISPLAY_NAMES",
  "pc29-contract-grid",
  "Salary Table",
  "RuntimePlayerPortrait",
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
for (const token of required) if (!text.includes(token)) fail(`Required Pass 29.1/core token missing: ${token}`);

if (text.includes('{ key: "mood", label: "Mood" }')) fail("Mood tab is present.");
if (text.includes('activeTab === "mood"')) fail("Mood render surface is present.");
if (text.includes("localStorage.setItem")) fail("Unexpected localStorage write found.");
if (text.includes("localStorage.removeItem")) fail("Unexpected localStorage delete found.");

const hookReturnIndex = text.indexOf("if (!open || !player) return null;");
if (hookReturnIndex < 0) fail("Closed-state return was not found.");
if (/\buse(?:State|Effect|Memo|Ref|Callback|LayoutEffect)\s*\(/.test(text.slice(hookReturnIndex))) {
  fail("A React hook appears after the conditional closed-state return.");
}

console.log("PASS: Player Card Pass 29.1 emergency repair is installed.");
console.log("PASS: Header/portrait/attributes/contract geometry uses stable component CSS instead of fragile new arbitrary Tailwind layout classes.");
console.log("PASS: Mood remains removed; Trends, Career Stats, Accolades, contract, injury, and season-history pipelines remain present.");
console.log("PASS: Player Card remains read-only and React hook order remains safe.");
