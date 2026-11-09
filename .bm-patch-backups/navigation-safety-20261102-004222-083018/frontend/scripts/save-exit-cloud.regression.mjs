// Checks that Save & Exit checkpoints local data, waits for sidecars, then
// commits cloud before clearing active-slot ownership or navigating away.
// Static guard only: run a real-device upload test before trusting remote saves.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sidebar = readFileSync(new URL("../src/components/TeamHubSidebar.jsx", import.meta.url), "utf8");
const block = sidebar.split("  const confirmSaveAndExit = async () => {")[1]?.split("\n  };",1)[0];
assert(block, "Save & Exit handler missing");
const names = [
  "await checkpointActiveLeagueSave(",
  "await flushAllLeagueRuntimeWrites()",
  "await uploadCloudSave(accountId, { force: true })",
  "finishSaveAndExit()",
];
const positions = names.map(name => block.indexOf(name));
assert(positions.every(x => x >= 0), "Save & Exit missing a required step");
assert(positions.every((x,i) => i===0 || x>positions[i-1]), "Save & Exit steps in unsafe order");
assert(block.includes('getAccountSaveMode(accountId) === "cloud"'), "Local Save & Exit must NEVER upload");
assert(block.includes("setExitCloudWarning(detail)"), "Cloud failure must prompt user");
assert(block.includes("bm_pending_calendar_sim_v1") && block.includes("bm_pending_postseason_sim_v1"), "Save & Exit must not cloud-publish unfinished simulations");
assert(block.includes("return; // Keep the user here"), "Cloud failure must block automatic exit");
assert(sidebar.includes("Exit locally"), "Explicit offline exit is missing");
const finish = sidebar.split("  const finishSaveAndExit = () => {")[1]?.split("\n  };",1)[0];
assert(finish && finish.indexOf("clearActiveLeagueSaveId()") < finish.indexOf('navigate("/league-editor")'));
console.log("PASS: Save & Exit checkpoints local state, awaits cloud, preserves offline fallback");
