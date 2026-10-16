import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const jsx = fs.readFileSync(path.join(root, "src/pages/TeamHub.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/components/TeamHub.module.css"), "utf8");
const config = fs.readFileSync(path.join(root, "src/config/teamHubBannerLayout.js"), "utf8");

const checks = [];
const check = (condition, id, detail) => checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  config.includes("watermark: { x:") && jsx.includes("bannerLayout.watermark"),
  "teamhub.manual.watermark",
  "Background watermark has independent manual controls."
);

check(
  config.includes("nextGameBlock: { x:") && jsx.includes("bannerLayout.nextGameBlock"),
  "teamhub.manual.next_game_block",
  "Entire Next Game block can move independently."
);

check(
  config.includes("nextGameLabel:") &&
  config.includes("nextGameValue:") &&
  config.includes("nextGameLogo:") &&
  config.includes("nextGameDate:") &&
  config.includes("nextGameEmpty:"),
  "teamhub.manual.next_game_children",
  "Next Game label/value/logo/date/empty-state controls exist."
);

check(
  jsx.includes("bannerLayout.nextGameLabel") &&
  jsx.includes("bannerLayout.nextGameValue") &&
  jsx.includes("bannerLayout.nextGameLogo") &&
  jsx.includes("bannerLayout.nextGameDate") &&
  jsx.includes("bannerLayout.nextGameEmpty"),
  "teamhub.manual.next_game_wired",
  "All new Next Game controls are wired into TeamHub."
);

check(
  jsx.includes("function bannerWatermarkStyle") &&
  jsx.includes("Math.min(1, Math.max(0") &&
  jsx.includes("Math.max(0.01"),
  "teamhub.manual.watermark_safe",
  "Watermark opacity/scale inputs are safely clamped."
);

check(
  css.includes("TEAM HUB RECORD + LAST10 TYPOGRAPHY PASS 10") &&
  css.includes('"Segoe UI Variable Text"') &&
  css.includes('font-variant-numeric: tabular-nums'),
  "teamhub.metrics.typography",
  "Record/Last10 typography refinement is present without overriding manual font sizes."
);

check(
  config.includes("banner:") &&
  config.includes("identityBlock:") &&
  config.includes("recordBlock:") &&
  config.includes("last10Block:") &&
  config.includes("logo:") &&
  config.includes("teamCity:") &&
  config.includes("teamName:"),
  "teamhub.manual.previous_controls_preserved",
  "Existing Pass 9 manual-control families remain present."
);

check(
  !jsx.includes("initializeScheduleStorage") &&
  !jsx.includes("persistScheduleStructure") &&
  !jsx.includes("cacheScheduleForRuntime"),
  "teamhub.schedule.no_mutation_added",
  "This visual/manual-control pass adds no schedule mutation or regeneration logic."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub Pass 10 regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Team Hub Pass 10 regression passed: ${checks.length}/${checks.length} checks.`);
