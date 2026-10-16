import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const jsx = fs.readFileSync(path.join(root, "src/pages/TeamHub.jsx"), "utf8");
const config = fs.readFileSync(path.join(root, "src/config/teamHubBannerLayout.js"), "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  config.includes("banner: { height: 84 }") &&
  jsx.includes("style={bannerBoxStyle(bannerLayout.banner)}"),
  "teamhub.manual.banner_height",
  "Banner pill height is manually controllable and wired."
);

check(
  config.includes("identityBlock: { x: 0, y: 0 }") &&
  jsx.includes("bannerLayout.identityBlock"),
  "teamhub.manual.identity_block",
  "Entire logo/city/team-name block can move as one group."
);

check(
  config.includes("recordBlock: { x: 0, y: 0 }") &&
  jsx.includes("bannerLayout.recordBlock"),
  "teamhub.manual.record_block",
  "Entire Record block can move while child controls stay independent."
);

check(
  config.includes("last10Block: { x: 0, y: 0 }") &&
  jsx.includes("bannerLayout.last10Block"),
  "teamhub.manual.last10_block",
  "Entire Last 10 block can move while child controls stay independent."
);

check(
  jsx.includes("bannerLayout.logo") &&
  jsx.includes("bannerLayout.teamCity") &&
  jsx.includes("bannerLayout.teamName"),
  "teamhub.manual.identity_children",
  "Logo, city, and team-name individual controls remain wired."
);

check(
  jsx.includes("bannerLayout.recordLabel") &&
  jsx.includes("bannerLayout.recordValue") &&
  jsx.includes("bannerLayout.recordStanding"),
  "teamhub.manual.record_children",
  "Record label/value/standing individual controls remain wired."
);

check(
  jsx.includes("bannerLayout.last10Label") &&
  jsx.includes("bannerLayout.last10Value") &&
  jsx.includes("bannerLayout.last10Subtext"),
  "teamhub.manual.last10_children",
  "Last 10 label/value/subtext individual controls remain wired."
);

check(
  jsx.includes("Number.isFinite(height) && height > 0") &&
  jsx.includes("Number.isFinite(x) ? x : 0") &&
  jsx.includes("Number.isFinite(y) ? y : 0"),
  "teamhub.manual.safe_values",
  "Bad manual values fall back safely rather than poisoning inline CSS."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub Manual Controls Pass 9 regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Team Hub Manual Controls Pass 9 regression passed: ${checks.length}/${checks.length} checks.`);
