import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { saveLeagueDataInBackground } from "../utils/leagueStorage.js";
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
  const { setLeagueData } = useGame();
  const [fileName, setFileName] = useState("");
  const [rosterMode, setRosterMode] = useState("default");
  const [draft2027Mode, setDraft2027Mode] = useState("default");
  const [startingGame, setStartingGame] = useState(false);
  const [error, setError] = useState("");
  const [draftClassYear, setDraftClassYear] = useState(2028);
  const [draftClassStatus, setDraftClassStatus] = useState("");
  const [draftClassIndex, setDraftClassIndex] = useState(() =>
    readCustomDraftClassesIndex() || {}
  );
  const [draftClassModes, setDraftClassModes] = useState(() =>
    safeJSON(localStorage.getItem(CUSTOM_DRAFT_CLASS_MODE_BY_YEAR_KEY), {}) || {}
  );
  const navigate = useNavigate();

  const selectedYearKey = String(Number(draftClassYear || DEFAULT_DRAFT_CLASS_YEAR));
  const selectedClassSummary = draftClassIndex?.[selectedYearKey] || null;
  const selectedClassMode = draftClassModes?.[selectedYearKey] || (selectedClassSummary ? "custom" : "auto");

  const loadedDraftClassYears = useMemo(() => {
    return Object.keys(draftClassIndex || {})
      .filter((year) => Number.isFinite(Number(year)) && Number(year) > DEFAULT_DRAFT_CLASS_YEAR)
      .sort((a, b) => Number(a) - Number(b));
  }, [draftClassIndex]);

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

        // React state + IndexedDB save. localStorage only keeps a tiny pointer.
        setLeagueData(parsed);
        saveLeagueDataInBackground(parsed);

        // 🔥 GLOBAL version (Python worker needs this)
        window.leagueData = parsed;
        console.log("GLOBAL leagueData updated:", window.leagueData);

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
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load built-in game data (${response.status}).`);
    return response.json();
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

  const handleContinue = async () => {
    if (startingGame) return;
    setStartingGame(true);
    setError("");

    try {
      if (rosterMode === "default") {
        const parsed = await loadBundledJson("/defaults/default_roster.json");
        setLeagueData(parsed);
        saveLeagueDataInBackground(parsed);
        window.leagueData = parsed;
      } else if (!fileName) {
        throw new Error("Upload your custom roster JSON first.");
      }

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

      navigate("/team-selector");
    } catch (err) {
      setError(err?.message || "Could not start the game.");
    } finally {
      setStartingGame(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-900 text-white px-4 py-10">
      <h1 className="text-4xl font-bold mb-8 text-orange-500">NBA MyLeague</h1>

      <div className="flex flex-col items-center gap-4 bg-neutral-800 p-8 rounded-2xl shadow-lg w-full max-w-[460px]">
        <div className="w-full">
          <p className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-orange-300">Starting Roster</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setRosterMode("default"); setError(""); }}
              className={`rounded-xl border px-3 py-3 text-sm font-bold transition ${
                rosterMode === "default"
                  ? "border-orange-500 bg-orange-500/15 text-orange-100"
                  : "border-white/10 bg-neutral-900 text-white/65 hover:border-white/20"
              }`}
            >
              Default Roster
            </button>
            <label
              htmlFor="fileUpload"
              className={`cursor-pointer rounded-xl border px-3 py-3 text-center text-sm font-bold transition ${
                rosterMode === "custom"
                  ? "border-orange-500 bg-orange-500/15 text-orange-100"
                  : "border-white/10 bg-neutral-900 text-white/65 hover:border-white/20"
              }`}
            >
              Upload Custom
            </label>
          </div>
          <input id="fileUpload" type="file" accept=".json,application/json" className="hidden" onChange={handleFileUpload} />
          <p className="mt-2 text-xs text-white/45">
            {rosterMode === "default" ? "Uses the built-in starting NBA roster." : fileName ? `Loaded: ${fileName}` : "Choose a roster JSON file."}
          </p>
        </div>

        <div className="w-full rounded-2xl border border-orange-500/20 bg-neutral-900/80 p-4">
          <p className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-orange-300">2027 Draft Class</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft2027Mode("default");
                setDraftClassYear(2028);
                setDraftClassStatus("The 2027 draft will use the built-in class.");
                setError("");
              }}
              className={`rounded-xl border px-3 py-3 text-sm font-bold transition ${
                draft2027Mode === "default"
                  ? "border-orange-500 bg-orange-500/15 text-orange-100"
                  : "border-white/10 bg-neutral-800 text-white/65 hover:border-white/20"
              }`}
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
              className={`rounded-xl border px-3 py-3 text-sm font-bold transition ${
                draft2027Mode === "auto"
                  ? "border-orange-500 bg-orange-500/15 text-orange-100"
                  : "border-white/10 bg-neutral-800 text-white/65 hover:border-white/20"
              }`}
            >
              Auto
            </button>
            <label
              htmlFor="draftClassUpload2027"
              className={`cursor-pointer rounded-xl border px-3 py-3 text-center text-sm font-bold transition ${
                draft2027Mode === "custom"
                  ? "border-orange-500 bg-orange-500/15 text-orange-100"
                  : "border-white/10 bg-neutral-800 text-white/65 hover:border-white/20"
              }`}
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
          <p className="mt-2 text-xs text-white/45">
            {draft2027Mode === "default"
              ? "Uses the built-in 2027 class."
              : draft2027Mode === "auto"
              ? "Auto-generates the 2027 class when the draft starts."
              : draftClassIndex?.[String(DEFAULT_DRAFT_CLASS_YEAR)]
              ? `Loaded ${draftClassIndex[String(DEFAULT_DRAFT_CLASS_YEAR)]?.count || 0} prospects.`
              : "Choose a 2027 draft JSON file."}
          </p>
        </div>

        {error && <p className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

        <div className="mt-4 w-full rounded-2xl border border-purple-500/30 bg-neutral-900/80 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-lg font-bold text-purple-300">Future Draft Classes</h2>
              <p className="text-xs text-gray-400 mt-1">
                Optional: customize 2028 and later. Any future year without a file auto-generates.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <select
              value={draftClassYear}
              onChange={(e) => setDraftClassYear(Number(e.target.value))}
              className="rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm"
            >
              {FUTURE_DRAFT_CLASS_YEARS.map((year) => (
                <option key={year} value={year}>
                  Class of {year}
                </option>
              ))}
            </select>

            <label
              htmlFor="draftClassUpload"
              className="cursor-pointer rounded-lg bg-purple-600 px-3 py-2 text-sm font-semibold hover:bg-purple-500"
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
            <button
              type="button"
              onClick={() => setDraftClassModeForYear(draftClassYear, "auto")}
              className="rounded-lg bg-neutral-700 px-3 py-2 text-xs font-semibold hover:bg-neutral-600"
            >
              Use Auto For {draftClassYear}
            </button>

            <button
              type="button"
              disabled={!selectedClassSummary}
              onClick={() => setDraftClassModeForYear(draftClassYear, "custom")}
              className="rounded-lg bg-green-700 px-3 py-2 text-xs font-semibold hover:bg-green-600 disabled:bg-neutral-700 disabled:text-gray-500"
            >
              Use Custom For {draftClassYear}
            </button>

            <button
              type="button"
              disabled={!selectedClassSummary}
              onClick={clearDraftClassForYear}
              className="rounded-lg bg-red-900/80 px-3 py-2 text-xs font-semibold hover:bg-red-800 disabled:bg-neutral-700 disabled:text-gray-500"
            >
              Clear {draftClassYear}
            </button>
          </div>

          <div className="mt-3 text-xs text-gray-300">
            <div>
              Class of <span className="font-bold text-white">{draftClassYear}</span>: {" "}
              <span className={selectedClassMode === "custom" ? "text-green-400" : "text-orange-400"}>
                {selectedClassMode === "custom" ? "Custom" : "Auto-generate"}
              </span>
            </div>
            {selectedClassSummary && (
              <div className="mt-1 text-gray-400">
                Loaded {selectedClassSummary.count} prospects from {selectedClassSummary.fileName || "custom JSON"}
              </div>
            )}
          </div>

          {loadedDraftClassYears.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {loadedDraftClassYears.map((year) => (
                <button
                  key={year}
                  type="button"
                  onClick={() => setDraftClassYear(Number(year))}
                  className="rounded-full border border-purple-500/40 px-3 py-1 text-xs text-purple-200 hover:bg-purple-500/20"
                >
                  {year}: {draftClassIndex[year]?.count || 0}
                </button>
              ))}
            </div>
          )}

          {draftClassStatus && (
            <p className="mt-3 rounded-lg bg-purple-500/10 border border-purple-500/30 px-3 py-2 text-xs text-purple-100">
              {draftClassStatus}
            </p>
          )}
        </div>

        <button
          onClick={handleContinue}
          disabled={startingGame}
          className="mt-6 px-8 py-3 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-700 disabled:text-white/45 rounded-lg font-semibold transition"
        >
          {startingGame ? "Starting..." : "Continue"}
        </button>
      </div>

      <p className="mt-10 text-sm text-gray-400 italic">
        Choose the defaults for a quick start, or replace either file with your own JSON.
      </p>
    </div>
  );
}
