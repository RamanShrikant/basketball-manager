import React from "react";
import "@/api/simEnginePy.js";

import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { GameProvider } from "./context/GameContext.jsx"; // ✅ import provider
import { simulateOneGame as pySimOneGame } from "./api/simEnginePy";

// ------------------------------
// DEV BOOT RESET (npm run dev)
// ------------------------------
function devBootResetIfNeeded() {
  // Only run this in dev
  if (!import.meta.env.DEV) return;

  // This constant is injected by vite.config.js (define: __DEV_SERVER_BOOT_ID__)
  const bootId =
    typeof __DEV_SERVER_BOOT_ID__ !== "undefined" ? __DEV_SERVER_BOOT_ID__ : null;
  if (!bootId) return;

  const KEY = "bm_dev_boot_id_v1";
  const prev = localStorage.getItem(KEY);

  // First ever run: just store boot id, don't wipe
  if (!prev) {
    localStorage.setItem(KEY, String(bootId));
    return;
  }

  // Same server boot: do nothing
  if (prev === String(bootId)) return;

  // New dev server boot => wipe save state
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k) continue;

    // wipe ALL game state keys
    if (
      k === "leagueData" ||
      k === "selectedTeam" ||
      k.startsWith("gameplan_") ||
      k.startsWith("bm_") ||
      k.startsWith("bm_result_v3_")
    ) {
      localStorage.removeItem(k);
      continue;
    }

    // also wipe progression keys if you have them
    if (k === "bm_progression_deltas_v1" || k === "bm_progression_meta_v1") {
      localStorage.removeItem(k);
    }
  }

  // store the new boot id so we don't wipe repeatedly during this same run
  localStorage.setItem(KEY, String(bootId));

  console.log("🧹 Dev boot detected — wiped save state for a fresh start.");
}

devBootResetIfNeeded();

window.simulateOneGame = pySimOneGame;
console.log("✓ simulateOneGame exposed globally");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* ✅ Wrap your app with GameProvider */}
    <GameProvider>
      <App />
    </GameProvider>
  </React.StrictMode>
);
