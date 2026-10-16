import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const results = [];
const check = (id, condition, message) => results.push({ status: condition ? "PASS" : "FAIL", id, message });

const pageFade = read("src/components/PageFade.jsx");
const css = read("src/components/PageFade.css");
const app = read("src/App.jsx");
const teamHub = read("src/pages/TeamHub.jsx");
const teamHubCss = read("src/components/TeamHub.module.css");

check("nav.pathname_key", app.includes("<PageFade key={pathname}>"), "Every pathname change remounts the global transition, including browser Back/Forward.");
check("nav.paint_gate", pageFade.includes("requestAnimationFrame") && pageFade.includes("bm-page-fade--entered"), "Global transition waits for painted frames before starting.");
check("nav.css_transition", css.includes(".bm-page-fade.bm-page-fade--entered") && css.includes("transition:"), "Route fade uses a post-paint CSS transition instead of a mount-time keyframe clock.");
check("nav.team_hub_internal", teamHub.includes("styles.sectionSwapFade") && teamHubCss.includes("bmTeamHubSectionSwapIn"), "Team Hub URL-less category swaps have their own lightweight fade.");

console.table(results);
const failed = results.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`\nNavigation fade regression failed: ${failed.length}/${results.length} checks failed.`);
  process.exit(1);
}
console.log(`\nNavigation fade regression passed: ${results.length}/${results.length} checks.`);
