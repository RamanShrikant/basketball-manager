import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..");
const pagePath = path.join(frontendRoot, "src/pages/PlayerRetirements.jsx");
const configPath = path.join(frontendRoot, "src/config/retirementLayout.js");

const page = fs.readFileSync(pagePath, "utf8");
const configSource = fs.readFileSync(configPath, "utf8");
const { RETIREMENT_LAYOUT } = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`);

const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });

const masterWidth = Number(RETIREMENT_LAYOUT?.responsive?.masterWidth);
const minScale = Number(RETIREMENT_LAYOUT?.responsive?.minScale);
const maxScale = Number(RETIREMENT_LAYOUT?.responsive?.maxScale);

check("master width is fixed and valid", Number.isFinite(masterWidth) && masterWidth > 1000, `masterWidth=${masterWidth}`);
check("desktop is preserved at 1:1", maxScale === 1, `maxScale=${maxScale}`);
check("compact scaling has a sane floor", Number.isFinite(minScale) && minScale > 0 && minScale < 1, `minScale=${minScale}`);
check("row stage always uses master width", page.includes("width: `${retirementMasterWidth}px`"));
check("row height reserves scaled height", page.includes("RETIREMENT_LAYOUT.rowHeight * retirementRowScale"));
check("master stage scales as one unit", page.includes("transform: `scale(${retirementRowScale})`"));
check("master stage scales from top-left", page.includes('transformOrigin: "left top"'));
check("scale equation is width-only", page.includes("availableWidth / retirementMasterWidth"));
check("height is not part of scale equation", !/availableHeight\s*\/|clientHeight\s*\/|innerHeight\s*\//.test(page));
check("ResizeObserver tracks container width", page.includes("new ResizeObserver(updateScale)"));

const forbiddenRuntimeTokens = [
  "retirementUsesLaptopLayout",
  "retirementLaptop",
  "laptopMaxViewportWidth",
  "retirementViewportWidth",
  "matchMedia(",
];
for (const token of forbiddenRuntimeTokens) {
  check(`no per-element responsive runtime: ${token}`, !page.includes(token));
}

const forbiddenConfigTokens = ["laptopX", "laptopY", "laptopScale", "laptopLeft", "laptopNameGap", "laptopMaxViewportWidth"];
for (const token of forbiddenConfigTokens) {
  check(`no laptop-specific manual control: ${token}`, !configSource.includes(token));
}

for (const key of ["headshot", "name", "meta", "ratingRing", "reasonBox", "accomplishmentsBox", "teamLogo"]) {
  check(`${key} still has master controls`, !!RETIREMENT_LAYOUT?.[key], key);
}

const scaleAt = (availableWidth) => Math.max(minScale, Math.min(maxScale, availableWidth / masterWidth));
const laptopScale = scaleAt(1300);
const shortLaptopScale = scaleAt(1200);
check("1300px width scales down", laptopScale < 1 && laptopScale > minScale, `scale=${laptopScale.toFixed(4)}`);
check("narrower width scales monotonically", shortLaptopScale < laptopScale, `${shortLaptopScale.toFixed(4)} < ${laptopScale.toFixed(4)}`);
check("desktop/master width is exactly 1", scaleAt(masterWidth) === 1, `scale=${scaleAt(masterWidth)}`);
check("wider desktop remains exactly 1", scaleAt(masterWidth + 500) === 1, `scale=${scaleAt(masterWidth + 500)}`);

// Geometry invariance: any authored coordinate/dimension must preserve the same
// ratio when the stage scales. Test representative manual controls.
const representative = [
  RETIREMENT_LAYOUT.headshot.left + RETIREMENT_LAYOUT.headshot.x,
  RETIREMENT_LAYOUT.name.left + RETIREMENT_LAYOUT.name.x,
  RETIREMENT_LAYOUT.reasonBox.left + RETIREMENT_LAYOUT.reasonBox.x,
  RETIREMENT_LAYOUT.accomplishmentsBox.left + RETIREMENT_LAYOUT.accomplishmentsBox.x,
];
const sA = scaleAt(1300);
const sB = scaleAt(1200);
for (const [index, value] of representative.entries()) {
  const ratioA = (value * sA) / value;
  const ratioB = (value * sB) / value;
  check(`representative coordinate ${index + 1} scales uniformly`, Math.abs(ratioA - sA) < 1e-9 && Math.abs(ratioB - sB) < 1e-9);
}

const passed = results.filter((r) => r.pass).length;
for (const row of results) {
  console.log(`${row.pass ? "PASS" : "FAIL"}  ${row.name}${row.detail ? ` — ${row.detail}` : ""}`);
}
console.log(`\n${passed}/${results.length} checks passed.`);
if (passed !== results.length) process.exit(1);
