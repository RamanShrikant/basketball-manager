import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { saveLeagueData } from "../utils/leagueStorage.js";
import {
  checkpointActiveLeagueSave,
  clearActiveLeagueSaveId,
  createLeagueSave,
  deleteLeagueSave,
  downloadLeagueSaveBackup,
  getActiveLeagueSaveId,
  getLeagueSave,
  listLeagueSaves,
  MAX_LEAGUE_SAVE_SLOTS,
  renameLeagueSave,
  restoreLeagueSaveToActive,
} from "../storage/leagueSaves.js";
import { clearActiveLeagueRuntime } from "../storage/saveManager.js";
import { buildVisibleLeagueSaveSlots } from "../storage/leagueSaveSlots.js";
import {
  deleteCustomDraftClassForYear,
  readCustomDraftClassesIndex,
  writeCustomDraftClassForYear,
  writeCustomDraftClassesIndex,
} from "../utils/customDraftClassStorage.js";

const CUSTOM_DRAFT_CLASS_MODE_BY_YEAR_KEY = "bm_draft_class_mode_by_year_v1";
const DRAFT_STATE_KEY = "bm_draft_state_v1";
const DEFAULT_DRAFT_CLASS_YEAR = 2027;
const FUTURE_DRAFT_CLASS_YEARS = [2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035];

function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeLeagueSlotName(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getRowsFromDraftClassPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.draftClass)) return payload.draftClass;
  if (Array.isArray(payload?.prospects)) return payload.prospects;
  if (Array.isArray(payload?.players)) return payload.players;
  return [];
}

function inferDraftClassYear(payload, fallbackYear) {
  const rows = getRowsFromDraftClassPayload(payload);
  const rowYear = rows.find((row) => Number(row?.draftClassYear || row?.seasonYear || row?.draftYear)) || {};
  const year = Number(
    payload?.seasonYear ||
      payload?.draftClassYear ||
      rowYear?.draftClassYear ||
      rowYear?.seasonYear ||
      rowYear?.draftYear ||
      fallbackYear ||
      DEFAULT_DRAFT_CLASS_YEAR
  );

  if (Number.isFinite(year) && year >= 2020 && year <= 2100) return year;
  return Number(fallbackYear || DEFAULT_DRAFT_CLASS_YEAR);
}

function normalizeDraftClassForVault(payload, fallbackYear, fileName = "") {
  const rows = getRowsFromDraftClassPayload(payload);
  if (!rows.length) {
    throw new Error("Draft class JSON has no prospects. Expected draftClass, prospects, players, or a raw array.");
  }

  const seasonYear = inferDraftClassYear(payload, fallbackYear);
  const draftClass = rows.map((row, index) => ({
    ...row,
    id:
      row?.id ||
      `custom_${seasonYear}_${String(index + 1).padStart(3, "0")}_${String(row?.name || row?.playerName || "prospect")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")}`,
    name: row?.name || row?.playerName || `Custom Prospect ${index + 1}`,
    playerName: row?.playerName || row?.name || `Custom Prospect ${index + 1}`,
    draftClassYear: Number(row?.draftClassYear || row?.seasonYear || seasonYear),
    seasonYear: Number(row?.seasonYear || row?.draftClassYear || seasonYear),
    draftProjection: Number(row?.draftProjection || row?.trueRank || row?.rank || index + 1),
    trueRank: Number(row?.trueRank || row?.draftProjection || row?.rank || index + 1),
  }));

  return {
    ok: true,
    version: "play_custom_draft_class_vault_v1",
    seasonYear,
    draftClassYear: seasonYear,
    classType: "custom",
    count: draftClass.length,
    importedFileName: fileName || "custom_draft_class.json",
    importedAt: new Date().toISOString(),
    draftClass,
    classMeta: {
      seasonYear,
      classType: "custom",
      prospectCount: draftClass.length,
      source: fileName || "Play page import",
      summary: `${seasonYear} custom draft class`,
    },
  };
}

function clearDraftStateForYearIfNotStarted(seasonYear) {
  const savedDraftState = safeJSON(localStorage.getItem(DRAFT_STATE_KEY), null);
  if (!savedDraftState || Number(savedDraftState.seasonYear) !== Number(seasonYear)) return;

  const picksMade = Array.isArray(savedDraftState.draftedPicks)
    ? savedDraftState.draftedPicks.length
    : 0;

  if (picksMade === 0) {
    localStorage.removeItem(DRAFT_STATE_KEY);
  }
}

export default function Play() {
  const { leagueData, setLeagueData, selectedTeam, setSelectedTeam } = useGame();
  const navigate = useNavigate();

  const [screen, setScreen] = useState("menu");
  const [newLeagueSlotIndex, setNewLeagueSlotIndex] = useState(null);
  const [leagueName, setLeagueName] = useState("NBA 2026-27");
  const [fileName, setFileName] = useState("");
  const [customRosterData, setCustomRosterData] = useState(null);
  const [rosterMode, setRosterMode] = useState("default");
  const [draft2027Mode, setDraft2027Mode] = useState("default");
  const [startingGame, setStartingGame] = useState(false);
  const [loadingSaveId, setLoadingSaveId] = useState("");
  const [saveBusyId, setSaveBusyId] = useState("");
  const [error, setError] = useState("");
  const [savesError, setSavesError] = useState("");
  const [saveSlots, setSaveSlots] = useState([]);
  const [loadingSaves, setLoadingSaves] = useState(false);
  const [draftClassYear, setDraftClassYear] = useState(2028);
  const [draftClassStatus, setDraftClassStatus] = useState("");
  const [draftClassIndex, setDraftClassIndex] = useState(() =>
    readCustomDraftClassesIndex() || {}
  );
  const [draftClassModes, setDraftClassModes] = useState(() =>
    safeJSON(localStorage.getItem(CUSTOM_DRAFT_CLASS_MODE_BY_YEAR_KEY), {}) || {}
  );

  const selectedYearKey = String(Number(draftClassYear || DEFAULT_DRAFT_CLASS_YEAR));
  const selectedClassSummary = draftClassIndex?.[selectedYearKey] || null;
  const selectedClassMode = draftClassModes?.[selectedYearKey] || (selectedClassSummary ? "custom" : "auto");

  const loadedDraftClassYears = useMemo(() => {
    return Object.keys(draftClassIndex || {})
      .filter((year) => Number.isFinite(Number(year)) && Number(year) > DEFAULT_DRAFT_CLASS_YEAR)
      .sort((a, b) => Number(a) - Number(b));
  }, [draftClassIndex]);

  const refreshSaveSlots = async () => {
    setLoadingSaves(true);
    setSavesError("");
    try {
      setSaveSlots(await listLeagueSaves());
    } catch (err) {
      setSavesError(err?.message || "Could not load local saves.");
    } finally {
      setLoadingSaves(false);
    }
  };

  useEffect(() => {
    refreshSaveSlots();
  }, []);

  const saveDraftClassIndex = (nextIndex) => {
    setDraftClassIndex(nextIndex);
    writeCustomDraftClassesIndex(nextIndex || {});
  };

  const saveDraftClassModes = (nextModes) => {
    setDraftClassModes(nextModes);
    localStorage.setItem(CUSTOM_DRAFT_CLASS_MODE_BY_YEAR_KEY, JSON.stringify(nextModes || {}));
  };

  const setDraftClassModeForYear = (year, mode) => {
    const seasonYear = Number(year || draftClassYear || DEFAULT_DRAFT_CLASS_YEAR);
    const key = String(seasonYear);
    const nextModes = {
      ...(draftClassModes || {}),
      [key]: mode === "custom" ? "custom" : "auto",
    };
    saveDraftClassModes(nextModes);
    clearDraftStateForYearIfNotStarted(seasonYear);
    setDraftClassStatus(
      mode === "custom"
        ? `Class of ${seasonYear} will use your uploaded custom draft class.`
        : `Class of ${seasonYear} will auto-generate rookies.`
    );
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.type && file.type !== "application/json" && !file.name.toLowerCase().endsWith(".json")) {
      setError("Please upload a valid JSON file.");
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        setCustomRosterData(parsed);
        setLeagueData(parsed, { source: "Play.customRosterUpload", persist: false });
        window.leagueData = parsed;
        setFileName(file.name);
        setRosterMode("custom");
        setError("");
      } catch (err) {
        setError("Invalid JSON format.");
      }
    };

    reader.readAsText(file);
  };

  const handleDraftClassUpload = (e, forcedYear = null) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.type && file.type !== "application/json" && !file.name.toLowerCase().endsWith(".json")) {
      setDraftClassStatus("Please upload a valid draft class JSON file.");
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const fallbackYear = Number(forcedYear || draftClassYear || DEFAULT_DRAFT_CLASS_YEAR);
        const normalized = normalizeDraftClassForVault(parsed, fallbackYear, file.name);
        const seasonYear = Number(normalized.seasonYear || fallbackYear || DEFAULT_DRAFT_CLASS_YEAR);
        const key = String(seasonYear);

        writeCustomDraftClassForYear(seasonYear, normalized);

        const nextIndex = {
          ...(draftClassIndex || {}),
          [key]: {
            seasonYear,
            count: normalized.draftClass.length,
            fileName: file.name,
            importedAt: normalized.importedAt,
          },
        };
        saveDraftClassIndex(nextIndex);

        const nextModes = {
          ...(draftClassModes || {}),
          [key]: "custom",
        };
        saveDraftClassModes(nextModes);
        clearDraftStateForYearIfNotStarted(seasonYear);

        setDraftClassYear(seasonYear === DEFAULT_DRAFT_CLASS_YEAR ? 2028 : seasonYear);
        if (seasonYear === DEFAULT_DRAFT_CLASS_YEAR) setDraft2027Mode("custom");
        setDraftClassStatus(
          `Loaded ${normalized.draftClass.length} prospects for the ${seasonYear} draft class. This year is set to custom.`
        );
      } catch (err) {
        const message = err?.message || "Invalid draft class JSON format.";
        setDraftClassStatus(message);
      }
    };

    reader.readAsText(file);
  };

  const clearDraftClassForYear = () => {
    const seasonYear = Number(draftClassYear || DEFAULT_DRAFT_CLASS_YEAR);
    const key = String(seasonYear);

    deleteCustomDraftClassForYear(seasonYear);

    const nextIndex = { ...(draftClassIndex || {}) };
    delete nextIndex[key];
    saveDraftClassIndex(nextIndex);

    const nextModes = { ...(draftClassModes || {}) };
    nextModes[key] = "auto";
    saveDraftClassModes(nextModes);
    clearDraftStateForYearIfNotStarted(seasonYear);

    setDraftClassStatus(`Cleared the ${seasonYear} custom draft class. This year will auto-generate rookies.`);
  };

  const loadBundledJson = async (path) => {
    const cleanPath = String(path || "").trim();
    const candidates = [...new Set([
      cleanPath,
      cleanPath.replace(/^\/+/, ""),
      `/${cleanPath.replace(/^\/+/, "")}`,
    ].filter(Boolean))];

    let lastError = null;
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, { cache: "no-store" });
        if (!response.ok) {
          lastError = new Error(`Could not load ${candidate} (${response.status}).`);
          continue;
        }
        return response.json();
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(
      `Could not load built-in game data. Make sure the dev server is running, then refresh. ${lastError?.message || ""}`.trim()
    );
  };

  const installDraftClass = (payload, sourceName) => {
    const normalized = normalizeDraftClassForVault(payload, DEFAULT_DRAFT_CLASS_YEAR, sourceName);
    const seasonYear = Number(normalized.seasonYear || DEFAULT_DRAFT_CLASS_YEAR);
    const key = String(seasonYear);
    writeCustomDraftClassForYear(seasonYear, normalized);

    const nextIndex = {
      ...(draftClassIndex || {}),
      [key]: {
        seasonYear,
        count: normalized.draftClass.length,
        fileName: sourceName,
        importedAt: normalized.importedAt,
      },
    };
    saveDraftClassIndex(nextIndex);

    const nextModes = { ...(draftClassModes || {}), [key]: "custom" };
    saveDraftClassModes(nextModes);
    clearDraftStateForYearIfNotStarted(seasonYear);
    return normalized;
  };

  const beginNewLeagueSetup = async (slotIndex = null) => {
    if (startingGame || loadingSaveId) return;
    setStartingGame(true);
    setError("");
    setSavesError("");
    try {
      const existingSaves = await listLeagueSaves();
      const requestedSlotIndex = Number(slotIndex);
      if (!Number.isInteger(requestedSlotIndex) || requestedSlotIndex < 0 || requestedSlotIndex >= MAX_LEAGUE_SAVE_SLOTS) {
        throw new Error("Choose an empty save slot first.");
      }
      if (existingSaves.some((save) => Number(save?.slotIndex) === requestedSlotIndex)) {
        throw new Error(`Save Slot ${requestedSlotIndex + 1} is already in use.`);
      }

      if (getActiveLeagueSaveId() && leagueData) {
        await checkpointActiveLeagueSave({
          leagueData,
          selectedTeamName: selectedTeam?.name || "",
          source: "Play.beginNewLeagueSetup",
        });
      }

      clearActiveLeagueSaveId();
      setSelectedTeam(null);
      setLeagueData(null, { source: "Play.beginNewLeagueSetup", persist: false });
      await clearActiveLeagueRuntime({ resetCaches: true });
      try {
        window.__leagueData = null;
        window.leagueData = null;
      } catch {}

      setDraftClassIndex({});
      setDraftClassModes({});
      setCustomRosterData(null);
      setFileName("");
      setRosterMode("default");
      setDraft2027Mode("default");
      setDraftClassStatus("");
      setNewLeagueSlotIndex(requestedSlotIndex);
      setScreen("new");
    } catch (err) {
      setError(err?.message || "Could not prepare a clean new league.");
    } finally {
      setStartingGame(false);
    }
  };

  const handleContinue = async () => {
    if (startingGame) return;
    setStartingGame(true);
    setError("");

    try {
      const cleanLeagueName = String(leagueName || "").trim() || "Untitled League";
      const cleanLeagueNameKey = normalizeLeagueSlotName(cleanLeagueName);
      const existingSaves = await listLeagueSaves();
      if (existingSaves.some((save) => normalizeLeagueSlotName(save?.leagueName) === cleanLeagueNameKey)) {
        throw new Error("A league with this name already exists. Choose a different name.");
      }

      let nextLeagueData = null;

      if (rosterMode === "default") {
        nextLeagueData = await loadBundledJson("/defaults/default_roster.json");
      } else if (customRosterData) {
        nextLeagueData = customRosterData;
      } else if (leagueData && fileName) {
        nextLeagueData = leagueData;
      } else {
        throw new Error("Upload your custom roster JSON first.");
      }

      setSelectedTeam(null);
      nextLeagueData = setLeagueData(nextLeagueData, { source: "Play.startNewLeague", persist: false });
      await saveLeagueData(nextLeagueData, { source: "Play.startNewLeague" });
      window.leagueData = nextLeagueData;

      if (draft2027Mode === "default") {
        const payload = await loadBundledJson("/defaults/default_2027_draft.json");
        installDraftClass(payload, "Built-in 2027 Draft");
      } else if (draft2027Mode === "auto") {
        setDraftClassModeForYear(DEFAULT_DRAFT_CLASS_YEAR, "auto");
      } else {
        const summary = draftClassIndex?.[String(DEFAULT_DRAFT_CLASS_YEAR)];
        if (!summary) throw new Error("Upload your custom 2027 draft JSON first.");
        setDraftClassModeForYear(DEFAULT_DRAFT_CLASS_YEAR, "custom");
      }

      await createLeagueSave({
        leagueName: cleanLeagueName,
        leagueData: nextLeagueData,
        selectedTeamName: "",
        activate: true,
        source: "Play.startNewLeague",
        slotIndex: newLeagueSlotIndex,
      });

      navigate("/team-selector");
    } catch (err) {
      setError(err?.message || "Could not start the game.");
    } finally {
      setStartingGame(false);
    }
  };

  const continueSave = async (saveId) => {
    if (!saveId || loadingSaveId) return;
    setLoadingSaveId(saveId);
    setSavesError("");
    try {
      const activeId = getActiveLeagueSaveId();
      if (activeId && leagueData) {
        await checkpointActiveLeagueSave({
          leagueData,
          selectedTeamName: selectedTeam?.name || "",
          source: activeId === saveId ? "Play.resumeActiveSave" : "Play.beforeSaveSwitch",
        });
      }

      const { resumeRoute } = await restoreLeagueSaveToActive(saveId);
      // A hard navigation is intentional: it discards every module-level cache
      // from the previous universe, then the normal boot sequence hydrates the
      // selected save from its restored IndexedDB/localStorage runtime.
      window.location.assign(resumeRoute || "/team-hub");
    } catch (err) {
      setSavesError(err?.message || "Could not continue this save.");
      setLoadingSaveId("");
    }
  };

  const renameSave = async (save) => {
    const nextName = window.prompt("Rename league", save?.leagueName || "");
    if (nextName == null) return;
    const trimmed = nextName.trim();
    if (!trimmed) return;
    setSaveBusyId(save.saveId);
    try {
      const normalizedTrimmed = normalizeLeagueSlotName(trimmed);
      const existingSaves = await listLeagueSaves();
      if (existingSaves.some((slot) => slot?.saveId !== save.saveId && normalizeLeagueSlotName(slot?.leagueName) === normalizedTrimmed)) {
        throw new Error("A league with this name already exists. Choose a different name.");
      }
      await renameLeagueSave(save.saveId, trimmed);
      await refreshSaveSlots();
    } catch (err) {
      setSavesError(err?.message || "Could not rename this save.");
    } finally {
      setSaveBusyId("");
    }
  };

  const deleteSave = async (save) => {
    const ok = window.confirm(`Delete ${save?.leagueName || "this league"}? This cannot be undone.`);
    if (!ok) return;
    setSaveBusyId(save.saveId);
    try {
      const deletingActiveSave = getActiveLeagueSaveId() === save.saveId;
      await deleteLeagueSave(save.saveId);
      if (deletingActiveSave) {
        setSelectedTeam(null);
        setLeagueData(null, { source: "Play.deleteActiveSave", persist: false });
        await clearActiveLeagueRuntime({ resetCaches: true });
      }
      await refreshSaveSlots();
    } catch (err) {
      setSavesError(err?.message || "Could not delete this save.");
    } finally {
      setSaveBusyId("");
    }
  };

  const exportSave = async (save) => {
    setSaveBusyId(save.saveId);
    try {
      if (getActiveLeagueSaveId() === save.saveId && leagueData) {
        await checkpointActiveLeagueSave({
          leagueData,
          selectedTeamName: selectedTeam?.name || "",
          source: "Play.exportSave",
        });
      }
      const full = await getLeagueSave(save.saveId);
      downloadLeagueSaveBackup(full);
    } catch (err) {
      setSavesError(err?.message || "Could not export this save.");
    } finally {
      setSaveBusyId("");
    }
  };

  const visibleSaveSlots = useMemo(
    () => buildVisibleLeagueSaveSlots(saveSlots, MAX_LEAGUE_SAVE_SLOTS),
    [saveSlots]
  );

  const formatLastPlayed = (value) => {
    const time = Date.parse(value || "");
    if (!Number.isFinite(time)) return "Unknown";
    return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  const chromePanel = "rounded-xl border border-[#252525] bg-[#090909] shadow-[0_12px_30px_rgba(0,0,0,.28)]";
  const darkInput = "rounded-lg border border-[#303030] bg-[#111111] px-4 py-3 text-sm font-black text-white outline-none placeholder:text-white/28 focus:border-orange-500/80 focus:ring-2 focus:ring-orange-500/18";
  const selectInput = "rounded-lg border border-[#303030] bg-[#111111] px-3 py-2 text-sm font-black text-white outline-none [color-scheme:dark] focus:border-orange-500/70 focus:ring-2 focus:ring-orange-500/15";
  const quietButton = "rounded-lg border border-[#303030] bg-[#111111] px-4 py-3 text-sm font-black text-slate-300 transition hover:border-orange-500/45 hover:bg-orange-500/10 hover:text-white";
  const orangeButton = "rounded-lg border border-orange-500/30 bg-[#d65316] px-4 py-3 text-sm font-black text-white shadow-[0_7px_18px_rgba(67,20,7,.25)] transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:border-[#303030] disabled:bg-slate-800 disabled:text-slate-500";
  const choiceActive = "border-orange-500/55 bg-[#3a1608] text-orange-50";
  const choiceIdle = "border-[#303030] bg-[#111111] text-slate-300 hover:border-orange-500/40 hover:bg-orange-500/10 hover:text-white";

  if (screen === "menu") {
    return (
      <div className="h-[100dvh] overflow-hidden bg-[#050505] px-4 py-4 text-white">
        <div className="mx-auto flex h-full w-full max-w-[1500px] min-h-0 flex-col gap-3">
          <header className="flex shrink-0 items-end justify-between gap-4 px-1">
            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.22em] text-orange-300">Basketball Manager</p>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
                <h1 className="text-4xl font-black tracking-[-0.07em] md:text-5xl">League Saves</h1>
                <span className="mb-1 rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-orange-200">
                  {saveSlots.length} / {MAX_LEAGUE_SAVE_SLOTS} slots used
                </span>
              </div>
              <p className="mt-1 text-xs font-semibold text-white/48">Choose an occupied slot to continue, or an empty slot to start a new rebuild.</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => navigate("/league-editor")} className={`${quietButton} px-3 py-2 text-xs`}>League Editor</button>
              <button type="button" onClick={refreshSaveSlots} className={`${orangeButton} px-3 py-2 text-xs`}>Refresh</button>
            </div>
          </header>

          {savesError && (
            <p className="shrink-0 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">{savesError}</p>
          )}

          <main className="grid min-h-0 flex-1 grid-cols-5 grid-rows-2 gap-3">
            {visibleSaveSlots.map(({ slotIndex, save }) => {
              const busy = save ? saveBusyId === save.saveId || loadingSaveId === save.saveId : startingGame;

              if (!save) {
                return (
                  <button
                    key={`empty-${slotIndex}`}
                    type="button"
                    disabled={startingGame || loadingSaves}
                    onClick={() => beginNewLeagueSetup(slotIndex)}
                    className="group flex min-h-0 min-w-0 flex-col items-center justify-center rounded-xl border border-dashed border-white/16 bg-[#090909] p-4 text-center transition hover:border-orange-500/55 hover:bg-[#120d09] disabled:cursor-wait disabled:opacity-55"
                  >
                    <span className="absolute sr-only">Start new league in Save Slot {slotIndex + 1}</span>
                    <span className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-white/32">Save Slot {slotIndex + 1}</span>
                    <span className="flex h-11 w-11 items-center justify-center rounded-full border border-orange-500/35 bg-orange-500/10 text-3xl font-light text-orange-300 transition group-hover:scale-105 group-hover:bg-orange-500/16">+</span>
                    <h2 className="mt-3 text-xl font-black tracking-[-0.04em] text-white/88">New League</h2>
                    <p className="mt-1 text-[11px] font-semibold text-white/36">Empty slot</p>
                  </button>
                );
              }

              return (
                <article key={save.saveId} className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#090909] shadow-[0_12px_28px_rgba(0,0,0,.24)]">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => continueSave(save.saveId)}
                    className="group min-h-0 flex-1 p-4 text-left transition hover:bg-[#13100d] disabled:cursor-wait disabled:opacity-60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-300">Save Slot {slotIndex + 1}</span>
                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-200">Occupied</span>
                    </div>
                    <h2 className="mt-3 line-clamp-2 text-xl font-black leading-tight tracking-[-0.04em] text-white group-hover:text-orange-100">{save.leagueName}</h2>
                    <p className="mt-2 truncate text-sm font-black text-white/72">{save.controlledTeamName || "No team selected"}</p>
                    <div className="mt-2 space-y-1 text-[10px] font-bold text-white/40">
                      <div className="truncate">{save.seasonLabel || "Season not started"}</div>
                      <div>{save.teamCount || 0} teams</div>
                      <div>Last played {formatLastPlayed(save.updatedAt)}</div>
                    </div>
                    <div className="mt-3 rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-center text-xs font-black text-orange-100 transition group-hover:bg-orange-500/16">
                      {loadingSaveId === save.saveId ? "Loading..." : "Continue League"}
                    </div>
                  </button>

                  <div className="grid shrink-0 grid-cols-3 border-t border-white/8 bg-black/20">
                    <button type="button" disabled={busy} onClick={() => renameSave(save)} className="border-r border-white/8 px-2 py-2 text-[10px] font-black text-white/55 hover:bg-white/5 hover:text-white disabled:opacity-40">Rename</button>
                    <button type="button" disabled={busy} onClick={() => exportSave(save)} className="border-r border-white/8 px-2 py-2 text-[10px] font-black text-white/55 hover:bg-white/5 hover:text-white disabled:opacity-40">Export</button>
                    <button type="button" disabled={busy} onClick={() => deleteSave(save)} className="px-2 py-2 text-[10px] font-black text-red-300/75 hover:bg-red-500/10 hover:text-red-200 disabled:opacity-40">Delete</button>
                  </div>
                </article>
              );
            })}
          </main>

          {loadingSaves && (
            <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/35 text-sm font-black text-white/70">Loading save slots...</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#050505] px-4 py-3 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] w-full max-w-7xl flex-col justify-center gap-2">
        <button type="button" onClick={() => { setScreen("menu"); setError(""); refreshSaveSlots(); }} className="self-start rounded-lg border border-[#303030] bg-[#111111] px-4 py-2 text-sm font-black text-white/70 hover:border-orange-500/40 hover:text-orange-200">← Back to Save Slots</button>

        <div className={`${chromePanel} overflow-hidden p-3 md:p-3`}>
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-orange-300">Basketball Manager</p>
              <h1 className="text-3xl font-black tracking-[-0.06em] md:text-4xl">Start New League <span className="text-orange-300/80">· Slot {Number(newLeagueSlotIndex) + 1}</span></h1>
            </div>
            <div className="w-full md:w-[360px]">
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">League Name</p>
              <input
                type="text"
                value={leagueName}
                onChange={(event) => setLeagueName(event.target.value)}
                placeholder="Name this rebuild"
                className={`${darkInput} w-full py-2`}
              />
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[0.95fr_1.05fr]">
            <section className="rounded-xl border border-[#252525] bg-[#090909] p-3">
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Starting Roster</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setRosterMode("default"); setError(""); }}
                  className={`rounded-xl border px-3 py-2 text-sm font-black transition ${rosterMode === "default" ? choiceActive : choiceIdle}`}
                >
                  Default Roster
                </button>
                <label
                  htmlFor="fileUpload"
                  className={`cursor-pointer rounded-xl border px-3 py-2 text-center text-sm font-black transition ${rosterMode === "custom" ? choiceActive : choiceIdle}`}
                >
                  Upload Custom
                </label>
              </div>
              <input id="fileUpload" type="file" accept=".json,application/json" className="hidden" onChange={handleFileUpload} />
              <p className="mt-2 min-h-[18px] text-xs font-semibold text-white/42">
                {rosterMode === "default" ? "Uses the built-in starting NBA roster." : fileName ? `Loaded: ${fileName}` : "Choose a roster JSON file."}
              </p>

              <div className="mt-3 rounded-xl border border-orange-500/18 bg-[#0d0d0d] p-3">
                <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">2027 Draft Class</p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraft2027Mode("default");
                      setDraftClassYear(2028);
                      setDraftClassStatus("The 2027 draft will use the built-in class.");
                      setError("");
                    }}
                    className={`rounded-xl border px-2 py-2 text-sm font-black transition ${draft2027Mode === "default" ? choiceActive : choiceIdle}`}
                  >
                    Default
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft2027Mode("auto");
                      setDraftClassYear(2028);
                      setDraftClassModeForYear(DEFAULT_DRAFT_CLASS_YEAR, "auto");
                      setError("");
                    }}
                    className={`rounded-xl border px-2 py-2 text-sm font-black transition ${draft2027Mode === "auto" ? choiceActive : choiceIdle}`}
                  >
                    Auto
                  </button>
                  <label
                    htmlFor="draftClassUpload2027"
                    className={`cursor-pointer rounded-xl border px-2 py-2 text-center text-sm font-black transition ${draft2027Mode === "custom" ? choiceActive : choiceIdle}`}
                  >
                    Upload
                  </label>
                </div>
                <input
                  id="draftClassUpload2027"
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(event) => { setDraftClassYear(DEFAULT_DRAFT_CLASS_YEAR); handleDraftClassUpload(event, DEFAULT_DRAFT_CLASS_YEAR); }}
                />
                <p className="mt-2 min-h-[18px] text-xs font-semibold text-white/42">
                  {draft2027Mode === "default"
                    ? "Uses the built-in 2027 class."
                    : draft2027Mode === "auto"
                    ? "Auto-generates the 2027 class when the draft starts."
                    : draftClassIndex?.[String(DEFAULT_DRAFT_CLASS_YEAR)]
                    ? `Loaded ${draftClassIndex[String(DEFAULT_DRAFT_CLASS_YEAR)]?.count || 0} prospects.`
                    : "Choose a 2027 draft JSON file."}
                </p>
              </div>
            </section>

            <section className="rounded-xl border border-[#252525] bg-[#090909] p-3">
              <div className="mb-3">
                <h2 className="text-lg font-black text-white">Future Draft Classes</h2>
                <p className="mt-1 text-xs font-semibold text-white/42">
                  Optional: customize 2028 and later. Any future year without a file auto-generates.
                </p>
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-2">
                <select
                  value={draftClassYear}
                  onChange={(e) => setDraftClassYear(Number(e.target.value))}
                  className={selectInput}
                >
                  {FUTURE_DRAFT_CLASS_YEARS.map((year) => (
                    <option key={year} value={year}>
                      Class of {year}
                    </option>
                  ))}
                </select>

                <label
                  htmlFor="draftClassUpload"
                  className="cursor-pointer rounded-lg bg-[#d65316] px-3 py-2 text-sm font-black text-white hover:bg-orange-600"
                >
                  Upload Class
                </label>
                <input
                  id="draftClassUpload"
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleDraftClassUpload}
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setDraftClassModeForYear(draftClassYear, "auto")} className="rounded-lg border border-[#303030] bg-[#111111] px-3 py-2 text-xs font-black text-slate-300 hover:border-orange-500/40 hover:bg-orange-500/10">Use Auto For {draftClassYear}</button>
                <button type="button" disabled={!selectedClassSummary} onClick={() => setDraftClassModeForYear(draftClassYear, "custom")} className="rounded-lg border border-[#303030] bg-[#111111] px-3 py-2 text-xs font-black text-slate-300 hover:border-orange-500/40 hover:bg-orange-500/10 disabled:text-slate-600">Use Custom For {draftClassYear}</button>
                <button type="button" disabled={!selectedClassSummary} onClick={clearDraftClassForYear} className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-black text-red-100 hover:bg-red-500/18 disabled:bg-[#111111] disabled:text-slate-600">Clear {draftClassYear}</button>
              </div>

              <div className="mt-3 text-xs font-semibold text-white/62">
                Class of <span className="font-black text-white">{draftClassYear}</span>: {" "}
                <span className={selectedClassMode === "custom" ? "text-orange-300" : "text-white/70"}>
                  {selectedClassMode === "custom" ? "Custom" : "Auto-generate"}
                </span>
                {selectedClassSummary && (
                  <div className="mt-1 text-white/42">Loaded {selectedClassSummary.count} prospects from {selectedClassSummary.fileName || "custom JSON"}</div>
                )}
              </div>

              {loadedDraftClassYears.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {loadedDraftClassYears.map((year) => (
                    <button key={year} type="button" onClick={() => setDraftClassYear(Number(year))} className="rounded-full border border-orange-500/25 px-3 py-1 text-xs font-bold text-orange-100 hover:bg-orange-500/12">
                      {year}: {draftClassIndex[year]?.count || 0}
                    </button>
                  ))}
                </div>
              )}

              {draftClassStatus && <p className="mt-3 rounded-lg border border-orange-500/25 bg-orange-500/10 px-3 py-2 text-xs font-semibold text-orange-100">{draftClassStatus}</p>}
            </section>
          </div>

          {error && <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200">{error}</p>}

          <div className="mt-3 flex flex-col items-center justify-between gap-2 sm:flex-row">
            <p className="text-xs font-semibold italic text-white/40">Saved locally in this browser. Future patches can migrate the save schema.</p>
            <button onClick={handleContinue} disabled={startingGame} className={`${orangeButton} min-w-[170px] px-8`}>
              {startingGame ? "Creating Save..." : "Create League"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
