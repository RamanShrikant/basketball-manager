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
  css.includes("/* TEAM HUB BANNER HEIGHT SQUEEZE */"),
  "teamhub.banner.squeeze_marker",
  "Banner height squeeze override is installed."
);

check(
  css.includes("min-height: 96px"),
  "teamhub.banner.compact_height",
  "Banner is reduced to a compact 96px height."
);

check(
  css.includes("height: 88px"),
  "teamhub.banner.logo_fit",
  "Team logo remains large while leaving only a few pixels of vertical room."
);

check(
  css.includes("padding-top: 4px") && css.includes("padding-bottom: 4px"),
  "teamhub.banner.tight_padding",
  "Team identity has sampler-like tight top/bottom padding."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub banner height squeeze regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Team Hub banner height squeeze regression passed: ${checks.length}/${checks.length} checks.`);
