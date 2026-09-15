import fs from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), "frontend", "src", "components", "PlayerCardModal.jsx");
if (!fs.existsSync(target)) {
  console.error("FAIL: Run this regression from the basketball-manager repo root.");
  process.exit(1);
}
const src = fs.readFileSync(target, "utf8");
const earlyReturn = src.indexOf("if (!open || !player) return null;");
const overviewHook = src.indexOf("const overviewAttributes = useMemo(() => buildOverviewAttributeGroups(attributeRows), [attributeRows]);");
if (earlyReturn < 0) {
  console.error("FAIL: Expected PlayerCardModal closed-state return not found.");
  process.exit(1);
}
if (overviewHook < 0) {
  console.error("FAIL: overviewAttributes hook not found.");
  process.exit(1);
}
if (overviewHook > earlyReturn) {
  console.error("FAIL: React hook still appears after the conditional return.");
  process.exit(1);
}
const afterReturn = src.slice(earlyReturn);
const hookPattern = /\buse(?:State|Effect|Memo|Ref|Callback|Context|Reducer|LayoutEffect)\s*\(/g;
const hooksAfter = [...afterReturn.matchAll(hookPattern)];
if (hooksAfter.length) {
  console.error(`FAIL: Found ${hooksAfter.length} React hook call(s) after the conditional return.`);
  process.exit(1);
}
if (!src.includes('Snapshot: Draft Year') && !src.includes('Contract Expires')) {
  console.error("FAIL: Pass 28 compact Snapshot markers are missing.");
  process.exit(1);
}
console.log("PASS: Player Card Pass 28 hook-order hotfix is installed.");
console.log("PASS: No React hooks remain after the conditional closed-state return.");
