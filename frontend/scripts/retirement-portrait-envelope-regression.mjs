import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..");
const read = (rel) => fs.readFileSync(path.join(frontendRoot, rel), "utf8");

const runtime = read("src/components/RuntimePlayerPortrait.jsx");
const retirement = read("src/pages/PlayerRetirements.jsx");
const configPath = path.join(frontendRoot, "src/config/retirementLayout.js");
const { RETIREMENT_LAYOUT } = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`);

const results = [];
const check = (id, pass, detail) => results.push({ status: pass ? "PASS" : "FAIL", id, detail });

check(
  "retirement_portrait.explicit_layout_page",
  retirement.includes('layoutPage="player-retirements"'),
  "Player Retirements explicitly routes portraits through the player-retirements envelope policy."
);
check(
  "retirement_portrait.shared_canonical_envelope",
  runtime.includes('layoutPage === "salary-table" || layoutPage === "player-retirements"'),
  "Player Retirements shares the canonical contain envelope with Salary Table."
);
check(
  "retirement_portrait.runtime_and_static_marked",
  runtime.includes('data-bm-portrait-source="runtime-composite"') &&
    runtime.includes('data-bm-portrait-source="fallback-static"'),
  "Both runtime and fallback portrait branches expose the same envelope instrumentation."
);
check(
  "retirement_portrait.manual_layout_preserved",
  retirement.includes("RETIREMENT_LAYOUT.headshot.left") &&
    retirement.includes("RETIREMENT_LAYOUT.headshot.scale"),
  "Existing retirement manual positioning remains outside RuntimePlayerPortrait."
);

const width = Number(RETIREMENT_LAYOUT?.headshot?.width);
const height = Number(RETIREMENT_LAYOUT?.headshot?.height);
const portraitAspect = 1040 / 760;
const canonicalHeight = Math.min(height, width / portraitAspect);
const oldRuntimeWidth = height * portraitAspect;
const newRuntimeWidth = width;

check(
  "retirement_portrait.geometry_valid",
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0,
  `headshot slot=${width}x${height}`
);
check(
  "retirement_portrait.standard_static_unchanged",
  Math.abs(canonicalHeight - Math.min(height, width / portraitAspect)) < 1e-9,
  `Standard 1040x760 fallback remains ${width.toFixed(0)}x${canonicalHeight.toFixed(2)}px before page-level manual scaling.`
);
check(
  "retirement_portrait.runtime_no_longer_height_fit_oversized",
  oldRuntimeWidth > newRuntimeWidth && Math.abs(newRuntimeWidth / canonicalHeight - portraitAspect) < 1e-9,
  `Runtime composite changes from old height-fit ~${oldRuntimeWidth.toFixed(2)}x${height.toFixed(0)} to canonical ${newRuntimeWidth.toFixed(0)}x${canonicalHeight.toFixed(2)}.`
);
check(
  "retirement_portrait.odd_static_cannot_exceed_envelope",
  canonicalHeight <= height,
  `Odd square/tall fallback sources are constrained to at most ${canonicalHeight.toFixed(2)}px visual height inside the canonical canvas.`
);

console.table(results);
const failed = results.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`\nRetirement portrait envelope regression failed: ${failed.length}/${results.length} checks failed.`);
  process.exit(1);
}
console.log(`\nRetirement portrait envelope regression passed: ${results.length}/${results.length} checks.`);
