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
  css.includes("/* TEAM HUB BANNER PROPORTION MATCH PASS 4 */"),
  "teamhub.banner.pass4",
  "Pass 4 override is installed."
);

check(
  css.includes("grid-template-columns: 30% 13% 17% 40%"),
  "teamhub.banner.sampler_columns",
  "Banner horizontal sections use sampler-like proportions."
);

check(
  css.includes("width: 70px") && css.includes("height: 70px"),
  "teamhub.banner.logo_reduced",
  "Team logo is reduced to align with city+nickname height."
);

check(
  css.includes("min-height: 84px"),
  "teamhub.banner.height_reduced",
  "Banner is compacted further."
);

check(
  css.includes("font-size: 22px") &&
  css.includes("font-size: 18px") &&
  css.includes("font-size: 12px"),
  "teamhub.banner.type_scale",
  "Record/Last 10, Next Game, and date typography is recalibrated."
);

check(
  css.includes("width: 42px") && css.includes("height: 42px"),
  "teamhub.banner.opponent_logo",
  "Next-game opponent logo is sampler-sized."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub banner proportion Pass 4 regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Team Hub banner proportion Pass 4 regression passed: ${checks.length}/${checks.length} checks.`);
