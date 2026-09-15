import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const jsx = fs.readFileSync(path.join(root, "src/pages/TeamHub.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/components/TeamHub.module.css"), "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  !jsx.includes('className={styles.teamEyebrow}'),
  "teamhub.banner.conference_label_removed",
  "Conference eyebrow above the team name is removed."
);

check(
  css.includes('font-family: Arial, "Helvetica Neue", Helvetica, sans-serif') &&
  css.includes("letter-spacing: -0.025em"),
  "teamhub.banner.team_name_typography",
  "Team name uses the sampler-style clean sans typography."
);

check(
  css.includes("rgba(8, 17, 27, 1)") &&
  css.includes("rgba(29, 21, 61, 0.74)"),
  "teamhub.banner.color_balance",
  "Banner uses the darker sampler-style navy with only a restrained purple tint."
);

check(
  css.includes("opacity: 0.045"),
  "teamhub.banner.watermark_subtle",
  "Team watermark is intentionally subtle."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub banner match regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Team Hub banner match regression passed: ${checks.length}/${checks.length} checks.`);
