import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { saveLeagueDataInBackground } from "../utils/leagueStorage.js";

const CUSTOM_DRAFT_CLASS_PREFIX = "bm_custom_draft_class_";
const CUSTOM_DRAFT_CLASSES_INDEX_KEY = "bm_custom_draft_classes_v1";
const CUSTOM_DRAFT_CLASS_MODE_BY_YEAR_KEY = "bm_draft_class_mode_by_year_v1";
const DRAFT_STATE_KEY = "bm_draft_state_v1";

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

function getDraftClassStorageKey(seasonYear) {
  return `${CUSTOM_DRAFT_CLASS_PREFIX}${Number(seasonYear || 2026)}`;
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
      2026
  );

  if (Number.isFinite(year) && year >= 2020 && year <= 2100) return year;
  return Number(fallbackYear || 2026);
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
  const [error, setError] = useState("");
  const [draftClassYear, setDraftClassYear] = useState(2026);
  const [draftClassStatus, setDraftClassStatus] = useState("");
  const [draftClassIndex, setDraftClassIndex] = useState(() =>
    safeJSON(localStorage.getItem(CUSTOM_DRAFT_CLASSES_INDEX_KEY), {}) || {}
  );
  const [draftClassModes, setDraftClassModes] = useState(() =>
    safeJSON(localStorage.getItem(CUSTOM_DRAFT_CLASS_MODE_BY_YEAR_KEY), {}) || {}
  );
  const navigate = useNavigate();

  const selectedYearKey = String(Number(draftClassYear || 2026));
  const selectedClassSummary = draftClassIndex?.[selectedYearKey] || null;
  const selectedClassMode = draftClassModes?.[selectedYearKey] || (selectedClassSummary ? "custom" : "auto");

  const loadedDraftClassYears = useMemo(() => {
    return Object.keys(draftClassIndex || {})
      .filter((year) => Number.isFinite(Number(year)))
      .sort((a, b) => Number(a) - Number(b));
  }, [draftClassIndex]);

  const saveDraftClassIndex = (nextIndex) => {
    setDraftClassIndex(nextIndex);
    localStorage.setItem(CUSTOM_DRAFT_CLASSES_INDEX_KEY, JSON.stringify(nextIndex || {}));
  };

  const saveDraftClassModes = (nextModes) => {
    setDraftClassModes(nextModes);
    localStorage.setItem(CUSTOM_DRAFT_CLASS_MODE_BY_YEAR_KEY, JSON.stringify(nextModes || {}));
  };

  const setDraftClassModeForYear = (year, mode) => {
    const seasonYear = Number(year || draftClassYear || 2026);
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
        setError("");
      } catch (err) {
        setError("Invalid JSON format.");
      }
    };

    reader.readAsText(file);
  };

  const handleDraftClassUpload = (e) => {
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
        const normalized = normalizeDraftClassForVault(parsed, draftClassYear, file.name);
        const seasonYear = Number(normalized.seasonYear || draftClassYear || 2026);
        const key = String(seasonYear);

        localStorage.setItem(getDraftClassStorageKey(seasonYear), JSON.stringify(normalized));

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

        setDraftClassYear(seasonYear);
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
    const seasonYear = Number(draftClassYear || 2026);
    const key = String(seasonYear);

    localStorage.removeItem(getDraftClassStorageKey(seasonYear));

    const nextIndex = { ...(draftClassIndex || {}) };
    delete nextIndex[key];
    saveDraftClassIndex(nextIndex);

    const nextModes = { ...(draftClassModes || {}) };
    nextModes[key] = "auto";
    saveDraftClassModes(nextModes);
    clearDraftStateForYearIfNotStarted(seasonYear);

    setDraftClassStatus(`Cleared the ${seasonYear} custom draft class. This year will auto-generate rookies.`);
  };

  const handleContinue = () => {
    if (!fileName) {
      setError("Please upload a league file first!");
      return;
    }
    navigate("/team-selector");
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-900 text-white px-4 py-10">
      <h1 className="text-4xl font-bold mb-8 text-orange-500">NBA MyLeague</h1>

      <div className="flex flex-col items-center gap-4 bg-neutral-800 p-8 rounded-2xl shadow-lg w-full max-w-[460px]">
        <label
          htmlFor="fileUpload"
          className="cursor-pointer px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
        >
          Upload League JSON
        </label>

        <input
          id="fileUpload"
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleFileUpload}
        />

        {fileName && (
          <p className="text-green-400 text-sm mt-2">
            ✅ Loaded: <span className="font-semibold">{fileName}</span>
          </p>
        )}
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}

        <div className="mt-4 w-full rounded-2xl border border-purple-500/30 bg-neutral-900/80 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-lg font-bold text-purple-300">Draft Classes</h2>
              <p className="text-xs text-gray-400 mt-1">
                Optional. Upload custom classes by year. Missing years still auto-generate.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <select
              value={draftClassYear}
              onChange={(e) => setDraftClassYear(Number(e.target.value))}
              className="rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm"
            >
              {[2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035].map((year) => (
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
          className="mt-6 px-8 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg font-semibold transition"
        >
          Continue
        </button>
      </div>

      <p className="mt-10 text-sm text-gray-400 italic">
        Tip: You can use your “NBA 2025.json” to test this.
      </p>
    </div>
  );
}
