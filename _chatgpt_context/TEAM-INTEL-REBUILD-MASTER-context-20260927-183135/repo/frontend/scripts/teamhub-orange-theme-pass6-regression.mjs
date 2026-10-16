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
  css.includes("/* TEAM HUB ORANGE THEME + METRICS MATCH PASS 6 */"),
  "teamhub.pass6.installed",
  "Pass 6 override is installed."
);

check(
  !jsx.includes(`{phaseLabel()}
              <span className={styles.contextChevron}>⌄</span>`),
  "teamhub.topstrip.regular_season_removed",
  "Visible phase item is removed from the top strip."
);

check(
  css.includes("#100b08") &&
  css.includes("#241007") &&
  css.includes("#352318"),
  "teamhub.orange_hue",
  "Dashboard, banner and panels use the dark orange/brown visual family."
);

check(
  css.includes("font-size: 18px") &&
  css.includes("font-size: 9px"),
  "teamhub.metrics.smaller",
  "Record / Last 10 typography is reduced."
);

check(
  css.includes(".heroMetric span,") &&
  css.includes(".heroMetric strong,") &&
  css.includes(".heroMetric small"),
  "teamhub.metrics.same_family",
  "Record / Last 10 share the same typography family."
);

check(
  css.includes("width: 38px") && css.includes("height: 38px"),
  "teamhub.next_game.compact",
  "Next-game opponent logo is compact."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub Pass 6 regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Team Hub Pass 6 regression passed: ${checks.length}/${checks.length} checks.`);
