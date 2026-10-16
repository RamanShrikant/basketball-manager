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
  !jsx.includes("carouselShell") && !jsx.includes("activeTileIndex"),
  "teamhub.carousel_removed",
  "Legacy Team Hub carousel navigation is gone."
);

check(
  jsx.includes("Upcoming Games") &&
  jsx.includes("Team Overview") &&
  jsx.includes("Standings") &&
  jsx.includes("Starting Five") &&
  jsx.includes("Recent Games") &&
  jsx.includes("Top Prospects") &&
  jsx.includes("League News"),
  "teamhub.sampler_sections",
  "Sampler dashboard section structure is present."
);

check(
  jsx.includes("readScheduleFromStorage") &&
  jsx.includes("loadRegularSeasonResultsV3FromStorage") &&
  jsx.includes("computeCanonicalStandings"),
  "teamhub.real_schedule_standings",
  "Dashboard reads canonical real schedule/results/standings data."
);

check(
  jsx.includes("getPlayerSalary") &&
  jsx.includes("collectOwnedPicksForTeam") &&
  jsx.includes("readUpcomingDraftClassForYear"),
  "teamhub.real_management_data",
  "Payroll, owned picks, and draft preview come from existing game data."
);

check(
  jsx.includes("gameplan_") &&
  jsx.includes("rotationOrder") &&
  jsx.includes("minutes"),
  "teamhub.gameplan_read_only",
  "Starting Five reads the saved gameplan rather than creating a new one."
);

check(
  !jsx.match(/Morale|Fan Interest|Owner Confidence|Franchise Piece|Two-Way Impact|Strengths|Weaknesses/i),
  "teamhub.no_fake_management_metrics",
  "Unsupported management metrics are not fabricated."
);

check(
  jsx.includes("No persisted league headlines yet."),
  "teamhub.no_fake_news",
  "League News uses an explicit empty state instead of invented headlines."
);

check(
  css.includes("#06101b") &&
  css.includes("#6d55bb") &&
  css.includes(".teamBanner") &&
  css.includes(".topGrid"),
  "teamhub.sampler_visual_language",
  "Sampler-inspired navy/purple dashboard styling is installed."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub sampler dashboard regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Team Hub sampler dashboard regression passed: ${checks.length}/${checks.length} checks.`);
