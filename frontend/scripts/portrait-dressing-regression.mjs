import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const results = [];
const check = (id, condition, message) => results.push({ status: condition ? "PASS" : "FAIL", id, message });

const utils = await import(pathToFileURL(path.join(root, "src/utils/portraitDressing.js")).href);
const jerseyManifest = JSON.parse(read("public/assets/jerseys/v1/jerseys_manifest.json"));
const rookieManifest = JSON.parse(read("public/assets/rookie_faces/rookie_faces_manifest.json"));
const expectedTeams = ["ATL","BKN","BOS","CHA","CHI","CLE","DAL","DEN","DET","GSW","HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NOP","NYK","OKC","ORL","PHI","PHX","POR","SAC","SAS","TOR","UTA","WAS"];
const jerseyRoot = "public/assets/jerseys/v1";

check("dressing.jersey_manifest_count", jerseyManifest.length === 30, `Jersey manifest has 30 rows (found ${jerseyManifest.length}).`);
check("dressing.team_coverage", expectedTeams.every((team) => jerseyManifest.some((row) => row.team === team)), "All 30 NBA team abbreviations are covered.");
check("dressing.jersey_files_exist", jerseyManifest.every((row) => exists(`${jerseyRoot}/${row.filename}`)), "Every jersey manifest row points to an installed PNG.");
check("dressing.rookie_manifest_count", rookieManifest.length === 44, `Current context has 44 rookie identities (found ${rookieManifest.length}).`);

const canonicalFits = JSON.parse(read("public/assets/portrait_studio/fits/portrait_fits.json"));
const templateIds = jerseyManifest.map((row) => row.templateId || row.id).filter(Boolean);
const missingGeneratedFits = rookieManifest.flatMap((face) =>
  templateIds
    .filter((templateId) => !canonicalFits?.fitByFace?.[face.id]?.jerseys?.[templateId])
    .map((templateId) => `${face.id}:${templateId}`)
);
check(
  "dressing.generated_rookie_full_team_fit_coverage",
  missingGeneratedFits.length === 0,
  `Every generated rookie face has an explicit fit for all 30 team jerseys (missing ${missingGeneratedFits.length}${missingGeneratedFits.length ? `: ${missingGeneratedFits.slice(0, 5).join(", ")}` : ""}).`
);

const v1Migrated = utils.normalizePortraitFitConfig({ fitByFace: { rookie_face_0003: { x: 7, y: -2, scale: 1.04 } } });
check("dressing.v1_migration", v1Migrated.fitByFace.rookie_face_0003?.default?.x === 7, "Legacy v1 per-face fits migrate into the v2 player default without data loss.");

const config = utils.normalizePortraitFitConfig({
  version: "bm_portrait_dressing_fit_v2",
  fitByTemplate: { TOR_jersey_v1: { x: 3, y: 0, scale: 1.02 } },
  fitByFace: {
    rookie_face_0003: {
      default: { x: 5, y: 2, scale: 1.01 },
      jerseys: { BOS_jersey_v1: { x: 25, y: -9, scale: 0.97 } },
      stages: {},
    },
  },
});
const tor = utils.resolveJerseyFit(config, "rookie_face_0003", "TOR_jersey_v1", "rookie");
const bos = utils.resolveJerseyFit(config, "rookie_face_0003", "BOS_jersey_v1", "rookie");
check("dressing.template_calibration", tor.x === 8 && Math.abs(tor.scale - 1.0302) < 0.0001, "Inherited fits combine the player's default with jersey-template calibration.");
check("dressing.player_jersey_override", bos.x === 25 && bos.y === -9 && bos.scale === 0.97, "Player × jersey override wins for the exceptional templates that need custom fitting.");
check("dressing.override_detection", utils.hasJerseyOverride(config, "rookie_face_0003", "BOS_jersey_v1", "rookie") && !utils.hasJerseyOverride(config, "rookie_face_0003", "TOR_jersey_v1", "rookie"), "Override detection distinguishes inherited jerseys from custom exceptions.");
check("dressing.free_agent_team", utils.normalizePortraitTeamCode("Free Agent") === "", "Free agents explicitly resolve to no jersey instead of an invalid team template.");
const firstYearGeneratedFreeAgent = {
  portraitId: "rookie_face_0003",
  headshot: "/assets/rookie_faces/rookie_face_0003.png",
  team: "Free Agent",
  contractType: "free_agent",
  meta: { proSeasons: 0, rookieSigningDecision: "release" },
};
const veteranGeneratedFreeAgent = {
  ...firstYearGeneratedFreeAgent,
  meta: { proSeasons: 2 },
};
check(
  "dressing.first_year_generated_fa_draft_attire",
  utils.shouldUseDraftAttireForFirstYearGeneratedFreeAgent(firstYearGeneratedFreeAgent, "rookie_face_0003", firstYearGeneratedFreeAgent.headshot, "") &&
    !utils.shouldUseDraftAttireForFirstYearGeneratedFreeAgent(veteranGeneratedFreeAgent, "rookie_face_0003", veteranGeneratedFreeAgent.headshot, ""),
  "First-year generated rookie free agents keep their original draft-attire portrait while veteran generated free agents stay on the runtime path."
);
check("dressing.phoenix_normalization", utils.normalizePortraitTeamCode("Phoenix Suns") === "PHX", "Phoenix team naming resolves to the PHX runtime template.");

const layered = read("src/components/LayeredPlayerPortrait.jsx");
const runtime = read("src/components/RuntimePlayerPortrait.jsx");
const editor = read("src/components/PortraitDressingEditor.jsx");
const frame = read("src/components/PlayerPortraitFrame.jsx");
const vite = read("vite.config.js");
check("dressing.layer_order", layered.indexOf("bodySrc") < layered.lastIndexOf("jerseySrc"), "Layered portrait renders the body before the jersey overlay.");
check("dressing.directional_fit", ["left", "right", "up", "down"].every((field) => editor.includes(`\"${field}\"`)), "Editor retains independent Left/Right/Up/Down expansion controls in addition to uniform scale.");
check("dressing.per_template_storage", editor.includes("Save Player Default") && editor.includes("saveTeamOverride") && utils.PORTRAIT_DRESSING_STORAGE_KEY.endsWith("_v2"), "Editor stores player defaults plus per-template exceptions in the v2 working format.");
check("dressing.durable_project_save", vite.includes("/__bm/portrait-fits") && vite.includes("portrait_fits.json"), "Local Vite server exposes a dev-only canonical fit writer so fitting work is not trapped in localStorage.");
check("dressing.smart_frame", frame.includes("RuntimePlayerPortrait") && runtime.includes("getPlayerPortraitId"), "Shared portrait frame auto-upgrades generated rookies to runtime dressed portraits while keeping legacy fallback images.");

const integrationFiles = [
  "src/pages/RosterView.jsx",
  "src/pages/FreeAgents.jsx",
  "src/pages/RookieSignings.jsx",
  "src/components/PlayerCardModal.jsx",
  "src/pages/ProposeTrade.jsx",
  "src/pages/TradeFinder.jsx",
  "src/pages/TradePlayerSelect.jsx",
  "src/pages/SalaryTable.jsx",
  "src/pages/LockerRoom.jsx",
  "src/pages/CoachGameplan.jsx",
  "src/pages/PlayerStats.jsx",
  "src/pages/ViewingOffers.jsx",
  "src/pages/AllStars.jsx",
  "src/pages/Calendar.jsx",
  "src/pages/PlayerRetirements.jsx",
];
check("dressing.runtime_lifecycle_integration", integrationFiles.every((file) => read(file).includes("RuntimePlayerPortrait") || read(file).includes("PlayerPortraitFrame")), "Roster, player card, draft signing, FA, trade/offers, salary, locker-room, gameplan, stats, all-star, calendar and retirement surfaces route through runtime portrait rendering.");
check("dressing.draft_untouched", !read("src/pages/Draft.jsx").includes("RuntimePlayerPortrait"), "Draft page remains on the original baked draft-night portrait; dynamic dressing begins post-draft.");
check("dressing.archive_identity", read("src/utils/seasonStatsArchive.js").includes("portraitFamilyId") && read("src/utils/seasonStatsArchive.js").includes("portraitVariant"), "Season archives preserve portrait identity/stage metadata for future-season and historical rendering.");
check("dressing.mood_identity", read("public/python/player_mood_logic.py").includes('"portraitId": player.get("portraitId")'), "Locker-room mood payloads preserve portrait identity instead of flattening to a headshot URL only.");

console.table(results);
const failed = results.filter((row) => row.status === "FAIL");
if (failed.length) {
  console.error(`\nPortrait dressing regression failed: ${failed.length}/${results.length} checks failed.`);
  process.exit(1);
}
console.log(`\nPortrait dressing regression passed: ${results.length}/${results.length} checks.`);
