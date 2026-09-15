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
  jsx.includes("className={styles.topUtilities}") &&
  jsx.includes('placeholder="Search players, teams, etc..."') &&
  jsx.includes("className={styles.bellButton}") &&
  jsx.includes("className={styles.avatarControl}"),
  "teamhub.topstrip.sampler_controls",
  "Sampler-style search, bell and avatar are present."
);

check(
  jsx.includes('aria-label="Control team"') &&
  jsx.includes("setSelectedTeam(next)"),
  "teamhub.topstrip.team_switch_preserved",
  "Controlled-team switching remains available through the avatar control."
);

check(
  css.includes(".topBar {") &&
  css.includes("min-height: 34px") &&
  css.includes("padding-top: 6px"),
  "teamhub.topstrip.shorter",
  "Global top strip is intentionally shorter."
);

check(
  css.includes("width: 292px") &&
  css.includes("height: 32px") &&
  css.includes("background: #101a28"),
  "teamhub.topstrip.search_match",
  "Search shell dimensions and tone track the sampler."
);

check(
  css.includes("font-size: 25px") &&
  css.includes("font-weight: 650") &&
  css.includes("border-left: 1px solid rgba(130, 145, 165, 0.22)"),
  "teamhub.banner.record_last10_match",
  "Record / Last 10 values and dividers are recalibrated."
);

check(
  css.includes("#120a2b") &&
  css.includes("#07101a") &&
  css.includes("opacity: 0.018"),
  "teamhub.banner.dark_balance",
  "Banner has a much weaker purple tint and subtler watermark."
);

check(
  jsx.includes("className={styles.teamCity}") &&
  css.includes("font-size: 31px") &&
  css.includes("width: 128px"),
  "teamhub.banner.identity_balance",
  "Team identity proportions remain sampler-like."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub top-strip + banner Pass 3 regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Team Hub top-strip + banner Pass 3 regression passed: ${checks.length}/${checks.length} checks.`);
