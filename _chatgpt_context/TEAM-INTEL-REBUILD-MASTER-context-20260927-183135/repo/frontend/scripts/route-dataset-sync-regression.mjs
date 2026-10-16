import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const shell = fs.readFileSync(path.join(root, "src/components/PersistentGameShell.jsx"), "utf8");
const pageFade = fs.readFileSync(path.join(root, "src/components/PageFade.css"), "utf8");
const shellCss = fs.readFileSync(path.join(root, "src/components/PersistentGameShell.module.css"), "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  shell.includes("document.body.dataset.bmRoute = routeKey"),
  "route.body_dataset",
  "PersistentGameShell writes data-bm-route to body."
);

check(
  shell.includes("document.documentElement.dataset.bmRoute = routeKey"),
  "route.html_dataset",
  "PersistentGameShell writes data-bm-route to html."
);

check(
  shell.includes('pathname.replace(/^\\\\/+|\\\\/+$/g, "") || "root"'),
  "route.key_normalization",
  "Route keys normalize /roster-view -> roster-view and /coach-gameplan -> coach-gameplan."
);

check(
  pageFade.includes('body[data-bm-route="roster-view"] .bm-page-fade') &&
  pageFade.includes('body[data-bm-route="coach-gameplan"] .bm-page-fade'),
  "route.pagefade_consumers",
  "Existing route-specific PageFade CSS is present and can now match."
);

check(
  shellCss.includes(':global(body[data-bm-route="roster-view"]) .content') &&
  shellCss.includes(':global(body[data-bm-route="coach-gameplan"]) .content'),
  "route.shell_consumers",
  "Existing route-specific shell CSS is present and can now match."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Route dataset sync regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Route dataset sync regression passed: ${checks.length}/${checks.length} checks.`);
