#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(frontendRoot, "..");

function argValue(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function readRel(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const outputDir = path.resolve(repoRoot, argValue("--output", "PATCH58_guard_audit"));
fs.mkdirSync(outputDir, { recursive: true });

const progression = readRel("frontend/public/python/progression.py");
const tradeImpact = readRel("frontend/src/utils/tradeTeamImpact.js");
const batchAudit = readRel("frontend/scripts/progression-batch-audit.py");
const cpuTradeGenerator = readRel("frontend/public/python/cpu_cpu_trade_logic.py");

const checks = [];
function check(name, ok, details) {
  checks.push({ check: name, status: ok ? "PASS" : "FAIL", details });
}

check(
  "Progression version marker",
  progression.includes('PROGRESSION_PY_VERSION = "2026-09-01_progression_jump7_young_takeover_v6"'),
  "Confirms PATCH58 progression file is active."
);
check(
  "Rare +7 lane present",
  progression.includes("hi = 7") && progression.includes("PATCH58: rare +7 lane"),
  "The +7 cap exists only in the hidden-path young-takeover block."
);
check(
  "Young catch-up pressure present",
  progression.includes("_v25_young_takeover_catchup_pressure") && progression.includes("behind schedule"),
  "Young elite paths can receive hidden catch-up pressure when behind their expected curve."
);
check(
  "Jump distribution audit present",
  batchAudit.includes("progression_jump_distribution.csv") && batchAudit.includes("age25underPlus5plus"),
  "Progression audit now writes yearly +4/+5/+6/+7 jump distribution data."
);
check(
  "CPU-to-CPU-only market smoothing present",
  tradeImpact.includes("CPU_CPU_NON_MEGA_BUYER_RELIEF_BY_PHASE") && tradeImpact.includes("CPU_CPU_NON_MEGA_SELLER_RELIEF_BY_PHASE"),
  "CPU-to-CPU evaluator has phase-based non-mega relief constants."
);
check(
  "Mega trades excluded from new smoothing",
  tradeImpact.includes("isCpuCpuEvaluation && !cpuCpuDebugMarksMegaTrade") && tradeImpact.includes("cpuCpuDebugMarksMegaTrade"),
  "New market smoothing explicitly skips candidates marked as megaTrade."
);
check(
  "User trade mode isolated",
  tradeImpact.includes('String(evaluationMode || "").toLowerCase() === "cpu_cpu_trade"') && tradeImpact.includes("manual/user trade standards remain stricter"),
  "New smoothing only runs through evaluationMode=cpu_cpu_trade, not normal Propose Trade."
);
check(
  "Trade Finder fast-scan untouched",
  tradeImpact.includes('String(cpuTradeRole || "").toLowerCase() === "trade_finder"') && !tradeImpact.includes("CPU_CPU_NON_MEGA_BUYER_RELIEF_BY_PHASE, buyerPhase) : cpuCpuPhaseRelief(CPU_CPU_NON_MEGA_BUYER_RELIEF_BY_PHASE, 'trade_finder'"),
  "Trade Finder keeps its separate role/mode path and does not use PATCH58 CPU-to-CPU relief."
);
check(
  "CPU trade generator untouched by PATCH58 marker",
  !cpuTradeGenerator.includes("PATCH58") && cpuTradeGenerator.includes("MEGA_TRADE_TARGET_OVR"),
  "This script confirms PATCH58 did not add generator/mega-trade code markers."
);

const rows = ["check,status,details", ...checks.map(r => [r.check, r.status, r.details].map(csvEscape).join(","))];
fs.writeFileSync(path.join(outputDir, "patch58_guard_audit.csv"), rows.join("\n") + "\n", "utf8");
const summary = {
  ok: checks.every(r => r.status === "PASS"),
  pass: checks.filter(r => r.status === "PASS").length,
  fail: checks.filter(r => r.status === "FAIL").length,
  output: path.join(outputDir, "patch58_guard_audit.csv"),
  checks,
};
fs.writeFileSync(path.join(outputDir, "patch58_guard_audit.json"), JSON.stringify(summary, null, 2), "utf8");
console.log(`PATCH58 guard audit: ${summary.pass} PASS, ${summary.fail} FAIL`);
console.log(`wrote ${path.relative(repoRoot, outputDir)}`);
process.exit(summary.ok ? 0 : 1);
