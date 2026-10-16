import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const css = fs.readFileSync(path.join(root, "src/components/TeamHub.module.css"), "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  css.includes("/* TEAM HUB BANNER IDENTITY + METRICS MATCH PASS 5 */"),
  "teamhub.banner.pass5",
  "Pass 5 override is installed."
);

check(
  css.includes("padding-left: 54px"),
  "teamhub.banner.identity_shift",
  "Team identity is moved right."
);

check(
  css.includes("font-size: 31px"),
  "teamhub.banner.team_name_larger",
  "Team nickname uses the larger sampler-like scale."
);

check(
  css.includes("font-size: 20px") &&
  css.includes("font-weight: 600"),
  "teamhub.banner.metrics_smaller",
  "Record / Last 10 values are reduced and softened."
);

check(
  css.includes("width: 40px") &&
  css.includes("height: 40px"),
  "teamhub.banner.next_logo_compact",
  "Next-game opponent logo is compacted."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub Pass 5 regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Team Hub Pass 5 regression passed: ${checks.length}/${checks.length} checks.`);
