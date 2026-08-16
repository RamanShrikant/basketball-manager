import React, { useEffect } from "react";
import "@/api/simEnginePy.js";

import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import "./styles/BMResponsiveDensity.css";
import { GameProvider, useGame } from "./context/GameContext.jsx"; // ✅ import provider
import { simulateOneGame as pySimOneGame } from "./api/simEnginePy";
import {
  installBasketballManagerDiagnostics,
  updateBasketballManagerDiagnosticsContext,
} from "./utils/bmDiagnostics.js";
import { initializeTradeDeskStorage } from "./utils/tradeDeskFeed.js";
import { initializeScheduleStorage } from "./utils/scheduleStorage.js";
import { initializeUpcomingDraftClassStorage } from "./utils/upcomingDraftClass.js";
import { initializeSeasonStatsArchiveStorage } from "./utils/seasonStatsArchive.js";
import { initializeCustomDraftClassStorage } from "./utils/customDraftClassStorage.js";
import { initializeOffseasonMoodBaselineStorage } from "./utils/offseasonMoodBaselineStorage.js";

// ------------------------------
// DEV BOOT RESET (npm run dev)
// ------------------------------
function devBootResetIfNeeded() {
  // Only run this in dev
  if (!import.meta.env.DEV) return false;

  // This constant is injected by vite.config.js (define: __DEV_SERVER_BOOT_ID__)
  const bootId =
    typeof __DEV_SERVER_BOOT_ID__ !== "undefined" ? __DEV_SERVER_BOOT_ID__ : null;
  if (!bootId) return false;

  const KEY = "bm_dev_boot_id_v1";
  const prev = localStorage.getItem(KEY);

  // First ever run: just store boot id, don't wipe
  if (!prev) {
    localStorage.setItem(KEY, String(bootId));
    return false;
  }

  // Same server boot: do nothing
  if (prev === String(bootId)) return false;

  // New dev server boot => wipe save state. Calendar also consumes this
  // one-shot token before its first season hydrate so stale result payloads or
  // played flags cannot survive a dev fresh-start through another storage layer.
  try {
    sessionStorage.setItem("bm_dev_fresh_calendar_boot_v1", String(bootId));
  } catch {}

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
  return true;
}

function DiagnosticsBridge() {
  const { leagueData, selectedTeam } = useGame();

  useEffect(() => {
    updateBasketballManagerDiagnosticsContext({ leagueData, selectedTeam });
  }, [leagueData, selectedTeam]);

  return null;
}

async function bootstrap() {
  const devFreshReset = devBootResetIfNeeded();

  const storageBootstraps = [
    ["ScheduleStorage", initializeScheduleStorage],
    ["UpcomingDraft", initializeUpcomingDraftClassStorage],
    ["SeasonStatsArchive", initializeSeasonStatsArchiveStorage],
    ["CustomDraftStorage", initializeCustomDraftClassStorage],
    ["OffseasonMoodBaseline", initializeOffseasonMoodBaselineStorage],
    ["TradeDeskFeed", initializeTradeDeskStorage],
  ];

  for (const [label, initializeStorage] of storageBootstraps) {
    try {
      const storageReport = await initializeStorage({ reset: devFreshReset });
      console.log(`[${label}] IndexedDB storage ready`, storageReport);
    } catch (error) {
      // Storage migration must never prevent the game UI from booting. Each
      // storage layer keeps a synchronous runtime/legacy compatibility path.
      console.warn(`[${label}] storage bootstrap failed; continuing with compatibility cache`, error);
    }
  }

  installBasketballManagerDiagnostics();

  window.simulateOneGame = pySimOneGame;
  console.log("✓ simulateOneGame exposed globally");

  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      {/* ✅ Wrap your app with GameProvider */}
      <GameProvider>
        <DiagnosticsBridge />
        <App />
      </GameProvider>
    </React.StrictMode>
  );
}

bootstrap();
