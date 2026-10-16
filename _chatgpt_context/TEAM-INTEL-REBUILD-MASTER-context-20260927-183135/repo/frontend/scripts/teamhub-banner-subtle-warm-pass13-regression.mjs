import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const css = fs.readFileSync(path.join(root, "src/components/TeamHub.module.css"), "utf8");
const config = fs.readFileSync(path.join(root, "src/config/teamHubBannerLayout.js"), "utf8");

const checks = [];
const check = (condition, id, detail) =>
  checks.push({ status: condition ? "PASS" : "FAIL", id, detail });

check(
  css.includes("/* TEAM HUB SUBTLE WARM BANNER PASS 13 */"),
  "teamhub.banner.pass13",
  "Pass 13 banner override is installed."
);

check(
  css.includes("rgba(115, 43, 9, 0.22)") &&
  css.includes("transparent 48%"),
  "teamhub.banner.soft_left_tint",
  "Warm tint is localized and fades out early."
);

check(
  css.includes("#0d0f12") &&
  css.includes("#0a0d11") &&
  css.includes("#090b0e"),
  "teamhub.banner.neutral_dark",
  "Most of the banner surface is neutral black/charcoal."
);

check(
  css.includes("border-color: rgba(214, 92, 26, 0.15)"),
  "teamhub.banner.soft_border",
  "Banner border is intentionally subtle."
);

check(
  css.includes("saturate(0.28)") &&
  css.includes("brightness(0.64)"),
  "teamhub.banner.watermark_understated",
  "Watermark remains dark and low-saturation."
);

check(
  config.includes("TEAM_HUB_BANNER_LAYOUT"),
  "teamhub.banner.manual_config_present",
  "Manual banner config remains present."
);

console.table(checks);
const failed = checks.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`Team Hub Pass 13 regression failed: ${failed.length}/${checks.length} checks.`);
  process.exit(1);
}
console.log(`Team Hub Pass 13 regression passed: ${checks.length}/${checks.length} checks.`);
