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

  const [workingLeagueData, setWorkingLeagueData] = useState(leagueData || null);
  const [previewData, setPreviewData] = useState(null);
  const [appliedData, setAppliedData] = useState(null);
  const [userTeamOptionChoices, setUserTeamOptionChoices] = useState({});
 const [loadingPreview, setLoadingPreview] = useState(false);
const [loadingApply, setLoadingApply] = useState(false);
const [error, setError] = useState("");

const [sectionVisibility, setSectionVisibility] = useState({
  keyInterest: true,
  playerOptions: true,
  teamOptions: true,
  expiredContracts: true,
  resolutionLog: true,
});

const [sectionTeamFilters, setSectionTeamFilters] = useState({
  keyInterest: "ALL",
  playerOptions: "ALL",
  teamOptions: "ALL",
  expiredContracts: "ALL",
  resolutionLog: "ALL",
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

      const stored = safeJSON(localStorage.getItem(OPTIONS_RESULTS_KEY), {}) || {};
      localStorage.setItem(
        OPTIONS_RESULTS_KEY,
        JSON.stringify({
          ...stored,
          seasonYear,
          preview: res,
          applied: stored?.applied || null,
        })
      );
    } catch (err) {
      setError(err?.message || "Failed to load player and team options.");
    } finally {
      setLoadingPreview(false);
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
        preFreeAgencyResolved: true,
        freeAgencyComplete: false,
        progressionComplete: false,
      };

      saveOffseasonState(nextOffseasonState);

      localStorage.setItem(
        OPTIONS_RESULTS_KEY,
        JSON.stringify({
          seasonYear,
          preview: res?.previewAfter || previewData || null,
          applied: res,
        })
      );
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
                  onClick={() => navigate("/offseason-hub")}
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
    <div className="divide-y divide-white/5">
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
    <div className="divide-y divide-white/5">
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
    <div className="divide-y divide-white/5">
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
    <div className="divide-y divide-white/5">
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
      <div className="divide-y divide-white/5">
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
            onClick={() => navigate("/offseason-hub")}
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
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-semibold transition"
            >
              Continue to Free Agency
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