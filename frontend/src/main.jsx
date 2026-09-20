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
  // Local save slots need to survive normal npm-run-dev restarts. The old dev
  // boot reset wiped every bm_* key, which erased active save IDs, schedule
  // caches, and draft/runtime state unless the user clicked Schedule again.
  // Keep the boot marker for diagnostics, but do not perform a destructive wipe.
  if (!import.meta.env.DEV) return false;
  const bootId =
    typeof __DEV_SERVER_BOOT_ID__ !== "undefined" ? __DEV_SERVER_BOOT_ID__ : null;
  if (!bootId) return false;
  try {
    localStorage.setItem("bm_dev_boot_id_v1", String(bootId));
  } catch {}
  return false;
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
