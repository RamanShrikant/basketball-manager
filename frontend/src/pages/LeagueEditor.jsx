// LeagueEditor.jsx
import React, { useState, useEffect, useMemo } from "react";
import FaceDNAEditor from "../components/FaceDNAEditor";
import { getLeagueFinancialRules } from "../utils/leagueFinancials.js";
import { saveLeagueDataInBackground } from "../utils/leagueStorage.js";

const DRAFT_CLASSES_STORAGE_KEY = "bm_custom_draft_classes_v1";
const CUSTOM_DRAFT_CLASS_PREFIX = "bm_custom_draft_class_";
const FIRST_PLAYABLE_SEASON_YEAR = 2025;
const LEAGUE_META_KEY = "bm_league_meta_v1";
const RESULT_V3_PREFIX = "bm_result_v3_";

function validSeasonYear(value) {
  const y = Number(value);
  return Number.isFinite(y) && y >= 2020 && y <= 2100 ? Math.trunc(y) : null;
}

function resolveLeagueSeasonYear(league = {}, fallback = FIRST_PLAYABLE_SEASON_YEAR) {
  return (
    validSeasonYear(league?.seasonYear) ??
    validSeasonYear(league?.currentSeasonYear) ??
    validSeasonYear(league?.seasonStartYear) ??
    fallback
  );
}

function withLeagueTimingFields(league = {}, requestedSeasonYear = FIRST_PLAYABLE_SEASON_YEAR) {
  const seasonYear = validSeasonYear(requestedSeasonYear) ?? FIRST_PLAYABLE_SEASON_YEAR;
  const expectedFinancialYear = seasonYear + 1;
  const existingFinancials =
    league.financials && typeof league.financials === "object" ? league.financials : {};

  const currentFinancialSeasonYear =
    validSeasonYear(league.currentFinancialSeasonYear) ??
    validSeasonYear(existingFinancials.currentFinancialSeasonYear) ??
    validSeasonYear(existingFinancials.currentSeasonYear) ??
    validSeasonYear(existingFinancials.appliedThroughSeasonYear) ??
    expectedFinancialYear;

  return {
    ...league,
    seasonYear,
    currentSeasonYear: seasonYear,
    seasonStartYear: seasonYear,
    currentFinancialSeasonYear,
    financials: {
      ...existingFinancials,
      baseSeasonYear:
        validSeasonYear(existingFinancials.baseSeasonYear) ?? expectedFinancialYear,
      currentSeasonYear: currentFinancialSeasonYear,
      currentFinancialSeasonYear,
      appliedThroughSeasonYear:
        validSeasonYear(existingFinancials.appliedThroughSeasonYear) ??
        validSeasonYear(existingFinancials.appliedInflationThroughSeason) ??
        currentFinancialSeasonYear,
    },
  };
}

function writeLeagueMetaSeason(seasonYear) {
  try {
    const y = validSeasonYear(seasonYear) ?? FIRST_PLAYABLE_SEASON_YEAR;
    localStorage.setItem(
      LEAGUE_META_KEY,
      JSON.stringify({
        seasonYear: y,
        currentSeasonYear: y,
        seasonStartYear: y,
      })
    );
  } catch {}
}

function clearRuntimeSeasonStores() {
  const exactKeys = [
    "bm_schedule_v3",
    "bm_results_v2",
    "bm_results_index_v3",
    "bm_player_stats_v1",
    "bm_awards_latest",
    "bm_awards_v1",
    "bm_postseason_v2",
    "bm_champ_v1",
    "bm_finals_mvp_latest",
    "bm_finals_mvp_seen_v1",
    "bm_all_stars_v1",
    "bm_offseason_state_v1",
    "bm_retirement_results_v1",
    "bm_progression_deltas_v1",
    "bm_progression_meta_v1",
    "bm_draft_lottery_v1",
  ];

  for (const key of exactKeys) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith(RESULT_V3_PREFIX) ||
        key.startsWith("bm_calendar_cursor_v1_") ||
        key.startsWith("bm_all_star_handled_v1_") ||
        key.startsWith("bm_trade_deadline_handled_v1_")
      ) {
        localStorage.removeItem(key);
      }
    }
  } catch {}
}

function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}


// PLAYER_CREATOR_FACE_LIBRARY_V1
// Free, local-only portrait creator. It loads your realistic PNG face library from public/assets/rookie_faces.
const PLAYER_CREATOR_STORAGE_KEY = "bm_realistic_face_library_presets_v1";
const ROOKIE_FACE_MANIFEST_URL = "/assets/rookie_faces/rookie_faces_manifest.json";
const FACE_DNA_VERSION = "bm_face_library_dna_v1";

const APPEARANCE_POOL_OPTIONS = [
  "Black",
  "White",
  "Latino",
  "East Asian",
  "South Asian",
  "Middle Eastern / North African",
  "Mixed Black/White",
  "Mixed Black/Latino",
  "Mixed White/Asian",
  "Mixed / Flexible",
  "Unknown",
];

const FACE_STAGE_OPTIONS = ["rookie", "young", "prime", "veteran", "old"];


const DRAFT_PICK_STATUS_OPTIONS = ["active", "conveyed", "resolved", "void"];

const DRAFT_PICK_COMMON_PROTECTION_OPTIONS = [
  {
    value: "Unprotected",
    label: "Unprotected",
    description: "The pick conveys normally with no protection.",
  },
  {
    value: "Other / see notes",
    label: "Other / see notes",
    description: "Use this for a weird real-life condition and explain it in Notes.",
  },
];

const DRAFT_PICK_FIRST_ROUND_PROTECTION_OPTIONS = [
  { value: "Top 1 protected", label: "Top 1 protected", description: "Conveys unless it lands #1." },
  { value: "Top 3 protected", label: "Top 3 protected", description: "Conveys unless it lands #1-3." },
  { value: "Top 4 protected", label: "Top 4 protected", description: "Conveys unless it lands #1-4." },
  { value: "Top 5 protected", label: "Top 5 protected", description: "Conveys unless it lands #1-5." },
  { value: "Top 6 protected", label: "Top 6 protected", description: "Conveys unless it lands #1-6." },
  { value: "Top 8 protected", label: "Top 8 protected", description: "Conveys unless it lands #1-8." },
  { value: "Top 10 protected", label: "Top 10 protected", description: "Conveys unless it lands #1-10." },
  { value: "Top 12 protected", label: "Top 12 protected", description: "Conveys unless it lands #1-12." },
  { value: "Lottery protected (1-14)", label: "Lottery protected (1-14)", description: "Conveys only if it lands outside the lottery." },
  { value: "Top 18 protected", label: "Top 18 protected", description: "Conveys only if it lands #19-30." },
  { value: "Top 20 protected", label: "Top 20 protected", description: "Conveys only if it lands #21-30." },
  { value: "Protected 1-30 / does not convey", label: "Protected 1-30 / does not convey", description: "The pick is fully protected and may vanish or convert later." },
  { value: "Converts to 2nd-round pick", label: "Converts to 2nd-round pick", description: "If it does not convey, it becomes a 2nd." },
  { value: "Converts to two 2nd-round picks", label: "Converts to two 2nd-round picks", description: "If it does not convey, it becomes two 2nds." },
  { value: "Rolling protection next year", label: "Rolling protection next year", description: "Protection carries forward to a future draft year." },
];

const DRAFT_PICK_SECOND_ROUND_PROTECTION_OPTIONS = [
  { value: "Unprotected 2nd", label: "Unprotected 2nd", description: "Second-round pick conveys normally." },
  { value: "31-40 protected", label: "31-40 protected", description: "Does not convey if it lands #31-40." },
  { value: "31-45 protected", label: "31-45 protected", description: "Does not convey if it lands #31-45." },
  { value: "31-50 protected", label: "31-50 protected", description: "Does not convey if it lands #31-50." },
  { value: "Top 45 protected", label: "Top 45 protected", description: "Conveys only if it lands #46-60." },
  { value: "Top 50 protected", label: "Top 50 protected", description: "Conveys only if it lands #51-60." },
  { value: "Top 55 protected", label: "Top 55 protected", description: "Conveys only if it lands #56-60." },
  { value: "56-60 protected", label: "56-60 protected", description: "Does not convey if it lands #56-60." },
  { value: "More favorable 2nd", label: "More favorable 2nd", description: "Owner receives the better of multiple 2nd-rounders." },
  { value: "Less favorable 2nd", label: "Less favorable 2nd", description: "Owner receives the worse of multiple 2nd-rounders." },
];

const DRAFT_PICK_SWAP_PROTECTION_OPTIONS = [
  { value: "Unprotected swap right", label: "Unprotected swap right", description: "Holder can swap if the other pick is better." },
  { value: "More favorable pick", label: "More favorable pick", description: "Holder gets the better pick between the listed teams." },
  { value: "Less favorable pick", label: "Less favorable pick", description: "Holder gets the worse pick between the listed teams." },
  { value: "Best of two picks", label: "Best of two picks", description: "Holder gets the best pick from two options." },
  { value: "Worst of two picks", label: "Worst of two picks", description: "Holder gets the worst pick from two options." },
  { value: "Best of multiple picks", label: "Best of multiple picks", description: "Holder gets the best pick from several teams/picks." },
  { value: "Least favorable of multiple picks", label: "Least favorable of multiple picks", description: "Holder gets the least favorable pick from several teams/picks." },
  { value: "Swap if pick lands outside protected range", label: "Swap if outside protected range", description: "Swap applies only if the affected pick is not protected." },
  { value: "Top 4 protected swap", label: "Top 4 protected swap", description: "No swap if the affected pick lands #1-4." },
  { value: "Top 10 protected swap", label: "Top 10 protected swap", description: "No swap if the affected pick lands #1-10." },
  { value: "Lottery protected swap", label: "Lottery protected swap", description: "No swap if the affected pick lands #1-14." },
  { value: "No swap if original team keeps protected pick", label: "No swap if protected", description: "Swap disappears if the original team keeps its protected pick." },
];

function getDraftPickProtectionOptions(asset = {}) {
  const type = asset.type === "swap" ? "swap" : "pick";
  const round = Number(asset.round || 1) === 2 ? 2 : 1;

  if (type === "swap") {
    return [
      ...DRAFT_PICK_COMMON_PROTECTION_OPTIONS,
      ...DRAFT_PICK_SWAP_PROTECTION_OPTIONS,
    ];
  }

  if (round === 2) {
    return [
      ...DRAFT_PICK_COMMON_PROTECTION_OPTIONS,
      ...DRAFT_PICK_SECOND_ROUND_PROTECTION_OPTIONS,
    ];
  }

  return [
    ...DRAFT_PICK_COMMON_PROTECTION_OPTIONS,
    ...DRAFT_PICK_FIRST_ROUND_PROTECTION_OPTIONS,
  ];
}

function createDefaultDraftPickForm(overrides = {}) {
  return {
    type: "pick",
    year: 2026,
    round: 1,
    originalTeam: "",
    ownerTeam: "",
    swapWithTeam: "",
    protections: "Unprotected",
    status: "active",
    notes: "",
    ...overrides,
  };
}

function safePickText(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function makeTeamCode(name = "") {
  const clean = safePickText(name);
  if (!clean) return "TEAM";

  const parts = clean.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();

  return parts
    .map((part) => part[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

function makeDraftPickAssetId(asset = {}) {
  const type = asset.type === "swap" ? "SWAP" : "PICK";
  const year = Number(asset.year || 2026);
  const round = Number(asset.round || 1);
  const original = makeTeamCode(asset.originalTeam || "ORIG");
  const owner = makeTeamCode(asset.ownerTeam || "OWNER");
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();

  return `${year}_${original}_${round}_${type}_${owner}_${random}`;
}

function normalizeDraftPickAsset(row = {}, index = 0) {
  const type = row.type === "swap" || row.assetType === "swap" || row.isSwap ? "swap" : "pick";
  const year = Number(row.year || row.draftYear || 2026);
  const round = Number(row.round || row.draftRound || 1);

  const protections = safePickText(row.protections || row.protectionText || row.protection || row.displayProtection || "") || "Unprotected";
  const displayProtection = safePickText(row.displayProtection || protections) || protections;

  const normalized = {
    ...row,
    id: row.id || "",
    type,
    assetType: type,
    year: Number.isFinite(year) ? year : 2026,
    round: round === 2 ? 2 : 1,
    originalTeam: safePickText(row.originalTeam || row.originalTeamName || row.teamName || row.team || ""),
    ownerTeam: safePickText(row.ownerTeam || row.currentOwner || row.currentOwnerTeamName || row.holderTeam || ""),
    swapWithTeam: safePickText(row.swapWithTeam || row.swapTeam || row.swapTargetTeam || ""),
    protections,
    displayProtection,
    protectionType: row.protectionType || row.protection_type || row.protectionKind || "",
    logicType: row.logicType || row.logic_type || "",
    source: row.source || "",
    sourceAsOf: row.sourceAsOf || row.source_as_of || "",
    realLifeDetails: row.realLifeDetails && typeof row.realLifeDetails === "object" ? row.realLifeDetails : undefined,
    status: DRAFT_PICK_STATUS_OPTIONS.includes(row.status) ? row.status : "active",
    notes: safePickText(row.notes || row.description || ""),
  };

  if (!normalized.id) {
    normalized.id = makeDraftPickAssetId({ ...normalized, index });
  }

  return normalized;
}

function normalizeDraftPickAssets(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizeDraftPickAsset(row, index))
    .filter((row) => row.originalTeam || row.ownerTeam);
}

function formatDraftPickAsset(row = {}) {
  const year = Number(row.year || 2026);
  const round = Number(row.round || 1);
  const roundText = round === 1 ? "1st" : "2nd";

  if (row.type === "swap") {
    const swapText = row.swapWithTeam
      ? `swap with ${row.swapWithTeam}`
      : "swap right";
    return `${year} ${roundText} round ${row.originalTeam || "pick"} ${swapText}`;
  }

  return `${year} ${roundText} round ${row.originalTeam || "pick"}`;
}

function createDefaultFaceLibraryCreator(overrides = {}) {
  return {
    name: "",
    age: 19,
    position: "SF",
    height: 79,
    school: "",
    faceId: "",
    stage: "rookie",
    appearancePool: "Unknown",
    skinTone: "",
    hairStyle: "",
    facialHair: "",
    expression: "",
    notes: "",
    ...overrides,
  };
}

function normalizeFaceManifestRow(row = {}) {
  const id = String(row.id || row.faceId || row.portraitId || "").trim();
  const url = String(row.url || row.file || row.path || "").trim();

  if (!id || !url) return null;

  return {
    id,
    url,
    status: row.status || "keep",
    appearancePool: row.appearancePool || row.pool || row.ethnicityGroup || "Unknown",
    skinTone: row.skinTone || "",
    hairStyle: row.hairStyle || row.hair || "",
    facialHair: row.facialHair || row.beard || "",
    expression: row.expression || "",
    notes: row.notes || "",
  };
}


function getEditorLeagueSnapshot() {
  return safeJSON(localStorage.getItem("leagueData"), {}) || {};
}

function getEditorContractStartYear() {
  const league = getEditorLeagueSnapshot();
  return Number(league?.currentFinancialSeasonYear || league?.seasonYear || league?.currentSeasonYear || 2026);
}

function getEditorDefaultSalary() {
  const league = getEditorLeagueSnapshot();
  const rules = getLeagueFinancialRules(league, getEditorContractStartYear());
  return Math.round(Number(rules.salaryCap || 154_647_000) * 0.052 / 1_000) * 1_000;
}

function getEditorDefaultSalaryByYear(years = 2) {
  const first = getEditorDefaultSalary();
  const count = Math.max(1, Number(years || 1));
  return Array.from({ length: count }, (_, idx) => Math.round(first * Math.pow(1.05, idx) / 1_000) * 1_000);
}

function creatorNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/* ------------------------------------------------------------
   League Editor v5.1 (v19 OFF/DEF parity + live table render)
   - OFF/DEF table cells now compute from live formula (no lag)
   - v19 math: PF absolute mix + PF->SF bridge + SF DEF lift
   - Banker's rounding; jitter after league-shift
   - NEW: birthdays + contracts (with options) + backwards-compatible import/load
   - NEW: free agents pool (separate from teams)
   ------------------------------------------------------------ */

export default function LeagueEditor() {
  const [leagueName, setLeagueName] = useState("NBA 2025");
  const [conferences, setConferences] = useState({ East: [], West: [] });

  // FIX 1: free agents pool + pool toggle
  const [freeAgents, setFreeAgents] = useState([]);
  const [draftPicks, setDraftPicks] = useState([]);
  const [seasonYear, setSeasonYear] = useState(FIRST_PLAYABLE_SEASON_YEAR);
  const [hasLoadedLeague, setHasLoadedLeague] = useState(false);
  const [selectedPool, setSelectedPool] = useState("TEAMS"); // "TEAMS" | "PLAYER_CREATOR" | "FA" | "DRAFT"

  const [selectedConf, setSelectedConf] = useState("East");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamLogo, setNewTeamLogo] = useState("");
  const [editingTeam, setEditingTeam] = useState(null);
  const [editingPlayer, setEditingPlayer] = useState(null);

  // FIX 6: track which pool is being edited
  const [editingPool, setEditingPool] = useState("TEAMS");

  const [showPlayerForm, setShowPlayerForm] = useState(false);
  const [playerForm, setPlayerForm] = useState(initPlayer());
  const [salaryText, setSalaryText] = useState("");
  const [optionYearsText, setOptionYearsText] = useState("");
  const [expandedTeams, setExpandedTeams] = useState({});
  const [sortedTeams, setSortedTeams] = useState({});
  const [originalOrders, setOriginalOrders] = useState({});
  const [editTeamModal, setEditTeamModal] = useState(null);

  // Draft pick / swap ownership editor state
  const [selectedPickTeam, setSelectedPickTeam] = useState("ALL");
  const [editingPickId, setEditingPickId] = useState(null);
  const [pickForm, setPickForm] = useState(createDefaultDraftPickForm());

  // Trades modal state (teams + free agents bucket)
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [tradeA, setTradeA] = useState({ pool: "TEAMS", conf: "East", teamIdx: 0 });
  const [tradeB, setTradeB] = useState({ pool: "TEAMS", conf: "West", teamIdx: 0 });
  const [sendAIds, setSendAIds] = useState([]);
  const [sendBIds, setSendBIds] = useState([]);

  // Draft class creator state. This only stores custom classes and does not decide draft mode.
  const [draftClassYear, setDraftClassYear] = useState(2026);
  const [draftClasses, setDraftClasses] = useState({});
  const [draftClassStatus, setDraftClassStatus] = useState("");

  // Realistic face-library player creator. This is separate from teams and uses your local PNG manifest.
  const [rookieFaces, setRookieFaces] = useState([]);
  const [creatorForm, setCreatorForm] = useState(createDefaultFaceLibraryCreator());
  const [creatorSaved, setCreatorSaved] = useState([]);
  const [creatorStatus, setCreatorStatus] = useState("");

  const selectedCreatorFace = useMemo(() => {
    if (!rookieFaces.length) return null;
    return rookieFaces.find((face) => face.id === creatorForm.faceId) || rookieFaces[0];
  }, [rookieFaces, creatorForm.faceId]);

  const updateCreatorForm = (patch = {}) => {
    setCreatorForm((prev) => createDefaultFaceLibraryCreator({ ...prev, ...patch }));
  };

  const allTeamsFlat = useMemo(() => {
    const out = [];
    for (const conf of ["East", "West"]) {
      for (let i = 0; i < (conferences[conf] || []).length; i++) {
        const t = conferences[conf][i];
        out.push({
          key: `${conf}-${i}`,
          conf,
          teamIdx: i,
          name: t?.name || `${conf} Team ${i + 1}`,
        });
      }
    }
    return out;
  }, [conferences]);

  const tradeTargets = useMemo(() => {
    return [
      ...allTeamsFlat.map((t) => ({
        ...t,
        pool: "TEAMS",
      })),
      {
        key: "FA",
        pool: "FA",
        conf: null,
        teamIdx: null,
        name: "Free Agents",
      },
    ];
  }, [allTeamsFlat]);

  const teamNameOptions = useMemo(
    () => allTeamsFlat.map((team) => team.name).filter(Boolean),
    [allTeamsFlat]
  );

  const getDefaultPickTeamName = () => {
    if (selectedPickTeam && selectedPickTeam !== "ALL") return selectedPickTeam;
    return teamNameOptions[0] || "";
  };

  const resetPickForm = (overrides = {}) => {
    const defaultTeam = getDefaultPickTeamName();

    setEditingPickId(null);
    setPickForm(
      createDefaultDraftPickForm({
        originalTeam: defaultTeam,
        ownerTeam: defaultTeam,
        swapWithTeam: "",
        ...overrides,
      })
    );
  };

  const updatePickForm = (patch = {}) => {
    setPickForm((prev) => createDefaultDraftPickForm({ ...prev, ...patch }));
  };

  const saveDraftPickAsset = () => {
    const originalTeam = safePickText(pickForm.originalTeam);
    const ownerTeam = safePickText(pickForm.ownerTeam);

    if (!originalTeam) {
      alert("Pick the original / affected team.");
      return;
    }

    if (!ownerTeam) {
      alert("Pick the owner / swap-right holder.");
      return;
    }

    const normalized = normalizeDraftPickAsset({
      ...pickForm,
      id: editingPickId || pickForm.id || "",
      originalTeam,
      ownerTeam,
    });

    setDraftPicks((prev) => {
      const current = normalizeDraftPickAssets(prev || []);

      if (editingPickId) {
        return current.map((row) => (row.id === editingPickId ? normalized : row));
      }

      return [...current, normalized].sort(
        (a, b) =>
          Number(a.year || 0) - Number(b.year || 0) ||
          Number(a.round || 0) - Number(b.round || 0) ||
          String(a.originalTeam || "").localeCompare(String(b.originalTeam || ""))
      );
    });

    resetPickForm();
  };

  const editDraftPickAsset = (asset) => {
    const normalized = normalizeDraftPickAsset(asset);
    setEditingPickId(normalized.id);
    setPickForm(createDefaultDraftPickForm(normalized));
  };

  const deleteDraftPickAsset = (assetId) => {
    if (!window.confirm("Delete this draft pick asset?")) return;
    setDraftPicks((prev) => normalizeDraftPickAssets(prev).filter((row) => row.id !== assetId));
    if (editingPickId === assetId) resetPickForm();
  };

  const fillMissingDefaultDraftPicks = () => {
    const years = [2026, 2027, 2028, 2029, 2030, 2031, 2032];
    const existing = new Set(
      normalizeDraftPickAssets(draftPicks).map(
        (row) =>
          `${Number(row.year)}|${Number(row.round)}|${safePickText(row.originalTeam).toLowerCase()}|${row.type}`
      )
    );

    const additions = [];

    for (const teamName of teamNameOptions) {
      for (const year of years) {
        for (const round of [1, 2]) {
          const key = `${year}|${round}|${teamName.toLowerCase()}|pick`;
          if (existing.has(key)) continue;

          additions.push(
            normalizeDraftPickAsset({
              type: "pick",
              year,
              round,
              originalTeam: teamName,
              ownerTeam: teamName,
              protections: "Unprotected",
              status: "active",
              notes: "",
            })
          );
        }
      }
    }

    if (!additions.length) {
      alert("Default future picks already exist.");
      return;
    }

    setDraftPicks((prev) =>
      [...normalizeDraftPickAssets(prev), ...additions].sort(
        (a, b) =>
          Number(a.year || 0) - Number(b.year || 0) ||
          Number(a.round || 0) - Number(b.round || 0) ||
          String(a.originalTeam || "").localeCompare(String(b.originalTeam || ""))
      )
    );
  };

  const fillMissingDefaultDraftPicksForTeam = (teamNameInput) => {
    const teamName = safePickText(teamNameInput);
    if (!teamName) return;

    const years = [2026, 2027, 2028, 2029, 2030, 2031, 2032];
    const existing = new Set(
      normalizeDraftPickAssets(draftPicks).map(
        (row) =>
          `${Number(row.year)}|${Number(row.round)}|${safePickText(row.originalTeam).toLowerCase()}|${safePickText(row.ownerTeam).toLowerCase()}|${row.type}`
      )
    );

    const additions = [];

    for (const year of years) {
      for (const round of [1, 2]) {
        const key = `${year}|${round}|${teamName.toLowerCase()}|${teamName.toLowerCase()}|pick`;
        if (existing.has(key)) continue;

        additions.push(
          normalizeDraftPickAsset({
            type: "pick",
            year,
            round,
            originalTeam: teamName,
            ownerTeam: teamName,
            protections: "Unprotected",
            status: "active",
            notes: "Auto-added default own pick from team editor.",
          })
        );
      }
    }

    if (!additions.length) {
      alert(`${teamName} already has default own 1st/2nd round picks for 2026-2032.`);
      return;
    }

    setDraftPicks((prev) =>
      [...normalizeDraftPickAssets(prev), ...additions].sort(
        (a, b) =>
          Number(a.year || 0) - Number(b.year || 0) ||
          Number(a.round || 0) - Number(b.round || 0) ||
          String(a.originalTeam || "").localeCompare(String(b.originalTeam || ""))
      )
    );
  };

  const getDraftPickAssetsForTeam = (teamNameInput) => {
    const teamName = safePickText(teamNameInput);
    if (!teamName) return [];

    return normalizeDraftPickAssets(draftPicks)
      .filter((pick) => safePickText(pick.ownerTeam) === teamName)
      .sort(
        (a, b) =>
          Number(a.year || 0) - Number(b.year || 0) ||
          Number(a.round || 0) - Number(b.round || 0) ||
          String(a.originalTeam || "").localeCompare(String(b.originalTeam || "")) ||
          String(a.type || "pick").localeCompare(String(b.type || "pick"))
      );
  };

  const startDraftPickForEditedTeam = (overrides = {}) => {
    const teamName = safePickText(editTeamModal?.name || editTeamModal?.originalName || "");
    setSelectedPickTeam(teamName || "ALL");
    setEditingPickId(null);
    setPickForm(
      createDefaultDraftPickForm({
        originalTeam: teamName,
        ownerTeam: teamName,
        swapWithTeam: "",
        ...overrides,
      })
    );
  };

  const visibleDraftPicks = useMemo(() => {
    const rows = normalizeDraftPickAssets(draftPicks);

    const filtered =
      selectedPickTeam === "ALL"
        ? rows
        : rows.filter(
            (row) =>
              row.ownerTeam === selectedPickTeam ||
              row.originalTeam === selectedPickTeam ||
              row.swapWithTeam === selectedPickTeam
          );

    return [...filtered].sort(
      (a, b) =>
        Number(a.year || 0) - Number(b.year || 0) ||
        Number(a.round || 0) - Number(b.round || 0) ||
        String(a.originalTeam || "").localeCompare(String(b.originalTeam || "")) ||
        String(a.ownerTeam || "").localeCompare(String(b.ownerTeam || ""))
    );
  }, [draftPicks, selectedPickTeam]);

  const getTeam = (ref) => {
    if (!ref || ref.pool !== "TEAMS") return null;
    return conferences?.[ref.conf]?.[ref.teamIdx] || null;
  };

  const getTradeBucket = (ref, confState = conferences, faState = freeAgents) => {
    if (!ref) return [];
    if (ref.pool === "FA") return faState || [];
    return confState?.[ref.conf]?.[ref.teamIdx]?.players || [];
  };

  const getTradeLabel = (ref) => {
    if (!ref) return "Unknown";
    if (ref.pool === "FA") return "Free Agents";
    return getTeam(ref)?.name || "Unknown Team";
  };

  const getTradeLogo = (ref) => {
    if (!ref || ref.pool === "FA") return "";
    return getTeam(ref)?.logo || "";
  };

  const encodeTradeRef = (ref) => {
    if (!ref) return "";
    if (ref.pool === "FA") return "FA";
    return `${ref.conf}-${ref.teamIdx}`;
  };

  const decodeTradeRef = (value) => {
    if (value === "FA") {
      return { pool: "FA", conf: null, teamIdx: null };
    }
    const [conf, idxStr] = String(value).split("-");
    return {
      pool: "TEAMS",
      conf,
      teamIdx: Number(idxStr),
    };
  };

  const toggleId = (arr, id) =>
    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];

  const openTradeModal = () => {
    const firstTeam = conferences?.East?.length
      ? { pool: "TEAMS", conf: "East", teamIdx: 0 }
      : conferences?.West?.length
      ? { pool: "TEAMS", conf: "West", teamIdx: 0 }
      : { pool: "FA", conf: null, teamIdx: null };

    const secondTarget = conferences?.West?.length
      ? { pool: "TEAMS", conf: "West", teamIdx: 0 }
      : { pool: "FA", conf: null, teamIdx: null };

    setTradeA(firstTeam);
    setTradeB(secondTarget);
    setSendAIds([]);
    setSendBIds([]);
    setShowTradeModal(true);
  };

const executeTrade = () => {
  const sameBucket =
    tradeA.pool === tradeB.pool &&
    tradeA.conf === tradeB.conf &&
    tradeA.teamIdx === tradeB.teamIdx;

  if (sameBucket) {
    alert("Pick two different destinations.");
    return;
  }

  const confCopy = JSON.parse(JSON.stringify(conferences));
  const faCopy = JSON.parse(JSON.stringify(freeAgents || []));

  const bucketA = getTradeBucket(tradeA, confCopy, faCopy);
  const bucketB = getTradeBucket(tradeB, confCopy, faCopy);

  const aSend = bucketA.filter((p) => sendAIds.includes(p.id)).map((p0) => normalizePlayer(p0));
  const bSend = bucketB.filter((p) => sendBIds.includes(p.id)).map((p0) => normalizePlayer(p0));

  const destATeamName =
    tradeA.pool === "FA"
      ? null
      : confCopy?.[tradeA.conf]?.[tradeA.teamIdx]?.name || null;

  const destBTeamName =
    tradeB.pool === "FA"
      ? null
      : confCopy?.[tradeB.conf]?.[tradeB.teamIdx]?.name || null;

  const movePlayersToDestination = (players, destTeamName, destPool) => {
    return players.map((p0) => {
      const p = normalizePlayer(p0);

      const nextMeta = {
        ...(p.meta || buildDefaultMeta()),
        acquiredVia: destPool === "FA" ? "waivers" : "trade",
      };

      const nextRights =
        destPool === "FA"
          ? {
              ...(p.rights || buildDefaultRights()),
              heldByTeam: null,
              seasonsTowardBird: 0,
              birdLevel: "none",
            }
          : {
              ...(p.rights || buildDefaultRights()),
              heldByTeam: destTeamName,
            };

      return {
        ...p,
        meta: nextMeta,
        rights: buildDefaultRights(nextRights),
      };
    });
  };

  const movedAToB = movePlayersToDestination(aSend, destBTeamName, tradeB.pool);
  const movedBToA = movePlayersToDestination(bSend, destATeamName, tradeA.pool);

  const nextA = bucketA
    .filter((p) => !sendAIds.includes(p.id))
    .concat(movedBToA);

  const nextB = bucketB
    .filter((p) => !sendBIds.includes(p.id))
    .concat(movedAToB);

  if (tradeA.pool === "FA") {
    faCopy.splice(0, faCopy.length, ...nextA);
  } else {
    confCopy[tradeA.conf][tradeA.teamIdx].players = nextA;
  }

  if (tradeB.pool === "FA") {
    faCopy.splice(0, faCopy.length, ...nextB);
  } else {
    confCopy[tradeB.conf][tradeB.teamIdx].players = nextB;
  }

  setConferences(confCopy);
  setFreeAgents(faCopy);

  setSendAIds([]);
  setSendBIds([]);
  setShowTradeModal(false);
};
  function getBirdLevelFromSeasons(seasonsTowardBird = 0) {
  const n = Math.max(0, Number(seasonsTowardBird) || 0);

  if (n >= 3) return "bird";
  if (n >= 2) return "early_bird";
  if (n >= 1) return "non_bird";
  return "none";
}

function buildDefaultRights(overrides = {}) {
  const seasonsTowardBird = Math.max(
    0,
    Number(overrides?.seasonsTowardBird) || 0
  );

  return {
    heldByTeam: overrides?.heldByTeam ?? null,
    seasonsTowardBird,
    birdLevel:
      overrides?.birdLevel ?? getBirdLevelFromSeasons(seasonsTowardBird),
    rookieScale: Boolean(overrides?.rookieScale),
    restrictedFreeAgent: Boolean(overrides?.restrictedFreeAgent),
  };
}

function buildDefaultMeta(overrides = {}) {
  return {
    draftYear:
      overrides?.draftYear === null || overrides?.draftYear === undefined
        ? null
        : Number(overrides.draftYear),
    draftRound:
      overrides?.draftRound === null || overrides?.draftRound === undefined
        ? null
        : Number(overrides.draftRound),
    draftPick:
      overrides?.draftPick === null || overrides?.draftPick === undefined
        ? null
        : Number(overrides.draftPick),
    draftedBy: overrides?.draftedBy ?? null,
    acquiredVia: overrides?.acquiredVia ?? "editor",
    proSeasons: Math.max(0, Number(overrides?.proSeasons) || 0),
    yearsWithCurrentTeam: Math.max(0, Number(overrides?.yearsWithCurrentTeam) || 0),
  };
}

function buildDefaultHistory(overrides = {}) {
  return {
    seasons: Array.isArray(overrides?.seasons) ? overrides.seasons : [],
    accolades: Array.isArray(overrides?.accolades) ? overrides.accolades : [],
    transactions: Array.isArray(overrides?.transactions) ? overrides.transactions : [],
  };
}

function getBirdLabel(birdLevel) {
  if (birdLevel === "bird") return "Full Bird";
  if (birdLevel === "early_bird") return "Early Bird";
  if (birdLevel === "non_bird") return "Non-Bird";
  return "None";
}

function getBirdCreditFromLevel(birdLevel) {
  if (birdLevel === "bird") return 3;
  if (birdLevel === "early_bird") return 2;
  if (birdLevel === "non_bird") return 1;
  return 0;
}

const ACCOLADE_OPTIONS = [
  { value: "mvp", label: "Most Valuable Player" },
  { value: "dpoy", label: "Defensive Player of the Year" },
  { value: "roy", label: "Rookie of the Year" },
  { value: "sixth_man", label: "Sixth Man of the Year" },
  { value: "mip", label: "Most Improved Player" },
  { value: "clutch_player", label: "Clutch Player of the Year" },
  { value: "all_nba_first", label: "All-NBA First Team" },
  { value: "all_nba_second", label: "All-NBA Second Team" },
  { value: "all_nba_third", label: "All-NBA Third Team" },
  { value: "all_defensive_first", label: "All-Defensive First Team" },
  { value: "all_defensive_second", label: "All-Defensive Second Team" },
  { value: "all_rookie_first", label: "All-Rookie First Team" },
  { value: "all_rookie_second", label: "All-Rookie Second Team" },
  { value: "all_star", label: "NBA All-Star" },
  { value: "all_star_mvp", label: "All-Star Game MVP" },
  { value: "scoring_champ", label: "Scoring Champion" },
  { value: "assist_champ", label: "Assist Champion" },
  { value: "rebounding_champ", label: "Rebounding Champion" },
  { value: "steals_champ", label: "Steals Champion" },
  { value: "blocks_champ", label: "Blocks Champion" },
  { value: "nba_champion", label: "NBA Champion" },
  { value: "finals_mvp", label: "Finals MVP" },
  { value: "custom", label: "Custom" },
];

function getAccoladeLabel(type) {
  const found = ACCOLADE_OPTIONS.find((item) => item.value === type);
  return found?.label ?? "Custom";
}
  /* ---------------- Player Model ---------------- */
function initPlayer() {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    pos: "PG",
    secondaryPos: "",
    age: 25,
    height: 78,
    attrs: Array(15).fill(75),
    overall: 75,
    offRating: 75,
    defRating: 75,
    stamina: 75,
    potential: 75,
    headshot: "",
    appearanceDNA: null,
    scoringRating: 50,

    // birthdays
    birthMonth: 1,
    birthDay: 1,

    // contract
    contract: {
      startYear: getEditorContractStartYear(),
      salaryByYear: getEditorDefaultSalaryByYear(2),
      option: null,
    },

    // Bird rights / team-control scaffolding
    rights: buildDefaultRights(),

    // career / rookie / draft scaffolding
    meta: buildDefaultMeta(),

    // career continuity
    history: buildDefaultHistory(),
  };
}
  // Backwards-compatible defaults for player objects (load/import/edit)
const normalizePlayer = (p) => {
  const birthMonth = Number(p?.birthMonth ?? 1);
  const birthDay = Number(p?.birthDay ?? 1);

  const safeMeta = buildDefaultMeta(p?.meta ?? {});
  const safeHistory = buildDefaultHistory(p?.history ?? {});

  const rawRights =
    p?.rights ??
    {
      heldByTeam: null,
      seasonsTowardBird: 0,
      rookieScale: false,
      restrictedFreeAgent: false,
    };

  const safeRights = buildDefaultRights(rawRights);

  // IMPORTANT: allow true free agents to have no contract at all
  if (p?.contract === null) {
    return {
      ...p,
      headshot: p?.headshot || "",
      scoringRating: p?.scoringRating ?? 50,
      birthMonth: Math.min(12, Math.max(1, birthMonth)),
      birthDay: Math.min(31, Math.max(1, birthDay)),
      rights: safeRights,
      meta: safeMeta,
      history: safeHistory,
      contract: null,
    };
  }

  const contract =
    p?.contract ??
    (p?.salary != null || p?.contractYears != null
      ? {
          startYear: getEditorContractStartYear(),
          salaryByYear: Array(Math.max(1, Number(p.contractYears ?? 1))).fill(
            Number(p.salary ?? (getEditorDefaultSalary() / 1_000_000)) * 1_000_000
          ),
          option: null,
        }
      : {
          startYear: getEditorContractStartYear(),
          salaryByYear: getEditorDefaultSalaryByYear(2),
          option: null,
        });

  const rawOption = contract?.option ?? null;

  const safeContract = {
    startYear: Number(contract?.startYear ?? getEditorContractStartYear()),
    salaryByYear: Array.isArray(contract?.salaryByYear)
      ? contract.salaryByYear.map((x) => Number(x) || 0)
      : getEditorDefaultSalaryByYear(1),
    option: rawOption
      ? {
          type: rawOption?.type === "player" ? "player" : "team",
          yearIndices: getOptionYearIndices(rawOption),
          picked: rawOption?.picked ?? null,
        }
      : null,
  };

  return {
    ...p,
    headshot: p?.headshot || "",
    scoringRating: p?.scoringRating ?? 50,
    birthMonth: Math.min(12, Math.max(1, birthMonth)),
    birthDay: Math.min(31, Math.max(1, birthDay)),
    rights: safeRights,
    meta: safeMeta,
    history: safeHistory,
    contract: safeContract,
  };
};

  const formatSalaryText = (salaryByYear = []) => {
    return (salaryByYear || [])
      .map((x) => {
        const m = Number(x) / 1_000_000;
        return Number.isFinite(m) ? String(m) : "";
      })
      .filter(Boolean)
      .join(", ");
  };

  const parseSalaryText = (text) => {
    const vals = String(text || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => Math.round(Number(s) * 1_000_000))
      .filter((n) => Number.isFinite(n) && n >= 0);

    return vals.length ? vals : getEditorDefaultSalaryByYear(1);
  };

  function getOptionYearIndices(option) {
    if (!option) return [];

    const raw = Array.isArray(option.yearIndices)
      ? option.yearIndices
      : option.yearIndex != null
      ? [option.yearIndex]
      : [];

    return [...new Set(
      raw
        .map((x) => Number(x))
        .filter((n) => Number.isInteger(n) && n >= 0)
    )].sort((a, b) => a - b);
  }

  function formatOptionYearsText(option) {
    return getOptionYearIndices(option)
      .map((i) => String(i + 1))
      .join(", ");
  }

  function parseOptionYearsText(text, maxN = 1) {
    const seen = new Set();

    return String(text || "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 1)
      .map((n) => Math.min(maxN, Math.max(1, Math.floor(n))) - 1)
      .filter((n) => {
        if (seen.has(n)) return false;
        seen.add(n);
        return true;
      })
      .sort((a, b) => a - b);
  }

  function formatOptionSummary(option) {
    if (!option?.type) return "—";
    const ys = getOptionYearIndices(option).map((i) => `Y${i + 1}`);
    return ys.length ? `${option.type.toUpperCase()} ${ys.join(", ")}` : option.type.toUpperCase();
  }

  /* ---------------- Attribute indexes ---------------- */
  const T3 = 0,
    MID = 1,
    CLOSE = 2,
    FT = 3,
    BH = 4,
    PAS = 5,
    SPD = 6,
    ATH = 7;
  const PERD = 8,
    INTD = 9,
    BLK = 10,
    STL = 11,
    REB = 12,
    OIQ = 13,
    DIQ = 14;

  /* ---------------- Position Params for Overall (unchanged) ---------------- */
  const posParams = {
    PG: {
      weights: [
        0.11, 0.05, 0.03, 0.05, 0.17, 0.17, 0.1, 0.07, 0.1, 0.02, 0.01, 0.07, 0.05,
        0.01, 0.01,
      ],
      prim: [5, 6, 1, 7],
      alpha: 0.25,
    },
    SG: {
      weights: [
        0.15, 0.08, 0.05, 0.05, 0.12, 0.07, 0.11, 0.07, 0.11, 0.03, 0.02, 0.08,
        0.06, 0.01, 0.01,
      ],
      prim: [1, 5, 7],
      alpha: 0.28,
    },
    SF: {
      weights: [
        0.12, 0.09, 0.07, 0.04, 0.08, 0.07, 0.1, 0.1, 0.1, 0.06, 0.04, 0.08,
        0.05, 0.01, 0.01,
      ],
      prim: [1, 8, 9],
      alpha: 0.22,
    },
    PF: {
      weights: [
        0.07, 0.07, 0.12, 0.03, 0.05, 0.05, 0.08, 0.12, 0.07, 0.13, 0.08,
        0.08, 0.05, 0.01, 0.01,
      ],
      prim: [3, 10, 8],
      alpha: 0.24,
    },
    C: {
      weights: [
        0.04, 0.06, 0.17, 0.03, 0.02, 0.04, 0.07, 0.12, 0.05, 0.16, 0.13,
        0.06, 0.08, 0.01, 0.01,
      ],
      prim: [3, 10, 11, 13],
      alpha: 0.3,
    },
  };

  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const attrNames = [
    "Three Point",
    "Mid Range",
    "Close Shot",
    "Free Throw",
    "Ball Handling",
    "Passing",
    "Speed",
    "Athleticism",
    "Perimeter Defense",
    "Interior Defense",
    "Block",
    "Steal",
    "Rebounding",
    "Offensive IQ",
    "Defensive IQ",
  ];

  /* ---------------- v19 OFF weights on position z ---------------- */
  const OFF_WEIGHTS_POSZ = {
    PG: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.2, [PAS]: 0.2, [SPD]: 0.04, [ATH]: 0.02, [OIQ]: 0.0 },
    SG: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.14, [PAS]: 0.14, [SPD]: 0.06, [ATH]: 0.06, [OIQ]: 0.02 },
    SF: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.1, [PAS]: 0.1, [SPD]: 0.08, [ATH]: 0.1, [OIQ]: 0.08 },
    PF: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.1, [PAS]: 0.12, [SPD]: 0.08, [ATH]: 0.08, [OIQ]: 0.08 },
    C: { [T3]: 0.18, [MID]: 0.18, [CLOSE]: 0.18, [BH]: 0.04, [PAS]: 0.1, [SPD]: 0.06, [ATH]: 0.16, [OIQ]: 0.1 },
  };

  /* ---------------- v19 penalties ---------------- */
  const threePenaltyMult = (pos) =>
    ({ PG: 1.1, SG: 1.0, SF: 0.75, PF: 0.8, C: 0.3 }[pos] || 1);
  const closePenaltyMult = (pos) =>
    ({ PG: 0.3, SG: 0.45, SF: 0.7, PF: 0.85, C: 1.1 }[pos] || 1);

  /* ---------------- Helpers ---------------- */
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function bankersRound(n) {
    const f = Math.floor(n);
    const diff = n - f;
    if (Math.abs(diff - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
    return Math.round(n);
  }

  function v19Jitter(name = "", attrs = []) {
    let sA = 0;
    for (let i = 0; i < attrs.length; i++) sA += (i + 1) * (attrs[i] ?? 0);
    let sN = 0;
    for (let i = 0; i < name.length; i++) sN += name.charCodeAt(i);
    const seed = (sA + 0.13 * sN) * 12.9898;
    const raw = Math.sin(seed) * 43758.5453;
    const frac = raw - Math.floor(raw);
    return (frac - 0.5) * 0.7;
  }

  const sigmoid = (x) => 1 / (1 + Math.exp(-0.12 * (x - 77)));

  /* ---------------- Overall & Stamina (unchanged) ---------------- */
  const calcOverall = (attrs, pos) => {
    const p = posParams[pos];
    if (!p) return 0;
    const W = p.weights.reduce((s, w, i) => s + w * (attrs[i] || 75), 0);
    const prim = p.prim.map((i) => i - 1);
    const Peak = Math.max(...prim.map((i) => attrs[i] || 75));
    const B = p.alpha * Peak + (1 - p.alpha) * W;
    let overall = 60 + 39 * sigmoid(B);
    overall = Math.round(Math.min(99, Math.max(60, overall)));
    const num90 = (attrs || []).filter((a) => a >= 90).length;
    if (num90 >= 3) {
      const bonus = num90 - 2;
      overall = Math.min(99, overall + bonus);
    }
    return overall;
  };

  const calcStamina = (age, athleticism) => {
    age = clamp(age, 18, 45);
    athleticism = clamp(athleticism, 25, 99);
    let ageFactor;
    if (age <= 27) ageFactor = 1.0;
    else if (age <= 34) ageFactor = 0.95 - (0.15 * (age - 28)) / 6;
    else ageFactor = 0.8 - (0.45 * (age - 35)) / 10;
    ageFactor = clamp(ageFactor, 0.35, 1.0);
    const raw = ageFactor * 99 * 0.575 + athleticism * 0.425;
    const norm = (raw - 40) / (99 - 40);
    return Math.round(clamp(40 + norm * 59, 40, 99));
  };

  /* ---------------- v19 Baselines (pos means/std + league-absolute means/std) ---------------- */
  const ratingBaselines = useMemo(() => {
    const POS = ["PG", "SG", "SF", "PF", "C"];
    const offIdx = [T3, MID, CLOSE, BH, PAS, SPD, ATH, OIQ];
    const defIdx = [PERD, STL, INTD, BLK, SPD, ATH];

    const allPlayers = [...(conferences.East || []), ...(conferences.West || [])].flatMap((t) =>
      (t.players || []).map((p) => ({
        pos: POS.includes(p.pos) ? p.pos : "SF",
        attrs: p.attrs || Array(15).fill(75),
      }))
    );

    const posBuckets = Object.fromEntries(
      POS.map((p) => [
        p,
        Object.fromEntries([...offIdx, ...defIdx].map((k) => [k, []])),
      ])
    );
    const absBuckets = Object.fromEntries(offIdx.map((k) => [k, []]));

    for (const pl of allPlayers) {
      const { pos, attrs } = pl;
      for (const k of [...offIdx, ...defIdx]) posBuckets[pos][k].push(attrs[k]);
      for (const k of offIdx) absBuckets[k].push(attrs[k]);
    }

    const sampleStd = (arr) => {
      const n = arr.length;
      if (n < 2) return 1.0;
      const m = arr.reduce((s, v) => s + v, 0) / n;
      const v = arr.reduce((s, v2) => s + (v2 - m) * (v2 - m), 0) / (n - 1);
      return Math.max(1.0, Math.sqrt(v));
    };

    const posMean = {}, posStd = {};
    for (const p of POS) {
      posMean[p] = {};
      posStd[p] = {};
      for (const k of [...offIdx, ...defIdx]) {
        const arr = posBuckets[p][k];
        posMean[p][k] = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 75;
        posStd[p][k] = arr.length ? sampleStd(arr) : 1.0;
      }
    }

    const absMean = {}, absStd = {};
    for (const k of offIdx) {
      const arr = absBuckets[k];
      absMean[k] = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 75;
      absStd[k] = arr.length ? sampleStd(arr) : 1.0;
    }

    const safe = (v) => (v && v > 1e-6 ? v : 1.0);
    const zPos = (attrs, pos, k) => (attrs[k] - (posMean[pos]?.[k] ?? 75)) / safe(posStd[pos]?.[k]);
    const zAbs = (attrs, k) => (attrs[k] - (absMean[k] ?? 75)) / safe(absStd[k]);

    const pfBridgedWeights = (() => {
      const pf = OFF_WEIGHTS_POSZ.PF, sf = OFF_WEIGHTS_POSZ.SF;
      const keys = new Set([...Object.keys(pf), ...Object.keys(sf)].map(Number));
      const out = {};
      for (const k of keys) out[k] = 0.7 * (pf[k] || 0) + 0.3 * (sf[k] || 0);
      return out;
    })();

    const ABS_MIX = { PF: 0.7, SF: 0.2, PG: 0.1, SG: 0.1, C: 0.1 };
    const zToRating = (z) => clamp(75 + 12 * z, 50, 99);

    const previewOff = (attrs, pos) => {
      const p = ["PG", "SG", "SF", "PF", "C"].includes(pos) ? pos : "SF";
      const w = p === "PF" ? pfBridgedWeights : OFF_WEIGHTS_POSZ[p] || OFF_WEIGHTS_POSZ.SF;
      const mix = ABS_MIX[p] ?? 0.1;

      let zPosSum = 0, zAbsSum = 0;
      for (const [kStr, wt] of Object.entries(w)) {
        const k = +kStr;
        zPosSum += wt * zPos(attrs, p, k);
        zAbsSum += wt * zAbs(attrs, k);
      }

      let off = zToRating((1 - mix) * zPosSum + mix * zAbsSum);

      const t3Gap = Math.max(0, 50 - (attrs[T3] || 0) - 2);
      const cGap = Math.max(0, 60 - (attrs[CLOSE] || 0) - 2);
      off -= Math.min(6, 0.07 * threePenaltyMult(p) * t3Gap);
      off -= Math.min(6, 0.07 * closePenaltyMult(p) * cGap);
      return clamp(off, 50, 99);
    };

    const previewDef = (attrs, pos) => {
      const p = ["PG", "SG", "SF", "PF", "C"].includes(pos) ? pos : "SF";
      const DW =
        {
          PG: { [PERD]: 0.58, [STL]: 0.32, [SPD]: 0.06, [ATH]: 0.04 },
          SG: { [PERD]: 0.46, [STL]: 0.26, [INTD]: 0.12, [BLK]: 0.08, [SPD]: 0.04, [ATH]: 0.04 },
          SF: { [PERD]: 0.28, [STL]: 0.18, [INTD]: 0.28, [BLK]: 0.18, [ATH]: 0.05, [SPD]: 0.03 },
          PF: { [INTD]: 0.45, [BLK]: 0.35, [PERD]: 0.08, [STL]: 0.08, [ATH]: 0.04 },
          C: { [INTD]: 0.52, [BLK]: 0.4, [ATH]: 0.06, [PERD]: 0.01, [STL]: 0.01 },
        }[p] || {};
      let zsum = 0;
      for (const [kStr, wt] of Object.entries(DW)) zsum += wt * zPos(attrs, p, +kStr);
      let def = zToRating(zsum);

      const ath = attrs[ATH] ?? 75;
      let absPen = Math.max(0, 78 - ath) * 0.08;
      let relPen = Math.max(0, (posMean[p]?.[ATH] ?? 75) - ath) * 0.05;

      if (p === "SF") {
        absPen *= 0.8;
        relPen *= 0.8;
        def += 2.5;
        const perd = attrs[PERD] ?? 75, intd = attrs[INTD] ?? 75;
        const hi = Math.max(perd, intd), lo = Math.min(perd, intd);
        if (perd >= 88 && intd >= 88) def += Math.min(1.0, (Math.min(perd, intd) - 88) * 0.05);
        let tier = 0;
        if (perd >= 90 || intd >= 90) tier += 0.5;
        if (perd >= 85 && intd >= 85) tier += 0.5;
        if (hi >= 93 && lo >= 84) tier += 0.5;
        if (hi >= 94 && lo >= 90) tier += 0.5;
        def += Math.min(2.0, tier);
      }

      def -= Math.min(4, absPen + relPen);
      const cap = p === "C" ? 99 : p === "PF" ? 98 : 96;
      return clamp(def, 50, cap);
    };

    let sumOV = 0, sumOFF = 0, sumDEF = 0, n = 0;
    for (const t of [...(conferences.East || []), ...(conferences.West || [])]) {
      for (const p of t.players || []) {
        const a = p.attrs || Array(15).fill(75);
        sumOV += calcOverall(a, p.pos);
        n++;
        sumOFF += previewOff(a, p.pos);
        sumDEF += previewDef(a, p.pos);
      }
    }

    const ovMean = n ? sumOV / n : 75;
    const offMean = n ? sumOFF / n : 75;
    const defMean = n ? sumDEF / n : 75;

    const offShift = clamp(ovMean - offMean, -1.5, 1.5);
    const defShift = clamp(ovMean - defMean, -1.5, 1.5);

    return { posMean, posStd, absMean, absStd, offShift, defShift };
  }, [conferences]);

  /* ---------------- v19 Ratings (live) ---------------- */
  const calcOffDef = (attrs, pos, name = "", height = 78) => {
    const p = ["PG", "SG", "SF", "PF", "C"].includes(pos) ? pos : "SF";
    const { posMean, posStd, absMean, absStd, offShift, defShift } = ratingBaselines;

    const safe = (v) => (v && v > 1e-6 ? v : 1.0);
    const zPos = (k) => (attrs[k] - (posMean[p]?.[k] ?? 75)) / safe(posStd[p]?.[k]);
    const zAbs = (k) => (attrs[k] - (absMean[k] ?? 75)) / safe(absStd[k]);
    const zToRating = (z) => clamp(75 + 12 * z, 50, 99);

    const ABS_MIX = { PF: 0.7, SF: 0.2, PG: 0.1, SG: 0.1, C: 0.1 };
    const wBase =
      p === "PF"
        ? (() => {
            const pf = OFF_WEIGHTS_POSZ.PF, sf = OFF_WEIGHTS_POSZ.SF;
            const keys = new Set([...Object.keys(pf), ...Object.keys(sf)].map(Number));
            const out = {};
            for (const k of keys) out[k] = 0.7 * (pf[k] || 0) + 0.3 * (sf[k] || 0);
            return out;
          })()
        : OFF_WEIGHTS_POSZ[p] || OFF_WEIGHTS_POSZ.SF;

    let zPosSum = 0, zAbsSum = 0;
    for (const [kStr, wt] of Object.entries(wBase)) {
      const k = +kStr;
      zPosSum += wt * zPos(k);
      zAbsSum += wt * zAbs(k);
    }
    const mix = ABS_MIX[p] ?? 0.1;
    let off = zToRating((1 - mix) * zPosSum + mix * zAbsSum);

    const t3Gap = Math.max(0, 50 - (attrs[T3] || 0) - 2);
    const cGap = Math.max(0, 60 - (attrs[CLOSE] || 0) - 2);
    off -= Math.min(6, 0.07 * threePenaltyMult(p) * t3Gap);
    off -= Math.min(6, 0.07 * closePenaltyMult(p) * cGap);

    const DW =
      {
        PG: { [PERD]: 0.58, [STL]: 0.32, [SPD]: 0.06, [ATH]: 0.04 },
        SG: { [PERD]: 0.46, [STL]: 0.26, [INTD]: 0.12, [BLK]: 0.08, [SPD]: 0.04, [ATH]: 0.04 },
        SF: { [PERD]: 0.28, [STL]: 0.18, [INTD]: 0.28, [BLK]: 0.18, [ATH]: 0.05, [SPD]: 0.03 },
        PF: { [INTD]: 0.45, [BLK]: 0.35, [PERD]: 0.08, [STL]: 0.08, [ATH]: 0.04 },
        C: { [INTD]: 0.52, [BLK]: 0.4, [ATH]: 0.06, [PERD]: 0.01, [STL]: 0.01 },
      }[p] || {};
    let zsumD = 0;
    for (const [kStr, wt] of Object.entries(DW)) zsumD += wt * zPos(+kStr);
    let def = zToRating(zsumD);

    const ath = attrs[ATH] ?? 75;
    let absPen = Math.max(0, 78 - ath) * 0.08;
    let relPen = Math.max(0, (posMean[p]?.[ATH] ?? 75) - ath) * 0.05;
    if (p === "SF") {
      absPen *= 0.8;
      relPen *= 0.8;
      def += 2.5;
      const perd = attrs[PERD] ?? 75, intd = attrs[INTD] ?? 75;
      const hi = Math.max(perd, intd), lo = Math.min(perd, intd);
      if (perd >= 88 && intd >= 88) def += Math.min(1.0, (Math.min(perd, intd) - 88) * 0.05);
      let tier = 0;
      if (perd >= 90 || intd >= 90) tier += 0.5;
      if (perd >= 85 && intd >= 85) tier += 0.5;
      if (hi >= 93 && lo >= 84) tier += 0.5;
      if (hi >= 94 && lo >= 90) tier += 0.5;
      def += Math.min(2.0, tier);
    }
    def -= Math.min(4, absPen + relPen);

    const j = v19Jitter(name, attrs);
    off = clamp(off + offShift + j, 50, 99);
    const defCap = p === "C" ? 99 : p === "PF" ? 98 : 96;
    def = clamp(def + defShift + 0.7 * j, 50, defCap);

    return { off: bankersRound(off), def: bankersRound(def) };
  };

  function explodeJS(value, power) {
    return (value / 100) ** power;
  }

  function closePenaltyJS(close) {
    if (close >= 70) return 0;
    return ((70 - close) / 30) ** 2.3;
  }

  function calcScoringRating(pos, three, mid, close) {
    if (pos === "PG" || pos === "SG") {
      const three_term = explodeJS(three, 7) * 1.2;
      const mid_term = explodeJS(mid, 7) * 1.55;
      const close_term = explodeJS(close, 6) * 1.1;

      const base = 0.38 * (three / 100) + 0.4 * (mid / 100) + 0.22 * (close / 100);
      const penalty = closePenaltyJS(close) * 1.7;

      const raw = base + three_term + mid_term + close_term - penalty;
      const scaled = raw * 14.75 + 43.5;
      return scaled;
    }

    if (pos === "SF") {
      const three_term = explodeJS(three, 7) * 1.05;
      const mid_term = explodeJS(mid, 7) * 1.4;
      const close_term = explodeJS(close, 7) * 1.5;

      const base = 0.32 * (three / 100) + 0.35 * (mid / 100) + 0.33 * (close / 100);
      const penalty = closePenaltyJS(close) * 1.2;

      const raw = base + three_term + mid_term + close_term - penalty;
      const scaled = raw * 14.75 + 43.5;
      return scaled;
    }

    if (pos === "PF" || pos === "C") {
      const close_term = explodeJS(close, 8) * 1.95;
      const mid_term = explodeJS(mid, 6) * 1.3;
      const three_term = explodeJS(three, 5) * 0.6;

      const base = 0.58 * (close / 100) + 0.27 * (mid / 100) + 0.15 * (three / 100);
      const penalty = closePenaltyJS(close) * 2.0;

      const raw = base + three_term + mid_term + close_term - penalty;
      const scaled = raw * 14.75 + 43.5;
      return scaled;
    }

    return 50;
  }

  function safeDraftIdText(value = "") {
    return String(value || "prospect")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "prospect";
  }

  function getDraftClassStorageKey(seasonYear) {
    return `${CUSTOM_DRAFT_CLASS_PREFIX}${Number(seasonYear || draftClassYear || 2026)}`;
  }

  function getDraftClassForYear(year = draftClassYear) {
    return draftClasses[String(Number(year || 2026))] || [];
  }

  function getDraftSourceForProspect(row = {}) {
    return (
      row.college ||
      row.school ||
      row.university ||
      row.academy ||
      row.academyName ||
      row.sourceName ||
      row.draftSource ||
      row.nationality ||
      ""
    );
  }

  function normalizeDraftProspect(row = {}, index = 0, seasonYear = draftClassYear) {
    const rank = Number(row.trueRank || row.rank || row.draftProjection || index + 1);
    const name = String(row.name || row.playerName || `Custom Prospect ${index + 1}`).trim();
    const pos = ["PG", "SG", "SF", "PF", "C"].includes(row.pos || row.position)
      ? row.pos || row.position
      : "SF";
    const secondaryPos = ["PG", "SG", "SF", "PF", "C"].includes(row.secondaryPos || row.secondaryPosition)
      ? row.secondaryPos || row.secondaryPosition
      : "";

    const attrs = Array.isArray(row.attrs)
      ? row.attrs.map((x) => clamp(Number(x) || 75, 25, 99)).slice(0, 15)
      : Array.isArray(row.attributes)
      ? row.attributes.map((x) => clamp(Number(x) || 75, 25, 99)).slice(0, 15)
      : Array(15).fill(75);

    while (attrs.length < 15) attrs.push(75);

    const age = clamp(Number(row.age || 19), 18, 23);
    const height = clamp(Number(row.height || 78), 65, 90);
    const overall = clamp(
      Number(row.overall ?? row.ovr ?? calcOverall(attrs, pos)),
      50,
      99
    );
    const potential = clamp(Number(row.potential ?? row.pot ?? overall), overall, 99);
    const offDef = calcOffDef(attrs, pos, name, height);
    const scoringRating = Number.isFinite(Number(row.scoringRating))
      ? Number(row.scoringRating)
      : calcScoringRating(pos, attrs[0], attrs[1], attrs[2]);
    const stamina = clamp(Number(row.stamina ?? calcStamina(age, attrs[ATH])), 40, 99);
    const source = getDraftSourceForProspect(row);
    const headshot = row.headshot || row.image || row.img || "";
    const resolvedSeasonYear = Number(seasonYear || row.draftClassYear || row.seasonYear || draftClassYear || 2026);

    return normalizePlayer({
      ...row,
      id: row.id || `custom_${resolvedSeasonYear}_${String(rank).padStart(3, "0")}_${safeDraftIdText(name)}`,
      draftClassYear: Number(row.draftClassYear || resolvedSeasonYear),
      name,
      portraitId: row.portraitId || "",
      portraitFamilyId: row.portraitFamilyId || row.portraitId || "",
      portraitVariant: row.portraitVariant || "custom",
      headshot,
      image: row.image || headshot,
      img: row.img || headshot,
      age,
      birthMonth: clamp(Number(row.birthMonth || 1), 1, 12),
      birthDay: clamp(Number(row.birthDay || 1), 1, 28),
      pos,
      secondaryPos,
      height,
      weight: clamp(Number(row.weight || 215), 150, 320),
      college: row.college || source,
      school: row.school || source,
      university: row.university || source,
      academy: row.academy || source,
      academyName: row.academyName || source,
      sourceName: row.sourceName || source,
      draftSource: row.draftSource || source,
      sourceType: row.sourceType || row.collegeBucket || "custom",
      collegeBucket: row.collegeBucket || row.sourceType || "custom",
      nationality: row.nationality || "USA",
      ethnicityGroup: row.ethnicityGroup || "custom",
      subgroup: row.subgroup || "custom",
      skinTone: row.skinTone || "custom",
      identityKey: row.identityKey || "custom",
      region: row.region || "custom",
      archetype: row.archetype || row.type || "Custom Prospect",
      tier: row.tier || "Custom",
      overall,
      potential,
      floor: clamp(Number(row.floor || overall - 4), 45, overall),
      ceiling: clamp(Number(row.ceiling || potential), potential, 99),
      attrs,
      offRating: Number.isFinite(Number(row.offRating)) ? Number(row.offRating) : offDef.off,
      defRating: Number.isFinite(Number(row.defRating)) ? Number(row.defRating) : offDef.def,
      stamina,
      scoringRating,
      draftProjection: clamp(Number(row.draftProjection || rank), 1, 110),
      trueRank: clamp(Number(row.trueRank || rank), 1, 110),
      contract: null,
      rights: buildDefaultRights({ rookieScale: true }),
      meta: buildDefaultMeta({
        draftYear: resolvedSeasonYear,
        acquiredVia: "draft_class_editor",
        proSeasons: 0,
        yearsWithCurrentTeam: 0,
      }),
      scouting: row.scouting || {
        projectedRangeLow: clamp(rank - 3, 1, 110),
        projectedRangeHigh: clamp(rank + 8, 1, 110),
        scoutedOverallRange: [clamp(overall - 2, 45, 99), clamp(overall + 2, 45, 99)],
        scoutedPotentialRange: [clamp(potential - 4, overall, 99), clamp(potential + 3, overall, 99)],
      },
      traits: {
        nbaReady: Number(row.traits?.nbaReady ?? Math.max(0.05, Math.min(0.98, (overall - 55) / 32))),
        boomBust: Number(row.traits?.boomBust ?? 0.3),
        workEthic: Number(row.traits?.workEthic ?? 0.7),
        injuryRisk: Number(row.traits?.injuryRisk ?? 0.12),
        starUpside: Number(row.traits?.starUpside ?? Math.max(0.02, Math.min(0.98, (potential - 70) / 29))),
      },
    });
  }

  function normalizeDraftClassPayload(rawPayload, fallbackSeasonYear = draftClassYear) {
    const payload = rawPayload || {};
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.draftClass)
      ? payload.draftClass
      : Array.isArray(payload.prospects)
      ? payload.prospects
      : Array.isArray(payload.players)
      ? payload.players
      : [];

    const seasonYear = Number(payload.seasonYear || payload.draftClassYear || fallbackSeasonYear || 2026);
    const draftClass = rows.map((row, index) => normalizeDraftProspect(row, index, seasonYear));

    return {
      ok: true,
      version: "league_editor_draft_class_creator_v1",
      seasonYear,
      classType: "custom",
      count: draftClass.length,
      draftClass,
      classMeta: {
        seasonYear,
        classType: "custom",
        prospectCount: draftClass.length,
        summary: `${seasonYear} custom draft class`,
        source: "LeagueEditor draft class creator",
      },
    };
  }

  function persistDraftClasses(nextClasses) {
    localStorage.setItem(DRAFT_CLASSES_STORAGE_KEY, JSON.stringify(nextClasses || {}));

    for (const [year, rows] of Object.entries(nextClasses || {})) {
      const seasonYear = Number(year);
      if (!Number.isFinite(seasonYear)) continue;

      const payload = normalizeDraftClassPayload({ seasonYear, draftClass: rows || [] }, seasonYear);
      localStorage.setItem(getDraftClassStorageKey(seasonYear), JSON.stringify(payload));
    }
  }

  function updateDraftClassYear(year, updater) {
    const seasonYear = Number(year || draftClassYear || 2026);
    setDraftClasses((prev) => {
      const copy = JSON.parse(JSON.stringify(prev || {}));
      const key = String(seasonYear);
      const current = copy[key] || [];
      copy[key] = typeof updater === "function" ? updater(current) : updater;
      persistDraftClasses(copy);
      return copy;
    });
  }

  function exportDraftClassYear(year = draftClassYear) {
    const seasonYear = Number(year || draftClassYear || 2026);
    const payload = normalizeDraftClassPayload(
      {
        seasonYear,
        draftClass: getDraftClassForYear(seasonYear),
      },
      seasonYear
    );

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `custom_draft_class_${seasonYear}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importDraftClassYear(file) {
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const normalized = normalizeDraftClassPayload(parsed, draftClassYear);

        if (!normalized.draftClass.length) {
          throw new Error("Draft class JSON has no prospects.");
        }

        const seasonYear = Number(normalized.seasonYear || draftClassYear || 2026);

        setDraftClasses((prev) => {
          const copy = JSON.parse(JSON.stringify(prev || {}));
          copy[String(seasonYear)] = normalized.draftClass.map((row, index) =>
            normalizeDraftProspect(row, index, seasonYear)
          );
          persistDraftClasses(copy);
          return copy;
        });

        setDraftClassYear(seasonYear);
        setDraftClassStatus(
          `Imported ${normalized.draftClass.length} prospects into the ${seasonYear} draft class.`
        );
      } catch (err) {
        const message = err?.message || "Failed to import draft class JSON.";
        setDraftClassStatus(message);
        alert(message);
      }
    };

    reader.readAsText(file);
  }

  function clearDraftClassYear(year = draftClassYear) {
    const seasonYear = Number(year || draftClassYear || 2026);
    if (!window.confirm(`Clear the ${seasonYear} custom draft class?`)) return;

    setDraftClasses((prev) => {
      const copy = JSON.parse(JSON.stringify(prev || {}));
      delete copy[String(seasonYear)];
      persistDraftClasses(copy);
      localStorage.removeItem(getDraftClassStorageKey(seasonYear));
      return copy;
    });
    setDraftClassStatus(`Cleared custom draft class ${seasonYear}.`);
  }


  function syncCreatorFaceTags(face = selectedCreatorFace) {
    if (!face) return;
    setCreatorForm((prev) =>
      createDefaultFaceLibraryCreator({
        ...prev,
        faceId: face.id,
        appearancePool: prev.appearancePool && prev.appearancePool !== "Unknown" ? prev.appearancePool : face.appearancePool || "Unknown",
        skinTone: prev.skinTone || face.skinTone || "",
        hairStyle: prev.hairStyle || face.hairStyle || "",
        facialHair: prev.facialHair || face.facialHair || "",
        expression: prev.expression || face.expression || "",
        notes: prev.notes || face.notes || "",
      })
    );
  }

  function randomizeCreatorFace() {
    if (!rookieFaces.length) {
      setCreatorStatus("No rookie faces loaded yet. Check /assets/rookie_faces/rookie_faces_manifest.json.");
      return;
    }

    const face = rookieFaces[Math.floor(Math.random() * rookieFaces.length)];
    setCreatorForm((prev) =>
      createDefaultFaceLibraryCreator({
        ...prev,
        faceId: face.id,
        appearancePool: face.appearancePool || prev.appearancePool || "Unknown",
        skinTone: face.skinTone || prev.skinTone || "",
        hairStyle: face.hairStyle || prev.hairStyle || "",
        facialHair: face.facialHair || prev.facialHair || "",
        expression: face.expression || prev.expression || "",
        notes: face.notes || prev.notes || "",
      })
    );
    setCreatorStatus(`Selected ${face.id}.`);
  }

  function buildPlayerFromCreator(destination = "creator") {
    const face = selectedCreatorFace;

    if (!face) {
      alert("No face selected. Make sure the rookie face manifest loaded correctly.");
      return null;
    }

    const base = initPlayer();
    const age = creatorNumber(creatorForm.age, 19, 18, 45);
    const height = creatorNumber(creatorForm.height, 79, 65, 90);
    const pos = ["PG", "SG", "SF", "PF", "C"].includes(creatorForm.position)
      ? creatorForm.position
      : "SF";
    const name = String(creatorForm.name || "Created Rookie").trim() || "Created Rookie";

    const raw = {
      ...base,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      age,
      height,
      pos,
      headshot: face.url,
      image: face.url,
      img: face.url,
      portraitId: face.id,
      portraitFamilyId: face.id,
      portraitVariant: creatorForm.stage || "rookie",
      appearanceDNA: {
        version: FACE_DNA_VERSION,
        source: "realistic_face_library",
        faceId: face.id,
        stage: creatorForm.stage || "rookie",
        imageUrl: face.url,
        appearancePool: creatorForm.appearancePool || face.appearancePool || "Unknown",
        skinTone: creatorForm.skinTone || face.skinTone || "",
        hairStyle: creatorForm.hairStyle || face.hairStyle || "",
        facialHair: creatorForm.facialHair || face.facialHair || "",
        expression: creatorForm.expression || face.expression || "",
        notes: creatorForm.notes || face.notes || "",
      },
      meta: buildDefaultMeta({
        acquiredVia: destination,
        proSeasons: 0,
        yearsWithCurrentTeam: 0,
      }),
      rights: buildDefaultRights(),
    };

    const p = normalizePlayer(raw);
    const { off, def } = calcOffDef(p.attrs, p.pos, p.name, p.height);

    return {
      ...p,
      overall: calcOverall(p.attrs, p.pos),
      offRating: off,
      defRating: def,
      stamina: calcStamina(p.age, p.attrs[ATH]),
      scoringRating: calcScoringRating(p.pos, p.attrs[0], p.attrs[1], p.attrs[2]),
    };
  }

  function saveCreatorPreset() {
    const face = selectedCreatorFace;

    if (!face) {
      setCreatorStatus("No face selected. Check the rookie face manifest path.");
      return;
    }

    const nextPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: new Date().toISOString(),
      ...creatorForm,
      faceId: face.id,
      headshot: face.url,
      appearanceDNA: {
        version: FACE_DNA_VERSION,
        source: "realistic_face_library",
        faceId: face.id,
        stage: creatorForm.stage || "rookie",
        imageUrl: face.url,
        appearancePool: creatorForm.appearancePool || face.appearancePool || "Unknown",
        skinTone: creatorForm.skinTone || face.skinTone || "",
        hairStyle: creatorForm.hairStyle || face.hairStyle || "",
        facialHair: creatorForm.facialHair || face.facialHair || "",
        expression: creatorForm.expression || face.expression || "",
        notes: creatorForm.notes || face.notes || "",
      },
    };

    const next = [nextPreset, ...(creatorSaved || [])].slice(0, 80);
    setCreatorSaved(next);
    localStorage.setItem(PLAYER_CREATOR_STORAGE_KEY, JSON.stringify(next));
    setCreatorStatus(`Saved face-library preset${creatorForm.name ? ` for ${creatorForm.name}` : ""}.`);
  }

  function addCreatorPlayerToFreeAgents() {
    const p = buildPlayerFromCreator("free_agency");
    if (!p) return;

    const faPlayer = normalizePlayer({
      ...p,
      contract: null,
      rights: buildDefaultRights({ heldByTeam: null }),
      meta: buildDefaultMeta({
        ...(p.meta || {}),
        acquiredVia: "free_agency",
        proSeasons: 0,
        yearsWithCurrentTeam: 0,
      }),
    });

    setFreeAgents((prev) => [faPlayer, ...(prev || [])]);
    setCreatorStatus(`Added ${faPlayer.name} to Free Agents with ${faPlayer.appearanceDNA?.faceId || "selected face"}.`);
  }

  function addCreatorPlayerToDraftClass() {
    const p = buildPlayerFromCreator("draft_class_editor");
    if (!p) return;

    updateDraftClassYear(draftClassYear, (current) => {
      const copy = JSON.parse(JSON.stringify(current || []));
      const index = copy.length;
      const source = creatorForm.school || p.school || "";

      copy.push(
        normalizeDraftProspect(
          {
            ...p,
            contract: null,
            school: source,
            college: source,
            academy: source,
            academyName: source,
            sourceName: source,
            draftSource: source,
            draftClassYear,
            draftProjection: index + 1,
            trueRank: index + 1,
            rights: buildDefaultRights({ rookieScale: true }),
            meta: buildDefaultMeta({
              draftYear: draftClassYear,
              acquiredVia: "draft_class_editor",
              proSeasons: 0,
              yearsWithCurrentTeam: 0,
            }),
          },
          index,
          draftClassYear
        )
      );

      return copy.map((row, i) => normalizeDraftProspect(row, i, draftClassYear));
    });

    setDraftClassStatus(`Added ${p.name} to the ${draftClassYear} draft class.`);
    setCreatorStatus(`Added ${p.name} to the ${draftClassYear} draft class.`);
  }

  useEffect(() => {
    const saved = safeJSON(localStorage.getItem(PLAYER_CREATOR_STORAGE_KEY), []);
    setCreatorSaved(Array.isArray(saved) ? saved : []);
  }, []);

  useEffect(() => {
    let alive = true;

    fetch(ROOKIE_FACE_MANIFEST_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load ${ROOKIE_FACE_MANIFEST_URL}`);
        return res.json();
      })
      .then((data) => {
        if (!alive) return;

        const rows = Array.isArray(data)
          ? data.map(normalizeFaceManifestRow).filter(Boolean)
          : [];

        setRookieFaces(rows);

        if (rows.length) {
          setCreatorForm((prev) =>
            createDefaultFaceLibraryCreator({
              ...prev,
              faceId: prev.faceId || rows[0].id,
              appearancePool: prev.appearancePool && prev.appearancePool !== "Unknown" ? prev.appearancePool : rows[0].appearancePool || "Unknown",
              skinTone: prev.skinTone || rows[0].skinTone || "",
              hairStyle: prev.hairStyle || rows[0].hairStyle || "",
              facialHair: prev.facialHair || rows[0].facialHair || "",
              expression: prev.expression || rows[0].expression || "",
              notes: prev.notes || rows[0].notes || "",
            })
          );
          setCreatorStatus(`Loaded ${rows.length} rookie face assets from the manifest.`);
        } else {
          setCreatorStatus("Manifest loaded, but it did not contain any usable face rows.");
        }
      })
      .catch((err) => {
        if (!alive) return;
        setRookieFaces([]);
        setCreatorStatus(`${err?.message || "Could not load rookie face manifest."} Make sure it is saved at public/assets/rookie_faces/rookie_faces_manifest.json.`);
      });

    return () => {
      alive = false;
    };
  }, []);

  /* ---------------- Auto-Save + Load ---------------- */
  useEffect(() => {
    const saved = localStorage.getItem("leagueData");
    if (!saved) {
      setHasLoadedLeague(true);
      return;
    }

    try {
      const data = JSON.parse(saved);
      const updated = { ...data, conferences: {} };

      for (const side of ["East", "West"]) {
        updated.conferences[side] = (data.conferences?.[side] || []).map((team) => ({
          ...team,
          players: (team.players || []).map((p) => {
            const three = p.attrs?.[0] ?? 75;
            const mid = p.attrs?.[1] ?? 75;
            const close = p.attrs?.[2] ?? 75;
            const scoringRating = calcScoringRating(p.pos, three, mid, close);
            return normalizePlayer({ ...p, scoringRating });
          }),
        }));
      }

      // FIX 2: load free agents
      updated.freeAgents = (data.freeAgents || []).map((p) => {
        const three = p.attrs?.[0] ?? 75;
        const mid = p.attrs?.[1] ?? 75;
        const close = p.attrs?.[2] ?? 75;
        const scoringRating = calcScoringRating(p.pos, three, mid, close);
        return normalizePlayer({ ...p, scoringRating });
      });

      updated.draftPicks = normalizeDraftPickAssets(data.draftPicks || data.picks || []);

      const resolvedSeasonYear = resolveLeagueSeasonYear(data);
      const timed = withLeagueTimingFields(updated, resolvedSeasonYear);

      setLeagueName(timed.leagueName);
      setConferences(timed.conferences);
      setFreeAgents(timed.freeAgents || []);
      setDraftPicks(timed.draftPicks || []);
      setSeasonYear(resolvedSeasonYear);
    } catch (err) {
      console.error(err);
    } finally {
      setHasLoadedLeague(true);
    }
  }, []);

  useEffect(() => {
    const savedClasses = safeJSON(localStorage.getItem(DRAFT_CLASSES_STORAGE_KEY), {});
    const loaded = {};

    for (const [year, value] of Object.entries(savedClasses || {})) {
      const seasonYear = Number(year);
      if (!Number.isFinite(seasonYear)) continue;

      const rows = Array.isArray(value)
        ? value
        : Array.isArray(value?.draftClass)
        ? value.draftClass
        : [];

      loaded[String(seasonYear)] = rows.map((row, index) => normalizeDraftProspect(row, index, seasonYear));
    }

    for (let year = 2026; year <= 2035; year++) {
      const savedPayload = safeJSON(localStorage.getItem(getDraftClassStorageKey(year)), null);
      if (savedPayload?.draftClass?.length && !loaded[String(year)]) {
        loaded[String(year)] = savedPayload.draftClass.map((row, index) => normalizeDraftProspect(row, index, year));
      }
    }

    setDraftClasses(loaded);
    const years = Object.keys(loaded).sort();
    if (years.length) {
      setDraftClassYear(Number(years[0]));
      setDraftClassStatus(`Loaded ${years.length} saved custom draft class${years.length === 1 ? "" : "es"}.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasLoadedLeague) return;

    // FIX 2: save free agents too
    // Draft picks are central league assets, not stored inside team objects.
    const timedLeague = withLeagueTimingFields(
      {
        leagueName,
        conferences,
        freeAgents,
        draftPicks: normalizeDraftPickAssets(draftPicks),
      },
      seasonYear
    );

    writeLeagueMetaSeason(seasonYear);
    localStorage.setItem("leagueData", JSON.stringify(timedLeague));
    saveLeagueDataInBackground(timedLeague);
  }, [hasLoadedLeague, leagueName, conferences, freeAgents, draftPicks, seasonYear]);

  /* ---------------- Live Recalc in Modal ---------------- */
  useEffect(() => {
    if (!showPlayerForm) return;
    setPlayerForm((prev) => {
      const overall = calcOverall(prev.attrs, prev.pos);
      const { off, def } = calcOffDef(prev.attrs, prev.pos, prev.name, prev.height);
      const stamina = calcStamina(prev.age, prev.attrs[ATH]);

      const three = prev.attrs[0];
      const mid = prev.attrs[1];
      const close = prev.attrs[2];
      const scoringRating = calcScoringRating(prev.pos, three, mid, close);

      return {
        ...prev,
        overall,
        offRating: off,
        defRating: def,
        scoringRating,
        stamina,
      };
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPlayerForm, playerForm.attrs, playerForm.age, playerForm.potential, playerForm.height, playerForm.pos, playerForm.name]);

  /* ---------------- Handlers ---------------- */
  const addTeam = () => {
    if (!newTeamName.trim()) return;
    const team = { name: newTeamName.trim(), logo: newTeamLogo.trim(), players: [] };
    setConferences((prev) => ({ ...prev, [selectedConf]: [...prev[selectedConf], team] }));
    setNewTeamName("");
    setNewTeamLogo("");
  };

  const openEditTeam = (idx) => {
    const team = conferences[selectedConf][idx];
    const teamName = safePickText(team?.name || "");

    setEditTeamModal({ idx, originalName: teamName, ...team });
    setSelectedPickTeam(teamName || "ALL");
    setEditingPickId(null);
    setPickForm(
      createDefaultDraftPickForm({
        originalTeam: teamName,
        ownerTeam: teamName,
      })
    );
  };

  const saveEditTeam = () => {
    const oldName = safePickText(editTeamModal?.originalName || "");
    const newName = safePickText(editTeamModal?.name || "");

    setConferences((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));
      copy[selectedConf][editTeamModal.idx].name = editTeamModal.name;
      copy[selectedConf][editTeamModal.idx].logo = editTeamModal.logo;
      return copy;
    });

    if (oldName && newName && oldName !== newName) {
      setDraftPicks((prev) =>
        normalizeDraftPickAssets(prev).map((pick) => ({
          ...pick,
          originalTeam: pick.originalTeam === oldName ? newName : pick.originalTeam,
          ownerTeam: pick.ownerTeam === oldName ? newName : pick.ownerTeam,
          swapWithTeam: pick.swapWithTeam === oldName ? newName : pick.swapWithTeam,
        }))
      );
    }

    setEditTeamModal(null);
  };

  // FIX 6: openPlayerForm supports pool selection
  const openPlayerForm = (tIdx, pIdx = null, pool = "TEAMS") => {
    setEditingPool(pool);
    setEditingTeam(tIdx);

    if (pIdx !== null) {
      setEditingPlayer(pIdx);

      const ex =
        pool === "FA"
          ? freeAgents[pIdx]
          : pool === "DRAFT"
          ? getDraftClassForYear(draftClassYear)[pIdx]
          : conferences[selectedConf][tIdx].players[pIdx];

      const safe = normalizePlayer({
        potential: 75,
        height: 78,
        secondaryPos: "",
        scoringRating: 50,
        ...ex,
      });
      setPlayerForm(JSON.parse(JSON.stringify(safe)));
      setSalaryText(formatSalaryText(safe.contract?.salaryByYear || []));
      setOptionYearsText(formatOptionYearsText(safe.contract?.option));
    } else {
      setEditingPlayer(null);
      const fresh = initPlayer();
      const next =
        pool === "FA"
          ? { ...fresh, contract: null }
          : pool === "DRAFT"
          ? normalizeDraftProspect(
              {
                ...fresh,
                name: "",
                age: 19,
                potential: 75,
                contract: null,
                school: "",
                college: "",
                academy: "",
                draftClassYear,
                draftProjection: getDraftClassForYear(draftClassYear).length + 1,
                trueRank: getDraftClassForYear(draftClassYear).length + 1,
              },
              getDraftClassForYear(draftClassYear).length,
              draftClassYear
            )
          : fresh;

      setPlayerForm(next);
      setSalaryText(formatSalaryText(next.contract?.salaryByYear || []));
      setOptionYearsText(formatOptionYearsText(next.contract?.option));
    }
    setShowPlayerForm(true);
  };
    const getEditingRightsHolder = () => {
    if (editingPool === "FA" || editingPool === "DRAFT") return null;
    return conferences?.[selectedConf]?.[editingTeam]?.name || null;
  };

  const savePlayer = () => {
    const salaryByYear = parseSalaryText(salaryText);
    const optionType = playerForm.contract?.option?.type ?? null;
    const optionYearIndices = parseOptionYearsText(
      optionYearsText,
      Math.max(1, salaryByYear.length)
    );

    const builtOption =
      optionType && optionYearIndices.length
        ? {
            type: optionType,
            yearIndices: optionYearIndices,
            picked: playerForm.contract?.option?.picked ?? null,
          }
        : null;

    const rightsHolder = getEditingRightsHolder();

    const p = normalizePlayer({
      ...playerForm,
      rights: buildDefaultRights({
        ...(playerForm.rights ?? buildDefaultRights()),
        heldByTeam: rightsHolder,
      }),
      contract:
        editingPool === "DRAFT"
          ? null
          : {
              ...(playerForm.contract ?? {}),
              startYear: playerForm.contract?.startYear ?? getEditorContractStartYear(),
              salaryByYear,
              option: builtOption,
            },
    });

    const { off, def } = calcOffDef(p.attrs, p.pos, p.name, p.height);
    p.overall = calcOverall(p.attrs, p.pos);
    p.offRating = off;
    p.defRating = def;
    p.stamina = calcStamina(p.age, p.attrs[ATH]);

    // FIX 6: write to correct pool
    if (editingPool === "FA") {
      setFreeAgents((prev) => {
        const copy = JSON.parse(JSON.stringify(prev || []));
        if (editingPlayer !== null) copy[editingPlayer] = p;
        else copy.push(p);
        return copy;
      });
    } else if (editingPool === "DRAFT") {
      updateDraftClassYear(draftClassYear, (current) => {
        const copy = JSON.parse(JSON.stringify(current || []));
        const index = editingPlayer !== null ? editingPlayer : copy.length;
        const prospect = normalizeDraftProspect(p, index, draftClassYear);
        if (editingPlayer !== null) copy[editingPlayer] = prospect;
        else copy.push(prospect);
        return copy.map((row, i) => normalizeDraftProspect(row, i, draftClassYear));
      });
      setDraftClassStatus(`Saved ${p.name || "prospect"} to the ${draftClassYear} draft class.`);
    } else {
      setConferences((prev) => {
        const copy = JSON.parse(JSON.stringify(prev));
        if (editingPlayer !== null) copy[selectedConf][editingTeam].players[editingPlayer] = p;
        else copy[selectedConf][editingTeam].players.push(p);
        return copy;
      });
    }

    setShowPlayerForm(false);
  };

  const toggleSort = (idx) => {
    setConferences((prev) => {
      const copy = JSON.parse(JSON.stringify(prev));
      const team = copy[selectedConf][idx];
      const isSorted = !sortedTeams[idx];

      if (isSorted) {
        setOriginalOrders((prevOrders) => ({
          ...prevOrders,
          [`${selectedConf}-${idx}`]: [...team.players],
        }));
        team.players.sort((a, b) => b.overall - a.overall);
      } else {
        setOriginalOrders((prevOrders) => {
          const saved = prevOrders[`${selectedConf}-${idx}`];
          if (saved) team.players = saved;
          const newOrders = { ...prevOrders };
          delete newOrders[`${selectedConf}-${idx}`];
          return newOrders;
        });
      }
      return copy;
    });

    setSortedTeams((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleAdvanced = (idx) => setExpandedTeams((prev) => ({ ...prev, [idx]: !prev[idx] }));

  const buildExportSnapshot = () => {
    const clone = JSON.parse(JSON.stringify(conferences));
    const recalcPlayer = (p0) => {
      const p = normalizePlayer(p0);
      const { off, def } = calcOffDef(p.attrs, p.pos, p.name, p.height);
      const scoringRating = calcScoringRating(p.pos, p.attrs[0], p.attrs[1], p.attrs[2]);

      return {
        ...p,
        overall: calcOverall(p.attrs, p.pos),
        offRating: off,
        defRating: def,
        scoringRating,
        stamina: calcStamina(p.age, p.attrs[ATH]),
      };
    };

    ["East", "West"].forEach((side) => {
      clone[side] = (clone[side] || []).map((team) => ({
        ...team,
        players: (team.players || []).map(recalcPlayer),
      }));
    });

    // FIX 3: export recalced free agents too
    const freeAgentsOut = (freeAgents || []).map(recalcPlayer);
    return { conferences: clone, freeAgents: freeAgentsOut };
  };

  /* ---------------- UI ---------------- */
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-bold text-center">League Editor</h1>

      <div className="flex flex-col md:flex-row items-center justify-center gap-4">
        <input
          className="border p-2 rounded w-60"
          value={leagueName}
          onChange={(e) => setLeagueName(e.target.value)}
          placeholder="League Name"
        />
        <div className="flex gap-2">
          <label className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300 cursor-pointer">
            Import JSON
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = (x) => {
                  try {
                    const d = JSON.parse(x.target.result);
                    if (d.leagueName && d.conferences) {
                      const updated = { ...d, conferences: {} };

                      for (const side of ["East", "West"]) {
                        updated.conferences[side] = (d.conferences[side] || []).map((team) => ({
                          ...team,
                          players: (team.players || []).map((p) => {
                            const three = p.attrs?.[0] ?? 75;
                            const mid = p.attrs?.[1] ?? 75;
                            const close = p.attrs?.[2] ?? 75;
                            const scoringRating = calcScoringRating(p.pos, three, mid, close);
                            return normalizePlayer({ ...p, scoringRating });
                          }),
                        }));
                      }

                      // FIX 4: import free agents
                      updated.freeAgents = (d.freeAgents || []).map((p) => {
                        const three = p.attrs?.[0] ?? 75;
                        const mid = p.attrs?.[1] ?? 75;
                        const close = p.attrs?.[2] ?? 75;
                        const scoringRating = calcScoringRating(p.pos, three, mid, close);
                        return normalizePlayer({ ...p, scoringRating });
                      });

                      updated.draftPicks = normalizeDraftPickAssets(d.draftPicks || d.picks || []);

                      const resolvedSeasonYear = resolveLeagueSeasonYear(d);
                      const timed = withLeagueTimingFields(updated, resolvedSeasonYear);

                      clearRuntimeSeasonStores();
                      writeLeagueMetaSeason(resolvedSeasonYear);

                      setLeagueName(timed.leagueName);
                      setConferences(timed.conferences);
                      setFreeAgents(timed.freeAgents || []);
                      setDraftPicks(timed.draftPicks || []);
                      setSeasonYear(resolvedSeasonYear);

                      localStorage.setItem("leagueData", JSON.stringify(timed));
                      saveLeagueDataInBackground(timed);

                      alert(`✅ Imported ${timed.leagueName} as ${resolvedSeasonYear}-${resolvedSeasonYear + 1} (birthdays + contracts + free agents + draft picks kept / added)`);
                    } else alert("⚠️ Invalid JSON");
                  } catch {
                    alert("❌ Failed to parse JSON");
                  }
                };
                r.readAsText(f);
              }}
            />
          </label>

          <button
            onClick={openTradeModal}
            className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
          >
            Trades
          </button>

          <button
            onClick={() => {
              // FIX 3: export includes free agents, recalced
              const snapshot = buildExportSnapshot();
              const json = withLeagueTimingFields(
                {
                  leagueName,
                  conferences: snapshot.conferences,
                  freeAgents: snapshot.freeAgents,
                  draftPicks: normalizeDraftPickAssets(draftPicks),
                },
                seasonYear
              );
              const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${leagueName}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Export JSON
          </button>
        </div>
      </div>

      {/* FIX 5: Pool Toggle */}
      <div className="flex justify-center gap-4 flex-wrap">
        {["TEAMS", "PLAYER_CREATOR", "FA", "DRAFT"].map((p) => (
          <button
            key={p}
            onClick={() => setSelectedPool(p)}
            className={`px-4 py-2 rounded ${
              selectedPool === p ? "bg-orange-600 text-white" : "bg-gray-200"
            }`}
          >
            {p === "TEAMS"
              ? "Teams"
              : p === "PLAYER_CREATOR"
              ? "Player Creator"
              : p === "FA"
              ? "Free Agents"
              : p === "DRAFT"
              ? "Draft Classes"
              : "Draft Picks"}
          </button>
        ))}
      </div>

      {/* Only show conference toggle when on Teams */}
      {selectedPool === "TEAMS" && (
        <div className="flex justify-center gap-4">
          {["East", "West"].map((c) => (
            <button
              key={c}
              onClick={() => setSelectedConf(c)}
              className={`px-4 py-2 rounded ${
                selectedConf === c ? "bg-green-600 text-white" : "bg-gray-200"
              }`}
            >
              {c} Conference
            </button>
          ))}
        </div>
      )}

      {/* Only show team creation when on Teams */}
      {selectedPool === "TEAMS" && (
        <div className="flex flex-wrap justify-center gap-2">
          <input
            className="border p-2 rounded w-52"
            placeholder="Team Name"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
          />
          <input
            className="border p-2 rounded w-52"
            placeholder="Logo URL"
            value={newTeamLogo}
            onChange={(e) => setNewTeamLogo(e.target.value)}
          />
          <button
            onClick={addTeam}
            className="bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700"
          >
            Add Team
          </button>
        </div>
      )}

      {selectedPool === "PLAYER_CREATOR" && (
        <div className="max-w-7xl mx-auto border rounded-2xl p-8 bg-white shadow-lg">
          <FaceDNAEditor />
        </div>
      )}

      {/* FIX 7: Free Agents table */}
      {selectedPool === "FA" && (
        <div className="border rounded-2xl p-8 bg-white shadow-lg">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-2xl font-bold">Free Agents</h2>
            <button
              onClick={() => {
                openPlayerForm(null, null, "FA");
                setPlayerForm((prev) => ({ ...prev, contract: null }));
              }}
              className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
            >
              Add Free Agent
            </button>
          </div>

          <table className="w-full text-base">
            <thead>
              <tr className="border-b">
                <th className="text-left font-semibold">Player</th>
                <th className="text-center font-semibold">Pos</th>
                <th className="text-center font-semibold">Age</th>
                <th className="text-center font-semibold">Height</th>
                <th className="text-center font-semibold">OVR</th>
                <th className="text-center font-semibold">OFF</th>
                <th className="text-center font-semibold">DEF</th>
                <th className="text-center font-semibold">POT</th>
                <th className="text-center font-semibold">SCO</th>
                <th className="text-center font-semibold">Contract</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {(freeAgents || []).map((p0, i) => {
                const p = normalizePlayer(p0);
                const live = calcOffDef(p.attrs, p.pos, p.name, p.height);

                return (
                  <tr key={p.id || i} className="border-b align-middle py-4">
                    <td className="flex items-center gap-4 py-4">
                      {p.headshot && (
                        <div
                          className="w-16 h-16 rounded-full bg-white border border-slate-200"
                          style={{
                            backgroundImage: `url(${p.headshot})`,
                            backgroundSize: "80%",
                            backgroundPosition: "center 10%",
                            backgroundRepeat: "no-repeat",
                          }}
                        />
                      )}
                      <div>
                        <div className="font-semibold text-base">{p.name}</div>
                        <div className="text-[0.8rem] text-slate-600">FA</div>
                      </div>
                    </td>

                    <td className="text-center">
                      {p.pos}
                      {p.secondaryPos ? ` / ${p.secondaryPos}` : ""}
                    </td>
                    <td className="text-center">{p.age}</td>
                    <td className="text-center">{formatHeight(p.height)}</td>
                    <td className="text-center font-bold">{p.overall}</td>
                    <td className="text-center">{live.off}</td>
                    <td className="text-center">{live.def}</td>
                    <td className="text-center">{p.potential}</td>
                    <td className="text-center">{p.scoringRating?.toFixed(1) ?? "—"}</td>

                    <td className="text-center text-sm text-slate-700">
                      {(() => {
                        const c = p.contract;
                        if (!c) return "Unsigned";
                        const years = c.salaryByYear ?? [];
                        const cur = years.length ? years[0] : 0;
                        const curM = (Number(cur) || 0) / 1_000_000;

                        const opt = formatOptionSummary(c.option);

                        return `${years.length}Y | $${curM.toFixed(1)}M | ${opt}`;
                      })()}
                    </td>

                    <td className="text-right">
                      <button
                        onClick={() => openPlayerForm(null, i, "FA")}
                        className="text-blue-600 text-sm hover:underline mr-2"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          setFreeAgents((prev) => {
                            const copy = JSON.parse(JSON.stringify(prev || []));
                            copy.splice(i, 1);
                            return copy;
                          });
                        }}
                        className="text-red-600 text-xl hover:opacity-75"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                );
              })}

              {!(freeAgents || []).length && (
                <tr>
                  <td colSpan={11} className="text-center text-slate-500 py-6">
                    No free agents yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}


      {selectedPool === "DRAFT" && (
        <div className="border rounded-2xl p-8 bg-white shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
            <div>
              <h2 className="text-2xl font-bold">Draft Class Creator</h2>
              <p className="text-sm text-slate-600 mt-1">
                Build custom rookie classes here. The calendar/draft flow can later ask whether to use one.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <select
                className="border p-2 rounded bg-white"
                value={draftClassYear}
                onChange={(e) => setDraftClassYear(Number(e.target.value))}
              >
                {[2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035].map((year) => (
                  <option key={year} value={year}>
                    Class of {year}
                  </option>
                ))}
              </select>

              <button
                onClick={() => openPlayerForm(null, null, "DRAFT")}
                className="bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700"
              >
                Add Prospect
              </button>

              <label className="bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700 cursor-pointer">
                Import Class JSON
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    importDraftClassYear(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>

              <button
                onClick={() => exportDraftClassYear(draftClassYear)}
                className="bg-purple-600 text-white px-3 py-2 rounded hover:bg-purple-700"
              >
                Export Class JSON
              </button>

              <button
                onClick={() => clearDraftClassYear(draftClassYear)}
                className="bg-gray-200 px-3 py-2 rounded hover:bg-gray-300"
              >
                Clear Class
              </button>
            </div>
          </div>

          <div className="text-sm text-slate-700 mb-3">
            Class of <span className="font-bold">{draftClassYear}</span> | Prospects: {getDraftClassForYear(draftClassYear).length}
          </div>

          {draftClassStatus && (
            <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50 px-4 py-2 text-sm text-purple-900">
              {draftClassStatus}
            </div>
          )}

          <table className="w-full text-base">
            <thead>
              <tr className="border-b">
                <th className="text-left font-semibold">Prospect</th>
                <th className="text-center font-semibold">School / Academy</th>
                <th className="text-center font-semibold">Pos</th>
                <th className="text-center font-semibold">Age</th>
                <th className="text-center font-semibold">Height</th>
                <th className="text-center font-semibold">OVR</th>
                <th className="text-center font-semibold">OFF</th>
                <th className="text-center font-semibold">DEF</th>
                <th className="text-center font-semibold">POT</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {getDraftClassForYear(draftClassYear).map((p0, i) => {
                const p = normalizeDraftProspect(p0, i, draftClassYear);
                const live = calcOffDef(p.attrs, p.pos, p.name, p.height);
                const source = getDraftSourceForProspect(p) || "—";

                return (
                  <tr key={p.id || i} className="border-b align-middle py-4">
                    <td className="flex items-center gap-4 py-4">
                      {p.headshot && (
                        <div
                          className="w-16 h-16 rounded-full bg-white border border-slate-200"
                          style={{
                            backgroundImage: `url(${p.headshot})`,
                            backgroundSize: "80%",
                            backgroundPosition: "center 10%",
                            backgroundRepeat: "no-repeat",
                          }}
                        />
                      )}
                      <div>
                        <div className="font-semibold text-base">#{i + 1} {p.name}</div>
                        <div className="text-[0.8rem] text-slate-600">Class of {draftClassYear}</div>
                      </div>
                    </td>

                    <td className="text-center">{source}</td>
                    <td className="text-center">
                      {p.pos}
                      {p.secondaryPos ? ` / ${p.secondaryPos}` : ""}
                    </td>
                    <td className="text-center">{p.age}</td>
                    <td className="text-center">{formatHeight(p.height)}</td>
                    <td className="text-center font-bold">{p.overall}</td>
                    <td className="text-center">{live.off}</td>
                    <td className="text-center">{live.def}</td>
                    <td className="text-center">{p.potential}</td>

                    <td className="text-right">
                      <button
                        onClick={() => openPlayerForm(null, i, "DRAFT")}
                        className="text-blue-600 text-sm hover:underline mr-2"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          updateDraftClassYear(draftClassYear, (current) => {
                            const copy = JSON.parse(JSON.stringify(current || []));
                            copy.splice(i, 1);
                            return copy.map((row, index) => normalizeDraftProspect(row, index, draftClassYear));
                          });
                        }}
                        className="text-red-600 text-xl hover:opacity-75"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                );
              })}

              {!getDraftClassForYear(draftClassYear).length && (
                <tr>
                  <td colSpan={10} className="text-center text-slate-500 py-6">
                    No prospects in this class yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}


      {/* Teams view stays the same, but only renders when TEAMS */}
      {selectedPool === "TEAMS" && (
        <div className="flex flex-col gap-8">
          {conferences[selectedConf].map((team, idx) => {
            const sorted = sortedTeams[idx];
            const players = team.players || [];
            return (
              <div key={idx} className="border rounded-2xl p-8 bg-white shadow-lg">
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-3">
                    {team.logo && <img src={team.logo} alt="" className="w-14 h-14 object-contain" />}
                    <h2 className="text-2xl font-bold">{team.name}</h2>
                  </div>
                  <div className="flex gap-2 items-center">
                    <button
                      onClick={() => openPlayerForm(idx)}
                      className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                    >
                      Add Player
                    </button>
                    <button
                      onClick={() => toggleAdvanced(idx)}
                      className="bg-gray-200 px-3 py-1 rounded hover:bg-gray-300"
                    >
                      {expandedTeams[idx] ? "Hide Advanced" : "Show Advanced"}
                    </button>
                    <button
                      onClick={() => toggleSort(idx)}
                      className={`bg-gray-200 px-2 py-1 rounded hover:bg-gray-300 text-lg ${
                        sorted ? "text-green-600" : ""
                      }`}
                      title="Sort by Overall"
                    >
                      ⬇️ OVR
                    </button>
                    <button
                      onClick={() => openEditTeam(idx)}
                      className="text-blue-600 text-xl hover:opacity-80"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm("Delete team?")) {
                          setConferences((prev) => {
                            const c = JSON.parse(JSON.stringify(prev));
                            c[selectedConf].splice(idx, 1);
                            return c;
                          });
                        }
                      }}
                      className="text-red-600 text-xl hover:opacity-75"
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                <table className="w-full text-base">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left font-semibold">Player</th>
                      <th className="text-center font-semibold">Pos</th>
                      <th className="text-center font-semibold">Age</th>
                      <th className="text-center font-semibold">Height</th>
                      <th className="text-center font-semibold">OVR</th>
                      <th className="text-center font-semibold">OFF</th>
                      <th className="text-center font-semibold">DEF</th>
                      <th className="text-center font-semibold">POT</th>
                      <th className="text-center font-semibold">SCO</th>
                      <th className="text-center font-semibold">Contract</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {players.map((p0, i) => {
                      const p = normalizePlayer(p0);
                      const live = calcOffDef(p.attrs, p.pos, p.name, p.height);
                      return (
                        <tr key={p.id || i} className="border-b align-middle py-4">
                          <td className="flex items-center gap-4 py-4">
                            {p.headshot && (
                              <div
                                className="w-16 h-16 rounded-full bg-white border border-slate-200"
                                style={{
                                  backgroundImage: `url(${p.headshot})`,
                                  backgroundSize: "80%",
                                  backgroundPosition: "center 10%",
                                  backgroundRepeat: "no-repeat",
                                }}
                              />
                            )}
                            <div>
                              <div className="font-semibold text-base">{p.name}</div>
                              {expandedTeams[idx] && (
                                <div className="text-[0.8rem] text-slate-600 grid grid-cols-3 gap-x-2">
                                  {attrNames.map((n, j) => (
                                    <span key={j}>
                                      {n.split(" ")[0]} {p.attrs?.[j]}
                                    </span>
                                  ))}
                                  <span>Off {live.off}</span>
                                  <span>Def {live.def}</span>
                                  <span>Sta {p.stamina}</span>
                                  <span>Pot {p.potential}</span>
                                  <span>Sco {p.scoringRating?.toFixed(1)}</span>
                                  <span>Ht {formatHeight(p.height)}</span>
                                  <span>BD {p.birthMonth}/{p.birthDay}</span>
                                  <span>Pro {p.meta?.proSeasons ?? 0}</span>
                                  <span>TeamYrs {p.meta?.yearsWithCurrentTeam ?? 0}</span>
                                  <span>Via {p.meta?.acquiredVia ?? "editor"}</span>
                                  <span>Bird {getBirdLabel(p.rights?.birdLevel)}</span>
                                  <span>Yrs {(p.contract?.salaryByYear || []).length}</span>
                                  <span>
                                    Opt {formatOptionSummary(p.contract?.option) === "—" ? "None" : formatOptionSummary(p.contract?.option)}
                                  </span>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="text-center">
                            {p.pos}
                            {p.secondaryPos ? ` / ${p.secondaryPos}` : ""}
                          </td>
                          <td className="text-center">{p.age}</td>
                          <td className="text-center">{formatHeight(p.height)}</td>
                          <td className="text-center font-bold">{p.overall}</td>
                          <td className="text-center">{live.off}</td>
                          <td className="text-center">{live.def}</td>
                          <td className="text-center">{p.potential}</td>
                          <td className="text-center">{p.scoringRating?.toFixed(1) ?? "—"}</td>

                          <td className="text-center text-sm text-slate-700">
                            {(() => {
                              const c = p.contract;
                              if (!c) return "—";
                              const years = c.salaryByYear ?? [];
                              const cur = years.length ? years[0] : 0;
                              const curM = (Number(cur) || 0) / 1_000_000;

                              const opt = formatOptionSummary(c.option);

                              return `${years.length}Y | $${curM.toFixed(1)}M | ${opt}`;
                            })()}
                          </td>

                          <td className="text-right">
                            <button
                              onClick={() => openPlayerForm(idx, i)}
                              className="text-blue-600 text-sm hover:underline mr-2"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                setConferences((prev) => {
                                  const c = JSON.parse(JSON.stringify(prev));
                                  c[selectedConf][idx].players.splice(i, 1);
                                  return c;
                                });
                              }}
                              className="text-red-600 text-xl hover:opacity-75"
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* Trades Modal */}
      {showTradeModal && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg p-6 w-[900px] max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Trades (Roster Swap)</h2>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <div className="text-sm font-semibold mb-1 flex items-center gap-2">
                  <span>Team A</span>
                  {getTradeLogo(tradeA) && (
                    <img src={getTradeLogo(tradeA)} alt="" className="w-5 h-5 object-contain" />
                  )}
                </div>
                <select
                  className="border p-2 rounded w-full"
                  value={encodeTradeRef(tradeA)}
                  onChange={(e) => {
                    setTradeA(decodeTradeRef(e.target.value));
                    setSendAIds([]);
                  }}
                >
                  {tradeTargets.map((t) => (
                    <option key={`A-${t.pool}-${t.key}`} value={t.pool === "FA" ? "FA" : `${t.conf}-${t.teamIdx}`}>
                      {t.name}{t.pool === "TEAMS" ? ` (${t.conf})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="text-sm font-semibold mb-1 flex items-center gap-2">
                  <span>Team B</span>
                  {getTradeLogo(tradeB) && (
                    <img src={getTradeLogo(tradeB)} alt="" className="w-5 h-5 object-contain" />
                  )}
                </div>
                <select
                  className="border p-2 rounded w-full"
                  value={encodeTradeRef(tradeB)}
                  onChange={(e) => {
                    setTradeB(decodeTradeRef(e.target.value));
                    setSendBIds([]);
                  }}
                >
                  {tradeTargets.map((t) => (
                    <option key={`B-${t.pool}-${t.key}`} value={t.pool === "FA" ? "FA" : `${t.conf}-${t.teamIdx}`}>
                      {t.name}{t.pool === "TEAMS" ? ` (${t.conf})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="border rounded-lg p-3">
                <div className="font-semibold mb-2">
                  Send from {getTradeLabel(tradeA)} → {getTradeLabel(tradeB)}
                </div>
                <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-2">
                  {getTradeBucket(tradeA).map((p0) => {
                    const p = normalizePlayer(p0);
                    return (
                      <label key={`Apl-${p.id}`} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sendAIds.includes(p.id)}
                          onChange={() => setSendAIds((arr) => toggleId(arr, p.id))}
                        />
                        {p.headshot ? (
                          <img
                            src={p.headshot}
                            alt=""
                            className="w-6 h-6 rounded-full object-cover border border-slate-200"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200" />
                        )}
                        <span className="font-medium">{p.name}</span>
                        <span className="text-slate-500">
                          ({p.pos}, {p.overall})
                        </span>
                      </label>
                    );
                  })}
                  {!getTradeBucket(tradeA).length && (
                    <div className="text-sm text-slate-500">No players.</div>
                  )}
                </div>
              </div>

              <div className="border rounded-lg p-3">
                <div className="font-semibold mb-2">
                  Send from {getTradeLabel(tradeB)} → {getTradeLabel(tradeA)}
                </div>
                <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-2">
                  {getTradeBucket(tradeB).map((p0) => {
                    const p = normalizePlayer(p0);
                    return (
                      <label key={`Bpl-${p.id}`} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sendBIds.includes(p.id)}
                          onChange={() => setSendBIds((arr) => toggleId(arr, p.id))}
                        />

                        {p.headshot ? (
                          <img
                            src={p.headshot}
                            alt=""
                            className="w-6 h-6 rounded-full object-cover border border-slate-200"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200" />
                        )}

                        <span className="font-medium">{p.name}</span>
                        <span className="text-slate-500">
                          ({p.pos}, {p.overall})
                        </span>
                      </label>
                    );
                  })}
                  {!getTradeBucket(tradeB).length && (
                    <div className="text-sm text-slate-500">No players.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowTradeModal(false)}
                className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={executeTrade}
                className="px-3 py-2 rounded bg-purple-600 text-white hover:bg-purple-700"
              >
                Execute Trade
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Player Modal */}
      {showPlayerForm && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg p-6 w-[650px] max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">{editingPool === "DRAFT" ? editingPlayer !== null ? "Edit Prospect" : "Add Prospect" : editingPlayer !== null ? "Edit Player" : "Add Player"}</h2>

            <div className="flex flex-col gap-2 mb-3">
              <input
                className="border p-2 rounded"
                placeholder="Player Name"
                value={playerForm.name}
                onChange={(e) => setPlayerForm({ ...playerForm, name: e.target.value })}
              />

              <input
                className="border p-2 rounded"
                placeholder="Headshot URL"
                value={playerForm.headshot}
                onChange={(e) => setPlayerForm({ ...playerForm, headshot: e.target.value })}
              />

              {editingPool === "DRAFT" && (
                <input
                  className="border p-2 rounded"
                  placeholder="School / Academy"
                  value={playerForm.school || playerForm.college || playerForm.academy || ""}
                  onChange={(e) => {
                    const source = e.target.value;
                    setPlayerForm({
                      ...playerForm,
                      school: source,
                      college: source,
                      academy: source,
                      academyName: source,
                      sourceName: source,
                      draftSource: source,
                    });
                  }}
                />
              )}

              {/* Bio */}
              <div className="mt-2">
                <div className="text-sm font-semibold text-slate-700 mb-1">Bio</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-600">Birth Month</label>
                    <select
                      className="border p-2 rounded w-full"
                      value={(playerForm.birthMonth ?? 1) - 1}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          birthMonth: Number(e.target.value) + 1,
                        })
                      }
                    >
                      {MONTHS.map((m, idx) => (
                        <option key={m} value={idx}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-600">Birth Day</label>
                    <input
                      className="border p-2 rounded w-full"
                      type="number"
                      min="1"
                      max="31"
                      placeholder="DD"
                      value={playerForm.birthDay ?? 1}
                      onChange={(e) => setPlayerForm({ ...playerForm, birthDay: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>

              {/* Contract */}
              <div className="mt-4">
                <div className="text-sm font-semibold text-slate-700 mb-1">Contract</div>

                {(editingPool === "FA" || editingPool === "DRAFT") && (
                  <div className="text-xs text-slate-500 mb-2">
                    {editingPool === "DRAFT"
                      ? "Draft prospects are unsigned. Rookie contracts are handled after the draft."
                      : "Free agents are unsigned. Contract is set when they sign with a team."}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-600">Start Year</label>
                    <input
                      className="border p-2 rounded w-full"
                      type="number"
                      placeholder={String(getEditorContractStartYear())}
                      value={playerForm.contract?.startYear ?? getEditorContractStartYear()}
                      onChange={(e) => {
                        const startYear = Number(e.target.value);
                        setPlayerForm({
                          ...playerForm,
                          contract: {
                            ...(playerForm.contract ?? {}),
                            startYear,
                            salaryByYear: playerForm.contract?.salaryByYear ?? getEditorDefaultSalaryByYear(1),
                            option: playerForm.contract?.option ?? null,
                          },
                        });
                      }}
                      disabled={editingPool === "FA" || editingPool === "DRAFT"}
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-600">Salaries (in $M, CSV)</label>
                    <input
                      className="border p-2 rounded w-full"
                      type="text"
                      placeholder="8, 8.5, 9"
                      value={salaryText}
                      disabled={editingPool === "DRAFT"}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setSalaryText(raw);

                        setPlayerForm({
                          ...playerForm,
                          contract: {
                            ...(playerForm.contract ?? {}),
                            startYear: playerForm.contract?.startYear ?? getEditorContractStartYear(),
                            salaryByYear: parseSalaryText(raw),
                            option: playerForm.contract?.option ?? null,
                          },
                        });
                      }}
                    />
                  </div>
                </div>

                <div className="text-xs text-slate-500 mt-1">
                  Stored as dollars in JSON (ex: 8.5 becomes 8500000).
                </div>
              </div>

              {/* Career / Rights */}
              <div className="mt-4">
                <div className="text-sm font-semibold text-slate-700 mb-1">Career / Rights</div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-600">Pro Seasons</label>
                    <input
                      className="border p-2 rounded w-full"
                      type="number"
                      min="0"
                      max="30"
                      value={playerForm.meta?.proSeasons ?? 0}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          meta: {
                            ...(playerForm.meta ?? buildDefaultMeta()),
                            proSeasons: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-600">Years With Current Team</label>
                    <input
                      className="border p-2 rounded w-full"
                      type="number"
                      min="0"
                      max="30"
                      value={playerForm.meta?.yearsWithCurrentTeam ?? 0}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          meta: {
                            ...(playerForm.meta ?? buildDefaultMeta()),
                            yearsWithCurrentTeam: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-600">Acquired Via</label>
                    <select
                      className="border p-2 rounded w-full"
                      value={playerForm.meta?.acquiredVia ?? "editor"}
                      onChange={(e) =>
                        setPlayerForm({
                          ...playerForm,
                          meta: {
                            ...(playerForm.meta ?? buildDefaultMeta()),
                            acquiredVia: e.target.value,
                          },
                        })
                      }
                    >
                      <option value="editor">Editor / Unknown</option>
                      <option value="draft">Draft</option>
                      <option value="trade">Trade</option>
                      <option value="free_agency">Free Agency</option>
                      <option value="waivers">Waivers</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-600">Bird Rights</label>
                    <select
                      className="border p-2 rounded w-full"
                      value={playerForm.rights?.birdLevel ?? "none"}
                      onChange={(e) => {
                        const birdLevel = e.target.value;
                        const seasonsTowardBird = getBirdCreditFromLevel(birdLevel);

                        setPlayerForm({
                          ...playerForm,
                          rights: buildDefaultRights({
                            ...(playerForm.rights ?? buildDefaultRights()),
                            birdLevel,
                            seasonsTowardBird,
                          }),
                        });
                      }}
                    >
                      <option value="none">None</option>
                      <option value="non_bird">Non-Bird</option>
                      <option value="early_bird">Early Bird</option>
                      <option value="bird">Full Bird</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-600">Rights Held By</label>
                    <div className="border p-2 rounded w-full bg-slate-50 text-slate-700">
                      {editingPool === "FA"
                        ? "None - Free Agent"
                        : editingPool === "DRAFT"
                        ? "None - Draft Prospect"
                        : conferences?.[selectedConf]?.[editingTeam]?.name || "Current Team"}
                    </div>
                    <div className="text-[0.7rem] text-slate-500 mt-1">
                      Automatically assigned from the player&apos;s current team.
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-600">Team Control</label>
                    <div className="border rounded p-2 flex flex-col gap-1 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(playerForm.rights?.rookieScale)}
                          onChange={(e) =>
                            setPlayerForm({
                              ...playerForm,
                              rights: buildDefaultRights({
                                ...(playerForm.rights ?? buildDefaultRights()),
                                rookieScale: e.target.checked,
                              }),
                            })
                          }
                        />
                        Rookie Scale
                      </label>

                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(playerForm.rights?.restrictedFreeAgent)}
                          onChange={(e) =>
                            setPlayerForm({
                              ...playerForm,
                              rights: buildDefaultRights({
                                ...(playerForm.rights ?? buildDefaultRights()),
                                restrictedFreeAgent: e.target.checked,
                              }),
                            })
                          }
                        />
                        Restricted FA
                      </label>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-slate-500 mt-2">
                  Bird Rights Preview: {getBirdLabel(playerForm.rights?.birdLevel)} | Bird Credit: {" "}
                  {playerForm.rights?.seasonsTowardBird ?? 0}
                </div>
              </div>

              {/* Option */}
              <div className="mt-4">
                <div className="text-sm font-semibold text-slate-700 mb-1">Option</div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-600">Option Type</label>
                    <select
                      className="border p-2 rounded w-full"
                      value={playerForm.contract?.option?.type ?? "none"}
                      onChange={(e) => {
                        const type = e.target.value;
                        const cur = playerForm.contract ?? {
                          startYear: getEditorContractStartYear(),
                          salaryByYear: getEditorDefaultSalaryByYear(1),
                          option: null,
                        };

                        const maxN = Math.max(1, cur.salaryByYear?.length ?? 1);
                        const parsedYears = parseOptionYearsText(
                          optionYearsText || formatOptionYearsText(cur.option),
                          maxN
                        );
                        const nextYears = parsedYears.length ? parsedYears : [Math.max(0, maxN - 1)];

                        const nextOption =
                          type === "none"
                            ? null
                            : {
                                type,
                                yearIndices: nextYears,
                                picked: cur.option?.picked ?? null,
                              };

                        setPlayerForm({
                          ...playerForm,
                          contract: {
                            ...cur,
                            option: nextOption,
                          },
                        });

                        setOptionYearsText(type === "none" ? "" : nextYears.map((i) => String(i + 1)).join(", "));
                      }}
                      disabled={editingPool === "FA" || editingPool === "DRAFT"}
                    >
                      <option value="none">None</option>
                      <option value="team">Team Option</option>
                      <option value="player">Player Option</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-600">Option Year(s) (1..N, CSV)</label>
                    <input
                      className="border p-2 rounded w-full"
                      type="text"
                      placeholder="1 or 1, 2"
                      value={optionYearsText}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setOptionYearsText(raw);

                        const cur = playerForm.contract ?? {
                          startYear: getEditorContractStartYear(),
                          salaryByYear: getEditorDefaultSalaryByYear(1),
                          option: null,
                        };
                        if (!cur.option) return;

                        const maxN = Math.max(1, cur.salaryByYear?.length ?? 1);
                        const yearIndices = parseOptionYearsText(raw, maxN);

                        setPlayerForm({
                          ...playerForm,
                          contract: {
                            ...cur,
                            option: {
                              ...cur.option,
                              yearIndices,
                            },
                          },
                        });
                      }}
                      disabled={!playerForm.contract?.option || editingPool === "FA" || editingPool === "DRAFT"}
                    />
                  </div>
                </div>

                <div className="mt-2 text-sm text-slate-700">
                  <span className="font-semibold">Preview:</span>{" "}
                  {(() => {
                    const c = playerForm.contract;
                    if (!c) return "—";
                    const start = c.startYear ?? getEditorContractStartYear();
                    const years = c.salaryByYear ?? [];
                    const parts = years.map((v, i) => {
                      const yr = start + i;
                      const m = (Number(v) || 0) / 1_000_000;
                      return `${yr}: $${m.toFixed(1)}M`;
                    });
                    const opt = c.option?.type ? ` (${formatOptionSummary(c.option)})` : "";
                    return parts.join(", ") + opt;
                  })()}
                </div>
              </div>

              {/* History */}
              <div className="mt-4">
                <div className="text-sm font-semibold text-slate-700 mb-1">History</div>

                <div className="border rounded p-3 bg-slate-50">
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-sm font-semibold">Season Stat Rows</div>
                    <button
                      type="button"
                      onClick={() =>
                        setPlayerForm({
                          ...playerForm,
                          history: buildDefaultHistory({
                            ...(playerForm.history ?? buildDefaultHistory()),
                            seasons: [
                              ...((playerForm.history?.seasons) ?? []),
                              {
                                seasonYear: 2026,
                                teamName: "",
                                teamLogo: "",
                                games: 0,
                                ppg: 0,
                                rpg: 0,
                                apg: 0,
                                spg: 0,
                                bpg: 0,
                                fgPct: 0,
                                threePct: 0,
                                ftPct: 0,
                              },
                            ],
                          }),
                        })
                      }
                      className="text-xs bg-blue-600 text-white px-2 py-1 rounded"
                    >
                      Add Season
                    </button>
                  </div>

                  <div className="space-y-3 max-h-[32rem] overflow-y-auto pr-1">
  {(playerForm.history?.seasons ?? []).map((row, idx) => (
    <div key={`season-${idx}`} className="border bg-white rounded p-3">
      <div className="grid grid-cols-4 gap-2 items-start">
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Season Year</label>
          <input
            className="border p-2 rounded text-sm w-full"
            type="number"
            placeholder={String(getEditorContractStartYear())}
            value={row.seasonYear ?? ""}
            onChange={(e) => {
              const seasons = [...(playerForm.history?.seasons ?? [])];
              seasons[idx] = { ...seasons[idx], seasonYear: Number(e.target.value) };
              setPlayerForm({
                ...playerForm,
                history: buildDefaultHistory({
                  ...(playerForm.history ?? buildDefaultHistory()),
                  seasons,
                }),
              });
            }}
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Team</label>
          <input
            className="border p-2 rounded text-sm w-full"
            placeholder="Toronto Raptors"
            value={row.teamName ?? ""}
            onChange={(e) => {
              const seasons = [...(playerForm.history?.seasons ?? [])];
              seasons[idx] = { ...seasons[idx], teamName: e.target.value };
              setPlayerForm({
                ...playerForm,
                history: buildDefaultHistory({
                  ...(playerForm.history ?? buildDefaultHistory()),
                  seasons,
                }),
              });
            }}
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Team Logo URL</label>
          <input
            className="border p-2 rounded text-sm w-full"
            placeholder="/logos/raptors.png"
            value={row.teamLogo ?? ""}
            onChange={(e) => {
              const seasons = [...(playerForm.history?.seasons ?? [])];
              seasons[idx] = { ...seasons[idx], teamLogo: e.target.value };
              setPlayerForm({
                ...playerForm,
                history: buildDefaultHistory({
                  ...(playerForm.history ?? buildDefaultHistory()),
                  seasons,
                }),
              });
            }}
          />
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              const seasons = [...(playerForm.history?.seasons ?? [])];
              seasons.splice(idx, 1);
              setPlayerForm({
                ...playerForm,
                history: buildDefaultHistory({
                  ...(playerForm.history ?? buildDefaultHistory()),
                  seasons,
                }),
              });
            }}
            className="text-red-600 text-sm mt-6"
          >
            Remove
          </button>
        </div>
      </div>

      {(row.teamLogo || row.teamName) && (
        <div className="flex items-center gap-2 mt-3 text-sm text-slate-700">
          {row.teamLogo ? (
            <img
              src={row.teamLogo}
              alt={row.teamName || "Team logo"}
              className="w-8 h-8 object-contain"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <span>{row.teamName || "Team"}</span>
        </div>
      )}

      <div className="mt-4">
        <div className="grid grid-cols-9 gap-2 mb-1">
          {["GP", "PPG", "RPG", "APG", "SPG", "BPG", "FG%", "3P%", "FT%"].map((label) => (
            <div key={label} className="text-[11px] font-medium text-slate-600">
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-9 gap-2">
          <input
            className="border p-2 rounded text-sm w-full"
            type="number"
            placeholder="0"
            value={row.games ?? ""}
            onChange={(e) => {
              const seasons = [...(playerForm.history?.seasons ?? [])];
              seasons[idx] = { ...seasons[idx], games: Number(e.target.value) };
              setPlayerForm({
                ...playerForm,
                history: buildDefaultHistory({
                  ...(playerForm.history ?? buildDefaultHistory()),
                  seasons,
                }),
              });
            }}
          />

          <input
            className="border p-2 rounded text-sm w-full"
            type="number"
            step="0.1"
            placeholder="0.0"
            value={row.ppg ?? ""}
            onChange={(e) => {
              const seasons = [...(playerForm.history?.seasons ?? [])];
              seasons[idx] = { ...seasons[idx], ppg: Number(e.target.value) };
              setPlayerForm({
                ...playerForm,
                history: buildDefaultHistory({
                  ...(playerForm.history ?? buildDefaultHistory()),
                  seasons,
                }),
              });
            }}
          />

          <input
            className="border p-2 rounded text-sm w-full"
            type="number"
            step="0.1"
            placeholder="0.0"
            value={row.rpg ?? ""}
            onChange={(e) => {
              const seasons = [...(playerForm.history?.seasons ?? [])];
              seasons[idx] = { ...seasons[idx], rpg: Number(e.target.value) };
              setPlayerForm({
                ...playerForm,
                history: buildDefaultHistory({
                  ...(playerForm.history ?? buildDefaultHistory()),
                  seasons,
                }),
              });
            }}
          />

          <input
            className="border p-2 rounded text-sm w-full"
            type="number"
            step="0.1"
            placeholder="0.0"
            value={row.apg ?? ""}
            onChange={(e) => {
              const seasons = [...(playerForm.history?.seasons ?? [])];
              seasons[idx] = { ...seasons[idx], apg: Number(e.target.value) };
              setPlayerForm({
                ...playerForm,
                history: buildDefaultHistory({
                  ...(playerForm.history ?? buildDefaultHistory()),
                  seasons,
                }),
              });
            }}
          />

          <input
            className="border p-2 rounded text-sm w-full"
            type="number"
            step="0.1"
            placeholder="0.0"
            value={row.spg ?? ""}
            onChange={(e) => {
              const seasons = [...(playerForm.history?.seasons ?? [])];
              seasons[idx] = { ...seasons[idx], spg: Number(e.target.value) };
              setPlayerForm({
                ...playerForm,
                history: buildDefaultHistory({
                  ...(playerForm.history ?? buildDefaultHistory()),
                  seasons,
                }),
              });
            }}
          />

          <input
            className="border p-2 rounded text-sm w-full"
            type="number"
            step="0.1"
            placeholder="0.0"
            value={row.bpg ?? ""}
            onChange={(e) => {
              const seasons = [...(playerForm.history?.seasons ?? [])];
              seasons[idx] = { ...seasons[idx], bpg: Number(e.target.value) };
              setPlayerForm({
                ...playerForm,
                history: buildDefaultHistory({
                  ...(playerForm.history ?? buildDefaultHistory()),
                  seasons,
                }),
              });
            }}
          />

          <input
            className="border p-2 rounded text-sm w-full"
            type="number"
            step="0.1"
            placeholder="0.0"
            value={row.fgPct ?? ""}
            onChange={(e) => {
              const seasons = [...(playerForm.history?.seasons ?? [])];
              seasons[idx] = { ...seasons[idx], fgPct: Number(e.target.value) };
              setPlayerForm({
                ...playerForm,
                history: buildDefaultHistory({
                  ...(playerForm.history ?? buildDefaultHistory()),
                  seasons,
                }),
              });
            }}
          />

          <input
            className="border p-2 rounded text-sm w-full"
            type="number"
            step="0.1"
            placeholder="0.0"
            value={row.threePct ?? ""}
            onChange={(e) => {
              const seasons = [...(playerForm.history?.seasons ?? [])];
              seasons[idx] = { ...seasons[idx], threePct: Number(e.target.value) };
              setPlayerForm({
                ...playerForm,
                history: buildDefaultHistory({
                  ...(playerForm.history ?? buildDefaultHistory()),
                  seasons,
                }),
              });
            }}
          />

          <input
            className="border p-2 rounded text-sm w-full"
            type="number"
            step="0.1"
            placeholder="0.0"
            value={row.ftPct ?? ""}
            onChange={(e) => {
              const seasons = [...(playerForm.history?.seasons ?? [])];
              seasons[idx] = { ...seasons[idx], ftPct: Number(e.target.value) };
              setPlayerForm({
                ...playerForm,
                history: buildDefaultHistory({
                  ...(playerForm.history ?? buildDefaultHistory()),
                  seasons,
                }),
              });
            }}
          />
        </div>
      </div>
    </div>
  ))}

  {!(playerForm.history?.seasons ?? []).length && (
    <div className="text-xs text-slate-500">No season history yet.</div>
  )}
</div>
                </div>

                <div className="border rounded p-3 bg-slate-50 mt-3">
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-sm font-semibold">Accolades</div>
                    <button
                      type="button"
                      onClick={() =>
                        setPlayerForm({
                          ...playerForm,
                          history: buildDefaultHistory({
                            ...(playerForm.history ?? buildDefaultHistory()),
                            accolades: [
                              ...((playerForm.history?.accolades) ?? []),
                              {
                                seasonYear: 2026,
                                type: "all_star",
                                label: "NBA All-Star",
                              },
                            ],
                          }),
                        })
                      }
                      className="text-xs bg-blue-600 text-white px-2 py-1 rounded"
                    >
                      Add Accolade
                    </button>
                  </div>

                  <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                    {(playerForm.history?.accolades ?? []).map((row, idx) => (
                      <div key={`accolade-${idx}`} className="grid grid-cols-4 gap-2">
                        <input
                          className="border p-1 rounded text-xs"
                          type="number"
                          placeholder="Year"
                          value={row.seasonYear ?? ""}
                          onChange={(e) => {
                            const accolades = [...(playerForm.history?.accolades ?? [])];
                            accolades[idx] = { ...accolades[idx], seasonYear: Number(e.target.value) };
                            setPlayerForm({
                              ...playerForm,
                              history: buildDefaultHistory({
                                ...(playerForm.history ?? buildDefaultHistory()),
                                accolades,
                              }),
                            });
                          }}
                        />

                        <select
                          className="border p-1 rounded text-xs"
                          value={row.type ?? "custom"}
                          onChange={(e) => {
                            const nextType = e.target.value;
                            const nextLabel = getAccoladeLabel(nextType);

                            const accolades = [...(playerForm.history?.accolades ?? [])];
                            accolades[idx] = {
                              ...accolades[idx],
                              type: nextType,
                              label: nextType === "custom" ? accolades[idx]?.label ?? "" : nextLabel,
                            };

                            setPlayerForm({
                              ...playerForm,
                              history: buildDefaultHistory({
                                ...(playerForm.history ?? buildDefaultHistory()),
                                accolades,
                              }),
                            });
                          }}
                        >
                          {ACCOLADE_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>

                        <input
                          className="border p-1 rounded text-xs"
                          placeholder="Label"
                          value={row.label ?? ""}
                          onChange={(e) => {
                            const accolades = [...(playerForm.history?.accolades ?? [])];
                            accolades[idx] = { ...accolades[idx], label: e.target.value };
                            setPlayerForm({
                              ...playerForm,
                              history: buildDefaultHistory({
                                ...(playerForm.history ?? buildDefaultHistory()),
                                accolades,
                              }),
                            });
                          }}
                        />

                        <button
                          type="button"
                          onClick={() => {
                            const accolades = [...(playerForm.history?.accolades ?? [])];
                            accolades.splice(idx, 1);
                            setPlayerForm({
                              ...playerForm,
                              history: buildDefaultHistory({
                                ...(playerForm.history ?? buildDefaultHistory()),
                                accolades,
                              }),
                            });
                          }}
                          className="text-red-600 text-xs"
                        >
                          Remove
                        </button>
                      </div>
                    ))}

                    {!(playerForm.history?.accolades ?? []).length && (
                      <div className="text-xs text-slate-500">No accolades yet.</div>
                    )}
                  </div>
                </div>
              </div>

              <select
                className="border p-2 rounded"
                value={playerForm.pos}
                onChange={(e) => {
                  const pos = e.target.value;
                  setPlayerForm({
                    ...playerForm,
                    pos,
                    secondaryPos: playerForm.secondaryPos === pos ? "" : playerForm.secondaryPos,
                  });
                }}
              >
                {["PG", "SG", "SF", "PF", "C"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>

              <select
                className="border p-2 rounded"
                value={playerForm.secondaryPos}
                onChange={(e) => setPlayerForm({ ...playerForm, secondaryPos: e.target.value })}
              >
                <option value="">No Secondary</option>
                {["PG", "SG", "SF", "PF", "C"]
                  .filter((p) => p !== playerForm.pos)
                  .map((p) => (
                    <option key={p}>{p}</option>
                  ))}
              </select>
            </div>

            <div className="space-y-2">
              {attrNames.map((l, i) => (
                <div key={i}>
                  <label className="text-sm">
                    {l}: {playerForm.attrs[i]}
                  </label>
                  <input
                    type="range"
                    min="25"
                    max="99"
                    value={playerForm.attrs[i]}
                    onChange={(e) =>
                      setPlayerForm((p) => ({
                        ...p,
                        attrs: p.attrs.map((a, j) => (j === i ? +e.target.value : a)),
                      }))
                    }
                    className="w-full accent-blue-600"
                  />
                </div>
              ))}
              <div>
                <label className="text-sm">Age: {playerForm.age}</label>
                <input
                  type="range"
                  min="18"
                  max="45"
                  value={playerForm.age}
                  onChange={(e) => setPlayerForm({ ...playerForm, age: +e.target.value })}
                  className="w-full accent-green-600"
                />
              </div>
              <div>
                <label className="text-sm">Height: {formatHeight(playerForm.height)}</label>
                <input
                  type="range"
                  min="65"
                  max="90"
                  value={playerForm.height}
                  onChange={(e) => setPlayerForm({ ...playerForm, height: +e.target.value })}
                  className="w-full accent-purple-600"
                />
              </div>
              <div>
                <label className="text-sm">Potential: {playerForm.potential}</label>
                <input
                  type="range"
                  min="25"
                  max="99"
                  value={playerForm.potential}
                  onChange={(e) => setPlayerForm({ ...playerForm, potential: +e.target.value })}
                  className="w-full accent-pink-600"
                />
              </div>
            </div>

            <p className="mt-4 font-semibold text-lg">
              Overall: {playerForm.overall} | Off: {playerForm.offRating} | Def: {playerForm.defRating} | Sta:{" "}
              {playerForm.stamina} | Pot: {playerForm.potential} | Ht: {formatHeight(playerForm.height)} | Sco:{" "}
              {playerForm.scoringRating.toFixed(2)}
            </p>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowPlayerForm(false)}
                className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={savePlayer}
                className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700"
              >
                Save Player
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Team Modal */}
      {editTeamModal && (() => {
        const modalTeamName = safePickText(editTeamModal.name || editTeamModal.originalName || "");
        const teamOwnedPicks = getDraftPickAssetsForTeam(modalTeamName);
        const protectionOptionsForForm = getDraftPickProtectionOptions(pickForm);
        const selectedProtectionOption =
          protectionOptionsForForm.find((option) => option.value === pickForm.protections) ||
          protectionOptionsForForm[0];

        return (
          <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
            <div className="bg-white rounded-lg p-6 w-[980px] max-w-[96vw] max-h-[92vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-4">Edit Team</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Team Name</label>
                  <input
                    className="border p-2 rounded w-full"
                    placeholder="Team Name"
                    value={editTeamModal.name}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      setEditTeamModal({ ...editTeamModal, name: nextName });

                      if (!editingPickId) {
                        setPickForm((prev) =>
                          createDefaultDraftPickForm({
                            ...prev,
                            ownerTeam: safePickText(nextName),
                            originalTeam: prev.originalTeam || safePickText(nextName),
                          })
                        );
                      }
                    }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Logo URL</label>
                  <input
                    className="border p-2 rounded w-full"
                    placeholder="Logo URL"
                    value={editTeamModal.logo}
                    onChange={(e) => setEditTeamModal({ ...editTeamModal, logo: e.target.value })}
                  />
                </div>
              </div>

              <div className="border rounded-2xl p-4 bg-slate-50 mb-5">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-lg font-bold">Draft Picks Owned by {modalTeamName || "This Team"}</h3>
                    <p className="text-xs text-slate-600 mt-1">
                      Add the picks this team owns here. These save to <span className="font-mono">leagueData.draftPicks</span> for lottery, draft, and future trades.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => startDraftPickForEditedTeam()}
                      className="bg-gray-200 px-3 py-2 rounded hover:bg-gray-300 text-sm"
                    >
                      Clear Pick Form
                    </button>
                    <button
                      type="button"
                      onClick={() => fillMissingDefaultDraftPicksForTeam(modalTeamName)}
                      className="bg-slate-800 text-white px-3 py-2 rounded hover:bg-slate-700 text-sm"
                    >
                      Add Default Own Picks
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
                  <div className="border rounded-xl p-4 bg-white">
                    <div className="font-bold mb-3">
                      {editingPickId ? "Edit Pick / Swap" : "Add Pick / Swap"}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Asset Type</label>
                        <select
                          className="border p-2 rounded w-full bg-white"
                          value={pickForm.type}
                          onChange={(e) => updatePickForm({ type: e.target.value })}
                        >
                          <option value="pick">Normal Pick</option>
                          <option value="swap">Swap Right</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Year</label>
                        <input
                          className="border p-2 rounded w-full"
                          type="number"
                          min="2026"
                          max="2045"
                          value={pickForm.year}
                          onChange={(e) => updatePickForm({ year: Number(e.target.value) })}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Round</label>
                        <select
                          className="border p-2 rounded w-full bg-white"
                          value={pickForm.round}
                          onChange={(e) => updatePickForm({ round: Number(e.target.value) })}
                        >
                          <option value={1}>1st Round</option>
                          <option value={2}>2nd Round</option>
                        </select>
                      </div>

                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          Original / Affected Team
                        </label>
                        <select
                          className="border p-2 rounded w-full bg-white"
                          value={pickForm.originalTeam}
                          onChange={(e) => updatePickForm({ originalTeam: e.target.value })}
                        >
                          <option value="">Select team</option>
                          {teamNameOptions.map((teamName) => (
                            <option key={`team-modal-orig-${teamName}`} value={teamName}>
                              {teamName}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          {pickForm.type === "swap" ? "Swap Right Holder / Owner" : "Current Owner"}
                        </label>
                        <select
                          className="border p-2 rounded w-full bg-white"
                          value={pickForm.ownerTeam || modalTeamName}
                          onChange={(e) => updatePickForm({ ownerTeam: e.target.value })}
                        >
                          <option value="">Select team</option>
                          {teamNameOptions.map((teamName) => (
                            <option key={`team-modal-owner-${teamName}`} value={teamName}>
                              {teamName}
                            </option>
                          ))}
                        </select>
                        <div className="text-[11px] text-slate-500 mt-1">
                          Leave this as {modalTeamName || "this team"} when you are adding picks owned by this team.
                        </div>
                      </div>

                      {pickForm.type === "swap" && (
                        <div className="col-span-2">
                          <label className="block text-xs font-semibold text-slate-600 mb-1">Swap With Team</label>
                          <select
                            className="border p-2 rounded w-full bg-white"
                            value={pickForm.swapWithTeam}
                            onChange={(e) => updatePickForm({ swapWithTeam: e.target.value })}
                          >
                            <option value="">Optional / not specified</option>
                            {teamNameOptions.map((teamName) => (
                              <option key={`team-modal-swap-${teamName}`} value={teamName}>
                                {teamName}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          Protections / Conditions
                        </label>
                        <div className="border rounded-xl bg-white max-h-64 overflow-y-auto divide-y">
                          {protectionOptionsForForm.map((option) => {
                            const selected = pickForm.protections === option.value;

                            return (
                              <button
                                key={`team-modal-protection-${option.value}`}
                                type="button"
                                onClick={() => updatePickForm({ protections: option.value })}
                                className={`w-full text-left px-3 py-2 hover:bg-orange-50 ${
                                  selected ? "bg-orange-100 text-orange-900" : "bg-white text-slate-800"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="font-semibold text-sm">{option.label}</span>
                                  {selected && <span className="text-xs font-bold">Selected</span>}
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5">{option.description}</div>
                              </button>
                            );
                          })}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-2">
                          Selected: <span className="font-semibold">{selectedProtectionOption?.label || "Unprotected"}</span>. For unusual real-life language, choose <span className="font-semibold">Other / see notes</span> and write the exact details below.
                        </div>
                      </div>

                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label>
                        <textarea
                          className="border p-2 rounded w-full min-h-[80px]"
                          placeholder="Optional details, source, conditions, etc."
                          value={pickForm.notes}
                          onChange={(e) => updatePickForm({ notes: e.target.value })}
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={saveDraftPickAsset}
                      className="mt-4 w-full bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 font-bold"
                    >
                      {editingPickId ? "Save Pick Changes" : "Add Pick to Team"}
                    </button>
                  </div>

                  <div className="border rounded-xl overflow-hidden bg-white">
                    <div className="px-4 py-3 border-b bg-slate-100 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-bold">Owned Picks / Swap Rights</div>
                        <div className="text-xs text-slate-600">
                          {teamOwnedPicks.length} asset{teamOwnedPicks.length === 1 ? "" : "s"} owned by this team
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead className="sticky top-0 bg-white">
                          <tr className="border-b">
                            <th className="text-left p-3 font-semibold">Asset</th>
                            <th className="text-center p-3 font-semibold">Type</th>
                            <th className="text-center p-3 font-semibold">Year</th>
                            <th className="text-center p-3 font-semibold">Round</th>
                            <th className="text-left p-3 font-semibold">Protections</th>
                            <th className="text-right p-3 font-semibold">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {teamOwnedPicks.map((pick) => (
                            <tr key={pick.id} className="border-b align-top hover:bg-slate-50">
                              <td className="p-3">
                                <div className="font-bold text-slate-900">{formatDraftPickAsset(pick)}</div>
                                <div className="text-xs text-slate-500 mt-1">
                                  Original: {pick.originalTeam || "—"}
                                  {pick.type === "swap" ? ` | Swap with: ${pick.swapWithTeam || "not specified"}` : ""}
                                  {pick.notes ? ` | ${pick.notes}` : ""}
                                </div>
                              </td>
                              <td className="p-3 text-center">
                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                                  pick.type === "swap"
                                    ? "bg-purple-100 text-purple-800"
                                    : "bg-blue-100 text-blue-800"
                                }`}>
                                  {pick.type === "swap" ? "Swap" : "Pick"}
                                </span>
                              </td>
                              <td className="p-3 text-center font-semibold">{pick.year}</td>
                              <td className="p-3 text-center">{pick.round === 1 ? "1st" : "2nd"}</td>
                              <td className="p-3">{pick.protections || "Unprotected / none"}</td>
                              <td className="p-3 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => editDraftPickAsset(pick)}
                                  className="text-blue-600 text-sm hover:underline mr-3"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteDraftPickAsset(pick.id)}
                                  className="text-red-600 text-sm hover:underline"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}

                          {!teamOwnedPicks.length && (
                            <tr>
                              <td colSpan={6} className="text-center text-slate-500 py-8">
                                No draft pick assets owned by this team yet. Add one using the form on the left.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setEditTeamModal(null)}
                  className="px-3 py-2 rounded bg-gray-300 hover:bg-gray-400"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEditTeam}
                  className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700"
                >
                  Save Team
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );

  function formatHeight(inches) {
    const ft = Math.floor(inches / 12);
    const ins = inches % 12;
    return `${ft}′${ins}″`;
  }
}