import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const cssPath = path.join(root, "src/components/TeamHub.module.css");
const configPath = path.join(root, "src/config/teamHubBannerLayout.js");

const css = fs.readFileSync(cssPath, "utf8");
const config = fs.readFileSync(configPath, "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  css.includes("/* TEAM HUB SAMPLER SURFACE PASS 11 */"),
  "teamhub.surface.pass11",
  "Surface pass is installed."
);

check(
  css.includes("#07111b") &&
  css.includes("#07101a") &&
  css.includes("#050c14"),
  "teamhub.surface.cool_background",
  "Dashboard is back to cool blue-black instead of a global brown wash."
);

check(
  css.includes("border-color: rgba(105, 132, 164, 0.20)") &&
  css.includes("rgba(129, 151, 178, 0.11)"),
  "teamhub.surface.subtle_borders",
  "Panel borders/dividers are subtle blue-grey."
);

check(
  css.includes("background: #f97316") ||
  css.includes("background: #f97316;"),
  "teamhub.surface.orange_accent_only",
  "BM orange remains as an accent."
);

check(
  css.includes('font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;') &&
  css.includes("font-weight: 650"),
  "teamhub.surface.clean_typography",
  "Dashboard typography is normalized toward the sampler."
);

check(
  css.includes("rgba(111, 83, 20, 0.66)") &&
  css.includes("color: #f6efd7"),
  "teamhub.surface.muted_standing_highlight",
  "Selected standings row uses muted gold instead of orange-brown."
);

check(
  css.includes(".nextGame span") &&
  css.includes("color: #b694ee"),
  "teamhub.surface.next_game_lavender",
  "Next Game label gets the sampler-like lavender cue."
);

/* Protect the exact manual tuning values the user supplied. */
const requiredConfigFragments = [
  "banner: { height: 80 }",
  "logo: { x: 40, y: 0, size: 73 }",
  "teamCity: { x: 40, y: 0, size: 23 }",
  "teamName: { x: 40, y: 0, size: 39 }",
  "recordBlock: { x: 10, y: 0 }",
  "recordLabel: { x: 10, y: 0, size: 9 }",
  "recordValue: { x: 10, y: 0, size: 18 }",
  "recordStanding: { x: 10, y: 0, size: 9 }",
  "last10Block: { x: 15, y: 0 }",
  "last10Label: { x: 15, y: 0, size: 9 }",
  "last10Value: { x: 15, y: 0, size: 18 }",
  "last10Subtext: { x: 0, y: 0, size: 9 }",
  "watermark: { x: 70, y: 0, scale: 1, opacity: 0.038, rotation: -5 }",
  "nextGameBlock: { x: 0, y: 0 }",
  "nextGameLabel: { x: -20, y: 0, size: 15 }",
  "nextGameValue: { x: 0, y: 0, size: 16 }",
  "nextGameLogo: { x: -15, y: 0, size: 98 }",
  "nextGameDate: { x: 0, y: 0, size: 10 }",
  "nextGameEmpty: { x: 0, y: 0, size: 10 }",
];

check(
  requiredConfigFragments.every((fragment) => config.includes(fragment)),
  "teamhub.surface.manual_settings_preserved",
  "User's current banner manual settings remain present exactly."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub Surface Pass 11 regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Team Hub Surface Pass 11 regression passed: ${checks.length}/${checks.length} checks.`);
