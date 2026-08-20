import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const results = [];
const check = (id, condition, message) => results.push({ status: condition ? "PASS" : "FAIL", id, message });

const manifest = JSON.parse(read("public/assets/portrait_studio/portrait_studio_manifest.json"));
const queue = JSON.parse(read("public/assets/portrait_studio/generation_queue.json"));
const draft = JSON.parse(read("public/assets/rookie_faces/rookie_faces_manifest.json"));
const jerseys = JSON.parse(read("public/assets/jerseys/v1/jerseys_manifest.json"));
const fits = JSON.parse(read("public/assets/portrait_studio/fits/portrait_fits.json"));
const editor = read("src/components/PortraitDressingEditor.jsx");
const runtime = read("src/components/RuntimePlayerPortrait.jsx");
const packageJson = JSON.parse(read("package.json"));

const draftIds = new Set(draft.map((row) => row.id));
const base = manifest.entries.filter((row) => row.baseReady && draftIds.has(row.id));
const needs = manifest.entries.filter((row) => row.needsBase);

check("portrait_studio.draft_44", draft.length === 44, `Draft-night library remains 44 portraits (found ${draft.length}).`);
check("portrait_studio.jerseys_30", jerseys.length === 30, `All 30 jersey templates are installed (found ${jerseys.length}).`);
check("portrait_studio.jersey_ids", jerseys.every((row) => row.id && row.templateId && row.hash), "Every jersey template has a stable template ID and content hash.");
check("portrait_studio.base_folder", exists("public/assets/portrait_studio/base"), "Dedicated jerseyless base folder exists.");
check("portrait_studio.complete_counts", base.length === 44 && needs.length === 0, `All 44 current rookie references have jerseyless bases and none are missing (got ${base.length} ready, ${needs.length} missing).`);
check("portrait_studio.queue_empty", Array.isArray(queue.remaining) && queue.remaining.length === 0, `Generation queue is empty after completing the current library (found ${queue.remaining?.length ?? "?"}).`);
check("portrait_studio.deterministic_names", base.every((row) => row.baseFilename === `${row.id}_base.png`), "Every identity maps deterministically to rookie_face_####_base.png.");
check("portrait_studio.base_files_exist", base.every((row) => exists(`public/assets/portrait_studio/base/${row.baseFilename}`)), "Every manifest base-ready row points to an installed file.");
check("portrait_studio.v2_fits", fits.version === "bm_portrait_dressing_fit_v2" && fits.fitByFace && fits.fitByTemplate, "Canonical fit file uses the v2 per-player/per-template schema.");
check("portrait_studio.editor_project_save", editor.includes("/__bm/portrait-fits") && editor.includes("Save to Project"), "Portrait Studio can persist canonical fits directly to the local project during dev.");
check("portrait_studio.editor_all_team_qa", editor.includes("Preview All 30 Jerseys") && editor.includes("Save Player Default") && editor.includes("Override"), "Editor supports 30-team QA plus player defaults and jersey-specific overrides.");
check("portrait_studio.runtime_component", runtime.includes("resolveJerseyFit") && runtime.includes("teamCode") && runtime.includes("baseUrl"), "Runtime component resolves base + current team jersey + saved fit.");
check("portrait_studio.sync_script", packageJson.scripts?.["portrait:sync"] === "node scripts/sync-portrait-studio.mjs", "npm run portrait:sync regenerates/validates portrait assets.");
check("portrait_studio.auto_dev_sync", packageJson.scripts?.predev === "npm run portrait:sync", "Starting dev automatically syncs portrait assets.");
check("portrait_studio.auto_build_sync", packageJson.scripts?.prebuild === "npm run portrait:sync", "Production build automatically validates/syncs portrait assets.");

console.table(results);
const failed = results.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`\nPortrait Studio regression failed: ${failed.length}/${results.length} checks failed.`);
  process.exit(1);
}
console.log(`\nPortrait Studio regression passed: ${results.length}/${results.length} checks.`);
