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
  jsx.includes("function splitTeamIdentity") &&
  jsx.includes("className={styles.teamCity}") &&
  jsx.includes("teamIdentity.nickname"),
  "teamhub.banner.city_nickname_split",
  "Team identity is displayed as city above nickname."
);

check(
  !jsx.includes('className={styles.teamEyebrow}'),
  "teamhub.banner.no_conference_eyebrow",
  "EAST/West conference eyebrow remains removed."
);

check(
  css.includes('.teamCity {') &&
  css.includes('font-size: 17px') &&
  css.includes('font-size: 30px'),
  "teamhub.banner.wordmark_hierarchy",
  "City and nickname use distinct sampler-style hierarchy."
);

check(
  css.includes('.heroMetric span,') &&
  css.includes('font-size: 24px') &&
  css.includes('font-weight: 700'),
  "teamhub.banner.record_typography",
  "Record and Last 10 values use cleaner sampler-like typography."
);

check(
  css.includes('#170d35') &&
  css.includes('#08111b'),
  "teamhub.banner.darker_palette",
  "Banner purple is restrained and transitions quickly into near-black navy."
);

check(
  css.includes('width: 118px') &&
  css.includes('gap: 20px'),
  "teamhub.banner.logo_wordmark_spacing",
  "Logo and team wordmark proportions are recalibrated."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub banner match Pass 2 regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Team Hub banner match Pass 2 regression passed: ${checks.length}/${checks.length} checks.`);
