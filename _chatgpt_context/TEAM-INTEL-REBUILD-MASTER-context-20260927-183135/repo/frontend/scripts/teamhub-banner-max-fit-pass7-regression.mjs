import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const css = fs.readFileSync(path.join(root, "src/components/TeamHub.module.css"), "utf8");

const checks = [];
const check = (condition, id, detail) => checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  css.includes("/* TEAM HUB BANNER MAX-FIT IDENTITY PASS 7 */"),
  "teamhub.pass7.installed",
  "Pass 7 identity sizing override is installed."
);

check(
  css.includes("width: 82px") && css.includes("height: 82px"),
  "teamhub.identity.logo_enlarged",
  "Logo is enlarged to fill more of the banner height."
);

check(
  css.includes("font-size: 18px") && css.includes(".teamCity"),
  "teamhub.identity.city_enlarged",
  "City label is enlarged."
);

check(
  css.includes("font-size: 42px") && css.includes("max-width: 270px"),
  "teamhub.identity.teamname_enlarged",
  "Team name is enlarged while staying inside the pill."
);

check(
  css.includes("padding-top: 8px") && css.includes("padding-bottom: 8px") && css.includes("padding-left: 28px"),
  "teamhub.identity.tight_padding",
  "Identity block uses tighter padding so it nearly hugs the banner edges."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub Pass 7 regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Team Hub Pass 7 regression passed: ${checks.length}/${checks.length} checks.`);
