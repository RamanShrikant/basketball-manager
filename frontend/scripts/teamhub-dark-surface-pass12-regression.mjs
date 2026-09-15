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
  css.includes("/* TEAM HUB DARK SAMPLER SURFACE PASS 12 */"),
  "teamhub.pass12.installed",
  "Pass 12 surface override is installed."
);

check(
  css.includes("#08090b") && css.includes("#060709"),
  "teamhub.surface.neutral_dark",
  "Main Team Hub canvas uses neutral black/charcoal instead of navy."
);

check(
  css.includes("rgba(78, 28, 7, 0.92)") &&
  css.includes("rgba(214, 92, 26, 0.30)"),
  "teamhub.banner.orange_surface",
  "Top team pill has the requested restrained orange treatment."
);

check(
  css.includes(".heroMetric span,") &&
  css.includes('font-family: Inter, ui-sans-serif') &&
  css.includes("font-weight: 650"),
  "teamhub.metrics.sampler_typography",
  "Record and Last 10 share the cleaner sampler-like type family/weights."
);

check(
  !jsx.includes("<span>League Rank</span>") &&
  !jsx.includes("<span>1st Round Picks</span>"),
  "teamhub.overview.trimmed",
  "League Rank and 1st Round Picks are removed from Team Overview."
);

check(
  css.includes("@media (min-width: 1181px)") &&
  css.includes(".topGrid > .panel") &&
  css.includes("height: 100%"),
  "teamhub.toprow.equal_height",
  "Three top-row dashboard panels are forced to equal height."
);

check(
  css.includes(':global(body.th-no-scroll) :global([class*="sidebar"])') &&
  css.includes("#0b0c0e"),
  "teamhub.sidebar.cooled",
  "Persistent sidebar ambient orange wash is cooled on Team Hub."
);

check(
  config.includes("TEAM_HUB_BANNER_LAYOUT"),
  "teamhub.manual_config.exists",
  "Manual Team Hub banner tuning file is still present."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub Pass 12 regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Team Hub Pass 12 regression passed: ${checks.length}/${checks.length} checks.`);
