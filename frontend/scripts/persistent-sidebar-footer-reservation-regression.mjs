import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const css = fs.readFileSync(path.join(root, "src/styles/BMResponsiveDensity.css"), "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  css.includes("--bm-footer-height: 48px;") &&
  css.includes("--bm-route-height: calc(100dvh - var(--bm-footer-height));"),
  "footer.legacy_defaults_preserved",
  "Legacy footer-height defaults remain intact for non-sidebar routes."
);

check(
  css.includes("/* PERSISTENT_SIDEBAR_REMOVES_LEGACY_FOOTER_RESERVATION */"),
  "footer.fix_marker",
  "Persistent-sidebar footer-reservation fix is installed."
);

check(
  css.includes("body.bm-persistent-sidebar-active") &&
  css.includes("--bm-footer-height: 0px;") &&
  css.includes("--bm-route-height: 100dvh;"),
  "footer.sidebar_uses_full_viewport",
  "Persistent-sidebar routes no longer reserve the hidden 48px bottom footer."
);

check(
  css.includes(".bmGlobalRouteNav"),
  "footer.legacy_nav_preserved",
  "Legacy footer navigation CSS remains available where still used."
);

console.table(checks);

const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Persistent-sidebar footer regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Persistent-sidebar footer regression passed: ${checks.length}/${checks.length} checks.`);
