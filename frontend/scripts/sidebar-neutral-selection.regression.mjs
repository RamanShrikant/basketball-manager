// Run from frontend/: node scripts/sidebar-neutral-selection.regression.mjs
// Checks styling only; does not load or alter gameplay or browser storage.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/components/TeamHubSidebar.module.css", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../src/components/TeamHubSidebar.jsx", import.meta.url), "utf8");
const hover = css.match(/\.navItem:hover:not\(:disabled\)\s*\{([^}]*)\}/)?.[1];
const selected = css.match(/\.navItemActive,\s*\.navItemActive:hover\s*\{([^}]*)\}/)?.[1];
assert.ok(hover && selected, "Sidebar hover and selected selectors must exist");
assert.match(hover, /background:\s*transparent\s*;/);
assert.match(selected, /background:\s*transparent\s*!important\s*;/);
assert.match(selected, /box-shadow:\s*none\s*!important\s*;/);
assert.match(selected, /color:\s*#c8bfb7\s*!important\s*;/);
assert.match(selected, /font-weight:\s*560\s*;/);
assert.match(css, /\.navItemActive\s+\.icon\s*\{\s*color:\s*inherit\s*;/);
assert.ok(!selected.includes("#d65316"), "Selected nav must not have the old orange fill");
assert.ok(sidebar.includes("styles.navItemActive") && sidebar.includes('aria-current='), "Selection logic and accessibility remain intact");
console.log("PASS: selected sidebar rows stay dark; hover stays neutral; route selection preserved");
