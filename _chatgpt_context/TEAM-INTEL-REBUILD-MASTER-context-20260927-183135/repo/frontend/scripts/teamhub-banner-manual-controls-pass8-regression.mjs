import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const jsx = fs.readFileSync(path.join(root, "src/pages/TeamHub.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/components/TeamHub.module.css"), "utf8");
const config = fs.readFileSync(path.join(root, "src/config/teamHubBannerLayout.js"), "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  !css.includes("TEAM HUB BANNER MAX-FIT IDENTITY PASS 7"),
  "teamhub.pass7.undone",
  "Pass 7 max-fit CSS override has been removed."
);

check(
  jsx.includes('TEAM_HUB_BANNER_LAYOUT as bannerLayout'),
  "teamhub.manual.import",
  "Manual layout config is imported by TeamHub."
);

check(
  config.includes("logo: { x: 0, y: 0, size: 66 }") &&
  config.includes("teamCity: { x: 0, y: 0, size: 16 }") &&
  config.includes("teamName: { x: 0, y: 0, size: 31 }"),
  "teamhub.manual.identity_controls",
  "Logo/city/team-name x/y/size controls exist with Pass 6 defaults."
);

check(
  config.includes("recordLabel") &&
  config.includes("recordValue") &&
  config.includes("recordStanding"),
  "teamhub.manual.record_controls",
  "Record label/value/standing x/y/size controls exist."
);

check(
  config.includes("last10Label") &&
  config.includes("last10Value") &&
  config.includes("last10Subtext"),
  "teamhub.manual.last10_controls",
  "Last 10 label/value/subtext x/y/size controls exist."
);

check(
  jsx.includes("bannerLayout.logo") &&
  jsx.includes("bannerLayout.teamCity") &&
  jsx.includes("bannerLayout.teamName") &&
  jsx.includes("bannerLayout.recordValue") &&
  jsx.includes("bannerLayout.last10Value"),
  "teamhub.manual.wired",
  "Manual controls are wired to the displayed banner elements."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub Manual Controls Pass 8 regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Team Hub Manual Controls Pass 8 regression passed: ${checks.length}/${checks.length} checks.`);
