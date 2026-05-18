import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import styles from "./OffseasonHub.module.css";

const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const FREE_AGENCY_LAST_ROUTE_KEY = "bm_free_agency_last_route_v1";

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

function getChampionName() {
  const champ = safeJSON(localStorage.getItem("bm_champ_v1"), null);
  if (!champ) return null;

  if (typeof champ === "string") return champ;
  return champ.team || champ.teamName || champ.name || null;
}

function buildDefaultOffseasonState(seasonYear) {
  return {
    active: true,
    seasonYear,
    retirementsComplete: false,
    retirementsSkipped: false,
    retirementsDisabled: false,
    optionsComplete: false,
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

function getLeagueDataSnapshot(leagueData) {
  if (leagueData && typeof leagueData === "object") return leagueData;
  return safeJSON(localStorage.getItem("leagueData"), {}) || {};
}

function shouldResumeViewingOffers(leagueData) {
  const snapshot = getLeagueDataSnapshot(leagueData);
  const state = snapshot?.freeAgencyState || {};

  if (!state || typeof state !== "object") return false;

  const pendingUserDecisions = Array.isArray(state.pendingUserDecisions)
    ? state.pendingUserDecisions.length
    : 0;
  const pendingRfaMatchDecisions = Array.isArray(state.pendingRfaMatchDecisions)
    ? state.pendingRfaMatchDecisions.length
    : 0;

  const latestResults = state.latestResults || null;
  const latestHasContent = Boolean(
    latestResults &&
    ((latestResults.dayResolved !== null &&
      latestResults.dayResolved !== undefined) ||
      (Array.isArray(latestResults.signings) && latestResults.signings.length > 0) ||
      (Array.isArray(latestResults.generatedOffers) && latestResults.generatedOffers.length > 0) ||
      latestResults.stateSummary)
  );

  return Boolean(
    pendingUserDecisions > 0 ||
      pendingRfaMatchDecisions > 0 ||
      latestHasContent
  );
}

function getFreeAgencyResumeRoute(leagueData) {
  const savedRoute = localStorage.getItem(FREE_AGENCY_LAST_ROUTE_KEY);

  if (savedRoute === "/viewing-offers" && shouldResumeViewingOffers(leagueData)) {
    return "/viewing-offers";
  }

  if (savedRoute === "/free-agents") {
    return "/free-agents";
  }

  if (shouldResumeViewingOffers(leagueData)) {
    return "/viewing-offers";
  }

  return "/free-agents";
}

function getAllTeamsFromLeague(leagueData) {
  const snapshot = getLeagueDataSnapshot(leagueData);

  if (Array.isArray(snapshot?.teams)) return snapshot.teams;
  if (snapshot?.conferences) return Object.values(snapshot.conferences).flat();

  return [];
}

function getSelectedTeamName(selectedTeam) {
  if (selectedTeam?.name) return selectedTeam.name;

  const saved = safeJSON(localStorage.getItem("selectedTeam"), null);
  if (typeof saved === "string") return saved;
  if (saved?.name) return saved.name;

  return "";
}

function getSelectedTeamFromLeague(leagueData, selectedTeam) {
  const teamName = getSelectedTeamName(selectedTeam);
  if (!teamName) return null;

  return getAllTeamsFromLeague(leagueData).find((team) => team?.name === teamName) || null;
}

function getRosterStatus(leagueData, selectedTeam) {
  const snapshot = getLeagueDataSnapshot(leagueData);
  const teamName = getSelectedTeamName(selectedTeam);
  const liveTeam = getSelectedTeamFromLeague(snapshot, selectedTeam);

  if (!teamName || !liveTeam) {
    return {
      hasTeam: false,
      teamName,
      rosterCount: 0,
      minRoster: 14,
      maxRoster: 15,
      isValid: true,
      message: "",
    };
  }

  const minRoster = Number(
    snapshot?.minRosterSize ||
    snapshot?.minRosterLimit ||
    snapshot?.freeAgencyMinRosterSize ||
    snapshot?.offseasonMinRosterSize ||
    14
  );

  const maxRoster = Number(
    snapshot?.rosterLimit ||
    snapshot?.maxRosterSize ||
    15
  );

  const rosterCount = Array.isArray(liveTeam?.players)
    ? liveTeam.players.length
    : 0;

  let message = "";
  if (rosterCount < minRoster) {
    message = `${teamName} has ${rosterCount} players. You need at least ${minRoster} players before progression.`;
  } else if (rosterCount > maxRoster) {
    message = `${teamName} has ${rosterCount} players. You must get down to ${maxRoster} players before progression.`;
  }

  return {
    hasTeam: true,
    teamName,
    rosterCount,
    minRoster,
    maxRoster,
    isValid: !message,
    message,
  };
}


function StatPill({ label, value }) {
  return (
    <div className="px-4 py-3 rounded-xl bg-white/5 border border-white/10">
      <div className="text-xs text-white/50 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold text-white mt-1">{value}</div>
    </div>
  );
}

function EventCard({
  step,
  title,
  description,
  status,
  accent = "neutral",
  buttonLabel,
  onClick,
  disabled = false,
}) {
  const outerClass =
    accent === "orange"
      ? "border-orange-500/50 bg-gradient-to-br from-orange-600/20 to-neutral-800"
      : accent === "green"
      ? "border-emerald-500/35 bg-gradient-to-br from-emerald-600/10 to-neutral-800"
      : "border-white/10 bg-neutral-800/85";

  const statusClass =
    status === "Current"
      ? "bg-orange-500/15 text-orange-200 border-orange-400/30"
      : status === "Complete"
      ? "bg-emerald-500/15 text-emerald-200 border-emerald-400/30"
      : "bg-white/5 text-white/60 border-white/10";

  return (
    <div
      className={`rounded-2xl border shadow-2xl p-6 min-h-[250px] flex flex-col justify-between transition ${outerClass} ${
        disabled ? "opacity-70" : "hover:-translate-y-1 hover:border-orange-500/40"
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="h-12 w-12 rounded-2xl bg-black/25 border border-white/10 flex items-center justify-center text-xl font-extrabold text-orange-400">
            {step}
          </div>

          <div className={`px-3 py-1 rounded-full border text-xs font-semibold ${statusClass}`}>
            {status}
          </div>
        </div>

        <h2 className="text-2xl font-extrabold text-white mb-3">{title}</h2>
        <p className="text-sm leading-6 text-white/70">{description}</p>
      </div>

      <button
        onClick={onClick}
        disabled={disabled}
        className={`mt-6 w-full py-3 rounded-xl font-bold transition ${
          disabled
            ? "bg-neutral-700 text-white/45 cursor-not-allowed"
            : accent === "green"
            ? "bg-emerald-600 hover:bg-emerald-500 text-white"
            : accent === "orange"
            ? "bg-orange-600 hover:bg-orange-500 text-white"
            : "bg-neutral-700 hover:bg-neutral-600 text-white"
        }`}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

export default function OffseasonHub() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam } = useGame();

  const seasonYear = getSeasonYear(leagueData);
  const champion = getChampionName();
  const [offseasonState, setOffseasonState] = useState(() => readOffseasonState(seasonYear));

const toggleRetirementsDisabled = () => {
  const next = {
    ...readOffseasonState(seasonYear),
    retirementsDisabled: !offseasonState.retirementsDisabled,
  };

  setOffseasonState(next);
  saveOffseasonState(next);
};

const handleAdvanceToNewSeason = () => {
  const next = {
    ...offseasonState,
    active: false,
    progressionComplete: true,
  };

  setOffseasonState(next);
  saveOffseasonState(next);

  navigate("/calendar");
};

  useEffect(() => {
    const next = readOffseasonState(seasonYear);
    setOffseasonState(next);
    saveOffseasonState(next);
  }, [seasonYear]);

  const retirementResults = useMemo(() => {
    return safeJSON(localStorage.getItem("bm_retirement_results_v1"), null);
  }, []);

  const retiredCount = retirementResults?.summary?.retiredCount || 0;

  const rosterStatus = useMemo(() => {
    return getRosterStatus(leagueData, selectedTeam);
  }, [leagueData, selectedTeam]);

  const rosterBlocksProgression = rosterStatus.hasTeam && !rosterStatus.isValid;

  const cards = useMemo(() => {
    const retirementsComplete = !!offseasonState.retirementsComplete;
    const optionsComplete = !!offseasonState.optionsComplete;
    const freeAgencyComplete = !!offseasonState.freeAgencyComplete;
    const progressionComplete = !!offseasonState.progressionComplete;
    const freeAgencyReadyForProgression = freeAgencyComplete && !rosterBlocksProgression;

    return [
      {
        step: "1",
        title: "Player Retirements",
        description:
  offseasonState.retirementsDisabled
    ? "Retirements are disabled for this save, so veteran players will remain active and the offseason will continue without removing anyone."
    : "Run retirement logic, remove retired veterans from active rosters, and store them in league history before the market opens.",
        status: retirementsComplete ? "Complete" : "Current",
        accent: retirementsComplete ? "green" : "orange",
        buttonLabel: retirementsComplete ? "View Results" : "Open Retirements",
        disabled: false,
        onClick: () => navigate("/player-retirements"),
      },
      {
        step: "2",
        title: "Player / Team Options",
        description:
          "Resolve player options and team options before free agency begins so every contract decision is settled first.",
        status: optionsComplete ? "Complete" : retirementsComplete ? "Current" : "Locked",
        accent: optionsComplete ? "green" : retirementsComplete ? "orange" : "neutral",
        buttonLabel: retirementsComplete ? "Open Options" : "Locked",
        disabled: !retirementsComplete,
        onClick: () => navigate("/player-team-options"),
      },
      {
        step: "3",
        title: "Free Agency",
        description: rosterBlocksProgression
          ? "Your roster is still below or above the legal roster range. Sign or cut players here before progression unlocks."
          : "Negotiate with available players and reshape your roster once all option decisions are settled and the offseason market is ready.",
        status: freeAgencyComplete && rosterBlocksProgression ? "Current" : freeAgencyComplete ? "Complete" : optionsComplete ? "Current" : "Locked",
        accent: freeAgencyComplete && rosterBlocksProgression ? "orange" : freeAgencyComplete ? "green" : optionsComplete ? "orange" : "neutral",
        buttonLabel: optionsComplete ? "Open Free Agency" : "Locked",
        disabled: !optionsComplete,
        onClick: () => navigate(rosterBlocksProgression ? "/free-agents" : getFreeAgencyResumeRoute(leagueData)),
      },
      {
        step: "4",
        title: "Player Progression",
        description: rosterBlocksProgression
          ? "Progression stays locked until your team has a legal roster after free agency."
          : "Apply offseason development once roster moves are finished so your updated squads grow into the next year together.",
        status: progressionComplete ? "Complete" : freeAgencyReadyForProgression ? "Current" : "Locked",
        accent: progressionComplete ? "green" : freeAgencyReadyForProgression ? "orange" : "neutral",
        buttonLabel: freeAgencyReadyForProgression ? "Open Progression" : "Locked",
        disabled: !freeAgencyReadyForProgression,
        onClick: () => navigate("/player-progression"),
      },
{
  step: "5",
  title: "Advance to New Season",
  description:
    "Finalize the offseason and begin the new season once retirements, options, free agency, and progression are all complete.",
  status: progressionComplete ? "Current" : "Locked",
  accent: progressionComplete ? "orange" : "neutral",
  buttonLabel: progressionComplete ? "Advance to New Season" : "Locked",
  disabled: !progressionComplete,
  onClick: handleAdvanceToNewSeason,
},
    ];
  }, [navigate, offseasonState, leagueData, rosterBlocksProgression]);

  return (
    <div className={`${styles.offseasonPage} min-h-screen text-white py-10 px-4`}>
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <p className="text-sm text-white/45 tracking-[0.25em] uppercase mb-3">
            Basketball Manager
          </p>
          <h1 className="text-5xl font-extrabold text-orange-500 tracking-tight">
            OFFSEASON HUB
          </h1>
          <p className="text-white/60 mt-3 text-base">
            Move through each offseason stage one event at a time.
          </p>
        </div>

        <div className="bg-neutral-800/85 border border-white/10 rounded-3xl shadow-2xl p-6 md:p-7 mb-8">
          {rosterBlocksProgression && (
            <div className="mb-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200">
              {rosterStatus.message}
            </div>
          )}

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-white/40 mb-2">
                Offseason Overview
              </p>
              <h2 className="text-3xl font-extrabold text-white">
                {seasonYear} Offseason
              </h2>
<p className="text-white/60 mt-2">
  {champion ? `Champions: ${champion}` : "Championship complete."}
  {selectedTeam?.name ? ` Your team: ${selectedTeam.name}.` : ""}
</p>

<div className="mt-4">
  <button
    onClick={toggleRetirementsDisabled}
    className={`px-4 py-2 rounded-xl font-semibold transition ${
      offseasonState.retirementsDisabled
        ? "bg-emerald-700 hover:bg-emerald-600 text-white"
        : "bg-neutral-700 hover:bg-neutral-600 text-white"
    }`}
  >
    {offseasonState.retirementsDisabled ? "Retirements: OFF" : "Retirements: ON"}
  </button>
</div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatPill label="Season" value={seasonYear} />
              <StatPill label="Champion" value={champion || "TBD"} />
              <StatPill label="Retired" value={retiredCount} />
              <StatPill
                label="Current Step"
                value={
                  offseasonState.progressionComplete
                    ? "Start"
                    : offseasonState.freeAgencyComplete && !rosterBlocksProgression
                    ? "Progression"
                    : offseasonState.optionsComplete
                    ? "Free Agency"
                    : offseasonState.retirementsComplete
                    ? "Options"
                    : "Retirements"
                }
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {cards.map((card) => (
            <EventCard key={card.step} {...card} />
          ))}
        </div>

        <div className="mt-8 flex justify-center gap-4 flex-wrap">


<button
  onClick={() => navigate("/team-hub", { state: { offseasonMode: true, returnTo: "/offseason" } })}
  className="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-xl font-semibold transition"
>
  Open Team Hub
</button>
        </div>
      </div>
    </div>
  );
}