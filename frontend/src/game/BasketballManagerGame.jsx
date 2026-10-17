import React, { useEffect } from "react";
import "@/api/simEnginePy.js";
import App from "../App.jsx";
import { GameProvider, useGame } from "../context/GameContext.jsx";
import { simulateOneGame as pySimOneGame } from "../api/simEnginePy";
import {
  installBasketballManagerDiagnostics,
  updateBasketballManagerDiagnosticsContext,
} from "../utils/bmDiagnostics.js";
import { initializeTradeDeskStorage } from "../utils/tradeDeskFeed.js";
import { initializeScheduleStorage } from "../utils/scheduleStorage.js";
import { initializeUpcomingDraftClassStorage } from "../utils/upcomingDraftClass.js";
import { initializeSeasonStatsArchiveStorage } from "../utils/seasonStatsArchive.js";
import { initializeCustomDraftClassStorage } from "../utils/customDraftClassStorage.js";
import { initializeOffseasonMoodBaselineStorage } from "../utils/offseasonMoodBaselineStorage.js";
import { installUiSoundBindings } from "../audio/uiSoundBindings.js";
import { CloudAutosaveBridge } from "./CloudAutosaveBridge.jsx";
import { getAccountSaveMode } from "../auth/accountLocalVault.js";

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

export async function initializeGameAfterLogin() {
  // IMPORTANT: no game IndexedDB or sidecar initialization before the account
  // gate has restored the correct account's browser-local franchise universe.
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
      const report = await initializeStorage({ reset: devFreshReset });
      console.log(`[${label}] IndexedDB storage ready`, report);
    } catch (error) {
      console.warn(`[${label}] storage bootstrap failed; continuing with compatibility cache`, error);
    }
  }
  installBasketballManagerDiagnostics();
  installUiSoundBindings();
  window.simulateOneGame = pySimOneGame;
}

export default function BasketballManagerGame({ user }) {
  return (
    <React.StrictMode>
      <GameProvider>
        <DiagnosticsBridge />
        {getAccountSaveMode(user.id) === "cloud" && <CloudAutosaveBridge user={user} />}
        <App user={user} />
      </GameProvider>
    </React.StrictMode>
  );
}
