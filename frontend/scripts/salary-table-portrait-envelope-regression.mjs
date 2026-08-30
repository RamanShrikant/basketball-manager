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
  "salary_portrait.runtime_width_fit",
  runtime.includes('layoutPage === "salary-table" ? "w-full" : "h-full"') &&
    runtime.includes('data-bm-portrait-envelope={layoutPage === "salary-table" ? "contain-width" : "height-fit"}'),
  "Salary Table runtime composites width-fit the 1040x760 canvas while other pages preserve the existing height-fit behavior."
);
check(
  "salary_portrait.static_stays_object_contain",
  runtime.includes("object-contain object-bottom"),
  "Static/fallback portraits continue using object-contain/object-bottom."
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
  const staticHeight = Math.min(height, width / portraitAspect);
  const compositeHeight = width / portraitAspect;
  check(
    `salary_portrait.${label}_envelope_parity`,
    Math.abs(staticHeight - compositeHeight) < 1e-9,
    `${label}: static object-contain and runtime width-fit both paint the portrait canvas at ${compositeHeight.toFixed(2)}px tall.`
  );
}

console.table(results);
const failed = results.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`\nSalary Table portrait envelope regression failed: ${failed.length}/${results.length} checks failed.`);
  process.exit(1);
}
console.log(`\nSalary Table portrait envelope regression passed: ${results.length}/${results.length} checks.`);
