import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import * as simEngine from "../api/simEnginePy.js";

const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const OPTIONS_RESULTS_KEY = "bm_option_decision_results_v1";

function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getSeasonYear(leagueData) {
  return Number(
    leagueData?.seasonYear ||
    leagueData?.currentSeasonYear ||
    safeJSON(localStorage.getItem("bm_league_meta_v1"), {})?.seasonYear ||
    2026
  );
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function resolveLogo(team) {
  return team?.logo || team?.teamLogo || team?.newTeamLogo || team?.logoUrl || team?.image || "";
}

function buildDefaultOffseasonState(seasonYear) {
  return {
    active: true,
    seasonYear,
    retirementsComplete: false,
    optionsComplete: false,
    rightsManagementComplete: false,
    preFreeAgencyResolved: false,
    freeAgencyComplete: false,
    progressionComplete: false,
  };
}

function readOffseasonState(seasonYear) {
  const stored = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), null);
  if (!stored || typeof stored !== "object") {
    return buildDefaultOffseasonState(seasonYear);
  }

  return {
    ...buildDefaultOffseasonState(seasonYear),
    ...stored,
    seasonYear,
  };
}

function saveOffseasonState(state) {
  localStorage.setItem(OFFSEASON_STATE_KEY, JSON.stringify(state));
}

function safeSetJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`[PlayerTeamOptions] Failed to save ${key}`, err);
    try {
      localStorage.removeItem(key);
    } catch {}
    return false;
  }
}

function fmtMoney(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));
}

function SummaryCard({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "orange"
      ? "border-orange-500/30 bg-orange-500/10 text-orange-100"
      : tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
      : "border-white/10 bg-white/5 text-white";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-xs uppercase tracking-[0.18em] text-white/45 mb-2">{label}</div>
      <div className="text-3xl font-extrabold">{value}</div>
    </div>
  );
}

function SectionShell({ title, subtitle, children, rightNode = null }) {
  return (
    <div className="bg-neutral-800/85 border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
      <div className="px-6 py-5 border-b border-white/10 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-2xl font-extrabold text-white">{title}</h3>
          {subtitle && <p className="text-white/55 mt-1">{subtitle}</p>}
        </div>
        {rightNode}
      </div>
      {children}
    </div>
  );
}

function DataPill({ children, tone = "neutral" }) {
  const cls =
    tone === "orange"
      ? "border-orange-500/30 bg-orange-500/10 text-orange-200"
      : tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : "border-white/10 bg-white/5 text-white/75";

  return (
    <div className={`px-3 py-1 rounded-full border text-xs font-bold uppercase tracking-wide ${cls}`}>
      {children}
    </div>
  );
}
function getPlayerKey(row) {
  if (row?.playerId !== undefined && row?.playerId !== null && row?.playerId !== "") return String(row.playerId);
  if (row?.id !== undefined && row?.id !== null && row?.id !== "") return String(row.id);
  return String(row?.playerName || row?.name || "");
}

function getRights(player) {
  return player?.rights && typeof player.rights === "object"
    ? player.rights
    : { heldByTeam: null, seasonsTowardBird: 0, birdLevel: "none", rookieScale: false, restrictedFreeAgent: false };
}

function normalizeBirdLabel(level) {
  if (level === "bird") return "Bird";
  if (level === "early_bird") return "Early Bird";
  if (level === "non_bird") return "Non-Bird";
  return "No Rights";
}

function getPreviousSalary(player) {
  const salaryByYear = player?.previousContract?.salaryByYear || player?.contract?.salaryByYear || [];
  if (Array.isArray(salaryByYear) && salaryByYear.length) return Number(salaryByYear[salaryByYear.length - 1] || 0);
  return Number(player?.marketValue?.expectedYear1Salary || 0);
}

function getCapHold(player) {
  const rights = getRights(player);
  if (!rights?.heldByTeam || rights?.birdLevel === "none") return 0;
  if (rights?.restrictedFreeAgent && player?.qualifyingOffer?.amount) return Number(player.qualifyingOffer.amount || 0);
  const previousSalary = getPreviousSalary(player);
  const marketYearOne = Number(player?.marketValue?.expectedYear1Salary || 0);
  if (rights.birdLevel === "bird") return Math.max(previousSalary, marketYearOne, 1200000);
  if (rights.birdLevel === "early_bird") return Math.max(previousSalary * 1.3, 1200000);
  if (rights.birdLevel === "non_bird") return Math.max(previousSalary * 1.2, 1200000);
  return 0;
}

function getUserRightsRows(leagueData, teamName) {
  if (!leagueData || !teamName) return [];
  const rows = [];
  for (const player of leagueData.freeAgents || []) {
    const rights = getRights(player);
    if (rights?.heldByTeam !== teamName) continue;
    const capHold = getCapHold(player);
    if (capHold <= 0) continue;
    rows.push({
      playerId: player?.id,
      playerName: player?.name,
      position: player?.pos || player?.position || "-",
      age: player?.age,
      overall: player?.overall,
      potential: player?.potential,
      teamName,
      rights,
      birdLevel: rights?.birdLevel || "none",
      restrictedFreeAgent: !!rights?.restrictedFreeAgent,
      rookieScale: !!rights?.rookieScale,
      qualifyingOffer: player?.qualifyingOffer || null,
      marketValue: player?.marketValue || null,
      capHold,
      previousSalary: getPreviousSalary(player),
    });
  }
  return rows.sort((a, b) => Number(b.capHold || 0) - Number(a.capHold || 0));
}

function getTeamPayrollForNextSeason(leagueData, teamName) {
  const teams = getAllTeamsFromLeague(leagueData);
  const team = teams.find((t) => t?.name === teamName);
  const seasonYear = getSeasonYear(leagueData) + 1;
  let payroll = 0;
  for (const player of team?.players || []) {
    const c = player?.contract;
    const startYear = Number(c?.startYear || 0);
    const salaryByYear = Array.isArray(c?.salaryByYear) ? c.salaryByYear : [];
    const idx = seasonYear - startYear;
    if (idx >= 0 && idx < salaryByYear.length) payroll += Number(salaryByYear[idx] || 0);
  }
  return payroll;
}

function applyRenounceRightsLocal(leagueData, teamName, renounceMap) {
  const updated = JSON.parse(JSON.stringify(leagueData || {}));
  updated.freeAgents = (updated.freeAgents || []).map((player) => {
    const rights = getRights(player);
    if (rights?.heldByTeam !== teamName) return player;
    const key = getPlayerKey({ playerId: player?.id, playerName: player?.name });
    if (!renounceMap?.[key]) return player;
    const next = {
      ...player,
      rightsRenounced: true,
      rights: {
        ...rights,
        heldByTeam: null,
        seasonsTowardBird: 0,
        birdLevel: "none",
        restrictedFreeAgent: false,
      },
    };
    delete next.qualifyingOffer;
    return next;
  });
  return updated;
}
function getTeamFilterOptions(rows) {
  const teams = Array.from(
    new Set((rows || []).map((row) => row?.teamName).filter(Boolean))
  ).sort();

  return ["ALL", ...teams];
}

function filterRowsByTeam(rows, teamFilter) {
  if (!Array.isArray(rows)) return [];
  if (!teamFilter || teamFilter === "ALL") return rows;
  return rows.filter((row) => row?.teamName === teamFilter);
}

function buildKeyInterestRows(expiredContracts, playerOptions, teamOptions) {
  const out = [];

  for (const row of expiredContracts || []) {
    if (Number(row?.overall || 0) >= 85) {
      out.push({
        ...row,
        interestType: "expired_contract",
      });
    }
  }

  for (const row of playerOptions || []) {
    if (Number(row?.overall || 0) >= 85) {
      out.push({
        ...row,
        interestType: "player_option",
      });
    }
  }

  for (const row of teamOptions || []) {
    if (Number(row?.overall || 0) >= 85) {
      out.push({
        ...row,
        interestType: "team_option",
      });
    }
  }

  const seen = new Set();
  const deduped = [];

  for (const row of out) {
    const key = `${row?.playerName || ""}__${row?.teamName || ""}__${row?.interestType || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped.sort((a, b) => {
    const ovrDiff = Number(b?.overall || 0) - Number(a?.overall || 0);
    if (ovrDiff !== 0) return ovrDiff;

    const teamA = String(a?.teamName || "");
    const teamB = String(b?.teamName || "");
    if (teamA !== teamB) return teamA.localeCompare(teamB);

    return String(a?.playerName || "").localeCompare(String(b?.playerName || ""));
  });
}

function SectionControls({
  isShown,
  onShowAll,
  onHideAll,
  teamFilter,
  onTeamFilterChange,
  filterOptions,
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={teamFilter}
        onChange={(e) => onTeamFilterChange(e.target.value)}
        className="px-3 py-2 rounded-lg bg-neutral-700 border border-white/10 text-white text-sm"
      >
        {filterOptions.map((team) => (
          <option key={team} value={team}>
            {team === "ALL" ? "All Teams" : team}
          </option>
        ))}
      </select>

      <button
        onClick={onShowAll}
        disabled={isShown}
        className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
          isShown
            ? "bg-neutral-700 text-white/35 cursor-not-allowed"
            : "bg-neutral-700 hover:bg-neutral-600 text-white"
        }`}
      >
        Show All
      </button>

      <button
        onClick={onHideAll}
        disabled={!isShown}
        className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
          !isShown
            ? "bg-neutral-700 text-white/35 cursor-not-allowed"
            : "bg-neutral-700 hover:bg-neutral-600 text-white"
        }`}
      >
        Hide All
      </button>
    </div>
  );
}
export default function PlayerTeamOptions() {
  const navigate = useNavigate();
  const { leagueData, setLeagueData, selectedTeam, setSelectedTeam } = useGame();

  const previewPlayerTeamOptions = simEngine.previewOffseasonContracts;
  const applyPlayerTeamOptions = simEngine.applyOffseasonContractDecisions;
  const previewRightsManagement = simEngine.previewRightsManagement;
  const applyRightsManagement = simEngine.applyRightsManagement;

  const [workingLeagueData, setWorkingLeagueData] = useState(leagueData || null);
  const [previewData, setPreviewData] = useState(null);
  const [appliedData, setAppliedData] = useState(null);
  const [userTeamOptionChoices, setUserTeamOptionChoices] = useState({});
 const [loadingPreview, setLoadingPreview] = useState(false);
const [loadingApply, setLoadingApply] = useState(false);
const [error, setError] = useState("");
const [rightsDecisionMap, setRightsDecisionMap] = useState({});
const [rightsSavedMessage, setRightsSavedMessage] = useState("");
const [rightsFinalizedLocal, setRightsFinalizedLocal] = useState(false);
const [rightsPreviewData, setRightsPreviewData] = useState(null);
const [rightsPreviewLoading, setRightsPreviewLoading] = useState(false);
const [rightsApplyLoading, setRightsApplyLoading] = useState(false);

const [sectionVisibility, setSectionVisibility] = useState({
  keyInterest: true,
  playerOptions: true,
  teamOptions: true,
  expiredContracts: true,
  resolutionLog: true,
  rightsManagement: true,
});

const [sectionTeamFilters, setSectionTeamFilters] = useState({
  keyInterest: "ALL",
  playerOptions: "ALL",
  teamOptions: "ALL",
  expiredContracts: "ALL",
  resolutionLog: "ALL",
  rightsManagement: "ALL",
});

  useEffect(() => {
    setWorkingLeagueData(leagueData || null);
  }, [leagueData]);

  const seasonYear = getSeasonYear(workingLeagueData || leagueData);
  const offseasonState = useMemo(() => readOffseasonState(seasonYear), [seasonYear]);

  const teamLogoMap = useMemo(() => {
    const map = {};
    const teams = getAllTeamsFromLeague(workingLeagueData || leagueData);
    for (const team of teams) {
      map[team.name] = resolveLogo(team);
    }
    return map;
  }, [workingLeagueData, leagueData]);

  const applyLeagueUpdate = (updated) => {
    if (!updated) return;

    setWorkingLeagueData(updated);

    if (typeof setLeagueData === "function") {
      setLeagueData(updated);
    }

    localStorage.setItem("leagueData", JSON.stringify(updated));

    if (typeof setSelectedTeam === "function" && selectedTeam?.name) {
      let nextSelectedTeam = null;

      for (const confKey of Object.keys(updated.conferences || {})) {
        const found = (updated.conferences[confKey] || []).find(
          (team) => team.name === selectedTeam.name
        );
        if (found) {
          nextSelectedTeam = found;
          break;
        }
      }

      if (nextSelectedTeam) {
        setSelectedTeam(nextSelectedTeam);
        localStorage.setItem("selectedTeam", JSON.stringify(nextSelectedTeam));
      }
    }
  };

  useEffect(() => {
    const stored = safeJSON(localStorage.getItem(OPTIONS_RESULTS_KEY), null);
    if (!stored || stored?.seasonYear !== seasonYear) return;

    if (stored?.preview) setPreviewData(stored.preview);
    if (stored?.applied) setAppliedData(stored.applied);
  }, [seasonYear]);

  useEffect(() => {
    const pendingRows = previewData?.pendingUserTeamOptions || [];
    if (!pendingRows.length) return;

    setUserTeamOptionChoices((prev) => {
      const next = { ...prev };

      for (const row of pendingRows) {
        const key =
          row?.playerId !== undefined && row?.playerId !== null && row?.playerId !== ""
            ? String(row.playerId)
            : String(row.playerName || "");

        if (!(key in next)) {
          next[key] = null;
        }
      }

      return next;
    });
  }, [previewData]);

  const loadPreview = async () => {
    if (!workingLeagueData) {
      setError("No league data found.");
      return;
    }

    setLoadingPreview(true);
    setError("");

    try {
      const res = await previewPlayerTeamOptions(
        workingLeagueData,
        selectedTeam?.name || null
      );

      if (!res?.ok) {
        setError(res?.reason || "Failed to load player and team options.");
        return;
      }

      setPreviewData(res);

      // Keep this storage tiny. Full preview payloads can exceed browser localStorage quota.
      const stored = safeJSON(localStorage.getItem(OPTIONS_RESULTS_KEY), {}) || {};
      safeSetJSON(OPTIONS_RESULTS_KEY, {
        ...stored,
        seasonYear,
        preview: {
          ok: true,
          seasonYear: res?.seasonYear,
          summary: res?.summary || {},
        },
        applied: stored?.applied || null,
      });
    } catch (err) {
      setError(err?.message || "Failed to load player and team options.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const loadRightsPreview = async (baseLeague = workingLeagueData) => {
    if (!baseLeague || !selectedTeam?.name) return null;

    if (typeof previewRightsManagement !== "function") {
      return null;
    }

    setRightsPreviewLoading(true);
    setError("");

    try {
      const res = await previewRightsManagement(
        baseLeague,
        selectedTeam.name
      );

      if (!res?.ok) {
        setError(res?.reason || "Failed to load rights management.");
        return null;
      }

      setRightsPreviewData(res);
      return res;
    } catch (err) {
      setError(err?.message || "Failed to load rights management.");
      return null;
    } finally {
      setRightsPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!workingLeagueData) return;
    if (appliedData?.ok) return;
    if (previewData?.ok) return;
    loadPreview();
  }, [workingLeagueData]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingUserTeamOptions = previewData?.pendingUserTeamOptions || [];
  const expiredContracts = previewData?.expiredContracts || [];
  const playerOptions = previewData?.playerOptions || [];
  const teamOptions = previewData?.teamOptions || [];
  const decisionLog = appliedData?.decisionLog || [];
  const resolutionLogFilterOptions = useMemo(() => {
  return getTeamFilterOptions(decisionLog);
}, [decisionLog]);

const filteredDecisionLog = useMemo(() => {
  const filtered = filterRowsByTeam(decisionLog, sectionTeamFilters.resolutionLog);

  return [...filtered].sort((a, b) => {
    const teamDiff = String(a?.teamName || "").localeCompare(String(b?.teamName || ""));
    if (teamDiff !== 0) return teamDiff;

    const typeDiff = String(a?.type || "").localeCompare(String(b?.type || ""));
    if (typeDiff !== 0) return typeDiff;

    return String(a?.playerName || "").localeCompare(String(b?.playerName || ""));
  });
}, [decisionLog, sectionTeamFilters.resolutionLog]);

  const allUserChoicesMade = useMemo(() => {
    if (!pendingUserTeamOptions.length) return true;

    return pendingUserTeamOptions.every((row) => {
      const key =
        row?.playerId !== undefined && row?.playerId !== null && row?.playerId !== ""
          ? String(row.playerId)
          : String(row.playerName || "");

      return userTeamOptionChoices[key] === true || userTeamOptionChoices[key] === false;
    });
  }, [pendingUserTeamOptions, userTeamOptionChoices]);

const previewSummary = previewData?.summary || {};
const appliedSummary = appliedData?.summary || {};

const selectedTeamName = selectedTeam?.name || null;
const optionsComplete = !!offseasonState?.optionsComplete || !!appliedData?.ok;

useEffect(() => {
  if (!optionsComplete) return;
  if (!selectedTeamName) return;
  if (!workingLeagueData) return;
  if (rightsFinalizedLocal) return;

  loadRightsPreview(workingLeagueData);
}, [optionsComplete, selectedTeamName, workingLeagueData, rightsFinalizedLocal]); // eslint-disable-line react-hooks/exhaustive-deps

const rightsRows = useMemo(() => {
  const rows =
    rightsPreviewData?.rightsRows ||
    rightsPreviewData?.rows ||
    rightsPreviewData?.teamSnapshot?.capHoldRows ||
    [];

  return Array.isArray(rows) ? rows : [];
}, [rightsPreviewData]);

const selectedRenounceRows = useMemo(() => {
  return rightsRows.filter((row) => {
    const key = row?.playerKey || getPlayerKey(row);
    return rightsDecisionMap[key] === "renounce";
  });
}, [rightsRows, rightsDecisionMap]);

const rightsCapHoldTotal = useMemo(() => {
  const fromSummary = rightsPreviewData?.summary?.capHoldTotal;
  const fromSnapshot = rightsPreviewData?.teamSnapshot?.capHoldTotal;

  if (fromSummary !== undefined && fromSummary !== null) return Number(fromSummary || 0);
  if (fromSnapshot !== undefined && fromSnapshot !== null) return Number(fromSnapshot || 0);

  return rightsRows.reduce(
    (sum, row) => sum + Number(row?.capHoldAmount ?? row?.capHold ?? 0),
    0
  );
}, [rightsPreviewData, rightsRows]);

const selectedRenounceCapHold = useMemo(() => {
  return selectedRenounceRows.reduce(
    (sum, row) => sum + Number(row?.capHoldAmount ?? row?.capHold ?? 0),
    0
  );
}, [selectedRenounceRows]);

const payrollBeforeHolds = useMemo(() => {
  const fromSummary = rightsPreviewData?.summary?.payrollBeforeHolds;
  const fromSnapshot = rightsPreviewData?.teamSnapshot?.rawPayrollWithoutHolds;

  if (fromSummary !== undefined && fromSummary !== null) return Number(fromSummary || 0);
  if (fromSnapshot !== undefined && fromSnapshot !== null) return Number(fromSnapshot || 0);

  return getTeamPayrollForNextSeason(workingLeagueData || leagueData, selectedTeamName);
}, [rightsPreviewData, workingLeagueData, leagueData, selectedTeamName]);

const salaryCap = Number(
  rightsPreviewData?.summary?.salaryCap ||
  rightsPreviewData?.teamSnapshot?.salaryCap ||
  (workingLeagueData || leagueData)?.salaryCap ||
  (workingLeagueData || leagueData)?.capLimit ||
  150000000
);

const practicalCapRoomBeforeRenounce = Number(
  rightsPreviewData?.summary?.practicalCapRoom ??
  rightsPreviewData?.teamSnapshot?.practicalCapRoom ??
  (salaryCap - payrollBeforeHolds - rightsCapHoldTotal)
);

const practicalCapRoomAfterRenounce =
  practicalCapRoomBeforeRenounce + selectedRenounceCapHold;

const rightsManagementComplete =
  rightsFinalizedLocal ||
  !!offseasonState?.rightsManagementComplete ||
  (optionsComplete && !!rightsPreviewData?.ok && rightsRows.length === 0);

const canContinueToFreeAgency = optionsComplete && rightsManagementComplete;

useEffect(() => {
  if (!optionsComplete) return;
  if (!selectedTeamName) return;
  if (!rightsPreviewData?.ok) return;
  if (rightsRows.length > 0) return;
  if (rightsFinalizedLocal || offseasonState?.rightsManagementComplete) return;

  const nextState = {
    ...readOffseasonState(seasonYear),
    active: true,
    seasonYear,
    retirementsComplete: true,
    optionsComplete: true,
    rightsManagementComplete: true,
    preFreeAgencyResolved: true,
    freeAgencyComplete: false,
    progressionComplete: false,
  };

  saveOffseasonState(nextState);
  setRightsFinalizedLocal(true);
  setRightsSavedMessage("Rights reviewed. No outgoing rights to manage.");
}, [
  optionsComplete,
  selectedTeamName,
  rightsPreviewData?.ok,
  rightsRows.length,
  rightsFinalizedLocal,
  offseasonState?.rightsManagementComplete,
  seasonYear,
]);

const cpuTeamOptions = useMemo(() => {
  return (teamOptions || []).filter((row) => row?.teamName !== selectedTeamName);
}, [teamOptions, selectedTeamName]);

const keyInterestRows = useMemo(() => {
  return buildKeyInterestRows(expiredContracts, playerOptions, teamOptions);
}, [expiredContracts, playerOptions, teamOptions]);

const keyInterestFilterOptions = useMemo(() => {
  return getTeamFilterOptions(keyInterestRows);
}, [keyInterestRows]);

const playerOptionFilterOptions = useMemo(() => {
  return getTeamFilterOptions(playerOptions);
}, [playerOptions]);

const teamOptionFilterOptions = useMemo(() => {
  return getTeamFilterOptions(cpuTeamOptions);
}, [cpuTeamOptions]);

const expiredContractFilterOptions = useMemo(() => {
  return getTeamFilterOptions(expiredContracts);
}, [expiredContracts]);

const filteredKeyInterestRows = useMemo(() => {
  return filterRowsByTeam(keyInterestRows, sectionTeamFilters.keyInterest);
}, [keyInterestRows, sectionTeamFilters.keyInterest]);

const filteredPlayerOptions = useMemo(() => {
  return filterRowsByTeam(playerOptions, sectionTeamFilters.playerOptions);
}, [playerOptions, sectionTeamFilters.playerOptions]);

const filteredCpuTeamOptions = useMemo(() => {
  return filterRowsByTeam(cpuTeamOptions, sectionTeamFilters.teamOptions);
}, [cpuTeamOptions, sectionTeamFilters.teamOptions]);

const filteredExpiredContracts = useMemo(() => {
  return filterRowsByTeam(expiredContracts, sectionTeamFilters.expiredContracts);
}, [expiredContracts, sectionTeamFilters.expiredContracts]);

  const resolveOptions = async () => {
    if (!workingLeagueData) {
      setError("No league data found.");
      return;
    }

    if (!selectedTeamName) {
      setError("No selected team found.");
      return;
    }

    if (!allUserChoicesMade) {
      setError("Choose exercise or decline for every pending team option on your team.");
      return;
    }

    setLoadingApply(true);
    setError("");

    try {
      const decisionsPayload = {};

      for (const row of pendingUserTeamOptions) {
        const hasId =
          row?.playerId !== undefined && row?.playerId !== null && row?.playerId !== "";

        const idKey = hasId ? String(row.playerId) : null;
        const nameKey = String(row.playerName || "");

        const choice = hasId ? userTeamOptionChoices[idKey] : userTeamOptionChoices[nameKey];

        if (idKey) decisionsPayload[idKey] = !!choice;
        if (nameKey) decisionsPayload[nameKey] = !!choice;
      }

      const res = await applyPlayerTeamOptions(
        workingLeagueData,
        selectedTeamName,
        decisionsPayload
      );

      if (!res?.ok || !res?.leagueData) {
        setError(res?.reason || "Failed to apply option decisions.");
        return;
      }

      applyLeagueUpdate(res.leagueData);
      setAppliedData(res);

      if (res?.previewAfter) {
        setPreviewData(res.previewAfter);
      }

      const nextOffseasonState = {
        ...readOffseasonState(seasonYear),
        active: true,
        seasonYear,
        retirementsComplete: true,
        optionsComplete: true,
        rightsManagementComplete: false,
        preFreeAgencyResolved: false,
        freeAgencyComplete: false,
        progressionComplete: false,
      };

      saveOffseasonState(nextOffseasonState);

      // Store only lightweight UI history. Do not store full leagueData/previewAfter here.
      safeSetJSON(OPTIONS_RESULTS_KEY, {
        seasonYear,
        preview: {
          ok: true,
          seasonYear: res?.previewAfter?.seasonYear || seasonYear,
          summary: res?.previewAfter?.summary || {},
        },
        applied: {
          ok: true,
          summary: res?.summary || {},
          decisionLog: res?.decisionLog || [],
        },
      });
    } catch (err) {
      setError(err?.message || "Failed to apply option decisions.");
    } finally {
      setLoadingApply(false);
    }
  };

  const setChoiceForRow = (row, value) => {
    const key =
      row?.playerId !== undefined && row?.playerId !== null && row?.playerId !== ""
        ? String(row.playerId)
        : String(row.playerName || "");

    setUserTeamOptionChoices((prev) => ({
      ...prev,
      [key]: value,
    }));
  };
  const showSection = (sectionKey) => {
  setSectionVisibility((prev) => ({
    ...prev,
    [sectionKey]: true,
  }));
};

const hideSection = (sectionKey) => {
  setSectionVisibility((prev) => ({
    ...prev,
    [sectionKey]: false,
  }));
};

const setSectionTeamFilter = (sectionKey, value) => {
  setSectionTeamFilters((prev) => ({
    ...prev,
    [sectionKey]: value,
  }));
};

const getRightsDecisionKey = (row) => row?.playerKey || getPlayerKey(row);

const hasPendingQualifyingOffer = (row) => {
  return row?.qualifyingOfferEligible?.status === "pending";
};

const hasExtendedQualifyingOffer = (row) => {
  return row?.qualifyingOffer?.status === "extended" || !!row?.qualifyingOffer?.amount;
};

const getDefaultRightsDecision = (row) => {
  if (hasExtendedQualifyingOffer(row)) return "keep_qo";
  if (hasPendingQualifyingOffer(row)) return "";
  return "keep";
};

const getRightsDecision = (row) => {
  const key = getRightsDecisionKey(row);
  return rightsDecisionMap[key] ?? getDefaultRightsDecision(row);
};

const setRightsDecisionForRow = (row, decision) => {
  const key = getRightsDecisionKey(row);
  setRightsSavedMessage("");
  setRightsDecisionMap((prev) => ({
    ...prev,
    [key]: decision,
  }));
};

const getPendingQORowsMissingDecision = () => {
  return rightsRows.filter((row) => {
    if (!hasPendingQualifyingOffer(row)) return false;
    const decision = getRightsDecision(row);
    return !["extend_qo", "decline_qo", "renounce"].includes(decision);
  });
};

const finalizeRightsManagement = async () => {
  if (!selectedTeamName || !workingLeagueData) return;

  if (typeof applyRightsManagement !== "function") {
    setError("Rights management backend is not wired in simEnginePy.js.");
    return;
  }

  setRightsApplyLoading(true);
  setError("");
  setRightsSavedMessage("");

  try {
    const missingQODecisions = getPendingQORowsMissingDecision();
    if (missingQODecisions.length) {
      setError("Choose Extend QO, No QO, or Renounce Rights for every QO-eligible player before finalizing rights management.");
      return;
    }

    const rightsDecisions = {};

    for (const row of rightsRows) {
      const key = getRightsDecisionKey(row);
      const decision = getRightsDecision(row);
      rightsDecisions[key] = decision || "keep";
    }

    const res = await applyRightsManagement(
      workingLeagueData,
      selectedTeamName,
      rightsDecisions
    );

    if (!res?.ok || !res?.leagueData) {
      setError(res?.reason || "Failed to apply rights management.");
      return;
    }

    applyLeagueUpdate(res.leagueData);

    if (res?.previewAfter) {
      setRightsPreviewData(res.previewAfter);
    } else {
      await loadRightsPreview(res.leagueData);
    }

    const nextState = {
      ...readOffseasonState(seasonYear),
      active: true,
      seasonYear,
      retirementsComplete: true,
      optionsComplete: true,
      rightsManagementComplete: true,
      preFreeAgencyResolved: true,
      freeAgencyComplete: false,
      progressionComplete: false,
    };

    saveOffseasonState(nextState);
    setRightsFinalizedLocal(true);

    const renouncedCount =
      res?.summary?.renouncedCount ?? selectedRenounceRows.length;
    const extendedQOCount = Number(res?.summary?.extendedQOCount || 0);
    const declinedQOCount = Number(res?.summary?.declinedQOCount || 0) + Number(res?.summary?.withdrawnQOCount || 0);

    const parts = [];
    if (renouncedCount) parts.push(`${renouncedCount} renounced`);
    if (extendedQOCount) parts.push(`${extendedQOCount} QO extended`);
    if (declinedQOCount) parts.push(`${declinedQOCount} QO declined/withdrawn`);

    setRightsSavedMessage(
      parts.length ? `Rights saved: ${parts.join(", ")}.` : "Rights reviewed. No changes selected."
    );
  } catch (err) {
    setError(err?.message || "Failed to apply rights management.");
  } finally {
    setRightsApplyLoading(false);
  }
};

const renderKeyInterestExtraNode = (row) => {
  if (row?.interestType === "expired_contract") {
    return <DataPill>Expiring Deal</DataPill>;
  }

  if (row?.interestType === "player_option") {
    return (
      <>
        <DataPill tone="orange">Player Option</DataPill>
        <DataPill tone="orange">
          {row?.playerOptionDecision?.exerciseOption ? "Likely Opt In" : "Likely Free Agency"}
        </DataPill>
      </>
    );
  }

  if (row?.interestType === "team_option") {
    const isUserTeam = row?.teamName === selectedTeamName;

    return (
      <>
        <DataPill tone="green">Team Option</DataPill>
        <DataPill tone="green">
          {isUserTeam
            ? "User Decision"
            : row?.cpuTeamOptionDecision?.exerciseOption
            ? "Likely Exercise"
            : "Likely Decline"}
        </DataPill>
      </>
    );
  }

  return null;
};

  const renderRow = (row, idx, extraNode = null) => {
    const logo = teamLogoMap[row?.teamName] || "";

    return (
      <div
        key={`${row?.playerName || "row"}-${idx}`}
        className="px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 hover:bg-white/5 transition"
      >
        <div className="flex items-center gap-4 min-w-0">
          {logo ? (
            <img
              src={logo}
              alt={row?.teamName || "Team"}
              className="h-10 w-10 object-contain"
            />
          ) : (
            <div className="h-10 w-10 rounded bg-white/5 border border-white/10" />
          )}

          <div className="min-w-0">
            <div className="text-lg font-bold text-white truncate">
              {row?.playerName || "Unknown Player"}
            </div>
            <div className="text-sm text-white/55 mt-1">
              {row?.position || "-"} • Age {row?.age ?? "-"} • OVR {row?.overall ?? "-"} • {row?.teamName || "Unknown Team"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {row?.salaryThisYear > 0 && (
            <DataPill>{fmtMoney(row.salaryThisYear)}</DataPill>
          )}

          {row?.marketValue?.expectedAAV > 0 && (
            <DataPill tone="orange">Market {fmtMoney(row.marketValue.expectedAAV)}</DataPill>
          )}

          {row?.teamDirection && (
            <DataPill tone="green">{row.teamDirection}</DataPill>
          )}

          {extraNode}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-white py-10 px-4">

      <style>{`
        .bm-orange-scroll {
          scrollbar-width: thin;
          scrollbar-color: #f97316 #171717;
        }

        .bm-orange-scroll::-webkit-scrollbar {
          width: 10px;
        }

        .bm-orange-scroll::-webkit-scrollbar-track {
          background: #171717;
          border-radius: 9999px;
        }

        .bm-orange-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(to bottom, #f97316, #c2410c);
          border-radius: 9999px;
          border: 2px solid #171717;
        }

        .bm-orange-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(to bottom, #fb923c, #ea580c);
        }
      `}</style>
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-7">
          <p className="text-sm uppercase tracking-[0.28em] text-white/40 mb-3">
            Offseason Event
          </p>
          <h1 className="text-5xl font-extrabold text-orange-500">
            PLAYER / TEAM OPTIONS
          </h1>
          <p className="text-white/60 mt-3">
            Settle contract options before free agency opens.
          </p>
        </div>

        <div className="bg-neutral-800/85 border border-white/10 rounded-3xl shadow-2xl p-6 md:p-7 mb-7">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <div className="text-sm text-white/45 uppercase tracking-[0.2em] mb-2">
                Options Phase
              </div>
              <h2 className="text-3xl font-extrabold text-white">
                {seasonYear} Offseason
              </h2>
              <p className="text-white/60 mt-2 max-w-2xl">
                This stage resolves expired deals, player options, and team options before the market opens.
              </p>
            </div>

            <div className="flex gap-3 flex-wrap">
              <button
                onClick={loadPreview}
                disabled={loadingPreview || loadingApply}
                className={`px-5 py-3 rounded-xl font-bold transition ${
                  loadingPreview || loadingApply
                    ? "bg-neutral-700 text-white/45 cursor-not-allowed"
                    : "bg-neutral-700 hover:bg-neutral-600 text-white"
                }`}
              >
                {loadingPreview ? "Loading..." : "Refresh Preview"}
              </button>

              {!optionsComplete ? (
                <button
                  onClick={resolveOptions}
                  disabled={loadingApply || loadingPreview || !allUserChoicesMade}
                  className={`px-5 py-3 rounded-xl font-bold transition ${
                    loadingApply || loadingPreview || !allUserChoicesMade
                      ? "bg-neutral-700 text-white/45 cursor-not-allowed"
                      : "bg-orange-600 hover:bg-orange-500 text-white"
                  }`}
                >
                  {loadingApply ? "Resolving Options..." : "Resolve Options"}
                </button>
              ) : (
                <button
                  onClick={() => navigate("/offseason")}
                  className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold transition"
                >
                  Continue to Offseason Hub
                </button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-red-200 font-semibold">
            {error}
          </div>
        )}

        {!optionsComplete ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-7">
            <SummaryCard
              label="Expired Contracts"
              value={previewSummary?.expiredContractCount || 0}
              tone="orange"
            />
            <SummaryCard
              label="Player Options"
              value={previewSummary?.playerOptionCount || 0}
            />
            <SummaryCard
              label="Team Options"
              value={previewSummary?.teamOptionCount || 0}
            />
            <SummaryCard
              label="Your Decisions"
              value={previewSummary?.pendingUserTeamOptionCount || 0}
              tone="green"
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-7">
            <SummaryCard
              label="Entered Free Agency"
              value={appliedSummary?.enteredFreeAgencyCount || 0}
              tone="orange"
            />
            <SummaryCard
              label="Player Options Accepted"
              value={appliedSummary?.playerOptionAcceptedCount || 0}
            />
            <SummaryCard
              label="Team Options Exercised"
              value={appliedSummary?.teamOptionExercisedCount || 0}
              tone="green"
            />
            <SummaryCard
              label="Team Options Declined"
              value={appliedSummary?.teamOptionDeclinedCount || 0}
            />
          </div>
        )}

        <div className="space-y-7">
  {!optionsComplete && (
    <>
          <SectionShell
            title="Your Team Options"
            subtitle={
              pendingUserTeamOptions.length
                ? "Choose whether to exercise or decline each team option on your roster."
                : "No pending team option decisions for your team."
            }
            rightNode={
              pendingUserTeamOptions.length ? (
                <DataPill tone="orange">{pendingUserTeamOptions.length} Pending</DataPill>
              ) : null
            }
          >
            {!pendingUserTeamOptions.length ? (
              <div className="px-6 py-14 text-center text-white/50">
                No user-controlled team options this offseason.
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {pendingUserTeamOptions.map((row, idx) => {
                  const key =
                    row?.playerId !== undefined && row?.playerId !== null && row?.playerId !== ""
                      ? String(row.playerId)
                      : String(row.playerName || "");

                  const choice = userTeamOptionChoices[key];

                  return renderRow(
                    row,
                    idx,
                    <div className="flex gap-2">
                      <button
                        onClick={() => setChoiceForRow(row, true)}
                        className={`px-4 py-2 rounded-lg font-semibold transition ${
                          choice === true
                            ? "bg-emerald-600 text-white"
                            : "bg-neutral-700 hover:bg-neutral-600 text-white"
                        }`}
                      >
                        Exercise
                      </button>

                      <button
                        onClick={() => setChoiceForRow(row, false)}
                        className={`px-4 py-2 rounded-lg font-semibold transition ${
                          choice === false
                            ? "bg-red-600 text-white"
                            : "bg-neutral-700 hover:bg-neutral-600 text-white"
                        }`}
                      >
                        Decline
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionShell>
          <SectionShell
  title="Players of Key Interest"
  subtitle="High-impact players (85+ OVR) who are expiring, on a player option, or on a team option this offseason."
  rightNode={
    <SectionControls
      isShown={sectionVisibility.keyInterest}
      onShowAll={() => showSection("keyInterest")}
      onHideAll={() => hideSection("keyInterest")}
      teamFilter={sectionTeamFilters.keyInterest}
      onTeamFilterChange={(value) => setSectionTeamFilter("keyInterest", value)}
      filterOptions={keyInterestFilterOptions}
    />
  }
>
  {!sectionVisibility.keyInterest ? (
    <div className="px-6 py-14 text-center text-white/50">
      Section hidden. Click Show All to expand.
    </div>
  ) : !filteredKeyInterestRows.length ? (
    <div className="px-6 py-14 text-center text-white/50">
      No key interest players match this filter.
    </div>
  ) : (
    <div className="bm-orange-scroll max-h-[520px] overflow-y-auto divide-y divide-white/5 pr-1">
      {filteredKeyInterestRows.map((row, idx) =>
        renderRow(row, idx, renderKeyInterestExtraNode(row))
      )}
    </div>
  )}
</SectionShell>
<SectionShell
  title="Player Options"
  subtitle="These are auto-resolved by the Python logic when you finalize this stage."
  rightNode={
    <SectionControls
      isShown={sectionVisibility.playerOptions}
      onShowAll={() => showSection("playerOptions")}
      onHideAll={() => hideSection("playerOptions")}
      teamFilter={sectionTeamFilters.playerOptions}
      onTeamFilterChange={(value) => setSectionTeamFilter("playerOptions", value)}
      filterOptions={playerOptionFilterOptions}
    />
  }
>
  {!sectionVisibility.playerOptions ? (
    <div className="px-6 py-14 text-center text-white/50">
      Section hidden. Click Show All to expand.
    </div>
  ) : !filteredPlayerOptions.length ? (
    <div className="px-6 py-14 text-center text-white/50">
      No player options match this filter.
    </div>
  ) : (
    <div className="bm-orange-scroll max-h-[520px] overflow-y-auto divide-y divide-white/5 pr-1">
      {filteredPlayerOptions.map((row, idx) =>
        renderRow(
          row,
          idx,
          <DataPill tone="orange">
            {row?.playerOptionDecision?.exerciseOption ? "Likely Opt In" : "Likely Free Agency"}
          </DataPill>
        )
      )}
    </div>
  )}
</SectionShell>
<SectionShell
  title="CPU Team Options"
  subtitle="CPU teams will automatically decide whether to keep or decline these players."
  rightNode={
    <SectionControls
      isShown={sectionVisibility.teamOptions}
      onShowAll={() => showSection("teamOptions")}
      onHideAll={() => hideSection("teamOptions")}
      teamFilter={sectionTeamFilters.teamOptions}
      onTeamFilterChange={(value) => setSectionTeamFilter("teamOptions", value)}
      filterOptions={teamOptionFilterOptions}
    />
  }
>
  {!sectionVisibility.teamOptions ? (
    <div className="px-6 py-14 text-center text-white/50">
      Section hidden. Click Show All to expand.
    </div>
  ) : !filteredCpuTeamOptions.length ? (
    <div className="px-6 py-14 text-center text-white/50">
      No CPU team options match this filter.
    </div>
  ) : (
    <div className="bm-orange-scroll max-h-[520px] overflow-y-auto divide-y divide-white/5 pr-1">
      {filteredCpuTeamOptions.map((row, idx) =>
        renderRow(
          row,
          idx,
          <DataPill tone="green">
            {row?.cpuTeamOptionDecision?.exerciseOption ? "Likely Exercise" : "Likely Decline"}
          </DataPill>
        )
      )}
    </div>
  )}
</SectionShell>

<SectionShell
  title="Expired Contracts"
  subtitle="These players will enter free agency when you resolve this stage."
  rightNode={
    <SectionControls
      isShown={sectionVisibility.expiredContracts}
      onShowAll={() => showSection("expiredContracts")}
      onHideAll={() => hideSection("expiredContracts")}
      teamFilter={sectionTeamFilters.expiredContracts}
      onTeamFilterChange={(value) => setSectionTeamFilter("expiredContracts", value)}
      filterOptions={expiredContractFilterOptions}
    />
  }
>
  {!sectionVisibility.expiredContracts ? (
    <div className="px-6 py-14 text-center text-white/50">
      Section hidden. Click Show All to expand.
    </div>
  ) : !filteredExpiredContracts.length ? (
    <div className="px-6 py-14 text-center text-white/50">
      No expired contracts match this filter.
    </div>
  ) : (
    <div className="bm-orange-scroll max-h-[520px] overflow-y-auto divide-y divide-white/5 pr-1">
      {filteredExpiredContracts.map((row, idx) =>
        renderRow(
          row,
          idx,
          <DataPill>Expiring Deal</DataPill>
        )
      )}
    </div>
  )}
</SectionShell>
    </>
  )}

  {optionsComplete && (
    <SectionShell
      title="Rights Management / Cap Holds"
      subtitle="Keep Bird/RFA control or renounce rights to clear cap holds before free agency."
      rightNode={
        <div className="flex items-center gap-2 flex-wrap">
          <DataPill tone="orange">Cap Holds {fmtMoney(rightsCapHoldTotal)}</DataPill>
          <DataPill tone="green">After Renounces {fmtMoney(practicalCapRoomAfterRenounce)}</DataPill>
        </div>
      }
    >
      {!rightsRows.length ? (
        <div className="px-6 py-12 text-center text-white/50 space-y-4">
          <div>No outgoing free-agent rights to manage for your team.</div>
          <button
            onClick={finalizeRightsManagement}
            disabled={rightsManagementComplete || rightsApplyLoading || rightsPreviewLoading}
            className={`px-5 py-3 rounded-xl font-bold transition ${
              (rightsManagementComplete || rightsApplyLoading || rightsPreviewLoading)
                ? "bg-neutral-700 text-white/45 cursor-not-allowed"
                : "bg-orange-600 hover:bg-orange-500 text-white"
            }`}
          >
            {rightsApplyLoading ? "Saving Rights..." : rightsManagementComplete ? "Rights Finalized" : "Confirm Rights Reviewed"}
          </button>
        </div>
      ) : (
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <SummaryCard label="Roster Payroll" value={fmtMoney(payrollBeforeHolds)} />
            <SummaryCard label="Cap Holds Kept" value={fmtMoney(rightsCapHoldTotal - selectedRenounceCapHold)} tone="orange" />
            <SummaryCard label="Cap Room Now" value={fmtMoney(practicalCapRoomBeforeRenounce)} />
            <SummaryCard label="Cap Room If Saved" value={fmtMoney(practicalCapRoomAfterRenounce)} tone="green" />
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/65">
Keeping rights preserves Bird control, but the cap hold stays on your books. For QO-eligible players, extend the qualifying offer to make them RFA, choose No QO to make them UFA while keeping Bird rights, or renounce rights completely to clear the hold.          </div>
          {rightsSavedMessage && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200">{rightsSavedMessage}</div>
          )}
          <div className="divide-y divide-white/5 rounded-2xl overflow-hidden border border-white/10">
            {rightsRows.map((row, idx) => {
              const key = getRightsDecisionKey(row);
              const decision = getRightsDecision(row);
              const renounced = decision === "renounce";
              const pendingQO = hasPendingQualifyingOffer(row);
              const extendedQO = hasExtendedQualifyingOffer(row);
              const qoAmount = Number(row?.qualifyingOfferEligible?.amount || row?.qualifyingOffer?.amount || 0);
              const disabled = rightsManagementComplete || rightsApplyLoading;
              const buttonClass = (active, tone = "neutral") => {
                const activeClass =
                  tone === "red"
                    ? "bg-red-600 text-white"
                    : tone === "green"
                    ? "bg-emerald-600 text-white"
                    : "bg-orange-600 text-white";

                const inactiveClass = "bg-neutral-700 hover:bg-neutral-600 text-white";

                return `px-3 py-2 rounded-lg font-semibold text-sm whitespace-nowrap transition ${
                  active ? activeClass : inactiveClass
                } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`;
              };

              const actionButtons = pendingQO ? (
                <>
                  <button
                    onClick={() => setRightsDecisionForRow(row, "extend_qo")}
                    disabled={disabled}
                    className={buttonClass(decision === "extend_qo", "green")}
                  >
                    Extend QO
                  </button>

                  <button
                    onClick={() => setRightsDecisionForRow(row, "decline_qo")}
                    disabled={disabled}
                    className={buttonClass(decision === "decline_qo")}
                  >
                    No QO, Keep Rights
                  </button>

                  <button
                    onClick={() => setRightsDecisionForRow(row, "renounce")}
                    disabled={disabled}
                    className={buttonClass(renounced, "red")}
                  >
                    Renounce Rights
                  </button>
                </>
              ) : extendedQO ? (
                <>
                  <button
                    onClick={() => setRightsDecisionForRow(row, "keep_qo")}
                    disabled={disabled}
                    className={buttonClass(decision === "keep_qo", "green")}
                  >
                    Keep QO
                  </button>

                  <button
                    onClick={() => setRightsDecisionForRow(row, "withdraw_qo")}
                    disabled={disabled}
                    className={buttonClass(decision === "withdraw_qo")}
                  >
                    Withdraw QO
                  </button>

                  <button
                    onClick={() => setRightsDecisionForRow(row, "renounce")}
                    disabled={disabled}
                    className={buttonClass(renounced, "red")}
                  >
                    Renounce Rights
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setRightsDecisionForRow(row, "keep")}
                    disabled={disabled}
                    className={buttonClass(decision === "keep", "green")}
                  >
                    Keep Rights
                  </button>

                  <button
                    onClick={() => setRightsDecisionForRow(row, "renounce")}
                    disabled={disabled}
                    className={buttonClass(renounced, "red")}
                  >
                    Renounce Rights
                  </button>
                </>
              );

              return (
                <div
                  key={`${key}-${idx}`}
                  className="px-5 py-4 bg-neutral-900/70"
                >
                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(180px,260px)_minmax(430px,1fr)_auto] gap-4 xl:items-center">
                    <div className="min-w-0">
                      <div className="text-lg font-bold text-white truncate">
                        {row.playerName}
                      </div>
                      <div className="text-sm text-white/55 mt-1">
                        {row.position || "-"} • Age {row.age ?? "-"} • OVR {row.overall ?? "-"}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <DataPill tone="orange">{normalizeBirdLabel(row.birdLevel)}</DataPill>
                      {extendedQO && <DataPill tone="green">RFA / QO {fmtMoney(qoAmount)}</DataPill>}
                      {pendingQO && <DataPill tone="orange">QO Eligible {fmtMoney(qoAmount)}</DataPill>}
                      <DataPill>Hold {fmtMoney(row.capHoldAmount ?? row.capHold)}</DataPill>
                      {row.marketValue?.expectedAAV > 0 && <DataPill>Market {fmtMoney(row.marketValue.expectedAAV)}</DataPill>}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap xl:flex-nowrap xl:justify-end">
                      {actionButtons}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end">
            <button onClick={finalizeRightsManagement} disabled={rightsManagementComplete || rightsApplyLoading || rightsPreviewLoading} className={`px-5 py-3 rounded-xl font-bold transition ${(rightsManagementComplete || rightsApplyLoading || rightsPreviewLoading) ? "bg-neutral-700 text-white/45 cursor-not-allowed" : "bg-orange-600 hover:bg-orange-500 text-white"}`}>
              {rightsApplyLoading ? "Saving Rights..." : rightsManagementComplete ? "Rights Finalized" : "Finalize Rights Management"}
            </button>
          </div>
        </div>
      )}
    </SectionShell>
  )}

  {optionsComplete && (
  <SectionShell
    title="Resolution Log"
    subtitle="These are the option and contract decisions that were applied to the league."
    rightNode={
      <SectionControls
        isShown={sectionVisibility.resolutionLog}
        onShowAll={() => showSection("resolutionLog")}
        onHideAll={() => hideSection("resolutionLog")}
        teamFilter={sectionTeamFilters.resolutionLog}
        onTeamFilterChange={(value) => setSectionTeamFilter("resolutionLog", value)}
        filterOptions={resolutionLogFilterOptions}
      />
    }
  >
    {!sectionVisibility.resolutionLog ? (
      <div className="px-6 py-14 text-center text-white/50">
        Section hidden. Click Show All to expand.
      </div>
    ) : !filteredDecisionLog.length ? (
      <div className="px-6 py-14 text-center text-white/50">
        No decision log available for this filter.
      </div>
    ) : (
      <div className="bm-orange-scroll max-h-[520px] overflow-y-auto divide-y divide-white/5 pr-1">
        {filteredDecisionLog.map((row, idx) => {
          const logo = teamLogoMap[row?.teamName] || "";

          return (
            <div
              key={`${row?.playerName || "decision"}-${idx}`}
              className="px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4 hover:bg-white/5 transition"
            >
              <div className="flex items-center gap-4 min-w-0">
                {logo ? (
                  <img
                    src={logo}
                    alt={row?.teamName || "Team"}
                    className="h-10 w-10 object-contain"
                  />
                ) : (
                  <div className="h-10 w-10 rounded bg-white/5 border border-white/10" />
                )}

                <div className="min-w-0">
                  <div className="text-lg font-bold text-white truncate">
                    {row?.playerName || "Unknown Player"}
                  </div>
                  <div className="text-sm text-white/55 mt-1">
                    {row?.teamName || "Unknown Team"} • {String(row?.type || "").replaceAll("_", " ")}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <DataPill tone="orange">
                  {String(row?.result || "resolved").replaceAll("_", " ")}
                </DataPill>
              </div>
            </div>
          );
        })}
      </div>
    )}
  </SectionShell>
)}
        </div>

        <div className="mt-8 flex justify-center gap-4 flex-wrap">
          <button
            onClick={() => navigate("/offseason")}
            className="px-6 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl font-semibold transition"
          >
            Back to Offseason Hub
          </button>

          {!optionsComplete ? (
            <button
              onClick={resolveOptions}
              disabled={loadingApply || loadingPreview || !allUserChoicesMade}
              className={`px-6 py-3 rounded-xl font-semibold transition ${
                loadingApply || loadingPreview || !allUserChoicesMade
                  ? "bg-neutral-700 text-white/45 cursor-not-allowed"
                  : "bg-orange-600 hover:bg-orange-500 text-white"
              }`}
            >
              {loadingApply ? "Resolving Options..." : "Resolve Options"}
            </button>
          ) : (
            <button
              onClick={() => navigate("/free-agents")}
              disabled={!canContinueToFreeAgency}
              className={`px-6 py-3 rounded-xl font-semibold transition ${
                !canContinueToFreeAgency
                  ? "bg-neutral-700 text-white/45 cursor-not-allowed"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white"
              }`}
            >
              {canContinueToFreeAgency ? "Continue to Free Agency" : "Finalize Rights First"}
            </button>
          )}

          <button
            onClick={() => navigate("/team-hub")}
            className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-xl font-semibold transition"
          >
            Back to Team Hub
          </button>
        </div>
      </div>
    </div>
  );
}