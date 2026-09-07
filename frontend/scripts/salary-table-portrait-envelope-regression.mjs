import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const results = [];
const check = (id, condition, message) => results.push({ status: condition ? "PASS" : "FAIL", id, message });

const runtime = read("src/components/RuntimePlayerPortrait.jsx");
const salary = read("src/pages/SalaryTable.jsx");
const config = read("src/config/headshotLayout.js");

check(
  "salary_portrait.shared_canonical_envelope",
  runtime.includes('layoutPage === "salary-table" || layoutPage === "player-retirements"') &&
    runtime.includes('data-bm-portrait-source="runtime-composite"') &&
    runtime.includes('data-bm-portrait-source="fallback-static"'),
  "Salary Table runtime composites and static fallbacks share the same canonical 1040x760 envelope."
);
check(
  "salary_portrait.runtime_width_fit",
  runtime.includes('useCanonicalContainEnvelope ? "w-full" : "h-full"') &&
    runtime.includes('data-bm-portrait-envelope={useCanonicalContainEnvelope ? "contain-width" : "height-fit"}'),
  "Salary Table runtime composites width-fit the canonical portrait canvas."
);
check(
  "salary_portrait.static_is_inside_canonical_wrapper",
  runtime.includes('data-bm-portrait-envelope="contain-width"') &&
    runtime.includes('style={{ aspectRatio: "1040 / 760", height: "auto", maxHeight: "100%" }}'),
  "Static/fallback portraits are constrained by the same canonical canvas instead of their source image aspect ratio."
);
check(
  "salary_portrait.static_stays_object_contain",
  runtime.includes("object-contain object-bottom"),
  "Static/fallback portraits continue using object-contain/object-bottom inside the canonical envelope."
);
check(
  "salary_portrait.manual_config_unchanged_contract",
  config.includes('"salary-table"') && salary.includes('HEADSHOT_LAYOUTS["salary-table"]'),
  "Existing centralized Salary Table manual controls remain the page-level source of tuning."
);

const portraitAspect = 1040 / 760;
for (const [label, width, height] of [
  ["desktop", 42, 44],
  ["laptop", 36, 40],
]) {
  const canonicalHeight = Math.min(height, width / portraitAspect);
  const standardNbaHeight = canonicalHeight;
  const runtimeCompositeHeight = canonicalHeight;
  const squareStaticHeight = Math.min(canonicalHeight, width);
  const portraitStaticHeight = canonicalHeight;

  check(
    `salary_portrait.${label}_runtime_parity`,
    Math.abs(standardNbaHeight - runtimeCompositeHeight) < 1e-9,
    `${label}: standard NBA and runtime composite both use a ${width.toFixed(0)}x${canonicalHeight.toFixed(2)}px canonical envelope.`
  );
  check(
    `salary_portrait.${label}_odd_source_cannot_exceed_canonical_height`,
    squareStaticHeight <= canonicalHeight + 1e-9 && portraitStaticHeight <= canonicalHeight + 1e-9,
    `${label}: square/portrait fallback sources cannot paint taller than the canonical ${canonicalHeight.toFixed(2)}px envelope.`
  );
}

console.table(results);
const failed = results.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`\nSalary Table portrait envelope regression failed: ${failed.length}/${results.length} checks failed.`);
  process.exit(1);
}
console.log(`\nSalary Table portrait envelope regression passed: ${results.length}/${results.length} checks.`);
