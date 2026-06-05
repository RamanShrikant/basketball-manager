import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import * as simEngine from "../api/simEnginePy.js";
import PlayerCardModal from "../components/PlayerCardModal.jsx";
import styles from "./ViewingOffers.module.css";
import { saveLeagueData } from "../utils/leagueStorage.js";

const FREE_AGENCY_LAST_ROUTE_KEY = "bm_free_agency_last_route_v1";

function compactStorySideForStorage(side) {
  if (!side || typeof side !== "object") return null;

  return {
    title: side.title || "",
    voice: side.voice || "",
    summary: side.summary || "",
    bullets: Array.isArray(side.bullets)
      ? side.bullets.filter(Boolean).slice(0, 5)
      : [],
  };
}

function compactStoryContextForStorage(story) {
  if (!story || typeof story !== "object") return null;

  const sections = Array.isArray(story.sections)
    ? story.sections
        .filter((section) => section && (section.label || section.value))
        .slice(0, 7)
        .map((section) => ({
          label: section.label || "",
          value: section.value || "",
        }))
    : [];

  const otherOffers = Array.isArray(story.otherOffers)
    ? story.otherOffers.slice(0, 3).map((offer) => ({
        teamName: offer.teamName || "",
        displayTeamName: offer.displayTeamName || "",
        line: offer.line || "",
        totalValue: offer.totalValue || 0,
        years: offer.years || 0,
        playerViewScore: offer.playerViewScore || 0,
      }))
    : [];

  const rosterContext = story.rosterContext && typeof story.rosterContext === "object"
    ? {
        positionBucket: story.rosterContext.positionBucket || "",
        topPlayerNames: story.rosterContext.topPlayerNames || "",
        starNames: story.rosterContext.starNames || "",
        samePositionNames: story.rosterContext.samePositionNames || "",
        youngCoreNames: story.rosterContext.youngCoreNames || "",
        rotationSamePositionCount: story.rosterContext.rotationSamePositionCount || 0,
        averageCoreAge: story.rosterContext.averageCoreAge ?? null,
        playerOverall: story.rosterContext.playerOverall ?? null,
        playerAge: story.rosterContext.playerAge ?? null,
        playerPotential: story.rosterContext.playerPotential ?? null,
        roleRead: story.rosterContext.roleRead || "",
        betterSamePositionNames: story.rosterContext.betterSamePositionNames || "",
        clearlyBelowSamePositionNames: story.rosterContext.clearlyBelowSamePositionNames || "",
      }
    : null;

  return {
    version: story.version || 1,
    eventType: story.eventType || "",
    headline: story.headline || "",
    subtitle: story.subtitle || story.contractLine || "",
    playerName: story.playerName || "",
    teamName: story.teamName || "",
    teamDisplayName: story.teamDisplayName || "",
    day: story.day ?? null,
    contractLine: story.contractLine || "",
    totalValue: story.totalValue || 0,
    years: story.years || 0,
    aav: story.aav || 0,
    spendingType: story.spendingType || "",
    exceptionType: story.exceptionType || "",
    payrollZone: story.payrollZone || "",
    teamDirection: story.teamDirection || "",
    needScore: story.needScore ?? null,
    positionBucket: story.positionBucket || "",
    recentRecord: story.recentRecord || "",
    recentTeamShort: story.recentTeamShort || "",
    moodAngle: story.moodAngle || "",
    rfaMatched: Boolean(story.rfaMatched),
    originalOfferTeamName: story.originalOfferTeamName || "",
    rightsTeamName: story.rightsTeamName || "",
    teamSide: compactStorySideForStorage(story.teamSide),
    playerSide: compactStorySideForStorage(story.playerSide),
    otherOffers,
    rosterContext,
    sections,
  };
}


function compactOfferForStorage(offer, keepStory = false) {
  if (!offer || typeof offer !== "object") return offer;

  return {
    offerId: offer.offerId || null,
    playerId: offer.playerId ?? null,
    playerName: offer.playerName || "",
    playerKey: offer.playerKey || "",
    teamName: offer.teamName || "",
    source: offer.source || "",
    status: offer.status || "active",
    submittedDay: offer.submittedDay ?? offer.day ?? null,
    day: offer.day ?? offer.submittedDay ?? null,
    contract: offer.contract || null,
    salaryByYear: Array.isArray(offer.salaryByYear) ? offer.salaryByYear : undefined,
    years: offer.years || offer.contract?.salaryByYear?.length || 0,
    totalValue: offer.totalValue || 0,
    aav: offer.aav || 0,
    currentYearSalary:
      offer.currentYearSalary ||
      offer.contract?.salaryByYear?.[0] ||
      offer.salaryByYear?.[0] ||
      0,
    playerViewScore: offer.playerViewScore || 0,
    spendingType: offer.spendingType || "",
    exceptionType: offer.exceptionType || "",
    payrollZone: offer.payrollZone || "",
    teamDirection: offer.teamDirection || "",
    needScore: offer.needScore ?? offer.rosterNeed?.needScore ?? null,
    positionBucket: offer.positionBucket || offer.rosterNeed?.position || "",
    weakestPositions: Array.isArray(offer.weakestPositions) ? offer.weakestPositions.slice(0, 3) : undefined,
    rosterNeed: offer.rosterNeed
      ? {
          position: offer.rosterNeed.position || offer.rosterNeed.positionBucket || "",
          needScore: offer.rosterNeed.needScore ?? null,
          teamDirection: offer.rosterNeed.teamDirection || offer.teamDirection || "",
          weakestPositions: Array.isArray(offer.rosterNeed.weakestPositions)
            ? offer.rosterNeed.weakestPositions.slice(0, 3)
            : undefined,
        }
      : undefined,
    rfaOfferSheet: Boolean(offer.rfaOfferSheet),
    rfaMatched: Boolean(offer.rfaMatched),
    rightsTeamName: offer.rightsTeamName || "",
    originalOfferTeamName: offer.originalOfferTeamName || "",
    matchedOriginalTeamName: offer.matchedOriginalTeamName || "",
    storyContext: keepStory ? compactStoryContextForStorage(offer.storyContext) : undefined,
  };
}

function compactSigningForStorage(row, emergency = false) {
  if (!row || typeof row !== "object") return row;

  return {
    day: row.day ?? null,
    playerId: row.playerId ?? null,
    playerName: row.playerName || "",
    playerKey: row.playerKey || "",
    teamName: row.teamName || row.signedWith || "",
    signedWith: row.signedWith || row.teamName || "",
    contract: row.contract || row.signedContract || null,
    totalValue: row.totalValue || row.signedTotalValue || 0,
    aav: row.aav || 0,
    years: row.years || row.signedYears || row.contract?.salaryByYear?.length || 0,
    spendingType: row.spendingType || "",
    exceptionType: row.exceptionType || "",
    payrollZone: row.payrollZone || "",
    exceptionUsage: row.exceptionUsage
      ? {
          type: row.exceptionUsage.type || "",
          amountUsed: row.exceptionUsage.amountUsed || 0,
        }
      : null,
    rfaMatched: Boolean(row.rfaMatched),
    originalOfferTeamName: row.originalOfferTeamName || "",
    matchedOriginalTeamName: row.matchedOriginalTeamName || "",
    declinedRightsTeamName: row.declinedRightsTeamName || "",
    userOfferOutcomes: Array.isArray(row.userOfferOutcomes)
      ? row.userOfferOutcomes.slice(0, emergency ? 8 : 20).map((outcome) => ({
          id: outcome.id || "",
          day: outcome.day ?? null,
          playerId: outcome.playerId ?? null,
          playerName: outcome.playerName || "",
          playerKey: outcome.playerKey || "",
          userTeamName: outcome.userTeamName || "",
          status: outcome.status || "",
          offerStatus: outcome.offerStatus || "",
          signedWith: outcome.signedWith || "",
          signedContract: outcome.signedContract || null,
          signedTotalValue: outcome.signedTotalValue || 0,
          signedYears: outcome.signedYears || 0,
          userOfferContract: outcome.userOfferContract || null,
          userOfferTotalValue: outcome.userOfferTotalValue || 0,
          userOfferYears: outcome.userOfferYears || 0,
          rfaMatched: Boolean(outcome.rfaMatched),
          originalOfferTeamName: outcome.originalOfferTeamName || "",
          storyContext: compactStoryContextForStorage(outcome.storyContext),
        }))
      : [],
    allOffers: Array.isArray(row.allOffers)
      ? row.allOffers.slice(0, emergency ? 6 : 12).map((offer) => compactOfferForStorage(offer, false))
      : [],
    storyContext: compactStoryContextForStorage(row.storyContext),
  };
}

function compactFreeAgencyStateForStorage(state, emergency = false) {
  if (!state || typeof state !== "object") return state;

  const offersByPlayer = {};
  for (const [playerKey, offers] of Object.entries(state.offersByPlayer || {})) {
    offersByPlayer[playerKey] = Array.isArray(offers)
      ? offers.slice(0, emergency ? 8 : 20).map((offer) => compactOfferForStorage(offer, false))
      : offers;
  }

  const latestResults = state.latestResults
    ? {
        dayResolved: state.latestResults.dayResolved ?? null,
        stateSummary: state.latestResults.stateSummary || null,
        signings: Array.isArray(state.latestResults.signings)
          ? state.latestResults.signings
              .slice(0, emergency ? 40 : 120)
              .map((row) => compactSigningForStorage(row, emergency))
          : [],
        generatedOffers: Array.isArray(state.latestResults.generatedOffers)
          ? state.latestResults.generatedOffers
              .slice(0, emergency ? 120 : 420)
              .map((offer) => compactOfferForStorage(offer, true))
          : [],
      }
    : null;

  return {
    ...state,
    offersByPlayer,
    latestResults,
    signedPlayersLog: Array.isArray(state.signedPlayersLog)
      ? state.signedPlayersLog.map((row) => compactSigningForStorage(row, emergency))
      : [],
    offerHistory: Array.isArray(state.offerHistory)
      ? state.offerHistory.slice(-1 * (emergency ? 40 : 120)).map((offer) => compactOfferForStorage(offer, false))
      : [],
    dailyLog: Array.isArray(state.dailyLog)
      ? state.dailyLog.slice(-1 * (emergency ? 5 : 12))
      : [],
    userOfferOutcomeLog: Array.isArray(state.userOfferOutcomeLog)
      ? state.userOfferOutcomeLog.slice(-1 * (emergency ? 60 : 160)).map((row) => ({
          ...row,
          storyContext: compactStoryContextForStorage(row.storyContext),
        }))
      : [],
  };
}

function compactLeagueDataForStorage(leagueData, emergency = false) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  return {
    ...leagueData,
    freeAgencyState: compactFreeAgencyStateForStorage(leagueData.freeAgencyState, emergency),
  };
}

function persistLeagueData(updated) {
  if (!updated) return;

  saveLeagueData(updated).catch((err) => {
    console.error("[FreeAgencyStorage] IndexedDB leagueData save failed. Retrying emergency compact save.", err);

    const emergency = compactLeagueDataForStorage(updated, true);
    saveLeagueData(emergency).catch((finalErr) => {
      console.error("[FreeAgencyStorage] Emergency IndexedDB leagueData save failed.", finalErr);
    });
  });
}


// Surgical timeout guard for Pyodide free-agency actions.
// The backend does not need the large story objects from the results screen,
// and sending those through the worker can make process-pending calls time out.
function stripFreeAgencyStoryPayload(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripFreeAgencyStoryPayload(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const heavyStoryKeys = new Set([
    "storyContext",
    "teamSide",
    "playerSide",
    "otherOffers",
    "rosterContext",
    "sections",
    "voice",
    "summary",
    "bullets",
  ]);

  const out = {};

  for (const [key, item] of Object.entries(value)) {
    if (heavyStoryKeys.has(key)) continue;
    out[key] = stripFreeAgencyStoryPayload(item);
  }

  return out;
}

function buildLeagueDataForFreeAgencyBackendAction(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  const state = leagueData.freeAgencyState && typeof leagueData.freeAgencyState === "object"
    ? leagueData.freeAgencyState
    : {};

  const safeState = stripFreeAgencyStoryPayload(state);

  // latestResults is only for this UI page. Keeping it in the worker payload is
  // the biggest timeout risk on later offseasons because it can contain hundreds
  // of generated offers and signing story objects.
  safeState.latestResults = null;

  return {
    ...leagueData,
    freeAgencyState: safeState,
  };
}


function formatDollars(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));
}

function withTeamArticle(teamName) {
  const name = String(teamName || "Unknown Team").trim();
  if (!name) return "the Unknown Team";
  if (name.toLowerCase().startsWith("the ")) return name;
  return `the ${name}`;
}

function getContractSummary(contract, fallbackTotal = 0, fallbackYears = 0) {
  const salaryByYear = Array.isArray(contract?.salaryByYear)
    ? contract.salaryByYear
    : [];

  const years = salaryByYear.length || Number(fallbackYears || 0);
  const totalValue = salaryByYear.length
    ? salaryByYear.reduce((sum, value) => sum + Number(value || 0), 0)
    : Number(fallbackTotal || 0);

  const currentYearSalary = salaryByYear.length
    ? Number(salaryByYear[0] || 0)
    : 0;

  return {
    years,
    totalValue,
    currentYearSalary,
  };
}



function getContractOptionInfo(source = {}) {
  const contract =
    source?.contract ||
    source?.signedContract ||
    source?.userOfferContract ||
    source?.offerSheet?.contract ||
    source?.chosenOffer?.contract ||
    {};

  const option =
    contract?.option ||
    source?.option ||
    source?.offerSheet?.option ||
    source?.chosenOffer?.option ||
    null;

  const salaryByYear = Array.isArray(contract?.salaryByYear)
    ? contract.salaryByYear
    : [];

  const years = salaryByYear.length || Number(
    source?.years ||
      source?.signedYears ||
      source?.userOfferYears ||
      source?.offerSheet?.years ||
      0
  );

  const optionType = String(option?.type || "").toLowerCase();
  const validOption = option && ["player", "team"].includes(optionType) && years > 1;

  if (!validOption) {
    return {
      label: "No Option",
      tone: "neutral",
      title: "This offer does not include a player option or team option.",
    };
  }

  const rawYearIndices = Array.isArray(option?.yearIndices)
    ? option.yearIndices
    : option?.yearIndex !== undefined && option?.yearIndex !== null
    ? [option.yearIndex]
    : [];

  const optionYear = rawYearIndices.length
    ? Math.max(...rawYearIndices.map((value) => Number(value || 0))) + 1
    : years;

  if (optionType === "player") {
    return {
      label: "Player Option",
      tone: "green",
      title: `Player option attached${optionYear ? ` in year ${optionYear}` : ""}.`,
    };
  }

  return {
    label: "Team Option",
    tone: "orange",
    title: `Team option attached${optionYear ? ` in year ${optionYear}` : ""}.`,
  };
}

function getPendingSigningCurrentYearSalary(row = {}) {
  const summary = getContractSummary(
    row?.contract,
    row?.totalValue,
    row?.years
  );

  return Number(summary.currentYearSalary || row?.currentYearSalary || 0);
}

function getPendingSigningCapRoomImpact(row = {}) {
  const currentYearSalary = getPendingSigningCurrentYearSalary(row);
  const spendingType = String(row?.spendingType || row?.chosenOffer?.spendingType || "").toLowerCase();
  const exceptionType = String(row?.exceptionType || row?.chosenOffer?.exceptionType || "").toLowerCase();
  const payrollZone = String(row?.payrollZone || row?.chosenOffer?.payrollZone || "").toLowerCase();
  const raw = `${spendingType} ${exceptionType} ${payrollZone}`;

  // Surgical FA preview fix:
  // Minimum / exception / Bird pending signings still add to payroll and hard-cap math,
  // but they should not consume normal cap room on this confirmation screen.
  if (raw.includes("bird") || raw.includes("rfa_match") || raw.includes("minimum")) return 0;
  if (raw.includes("mle") || raw.includes("mid_level") || raw.includes("taxpayer")) return 0;
  if (raw.includes("exception") && !raw.includes("cap_space")) return 0;

  // Some old saved pending rows did not preserve spendingType = "minimum".
  // Treat near-minimum one-year depth deals as minimum-exception previews so a
  // cap-space signing does not incorrectly block a follow-up minimum signing.
  if (currentYearSalary > 0 && currentYearSalary <= 1_500_000) return 0;

  if (spendingType === "cap_space" || spendingType === "below_cap" || raw.includes("cap space")) {
    return currentYearSalary;
  }

  return currentYearSalary;
}

function formatContractLine(contract, fallbackTotal = 0, fallbackYears = 0) {
  const summary = getContractSummary(contract, fallbackTotal, fallbackYears);

  if (!summary.years || !summary.totalValue) {
    return "-";
  }

  return `${formatDollars(summary.totalValue)} - ${summary.years} years`;
}
function getOvrRingMetrics(overall) {
  const fillPercent = Math.min(Math.max(Number(overall || 0) / 99, 0), 1);
  const radius = 22;
  const circumference = 2 * Math.PI * radius;

  return {
    radius,
    circumference,
    strokeOffset: circumference * (1 - fillPercent),
  };
}
function InfoChip({ children, tone = "neutral", onClick, title = "" }) {
  const cls =
    tone === "orange"
      ? "border-orange-500/30 bg-orange-500/10 text-orange-200"
      : tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : tone === "red"
      ? "border-red-500/30 bg-red-500/10 text-red-200"
      : "border-neutral-600 bg-neutral-800 text-neutral-200";

  const commonClass = `inline-flex px-2.5 py-1 rounded-full border text-xs font-bold uppercase tracking-wide ${cls}`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title || "View details"}
        className={`${commonClass} cursor-pointer transition hover:scale-[1.03] hover:border-orange-300/70 hover:bg-orange-500/20`}
      >
        {children}
      </button>
    );
  }

  return <span title={title || ""} className={commonClass}>{children}</span>;
}

function ContractOptionChip({ source }) {
  const optionInfo = getContractOptionInfo(source);

  return (
    <InfoChip tone={optionInfo.tone} title={optionInfo.title}>
      {optionInfo.label}
    </InfoChip>
  );
}

function PlayerNameButton({ children, onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left font-semibold underline-offset-4 transition hover:text-orange-200 hover:underline ${className}`}
      title="Open player card"
    >
      {children}
    </button>
  );
}

function formatToolLabel(value) {
  if (!value) return "";
  return String(value).replaceAll("_", " ");
}

function formatNeedScore(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${Math.round(n * 100)}%`;
}

function getOfferPlayerKeyFromParts(playerId, playerName) {
  if (playerId !== undefined && playerId !== null && playerId !== "") {
    return `id:${playerId}`;
  }
  return `name:${playerName || ""}`;
}

function getOfferStatusTone(status) {
  if (["won", "pending_user_decision", "active"].includes(status)) return "green";
  if (["lost", "matched_by_original_team"].includes(status)) return "red";
  return "neutral";
}

function getOfferStatusLabel(status, signedWith = "", userTeamName = "") {
  if (status === "won") return "Won - Signed With You";
  if (status === "pending_user_decision") return "Ready to Sign";
  if (status === "active") return "Still Active";
  if (status === "matched_by_original_team") {
    return signedWith ? `Matched by ${signedWith}` : "Matched by Rights Team";
  }
  if (status === "lost") {
    return signedWith ? `Lost to ${signedWith}` : "Lost";
  }
  return "Tracking";
}

function getSignedWithDisplay(signedWith, userTeamName) {
  if (!signedWith) return "-";
  if (userTeamName && signedWith === userTeamName) return `${signedWith} (You)`;
  return signedWith;
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function getTeamByName(leagueData, teamName) {
  if (!teamName) return null;
  return getAllTeamsFromLeague(leagueData).find((team) => team?.name === teamName) || null;
}

function getPlayerKeyFromAny(row = {}) {
  return getOfferPlayerKeyFromParts(row.playerId || row.id || row?.player?.id, row.playerName || row.name || row?.player?.name);
}

function findPlayerInLeague(leagueData, row = {}) {
  const playerId = row.playerId || row.id || row?.player?.id;
  const playerName = row.playerName || row.name || row?.player?.name;

  if (row?.player && typeof row.player === "object") {
    return row.player;
  }

  const freeAgents = Array.isArray(leagueData?.freeAgents) ? leagueData.freeAgents : [];
  const teams = getAllTeamsFromLeague(leagueData);
  const pools = [freeAgents, ...teams.map((team) => team?.players || [])];

  for (const pool of pools) {
    for (const player of pool || []) {
      if (playerId !== undefined && playerId !== null && playerId !== "" && player?.id === playerId) {
        return player;
      }
      if (playerName && player?.name === playerName) {
        return player;
      }
    }
  }

  if (playerName) {
    return {
      id: playerId || null,
      name: playerName,
      pos: row.position || row.pos || row?.player?.position || row?.player?.pos || "-",
      age: row.age || row?.player?.age || null,
      overall: row.overall || row?.player?.overall || null,
      potential: row.potential || row?.player?.potential || null,
      headshot: row.headshot || row?.player?.headshot || "",
    };
  }

  return null;
}

function getLatestTeamHistoryRow(leagueData, teamName) {
  const seasons = Array.isArray(leagueData?.seasonHistory) ? leagueData.seasonHistory : [];

  for (const season of [...seasons].reverse()) {
    const teamRow = (season?.teams || []).find((team) => team?.teamName === teamName || team?.name === teamName);
    if (teamRow) {
      return {
        ...teamRow,
        seasonYear: season?.seasonYear || teamRow?.seasonYear,
        championTeam: season?.champion,
      };
    }
  }

  return null;
}

function formatTeamContext(leagueData, teamName) {
  const row = getLatestTeamHistoryRow(leagueData, teamName);
  if (!row) {
    return {
      label: "No recent standings context found",
      short: "their current roster situation",
      mood: "The player mood read will lean more on role, contract, and roster fit because recent standings are not available yet.",
    };
  }

  const wins = Number(row?.wins || 0);
  const losses = Number(row?.losses || 0);
  const seed = row?.conferenceSeed || row?.seed;
  const result = String(row?.playoffResult || "missed_playoffs").replaceAll("_", " ");
  const record = wins || losses ? `${wins}-${losses}` : "record unavailable";

  let label = `${record}`;
  if (seed) label += `, ${seed} seed`;
  if (result && result !== "missed playoffs") label += `, ${result}`;

  let short = "a team trying to define its next step";
  let mood = "The player mood should be fairly neutral unless role or money becomes a major factor.";

  if (row?.champion) {
    short = "a defending champion environment";
    mood = "This should give the player a strong mood bump because the new team is coming off a title.";
  } else if (row?.finals) {
    short = "a Finals-level situation";
    mood = "This should help the player mood because the team already looks like a real title threat.";
  } else if (row?.conferenceFinals) {
    short = "a deep playoff team";
    mood = "This should usually improve mood because the player is joining a serious playoff group.";
  } else if (wins >= 50) {
    short = "a 50-win team";
    mood = "This should be a positive mood environment because the team is already winning.";
  } else if (wins >= 42 || row?.madePlayoffs) {
    short = "a playoff-caliber team";
    mood = "This should be a stable mood landing spot because the team is competitive.";
  } else if (wins <= 25 && wins > 0) {
    short = "a rebuilding team with a bigger role available";
    mood = "The standings may lower short-term mood, but a bigger role or stronger contract can balance that out.";
  }

  return { label, short, mood, row };
}

function stableTextNumber(text) {
  let out = 0;
  for (let i = 0; i < String(text || "").length; i++) {
    out += String(text || "").charCodeAt(i) * (i + 7);
  }
  return out;
}

function pickVariant(seedText, options) {
  if (!options.length) return "";
  return options[stableTextNumber(seedText) % options.length];
}

function buildPlayerTraitLine(player) {
  if (!player) return "Player profile details were limited for this event.";

  const age = Number(player?.age || 0);
  const overall = Number(player?.overall || 0);
  const potential = Number(player?.potential || overall || 0);
  const pos = player?.pos || player?.position || "player";

  if (overall >= 88) return `${player.name} is being treated like a true star-level ${pos}.`;
  if (overall >= 82 && age <= 26) return `${player.name} gives the team a young high-end ${pos} who can still grow.`;
  if (overall >= 80) return `${player.name} profiles as a strong rotation/starter-level ${pos}.`;
  if (age <= 24 && potential >= overall + 3) return `${player.name} is more of an upside bet than a finished product right now.`;
  if (age >= 32) return `${player.name} looks like a veteran stability move more than a long-term upside swing.`;
  return `${player.name} gives the team another playable ${pos} option.`;
}

function buildToolExplanation(label, row = {}) {
  const raw = String(label || row?.spendingType || row?.exceptionType || row?.payrollZone || "").toLowerCase();

  if (raw.includes("bird")) {
    return "Bird rights let the signing team keep its own free agent without needing normal cap room, which is why this move can happen even if the team is operating above the cap.";
  }
  if (raw.includes("taxpayer")) {
    return "The taxpayer mid-level exception is a smaller spending tool for teams already operating around the tax/apron range. This usually points to a win-now team adding a role player without real cap room.";
  }
  if (raw.includes("mid") || raw.includes("mle")) {
    return "The mid-level exception is the team's main over-the-cap tool. It is usually used when the player is too expensive for a minimum deal but the team does not have true cap space.";
  }
  if (raw.includes("minimum")) {
    return "A minimum contract usually means the player accepted a smaller role, the team needed cheap depth, or the market did not produce a stronger offer.";
  }
  if (raw.includes("cap") || raw.includes("room")) {
    return "This points to cap-space or room-exception spending. The team had enough flexibility to chase the player without relying only on minimum deals.";
  }
  if (raw.includes("rfa")) {
    return "Restricted free agency lets the rights team match an outside offer sheet. The player can negotiate elsewhere, but the original team gets the final call.";
  }
  if (raw.includes("contending") || raw.includes("win now")) {
    return "The team profile suggests they are prioritizing immediate wins, so the offer is more about filling a playoff rotation need than long-term upside.";
  }
  if (raw.includes("rebuilding") || raw.includes("retooling")) {
    return "The team profile suggests a longer-term move, so age, upside, and role opportunity matter more than one-season impact.";
  }

  return "This tag is a quick label from the free agency engine. The full context depends on team need, available spending tools, player market value, and the player's role fit.";
}


function normalizeStorySections(story) {
  if (!story || typeof story !== "object") return [];

  if (Array.isArray(story.sections) && story.sections.length) {
    return story.sections.filter((section) => section && (section.label || section.value));
  }

  return [
    story.whatHappened ? { label: "What happened", value: story.whatHappened } : null,
    story.playerFit ? { label: "Player fit", value: story.playerFit } : null,
    story.teamContext ? { label: "Team context", value: story.teamContext } : null,
    story.moodAngle ? { label: "Mood angle", value: story.moodAngle } : null,
    story.tagMeaning ? { label: "Tag meaning", value: story.tagMeaning } : null,
  ].filter(Boolean);
}

function buildPopupFromStoryContext(row, chipLabel = "Transaction Detail") {
  const story = row?.storyContext || row?.chosenOffer?.storyContext || row?.offerSheet?.storyContext;
  if (!story) return null;

  return {
    title: story.headline || `${row?.playerName || story.playerName || "Player"} - ${chipLabel}`,
    subtitle: story.subtitle || story.contractLine || "Free agency context",
    playerSource: {
      ...row,
      playerName: row?.playerName || story.playerName,
      teamName: row?.teamName || row?.signedWith || story.teamName,
    },
    teamSide: story.teamSide || null,
    playerSide: story.playerSide || null,
    otherOffers: Array.isArray(story.otherOffers) ? story.otherOffers : [],
    rosterContext: story.rosterContext || null,
    sections: normalizeStorySections(story),
  };
}


function includesAnyText(text, needles = []) {
  const haystack = String(text || "").toLowerCase();
  return needles.some((needle) => haystack.includes(String(needle || "").toLowerCase()));
}

function formatPositionContextLabel(pos) {
  const raw = String(pos || "").trim().toUpperCase();

  const labels = {
    PG: "point guard",
    SG: "shooting guard",
    SF: "small forward / wing",
    PF: "power forward / frontcourt",
    C: "center",
  };

  return labels[raw] || String(pos || "position").replaceAll("_", " ");
}

function formatPositionChipLabel(pos) {
  const raw = String(pos || "").trim().toUpperCase();

  const labels = {
    PG: "Point Guard",
    SG: "Shooting Guard",
    SF: "Wing",
    PF: "Frontcourt",
    C: "Center",
  };

  return labels[raw] || String(pos || "Position").replaceAll("_", " ");
}

function getFocusedTitleLabel(focusType) {
  if (focusType === "cba") return "Contract / CBA Path";
  if (focusType === "need") return "Position Need";
  if (focusType === "direction") return "Team Direction";
  return "Transaction Context";
}

function getFocusedSubtitle(focusType) {
  if (focusType === "cba") return "Only showing how this signing or offer was financially possible.";
  if (focusType === "need") return "Only showing the roster and position-need logic behind this tag.";
  if (focusType === "direction") return "Only showing the team's competitive situation and direction.";
  return "Full transaction context.";
}

function buildFocusFallbackSections({ row = {}, fullPopup = {}, chipLabel = "Context", focusType = "full", leagueData = null }) {
  const storySections = Array.isArray(fullPopup?.sections) ? fullPopup.sections : [];
  const rosterContext = fullPopup?.rosterContext || row?.storyContext?.rosterContext || row?.rosterContext || null;
  const teamName = row?.teamName || row?.signedWith || fullPopup?.playerSource?.teamName || fullPopup?.teamName || "Unknown Team";
  const playerName = row?.playerName || fullPopup?.playerSource?.playerName || fullPopup?.playerName || "the player";

  if (focusType === "cba") {
    const pathPieces = [
      row?.spendingType ? formatToolLabel(row.spendingType) : "",
      row?.exceptionType ? formatToolLabel(row.exceptionType) : "",
      row?.payrollZone ? formatToolLabel(row.payrollZone) : "",
    ].filter(Boolean);

    const sections = [
      {
        label: "How the signing path worked",
        value: buildToolExplanation(chipLabel || pathPieces[0] || "contract path", row),
      },
    ];

    if (pathPieces.length) {
      sections.push({
        label: "Recorded path",
        value: `The engine tagged this as ${pathPieces.join(" / ")}. That is the financial lane being shown here.`,
      });
    }

    if (row?.exceptionUsage?.amountUsed > 0) {
      sections.push({
        label: "Amount used",
        value: `${teamName} used ${formatDollars(row.exceptionUsage.amountUsed)} of this spending path.`,
      });
    }

    if (row?.rfaMatched || row?.chosenOffer?.rfaMatched || row?.rfaOfferSheet) {
      sections.push({
        label: "Restricted free agency note",
        value: "This tag is tied to restricted free agency. The player could sign an outside offer sheet, but the rights team could still match depending on the decision state.",
      });
    }

    return sections;
  }

  if (focusType === "need") {
    const needPos = row?.rosterNeed?.position || row?.positionBucket || rosterContext?.positionBucket || "";
    const needScore = row?.rosterNeed?.needScore ?? row?.needScore ?? null;
    const positionText = formatPositionContextLabel(needPos);

    const sections = [
      {
        label: "Position need",
        value: needPos
          ? `${teamName} had this tagged as a ${positionText} need${formatNeedScore(needScore) ? ` at ${formatNeedScore(needScore)}` : ""}. This view is only about the roster-fit reason for the tag, not the full signing story.`
          : `${teamName} had a roster-need tag attached to this move, but the exact position was not stored on this row.`,
      },
    ];

    if (rosterContext?.samePositionNames) {
      sections.push({
        label: "Players already in that area",
        value: `${teamName} already had ${rosterContext.samePositionNames} in the same general position group, so this tag is about depth, role balance, or upgrading the rotation around that spot.`,
      });
    }

    if (rosterContext?.topPlayerNames || rosterContext?.starNames) {
      sections.push({
        label: "Roster around the need",
        value: `The broader roster context included ${rosterContext.starNames || rosterContext.topPlayerNames}. The need tag should be read around those players, not as a full-team reset by itself.`,
      });
    }

    if (rosterContext?.roleRead) {
      sections.push({
        label: "Role read",
        value: rosterContext.roleRead,
      });
    }

    return sections;
  }

  if (focusType === "direction") {
    const teamContext = formatTeamContext(leagueData, teamName);
    const direction = formatToolLabel(row?.teamDirection || row?.rosterNeed?.teamDirection || fullPopup?.teamDirection || "");
    const sections = [
      {
        label: "Team direction",
        value: direction
          ? `${teamName} was tagged as ${direction}. This view is only about where the team is competitively, not the whole contract or player-side decision.`
          : `${teamName}'s exact direction tag was not stored on this row, so the read comes from recent team context and the offer type.`,
      },
      {
        label: "Recent team context",
        value: `${teamName} is coming off ${teamContext.label}. This reads like ${teamContext.short}.`,
      },
      {
        label: "What that usually means",
        value: buildToolExplanation(direction || chipLabel || "team direction", row),
      },
    ];

    return sections;
  }

  return storySections;
}

function buildFocusedPopup({ fullPopup, row = {}, chipLabel = "Context", focusType = "full", leagueData = null }) {
  if (!fullPopup) return null;
  if (!focusType || focusType === "full") return fullPopup;

  const labelKeywords = {
    cba: ["tag", "contract", "cba", "money", "cap", "rights", "rfa", "exception", "minimum", "bird", "payroll", "apron", "spending"],
    need: ["need", "position", "roster", "fit", "rotation", "depth", "role"],
    direction: ["team context", "direction", "recent", "standings", "record", "playoff", "contending", "rebuilding", "retooling", "win now", "mood"],
  };

  const keywords = labelKeywords[focusType] || [];
  const filteredSections = (fullPopup.sections || []).filter((section) => {
    const label = section?.label || "";
    const value = section?.value || "";
    return includesAnyText(label, keywords) || includesAnyText(value, keywords);
  });

  const fallbackSections = buildFocusFallbackSections({
    row,
    fullPopup,
    chipLabel,
    focusType,
    leagueData,
  });

  const seen = new Set();
  const mergedSections = [...filteredSections, ...fallbackSections]
    .filter((section) => section && (section.label || section.value))
    .filter((section) => {
      const key = `${section.label || ""}|${section.value || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);

  return {
    ...fullPopup,
    title: `${fullPopup?.playerSource?.playerName || row?.playerName || "Player"} - ${getFocusedTitleLabel(focusType)}`,
    subtitle: getFocusedSubtitle(focusType),
    teamSide: null,
    playerSide: null,
    otherOffers: [],
    sections: mergedSections.length ? mergedSections : fallbackSections,
  };
}



function formatListText(values, formatter = (value) => value) {
  const items = Array.isArray(values)
    ? values.filter(Boolean).map(formatter).filter(Boolean)
    : [];

  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatPlayoffResultLabel(value) {
  const raw = String(value || "").replaceAll("_", " ").trim();
  if (!raw) return "";
  return raw;
}

function buildRightsRenouncedPopup({ row, leagueData }) {
  const teamName = row?.teamName || "Unknown Team";
  const playerName = row?.playerName || "Unknown Player";
  const teamContext = formatTeamContext(leagueData, teamName);
  const direction = formatToolLabel(row?.teamDirection) || "not clearly tagged";
  const recentRecord = row?.recentRecord || teamContext.label || "record unavailable";
  const playoffResult = formatPlayoffResultLabel(row?.lastSeasonPlayoffResult);
  const needText = formatListText(row?.teamNeedPositions || row?.weakestPositions, formatPositionChipLabel);
  const triggerPlayerName = row?.targetPlayerName || row?.triggerPlayerName || "";
  const triggerPlayerPosition = row?.targetPlayerPosition ? formatPositionChipLabel(row.targetPlayerPosition) : "";
  const renouncedPosition = row?.renouncedPlayerPosition ? formatPositionChipLabel(row.renouncedPlayerPosition) : "";
  const capHoldText = formatDollars(row?.capHoldCleared || 0);

  const replacementLine = triggerPlayerName
    ? `${teamName} cleared this hold while trying to create room for ${triggerPlayerName}${triggerPlayerPosition ? ` at ${triggerPlayerPosition}` : ""}.`
    : `${teamName} cleared this hold to open cap flexibility for the rest of the market.`;

  const directionLine = direction !== "not clearly tagged"
    ? `${teamName} is being read as ${direction}. That changes the logic: contenders usually clear holds for immediate rotation help, while rebuilding teams usually clear holds to protect flexibility and chase better timeline fits.`
    : `${teamName}'s exact direction tag was not saved on this row, so this read leans on roster fit, cap flexibility, and recent team context.`;

  const targetLine = needText
    ? `${teamName}'s weakest roster areas were tagged around ${needText}. The renounce decision is probably connected to those needs or to making room for a stronger target.`
    : `No specific weak-position list was saved, so the safest read is cap flexibility rather than a single position replacement.`;

  const playerAffectedLine = `${playerName}${renouncedPosition ? ` (${renouncedPosition})` : ""} was still counting as a cap hold because ${teamName} held his free-agent rights. Renouncing him removes that hold, but the team loses Bird/RFA control over him.`;

  return {
    title: `${teamName} - Rights Renounced`,
    subtitle: `${playerName} • ${capHoldText} cleared`,
    playerSource: {
      ...row,
      playerName,
      teamName,
    },
    sections: [
      { label: "What happened", value: `${teamName} renounced rights on ${playerName}, clearing ${capHoldText} from its cap-hold sheet.` },
      { label: "Why the team did it", value: replacementLine },
      { label: "Team direction", value: directionLine },
      { label: "Last season context", value: `${teamName} is coming off ${recentRecord}${playoffResult ? ` with a ${playoffResult} playoff result` : ""}. ${teamContext.short ? `This reads like ${teamContext.short}.` : ""}` },
      { label: "Roster target", value: targetLine },
      { label: "Who got replaced", value: playerAffectedLine },
    ],
  };
}

function buildSigningPopup({ row, chipLabel, leagueData, selectedTeamName }) {
  const backendPopup = buildPopupFromStoryContext(row, chipLabel);
  if (backendPopup) return backendPopup;

  const player = findPlayerInLeague(leagueData, row);
  const signedWith = row?.signedWith || row?.teamName || row?.rightsTeamName || selectedTeamName || "Unknown Team";
  const teamContext = formatTeamContext(leagueData, signedWith);
  const contractLine = formatContractLine(row?.contract || row?.signedContract || row?.offerSheet?.contract, row?.totalValue || row?.signedTotalValue, row?.years || row?.signedYears);
  const seed = `${row?.playerName || player?.name}-${signedWith}-${contractLine}-${chipLabel}-${row?.day || ""}`;
  const opener = pickVariant(seed, [
    `${signedWith} did not make this move randomly - this was a fit, money, and timing decision.`,
    `This signing has a pretty clear team-building logic behind it once you look past the headline.`,
    `${signedWith} saw a path to add value here without changing the whole roster direction.`,
    `The move makes more sense when you connect the contract, the player profile, and where ${signedWith} sits as a team.`,
    `This is the kind of signing that tells you what ${signedWith} thinks it needs right now.`,
  ]);

  const playerName = row?.playerName || player?.name || "This player";
  const rfaLine = row?.rfaMatched
    ? `${signedWith} matched the offer sheet instead of letting ${playerName} leave. ${row?.originalOfferTeamName ? `${row.originalOfferTeamName} appears to have created the outside offer pressure.` : "The outside offer created the pressure point."}`
    : null;

  return {
    title: `${playerName} - ${chipLabel}`,
    subtitle: contractLine !== "-" ? contractLine : "Free agency detail",
    playerSource: { ...row, playerName, teamName: signedWith },
    sections: [
      { label: "What happened", value: opener },
      { label: "Player fit", value: buildPlayerTraitLine(player) },
      { label: "Team context", value: `${signedWith} is coming off ${teamContext.label}. This reads like ${teamContext.short}.` },
      { label: "Mood angle", value: teamContext.mood },
      ...(rfaLine ? [{ label: "RFA detail", value: rfaLine }] : []),
      { label: "Tag meaning", value: buildToolExplanation(chipLabel, row) },
    ],
  };
}

function buildOfferPopup({ row, chipLabel, leagueData }) {
  const backendPopup = buildPopupFromStoryContext(row, chipLabel);
  if (backendPopup) return backendPopup;

  const player = findPlayerInLeague(leagueData, row);
  const teamName = row?.teamName || "Unknown Team";
  const teamContext = formatTeamContext(leagueData, teamName);
  const contractLine = formatContractLine(row?.contract, row?.totalValue, row?.years);
  const needText = row?.rosterNeed?.position
    ? `The engine marked ${row.rosterNeed.position} as a need${formatNeedScore(row?.rosterNeed?.needScore) ? ` at ${formatNeedScore(row.rosterNeed.needScore)}` : ""}.`
    : "No specific position-need score was attached to this offer.";
  const seed = `${row?.playerName}-${teamName}-${contractLine}-${chipLabel}`;
  const opener = pickVariant(seed, [
    `${teamName} is testing the market here rather than waiting for leftovers.`,
    `This offer looks like a targeted roster-building swing from ${teamName}.`,
    `${teamName} seems to be using free agency to solve a specific roster problem.`,
    `This is a live-market offer, so the player can still compare it against other teams.`,
  ]);

  return {
    title: `${row?.playerName || player?.name || "Player"} - ${chipLabel}`,
    subtitle: `${teamName} offer${contractLine !== "-" ? ` - ${contractLine}` : ""}`,
    playerSource: { ...row, playerName: row?.playerName || player?.name, teamName },
    sections: [
      { label: "Why the team offered", value: opener },
      { label: "Need / direction", value: `${needText} Team direction tag: ${formatToolLabel(row?.teamDirection) || "not listed"}.` },
      { label: "Team context", value: `${teamName} is coming off ${teamContext.label}. This reads like ${teamContext.short}.` },
      { label: "Player angle", value: buildPlayerTraitLine(player) },
      { label: "Tag meaning", value: buildToolExplanation(chipLabel, row) },
    ],
  };
}

function buildUserOfferPopup({ row, chipLabel, leagueData, selectedTeamName }) {
  const backendPopup = buildPopupFromStoryContext(row, chipLabel);
  if (backendPopup) return backendPopup;

  const player = findPlayerInLeague(leagueData, row);
  const signedWith = row?.signedWith || selectedTeamName || "your team";
  const contractLine = formatContractLine(row?.contract || row?.userOfferContract || row?.signedContract, row?.totalValue || row?.userOfferTotalValue || row?.signedTotalValue, row?.years || row?.userOfferYears || row?.signedYears);
  const teamContext = formatTeamContext(leagueData, signedWith);

  return {
    title: `${row?.playerName || player?.name || "Player"} - ${chipLabel}`,
    subtitle: contractLine !== "-" ? contractLine : "Offer tracker detail",
    playerSource: { ...row, playerName: row?.playerName || player?.name, teamName: signedWith },
    sections: [
      { label: "Offer status", value: row?.detail || "This row tracks what happened to your live offer." },
      { label: "Player angle", value: buildPlayerTraitLine(player) },
      { label: "Team context", value: `${signedWith} is tied to ${teamContext.label}. ${teamContext.mood}` },
      { label: "Tag meaning", value: buildToolExplanation(chipLabel, row) },
    ],
  };
}

function getFirstFiniteNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }

  return null;
}

function getPreviewSalaryCap(leagueData, snapshot) {
  const direct = getFirstFiniteNumber(
    snapshot?.salaryCap,
    snapshot?.cap,
    snapshot?.softCap,
    snapshot?.capRules?.salaryCap,
    snapshot?.settings?.salaryCap,
    leagueData?.salaryCap,
    leagueData?.cap,
    leagueData?.softCap,
    leagueData?.capRules?.salaryCap,
    leagueData?.settings?.salaryCap,
    leagueData?.financialSettings?.salaryCap,
    leagueData?.freeAgencyState?.salaryCap,
    leagueData?.freeAgencyState?.cap,
    leagueData?.freeAgencyState?.capRules?.salaryCap,
    leagueData?.freeAgencyState?.settings?.salaryCap
  );

  if (direct && direct > 0) return direct;

  // Current cap fallback used by the FA screens.
  return 154_647_000;
}

function getPreviewCurrentSeasonYear(leagueData) {
  return Number(
    leagueData?.seasonYear ||
    leagueData?.currentSeasonYear ||
    2026
  );
}

function getPreviewOperatingSeasonYear(leagueData) {
  const state = leagueData?.freeAgencyState || {};
  const freeAgencyWindowActive = Boolean(
    state?.isActive ||
    Number(state?.currentDay || 0) > 0 ||
    Number(state?.maxDays || 0) > 0 ||
    state?.latestResults
  );

  return getPreviewCurrentSeasonYear(leagueData) + (freeAgencyWindowActive ? 1 : 0);
}

function getPreviewContractSalaryForYear(contract = {}, seasonYear = 0) {
  const salaryByYear = Array.isArray(contract?.salaryByYear)
    ? contract.salaryByYear
    : [];

  const startYear = Number(contract?.startYear || 0);
  const idx = Number(seasonYear || 0) - startYear;

  if (startYear > 0 && idx >= 0 && idx < salaryByYear.length) {
    return Math.max(0, Number(salaryByYear[idx] || 0));
  }

  return 0;
}

function getPlayerCurrentYearSalaryForPreview(player = {}, seasonYear = 0) {
  const contract = player?.contract || player?.currentContract || {};
  const salaryByYear = Array.isArray(contract?.salaryByYear)
    ? contract.salaryByYear
    : Array.isArray(player?.salaryByYear)
    ? player.salaryByYear
    : [];

  const yearSalary = getPreviewContractSalaryForYear(contract, seasonYear);
  if (yearSalary > 0) return yearSalary;

  // If the contract has a real startYear but no salary in the operating year,
  // it should not count toward this offseason payroll.
  if (Number(contract?.startYear || 0) > 0) return 0;

  const salary = getFirstFiniteNumber(
    contract?.currentYearSalary,
    player?.currentYearSalary,
    player?.capHit,
    contract?.salary,
    contract?.amount,
    player?.salary,
    salaryByYear[0]
  );

  return Math.max(0, Number(salary || 0));
}

function getPreviewTeamDeadCapForYear(leagueData, teamName = "", seasonYear = 0) {
  const deadCapMap = leagueData?.deadCapByTeam || {};
  const rows = Array.isArray(deadCapMap?.[teamName]) ? deadCapMap[teamName] : [];

  return rows.reduce((sum, row) => {
    if (Number(row?.seasonYear || -1) !== Number(seasonYear)) return sum;
    return sum + Number(row?.amount || 0);
  }, 0);
}

function getPreviewTeamPayroll(leagueData, team = {}, teamName = "") {
  const players = Array.isArray(team?.players) ? team.players : [];
  const seasonYear = getPreviewOperatingSeasonYear(leagueData);

  const playerPayroll = players.reduce((sum, player) => {
    return sum + getPlayerCurrentYearSalaryForPreview(player, seasonYear);
  }, 0);

  return playerPayroll + getPreviewTeamDeadCapForYear(leagueData, teamName, seasonYear);
}

function isPreviewTeamHardCapped(leagueData, teamName = "", team = {}) {
  if (!teamName) return false;

  if (team?.isHardCapped || team?.hardCapped || team?.hardCapTriggered || team?.triggeredHardCap) {
    return true;
  }

  if (leagueData?.hardCappedByTeam?.[teamName]) return true;
  if (leagueData?.hardCapTriggeredByTeam?.[teamName]) return true;

  if (Array.isArray(leagueData?.hardCappedTeams) && leagueData.hardCappedTeams.includes(teamName)) {
    return true;
  }

  return false;
}

function getPreviewHardCapForTeam(leagueData, teamName = "", team = {}) {
  if (!isPreviewTeamHardCapped(leagueData, teamName, team)) return null;

  const teamHardCap = getFirstFiniteNumber(
    team?.hardCap,
    team?.hardCapValue,
    team?.hardCapAmount,
    team?.hardCapLine,
    team?.hardCapLimit,
    team?.secondApron,
    team?.secondApronValue,
    team?.secondApronAmount,
    team?.secondApronLine,
    team?.apron2
  );
  if (teamHardCap && teamHardCap > 0) return teamHardCap;

  for (const mapKey of [
    "hardCapByTeam",
    "teamHardCaps",
    "hardCapMap",
    "secondApronByTeam",
    "teamSecondAprons",
  ]) {
    const value = getFirstFiniteNumber(leagueData?.[mapKey]?.[teamName]);
    if (value && value > 0) return value;
  }

  return getFirstFiniteNumber(
    leagueData?.hardCap,
    leagueData?.hardCapValue,
    leagueData?.hardCapAmount,
    leagueData?.hardCapLine,
    leagueData?.hardCapLimit,
    leagueData?.secondApron,
    leagueData?.secondApronValue,
    leagueData?.secondApronAmount,
    leagueData?.secondApronLine,
    leagueData?.apron2,
    207_824_000
  );
}

function getPreviewRights(player = {}) {
  return player?.rights && typeof player.rights === "object"
    ? player.rights
    : {
        heldByTeam: null,
        birdLevel: "none",
        seasonsTowardBird: 0,
        restrictedFreeAgent: false,
        rookieScale: false,
      };
}

function getPreviewPreviousSalary(player = {}) {
  const previousSalaryByYear = Array.isArray(player?.previousContract?.salaryByYear)
    ? player.previousContract.salaryByYear
    : [];

  const currentSalaryByYear = Array.isArray(player?.contract?.salaryByYear)
    ? player.contract.salaryByYear
    : [];

  if (previousSalaryByYear.length) {
    return Number(previousSalaryByYear[previousSalaryByYear.length - 1] || 0);
  }

  if (currentSalaryByYear.length) {
    return Number(currentSalaryByYear[currentSalaryByYear.length - 1] || 0);
  }

  return Number(player?.marketValue?.expectedYear1Salary || 1_200_000);
}

function getPreviewCapHoldForPlayer(player = {}, teamName = "") {
  const rights = getPreviewRights(player);
  const birdLevel = String(rights?.birdLevel || "").toLowerCase();

  if (player?.rightsRenounced || player?.rights?.renounced) return 0;
  if (!teamName || rights?.heldByTeam !== teamName) return 0;
  if (!birdLevel || birdLevel === "none" || birdLevel === "no rights" || birdLevel === "no_rights") return 0;

  if (
    rights?.restrictedFreeAgent &&
    player?.qualifyingOffer?.amount &&
    player?.qualifyingOffer?.status !== "withdrawn"
  ) {
    return Math.max(1_200_000, Number(player.qualifyingOffer.amount || 0));
  }

  const previousSalary = getPreviewPreviousSalary(player);
  const marketYearOne = Number(player?.marketValue?.expectedYear1Salary || 1_200_000);

  if (birdLevel === "bird") {
    return Math.max(previousSalary, marketYearOne, 1_200_000);
  }

  if (birdLevel === "early_bird") {
    return Math.max(previousSalary * 1.3, 1_200_000);
  }

  if (birdLevel === "non_bird") {
    return Math.max(previousSalary * 1.2, 1_200_000);
  }

  return 0;
}

function getPreviewCapHoldTotal(leagueData, teamName) {
  const freeAgents = Array.isArray(leagueData?.freeAgents)
    ? leagueData.freeAgents
    : [];

  return freeAgents.reduce((sum, player) => {
    return sum + getPreviewCapHoldForPlayer(player, teamName);
  }, 0);
}


function getFullSummaryContractLine(row = {}) {
  return formatContractLine(
    row?.contract || row?.signedContract || row?.userOfferContract,
    row?.totalValue || row?.signedTotalValue || row?.userOfferTotalValue,
    row?.years || row?.signedYears || row?.userOfferYears
  );
}

function normalizeFreeAgencySummaryEntry(entry = {}) {
  const dayResolved = entry?.dayResolved ?? entry?.day ?? null;
  const offerDay = entry?.offerDay ?? entry?.generatedOfferDay ?? null;
  const signings = Array.isArray(entry?.signings) ? entry.signings : [];
  const generatedOffers = Array.isArray(entry?.generatedOffers)
    ? entry.generatedOffers
    : Array.isArray(entry?.cpuOffers)
    ? entry.cpuOffers
    : [];

  return {
    ...entry,
    id: entry?.id || `${entry?.eventType || "market_update"}|${dayResolved ?? ""}|${offerDay ?? ""}`,
    eventType: entry?.eventType || "market_update",
    dayResolved,
    offerDay,
    signings,
    generatedOffers,
  };
}

function buildFallbackFreeAgencySummaryEntries(freeAgencyState = {}, latestResults = null) {
  const byKey = new Map();

  const ensureEntry = (dayResolved, offerDay = null, eventType = "fallback_market_update") => {
    const key = `${eventType}|${dayResolved ?? ""}|${offerDay ?? ""}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: key,
        eventType,
        dayResolved,
        offerDay,
        signings: [],
        generatedOffers: [],
      });
    }
    return byKey.get(key);
  };

  for (const signing of freeAgencyState?.signedPlayersLog || []) {
    const day = signing?.day ?? null;
    ensureEntry(day, null, "fallback_signings").signings.push(signing);
  }

  const addOffer = (offer = {}) => {
    if (offer?.source && offer.source !== "cpu") return;
    const offerDay = offer?.submittedDay ?? offer?.day ?? offer?.withdrawnOnDay ?? null;
    const entry = ensureEntry(null, offerDay, "fallback_cpu_offers");
    entry.generatedOffers.push(offer);
  };

  for (const offer of freeAgencyState?.offerHistory || []) {
    addOffer(offer);
  }

  const offersByPlayer = freeAgencyState?.offersByPlayer || {};
  for (const offers of Object.values(offersByPlayer)) {
    for (const offer of offers || []) {
      addOffer(offer);
    }
  }

  if (latestResults) {
    const dayResolved = latestResults?.dayResolved ?? null;
    const latestEntry = ensureEntry(dayResolved, null, "latest_results");
    latestEntry.signings.push(...(latestResults?.signings || []));
    latestEntry.generatedOffers.push(...(latestResults?.generatedOffers || []));
  }

  return Array.from(byKey.values());
}

function buildFreeAgencySummaryText(entries = []) {
  if (!entries.length) return "No full free agency action summary is available yet.";

  return entries
    .map((entry) => {
      const lines = [];
      const dayLabel = entry?.dayResolved
        ? `Day ${entry.dayResolved} Results`
        : entry?.offerDay
        ? `Day ${entry.offerDay} Offer Board`
        : "Opening Market";

      const offerDaySuffix = entry?.offerDay && entry?.dayResolved !== entry?.offerDay
        ? ` / Day ${entry.offerDay} CPU offers`
        : "";

      lines.push(`${dayLabel}${offerDaySuffix}`);
      lines.push("-".repeat(Math.min(58, lines[0].length)));

      const signings = Array.isArray(entry?.signings) ? entry.signings : [];
      const generatedOffers = Array.isArray(entry?.generatedOffers) ? entry.generatedOffers : [];

      if (signings.length) {
        lines.push(`Signings (${signings.length}):`);
        for (const signing of signings) {
          const teamName = signing?.teamName || signing?.signedWith || "Unknown Team";
          const playerName = signing?.playerName || signing?.player?.name || "Unknown Player";
          const contractLine = getFullSummaryContractLine(signing);
          const tags = [
            signing?.rfaMatched ? "RFA matched" : "",
            signing?.spendingType ? formatToolLabel(signing.spendingType) : "",
            signing?.exceptionType ? formatToolLabel(signing.exceptionType) : "",
          ].filter(Boolean);
          lines.push(`  • ${teamName} signed ${playerName}: ${contractLine}${tags.length ? ` (${tags.join(" / ")})` : ""}`);
        }
      } else {
        lines.push("Signings: none");
      }

      if (generatedOffers.length) {
        lines.push(`CPU Offers (${generatedOffers.length}):`);
        for (const offer of generatedOffers) {
          const teamName = offer?.teamName || "Unknown Team";
          const playerName = offer?.playerName || offer?.player?.name || "Unknown Player";
          const contractLine = getFullSummaryContractLine(offer);
          const tags = [
            offer?.targetTier ? formatToolLabel(offer.targetTier) : "",
            offer?.teamDirection ? formatToolLabel(offer.teamDirection) : "",
            offer?.spendingType ? formatToolLabel(offer.spendingType) : "",
            offer?.exceptionType ? formatToolLabel(offer.exceptionType) : "",
            offer?.rfaOfferSheet ? "RFA offer sheet" : "",
          ].filter(Boolean);
          lines.push(`  • ${teamName} offered ${playerName}: ${contractLine}${tags.length ? ` (${tags.join(" / ")})` : ""}`);
        }
      } else {
        lines.push("CPU Offers: none");
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

export default function ViewingOffers() {
  const navigate = useNavigate();
  const { leagueData, selectedTeam, setLeagueData, setSelectedTeam } = useGame();

  const [hideLeagueEvents, setHideLeagueEvents] = useState(false);
  const [hideCpuOffers, setHideCpuOffers] = useState(false);
  const [hideRightsRenounced, setHideRightsRenounced] = useState(false);
  const [selectedDecisionMap, setSelectedDecisionMap] = useState({});
  const [selectedRightsRenounceMap, setSelectedRightsRenounceMap] = useState({});
  const [actionError, setActionError] = useState("");
  const [processingBack, setProcessingBack] = useState(false);
  const [processingAdvance, setProcessingAdvance] = useState(false);
  const [processingDevAdvance, setProcessingDevAdvance] = useState(false);
  const [processingDevSimToEnd, setProcessingDevSimToEnd] = useState(false);
  const [offerStatusPopupOpen, setOfferStatusPopupOpen] = useState(false);
  const [dismissedOfferStatusIds, setDismissedOfferStatusIds] = useState(() => {
    try {
      const raw = sessionStorage.getItem("bm_dismissed_offer_status_ids_v1");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [playerCardView, setPlayerCardView] = useState(null);
  const [infoPopup, setInfoPopup] = useState(null);
  const [fullSummaryCopied, setFullSummaryCopied] = useState(false);

  useEffect(() => {
    localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/viewing-offers");
  }, []);

  const processPendingUserFreeAgencyDecisions =
    simEngine.processPendingUserFreeAgencyDecisions;
  const processPendingRfaMatchDecision =
    simEngine.processPendingRfaMatchDecision;
  const applyRightsManagement = simEngine.applyRightsManagement;
  const advanceFreeAgencyDay = simEngine.advanceFreeAgencyDay;

  const freeAgencyState = leagueData?.freeAgencyState || {};
  const latestResults = freeAgencyState?.latestResults || null;
  const stateSummary = latestResults?.stateSummary || null;
  const marketClosed = Boolean(stateSummary && !stateSummary.isActive);

  const signings = latestResults?.signings || [];
  const generatedOffers = latestResults?.generatedOffers || [];
  const dayResolved = latestResults?.dayResolved;

  const keepVisibleGeneratedOffers = (nextGeneratedOffers = []) => {
    return Array.isArray(nextGeneratedOffers) && nextGeneratedOffers.length
      ? nextGeneratedOffers
      : generatedOffers;
  };


  const fullFreeAgencySummaryEntries = useMemo(() => {
    const savedLog = Array.isArray(freeAgencyState?.fullActionLog)
      ? freeAgencyState.fullActionLog
      : [];

    const sourceEntries = savedLog.length
      ? savedLog
      : buildFallbackFreeAgencySummaryEntries(freeAgencyState, latestResults);

    const seen = new Set();

    return sourceEntries
      .map(normalizeFreeAgencySummaryEntry)
      .filter((entry) => {
        const key = entry?.id || `${entry?.eventType || ""}|${entry?.dayResolved ?? ""}|${entry?.offerDay ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return (entry?.signings?.length || 0) > 0 || (entry?.generatedOffers?.length || 0) > 0;
      })
      .sort((a, b) => {
        const aDay = Number(a?.dayResolved ?? a?.offerDay ?? 0);
        const bDay = Number(b?.dayResolved ?? b?.offerDay ?? 0);
        if (aDay !== bDay) return aDay - bDay;
        const aOfferDay = Number(a?.offerDay ?? 0);
        const bOfferDay = Number(b?.offerDay ?? 0);
        if (aOfferDay !== bOfferDay) return aOfferDay - bOfferDay;
        return String(a?.eventType || "").localeCompare(String(b?.eventType || ""));
      });
  }, [freeAgencyState, latestResults]);

  const fullFreeAgencySummaryText = useMemo(() => {
    return buildFreeAgencySummaryText(fullFreeAgencySummaryEntries);
  }, [fullFreeAgencySummaryEntries]);

  const freeAgencyMaxDaysForSummary = Number(
    freeAgencyState?.maxDays || stateSummary?.maxDays || 10
  );

  const showFullFreeAgencySummary = Boolean(
    fullFreeAgencySummaryEntries.length > 0 &&
      (
        marketClosed ||
        Number(dayResolved || 0) >= freeAgencyMaxDaysForSummary ||
        (!freeAgencyState?.isActive && Number(freeAgencyState?.currentDay || 0) >= freeAgencyMaxDaysForSummary)
      )
  );

  const copyFullFreeAgencySummary = async () => {
    try {
      await navigator.clipboard.writeText(fullFreeAgencySummaryText);
      setFullSummaryCopied(true);
      setTimeout(() => setFullSummaryCopied(false), 1400);
    } catch (err) {
      setActionError("Unable to copy full free agency summary. You can still select the text manually from the box.");
    }
  };

  const rightsRenounceRows = useMemo(() => {
    const rows = [];
    const seen = new Set();

    const addRow = (raw = {}, fallback = {}) => {
      const playerName = raw.playerName || raw.name || fallback.playerName || "Unknown Player";
      const teamName = raw.teamName || raw.heldByTeam || fallback.teamName || "Unknown Team";
      const day = raw.day ?? fallback.day ?? dayResolved ?? null;
      const capHoldCleared = Number(
        raw.capHoldCleared ??
          raw.capHoldAmount ??
          raw.capHold ??
          raw.amount ??
          fallback.capHoldCleared ??
          0
      );

      const key = [day ?? "", teamName, playerName, capHoldCleared, fallback.source || raw.source || raw.reason || ""].join("|");
      if (seen.has(key)) return;
      seen.add(key);

      rows.push({
        day,
        teamName,
        playerName,
        playerId: raw.playerId ?? raw.id ?? null,
        playerKey: raw.playerKey || fallback.playerKey || "",
        capHoldCleared,
        reason: raw.reason || fallback.reason || "renounced rights",
        source: fallback.source || raw.source || "rights_clearance",
        triggerPlayerName: fallback.triggerPlayerName || raw.triggerPlayerName || raw.targetPlayerName || "",
        teamDirection: raw.teamDirection || fallback.teamDirection || "",
        directionConfidence: raw.directionConfidence ?? fallback.directionConfidence ?? null,
        directionReasons: raw.directionReasons || fallback.directionReasons || [],
        recentRecord: raw.recentRecord || fallback.recentRecord || "",
        lastSeasonWins: raw.lastSeasonWins ?? fallback.lastSeasonWins ?? null,
        lastSeasonLosses: raw.lastSeasonLosses ?? fallback.lastSeasonLosses ?? null,
        lastSeasonSeed: raw.lastSeasonSeed ?? fallback.lastSeasonSeed ?? null,
        lastSeasonPlayoffResult: raw.lastSeasonPlayoffResult || fallback.lastSeasonPlayoffResult || "",
        lastSeasonRoundReached: raw.lastSeasonRoundReached ?? fallback.lastSeasonRoundReached ?? null,
        teamNeedPositions: raw.teamNeedPositions || raw.weakestPositions || fallback.teamNeedPositions || [],
        weakestPositions: raw.weakestPositions || raw.teamNeedPositions || fallback.weakestPositions || [],
        targetPlayerName: raw.targetPlayerName || fallback.targetPlayerName || raw.triggerPlayerName || fallback.triggerPlayerName || "",
        targetPlayerPosition: raw.targetPlayerPosition || fallback.targetPlayerPosition || "",
        targetPlayerOverall: raw.targetPlayerOverall ?? fallback.targetPlayerOverall ?? null,
        targetPlayerAge: raw.targetPlayerAge ?? fallback.targetPlayerAge ?? null,
        renouncedPlayerPosition: raw.renouncedPlayerPosition || raw.position || raw.pos || fallback.renouncedPlayerPosition || "",
        renouncedPlayerOverall: raw.renouncedPlayerOverall ?? raw.overall ?? fallback.renouncedPlayerOverall ?? null,
        renouncedPlayerAge: raw.renouncedPlayerAge ?? raw.age ?? fallback.renouncedPlayerAge ?? null,
      });
    };

    const signingSources = [
      ...(Array.isArray(signings) ? signings : []),
      ...(Array.isArray(freeAgencyState?.signedPlayersLog) ? freeAgencyState.signedPlayersLog : []),
    ];

    for (const signing of signingSources) {
      const fallback = {
        day: signing?.day ?? dayResolved ?? null,
        teamName: signing?.teamName || signing?.signedWith || "",
        triggerPlayerName: signing?.playerName || "",
      };

      for (const row of signing?.autoRenouncedCapHolds || []) {
        addRow(row, {
          ...fallback,
          source: "CPU auto-renounce",
          reason: `Cleared cap hold to sign ${fallback.triggerPlayerName || "a player"}`,
        });
      }

      for (const row of signing?.manualRenouncedCapHolds || []) {
        addRow(row, {
          ...fallback,
          source: "User clearance",
          reason: `Cleared cap hold to sign ${fallback.triggerPlayerName || "a player"}`,
        });
      }
    }

    for (const row of freeAgencyState?.rightsRenounceLog || []) {
      addRow(row, {
        source: row?.source || "Rights management",
        reason: row?.reason || "Renounced rights",
      });
    }

    return rows.sort((a, b) => {
      const dayDiff = Number(b.day || 0) - Number(a.day || 0);
      if (dayDiff !== 0) return dayDiff;
      return String(a.teamName).localeCompare(String(b.teamName));
    });
  }, [signings, freeAgencyState, dayResolved]);

  const pendingUserDecisions = Array.isArray(freeAgencyState?.pendingUserDecisions)
    ? freeAgencyState.pendingUserDecisions
    : [];

  const pendingUserTeamSnapshot =
    freeAgencyState?.pendingUserTeamSnapshot || null;

  const livePendingUserTeamSnapshot = useMemo(() => {
    if (!pendingUserTeamSnapshot?.ok) return pendingUserTeamSnapshot;
    if (!selectedTeam?.name) return pendingUserTeamSnapshot;

    const liveTeam = getTeamByName(leagueData, selectedTeam.name) || selectedTeam;

    const liveRosterCount = Array.isArray(liveTeam?.players)
      ? liveTeam.players.length
      : pendingUserTeamSnapshot?.rosterCount;

    const calculatedPayroll = getPreviewTeamPayroll(leagueData, liveTeam, selectedTeam.name);
    const payroll = calculatedPayroll >= 0
      ? calculatedPayroll
      : Number(pendingUserTeamSnapshot?.payroll || 0);

    const salaryCap = getPreviewSalaryCap(leagueData, pendingUserTeamSnapshot);
    const capHoldTotal = getPreviewCapHoldTotal(leagueData, selectedTeam.name);

    const capRoom = salaryCap - payroll;
    const practicalPayroll = payroll + capHoldTotal;
    const practicalCapRoom = salaryCap - practicalPayroll;
    const hardCap = getPreviewHardCapForTeam(leagueData, selectedTeam.name, liveTeam);
    const hardCapRoom = hardCap === null ? null : hardCap - practicalPayroll;

    return {
      ...pendingUserTeamSnapshot,
      salaryCap,
      payroll,
      rawPayrollWithoutHolds: payroll,
      capRoom,
      rawCapRoomWithoutHolds: capRoom,
      capHolds: capHoldTotal,
      capHoldTotal,
      practicalPayroll,
      practicalCapRoom,
      hardCap,
      hardCapRoom,
      isHardCapped: hardCap !== null,
      rosterCount: Number(liveRosterCount || 0),
    };
  }, [pendingUserTeamSnapshot, leagueData, selectedTeam]);

  const pendingRfaMatchDecisions = Array.isArray(freeAgencyState?.pendingRfaMatchDecisions)
    ? freeAgencyState.pendingRfaMatchDecisions
    : [];

  // Surgical recovery guard:
  // A pending-signing state can exist without latestResults after a saved reload,
  // compact backend payload, or partial update. Do not show the empty-results
  // dead-end in that case. Let the pending-signings UI render so the user can
  // sign/decline the waiting players and continue the market.
  const hasPendingUserAction =
    pendingUserDecisions.length > 0 || pendingRfaMatchDecisions.length > 0;
  const shouldShowEmptyResults = !latestResults && !hasPendingUserAction;

  const teamLogoMap = useMemo(() => {
    const map = new Map();

    for (const confKey of Object.keys(leagueData?.conferences || {})) {
      for (const team of leagueData?.conferences?.[confKey] || []) {
        if (team?.name) {
          map.set(team.name, team.logo || "");
        }
      }
    }

    return map;
  }, [leagueData]);

  const getTeamLogo = (teamName) => {
    return teamLogoMap.get(teamName) || "";
  };


  const openPlayerCardFromRow = (row = {}, preferredTeamName = "") => {
    const player = findPlayerInLeague(leagueData, row);
    if (!player) return;

    const resolvedTeamName =
      preferredTeamName ||
      row?.teamName ||
      row?.signedWith ||
      row?.rightsTeamName ||
      player?.teamName ||
      player?.rights?.heldByTeam ||
      "Free Agent";

    setPlayerCardView({
      player,
      teamName: resolvedTeamName,
      teamLogo: getTeamLogo(resolvedTeamName) || player?.teamLogo || "",
    });
  };

  const openSigningInfo = (row, chipLabel = "Signing Detail", focusType = "full") => {
    const fullPopup = buildSigningPopup({
      row,
      chipLabel,
      leagueData,
      selectedTeamName: selectedTeam?.name || "",
    });

    setInfoPopup(buildFocusedPopup({
      fullPopup,
      row,
      chipLabel,
      focusType,
      leagueData,
    }));
  };

  const openOfferInfo = (row, chipLabel = "Offer Detail", focusType = "full") => {
    const fullPopup = buildOfferPopup({
      row,
      chipLabel,
      leagueData,
    });

    setInfoPopup(buildFocusedPopup({
      fullPopup,
      row,
      chipLabel,
      focusType,
      leagueData,
    }));
  };

  const openUserOfferInfo = (row, chipLabel = "Offer Detail", focusType = "full") => {
    const fullPopup = buildUserOfferPopup({
      row,
      chipLabel,
      leagueData,
      selectedTeamName: selectedTeam?.name || "",
    });

    setInfoPopup(buildFocusedPopup({
      fullPopup,
      row,
      chipLabel,
      focusType,
      leagueData,
    }));
  };

  const openRightsRenouncedInfo = (row) => {
    setInfoPopup(buildRightsRenouncedPopup({
      row,
      leagueData,
    }));
  };

  const getPlayerKeyFromFreeAgent = (player) => {
    if (!player) return "";
    return getOfferPlayerKeyFromParts(player.id, player.name);
  };

  const findFreeAgentByKey = (playerKey) => {
    for (const player of leagueData?.freeAgents || []) {
      if (getPlayerKeyFromFreeAgent(player) === playerKey) return player;
    }
    return null;
  };

  const userOfferActivity = useMemo(() => {
    const teamName = selectedTeam?.name;
    if (!teamName) return [];

    const state = leagueData?.freeAgencyState || {};
    const rowsByKey = new Map();

    const addRow = (row) => {
      if (!row?.playerKey) return;
      const old = rowsByKey.get(row.playerKey);
      const priority = {
        lost: 5,
        matched_by_original_team: 5,
        won: 4,
        pending_user_decision: 3,
        active: 2,
      };

      if (!old || (priority[row.status] || 0) >= (priority[old.status] || 0)) {
        rowsByKey.set(row.playerKey, row);
      }
    };

    for (const row of state.pendingUserDecisions || []) {
      if (!row?.playerKey) continue;
      addRow({
        id: `pending|${row.playerKey}|${row.day || ""}`,
        playerKey: row.playerKey,
        playerName: row.playerName || row?.player?.name || "Unknown Player",
        status: "pending_user_decision",
        teamName,
        signedWith: teamName,
        contract: row.contract,
        totalValue: row.totalValue,
        years: row.years,
        day: row.day,
        detail: "Your offer is currently waiting for your final approval on this screen.",
        popupEligible: false,
      });
    }

    const offersByPlayer = state.offersByPlayer || {};
    for (const [playerKey, offers] of Object.entries(offersByPlayer)) {
      for (const offer of offers || []) {
        if (offer?.teamName !== teamName) continue;
        if (offer?.source !== "user") continue;
        if (offer?.status && offer.status !== "active") continue;

        const player = findFreeAgentByKey(playerKey);
        addRow({
          id: `active|${playerKey}|${offer.submittedDay || ""}`,
          playerKey,
          playerName: offer.playerName || player?.name || "Unknown Player",
          status: "active",
          teamName,
          signedWith: null,
          contract: offer.contract,
          totalValue: offer.totalValue,
          years: offer.years,
          day: offer.submittedDay,
          detail: "Your offer is live. The player is still comparing offers.",
          popupEligible: false,
        });
      }
    }

    for (const log of state.signedPlayersLog || []) {
      const allOffers = Array.isArray(log?.allOffers) ? log.allOffers : [];
      const userOffer = allOffers.find((offer) => offer?.teamName === teamName && offer?.source === "user");
      if (!userOffer) continue;

      const playerKey = getOfferPlayerKeyFromParts(log.playerId, log.playerName);
      const signedWith = log.teamName || log.signedWith;
      const won = signedWith === teamName || userOffer.status === "accepted";
      const matchedByOriginal = Boolean(log.rfaMatched && log.originalOfferTeamName === teamName && signedWith !== teamName);
      const status = won ? "won" : matchedByOriginal ? "matched_by_original_team" : "lost";

      const signedContractSummary = getContractSummary(log.contract);
      const userOfferContractSummary = getContractSummary(
        userOffer.contract,
        userOffer.totalValue,
        userOffer.years
      );

      addRow({
        id: `${status}|${playerKey}|${signedWith || ""}|${log.day || ""}`,
        playerKey,
        playerName: log.playerName || userOffer.playerName || "Unknown Player",
        status,
        teamName,
        signedWith,
        contract: log.contract || userOffer.contract,
        totalValue: signedContractSummary.totalValue || userOffer.totalValue,
        years: signedContractSummary.years || userOffer.years,
        userOfferContract: userOffer.contract,
        userOfferTotalValue: userOfferContractSummary.totalValue,
        userOfferYears: userOfferContractSummary.years,
        signedContract: log.contract || userOffer.contract,
        signedTotalValue: signedContractSummary.totalValue || userOffer.totalValue,
        signedYears: signedContractSummary.years || userOffer.years,
        day: log.day,
        detail: won
          ? `${log.playerName || "The player"} signed with ${teamName}. Your offer won.`
          : matchedByOriginal
          ? `${signedWith} matched your RFA offer sheet. ${log.playerName || "The player"} signed with ${signedWith}.`
          : `${log.playerName || "The player"} signed with ${signedWith || "another team"} instead of accepting your offer.`,
        storyContext: log?.storyContext || userOffer?.storyContext || null,
        popupEligible: !won,
      });
    }

    return Array.from(rowsByKey.values()).sort((a, b) => {
      const priority = { lost: 1, matched_by_original_team: 1, pending_user_decision: 2, active: 3, won: 4 };
      const diff = (priority[a.status] || 9) - (priority[b.status] || 9);
      if (diff !== 0) return diff;
      return String(a.playerName || "").localeCompare(String(b.playerName || ""));
    });
  }, [leagueData, selectedTeam?.name]);

  const offerPopupRows = useMemo(() => {
    const dismissed = new Set(dismissedOfferStatusIds || []);
    return userOfferActivity.filter((row) => row.popupEligible && !dismissed.has(row.id));
  }, [userOfferActivity, dismissedOfferStatusIds]);

  const dismissOfferStatusPopup = () => {
    const ids = Array.from(new Set([
      ...(dismissedOfferStatusIds || []),
      ...offerPopupRows.map((row) => row.id),
    ]));
    setDismissedOfferStatusIds(ids);
    try {
      sessionStorage.setItem("bm_dismissed_offer_status_ids_v1", JSON.stringify(ids));
    } catch {}
    setOfferStatusPopupOpen(false);
  };


  const applyLeagueUpdate = (updated) => {
    if (!updated) return;

    if (typeof setLeagueData === "function") {
      setLeagueData(updated);
    }

    persistLeagueData(updated);

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
        localStorage.setItem("selectedTeam", JSON.stringify(nextSelectedTeam.name));
      }
    }
  };

  const applyLeagueUpdateWithLatestResults = (updated, nextLatestResults = null) => {
    if (!updated) return;

    const nextLeagueData = {
      ...updated,
      freeAgencyState: {
        ...(updated.freeAgencyState || {}),
        latestResults: nextLatestResults || null,
      },
    };

    applyLeagueUpdate(nextLeagueData);
  };

  useEffect(() => {
    setSelectedDecisionMap((prev) => {
      const next = {};
      for (const row of pendingUserDecisions) {
        next[row.playerKey] = Boolean(prev?.[row.playerKey]);
      }
      return next;
    });
  }, [pendingUserDecisions]);

  useEffect(() => {
    if (offerPopupRows.length > 0) {
      setOfferStatusPopupOpen(true);
    }
  }, [offerPopupRows.length]);
  const finalizeFreeAgencyComplete = (updated, nextLatestResults = null) => {
  if (!updated) return;

  const nextLeagueData = {
    ...updated,
    freeAgencyState: {
      ...(updated.freeAgencyState || {}),
      isActive: false,
      completed: true,
      latestResults:
        nextLatestResults !== null
          ? nextLatestResults
          : updated.freeAgencyState?.latestResults ?? latestResults ?? null,
    },
  };

  applyLeagueUpdate(nextLeagueData);

  try {
    const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
    const raw = localStorage.getItem(OFFSEASON_STATE_KEY);
    const prev = raw ? JSON.parse(raw) : {};

    const nextOffseasonState = {
      ...prev,
      freeAgencyComplete: true,
      currentStep: 4,
    };

    localStorage.setItem(
      OFFSEASON_STATE_KEY,
      JSON.stringify(nextOffseasonState)
    );
  } catch (err) {
    console.error("Failed to persist free agency completion:", err);
  }
};

  const selectedPendingRows = useMemo(() => {
    return pendingUserDecisions.filter((row) => selectedDecisionMap[row.playerKey]);
  }, [pendingUserDecisions, selectedDecisionMap]);

  const getRightsFromPlayer = (player) => {
    return player?.rights && typeof player.rights === "object"
      ? player.rights
      : {
          heldByTeam: null,
          birdLevel: "none",
          seasonsTowardBird: 0,
          restrictedFreeAgent: false,
          rookieScale: false,
        };
  };

  const getPreviousSalaryForCapHold = (player) => {
    const previousSalaryByYear = Array.isArray(player?.previousContract?.salaryByYear)
      ? player.previousContract.salaryByYear
      : [];
    const currentSalaryByYear = Array.isArray(player?.contract?.salaryByYear)
      ? player.contract.salaryByYear
      : [];

    if (previousSalaryByYear.length) {
      return Number(previousSalaryByYear[previousSalaryByYear.length - 1] || 0);
    }

    if (currentSalaryByYear.length) {
      return Number(currentSalaryByYear[currentSalaryByYear.length - 1] || 0);
    }

    return Number(player?.marketValue?.expectedYear1Salary || 1_200_000);
  };

  const getCapHoldForPlayer = (player, teamName) => {
    const rights = getRightsFromPlayer(player);

    if (player?.rightsRenounced) return 0;
    if (!teamName || rights?.heldByTeam !== teamName) return 0;
    if (!rights?.birdLevel || rights.birdLevel === "none") return 0;

    if (
      rights?.restrictedFreeAgent &&
      player?.qualifyingOffer?.amount &&
      player?.qualifyingOffer?.status !== "withdrawn"
    ) {
      return Math.max(1_200_000, Number(player.qualifyingOffer.amount || 0));
    }

    const previousSalary = getPreviousSalaryForCapHold(player);
    const marketYearOne = Number(player?.marketValue?.expectedYear1Salary || 1_200_000);

    if (rights.birdLevel === "bird") {
      return Math.max(previousSalary, marketYearOne, 1_200_000);
    }

    if (rights.birdLevel === "early_bird") {
      return Math.max(previousSalary * 1.3, 1_200_000);
    }

    if (rights.birdLevel === "non_bird") {
      return Math.max(previousSalary * 1.2, 1_200_000);
    }

    return 0;
  };

  const formatBirdLevel = (level) => {
    if (level === "bird") return "Bird";
    if (level === "early_bird") return "Early Bird";
    if (level === "non_bird") return "Non-Bird";
    return "Rights";
  };

  const capHoldRenounceRows = useMemo(() => {
    const teamName = selectedTeam?.name;
    if (!teamName) return [];

    return (leagueData?.freeAgents || [])
      .map((player) => {
        const capHold = getCapHoldForPlayer(player, teamName);
        const rights = getRightsFromPlayer(player);
        return {
          player,
          playerKey: getOfferPlayerKeyFromParts(player?.id, player?.name),
          playerName: player?.name || "Unknown Player",
          position: player?.pos || player?.position || "-",
          age: player?.age ?? null,
          overall: player?.overall ?? null,
          birdLevel: rights?.birdLevel || "none",
          restrictedFreeAgent: Boolean(rights?.restrictedFreeAgent || player?.qualifyingOffer?.amount),
          capHold,
          marketValue: player?.marketValue || null,
        };
      })
      .filter((row) => row.capHold > 0)
      .sort((a, b) => Number(b.capHold || 0) - Number(a.capHold || 0));
  }, [leagueData, selectedTeam?.name]);

  useEffect(() => {
    setSelectedRightsRenounceMap((prev) => {
      const validKeys = new Set(capHoldRenounceRows.map((row) => row.playerKey));
      const next = {};

      for (const [key, value] of Object.entries(prev || {})) {
        if (value && validKeys.has(key)) {
          next[key] = true;
        }
      }

      return next;
    });
  }, [capHoldRenounceRows]);

  const selectedCapHoldClearance = useMemo(() => {
    return capHoldRenounceRows.reduce((sum, row) => {
      if (!selectedRightsRenounceMap[row.playerKey]) return sum;
      return sum + Number(row.capHold || 0);
    }, 0);
  }, [capHoldRenounceRows, selectedRightsRenounceMap]);

  const selectedRightsDecisions = useMemo(() => {
    const out = {};

    for (const row of capHoldRenounceRows) {
      if (selectedRightsRenounceMap[row.playerKey]) {
        out[row.playerKey] = "renounce";
      }
    }

    return out;
  }, [capHoldRenounceRows, selectedRightsRenounceMap]);

  const toggleRightsRenounce = (playerKey) => {
    setSelectedRightsRenounceMap((prev) => ({
      ...prev,
      [playerKey]: !prev[playerKey],
    }));
    setActionError("");
  };

  const selectionPreview = useMemo(() => {
    if (!livePendingUserTeamSnapshot?.ok) {
      return null;
    }

    const selectedCurrentYearTotal = selectedPendingRows.reduce((sum, row) => {
      const summary = getContractSummary(
        row?.contract,
        row?.totalValue,
        row?.years
      );
      return sum + Number(summary.currentYearSalary || row?.currentYearSalary || 0);
    }, 0);

    const selectedTotalValue = selectedPendingRows.reduce((sum, row) => {
      const summary = getContractSummary(
        row?.contract,
        row?.totalValue,
        row?.years
      );
      return sum + Number(summary.totalValue || 0);
    }, 0);

    const selectedCapRoomImpactTotal = selectedPendingRows.reduce((sum, row) => {
      return sum + getPendingSigningCapRoomImpact(row);
    }, 0);

    const selectedCount = selectedPendingRows.length;
    const payrollBefore = Number(livePendingUserTeamSnapshot?.payroll || 0);
    const capRoomBefore = Number(livePendingUserTeamSnapshot?.capRoom || 0);
    const hardCapRoomBefore =
      livePendingUserTeamSnapshot?.hardCapRoom === null ||
      livePendingUserTeamSnapshot?.hardCapRoom === undefined
        ? null
        : Number(livePendingUserTeamSnapshot.hardCapRoom);
    const rosterBefore = Number(livePendingUserTeamSnapshot?.rosterCount || 0);
    const rosterLimit = Number(livePendingUserTeamSnapshot?.rosterLimit || 15);

    const payrollAfter = payrollBefore + selectedCurrentYearTotal;
    const capRoomAfter = capRoomBefore - selectedCapRoomImpactTotal;
    const capHoldTotal = Number(livePendingUserTeamSnapshot?.capHoldTotal || 0);
    const practicalPayrollAfter =
      Number(livePendingUserTeamSnapshot?.practicalPayroll || payrollBefore + capHoldTotal)
      - selectedCapHoldClearance
      + selectedCurrentYearTotal;
    const practicalCapRoomAfter =
      Number(livePendingUserTeamSnapshot?.practicalCapRoom ?? capRoomBefore - capHoldTotal)
      + selectedCapHoldClearance
      - selectedCapRoomImpactTotal;
    const firstApron = Number(livePendingUserTeamSnapshot?.firstApron || 0);
    const secondApron = Number(livePendingUserTeamSnapshot?.secondApron || 0);
    const hardCapRoomAfter =
      hardCapRoomBefore === null
        ? null
        : hardCapRoomBefore + selectedCapHoldClearance - selectedCurrentYearTotal;
    const rosterAfter = rosterBefore + selectedCount;

    const warnings = [];
    const blockingWarnings = [];
    const apronNotes = [];

    const selectedNeedsNormalCapRoom = selectedCapRoomImpactTotal > 0;

    if (selectedCount > 0 && selectedNeedsNormalCapRoom && practicalCapRoomAfter < 0) {
      warnings.push(
        `Selected signings appear short by ${formatDollars(Math.abs(practicalCapRoomAfter))}. Renounce enough rights below to clear the cap holds before confirming.`
      );
    }

    if (hardCapRoomAfter !== null && hardCapRoomAfter < 0) {
      const msg = "Selected signings put you over the hard cap.";
      warnings.push(msg);
      blockingWarnings.push(msg);
    }

    if (rosterAfter > rosterLimit) {
      const msg = `Selected signings would take you over the ${rosterLimit}-man roster limit.`;
      warnings.push(msg);
      blockingWarnings.push(msg);
    }
if (secondApron > 0 && payrollAfter >= secondApron) {
  apronNotes.push("Selected signings would leave you at or above the second apron.");
} else if (firstApron > 0 && payrollAfter >= firstApron) {
  apronNotes.push("Selected signings would leave you at or above the first apron.");
}

    return {
      selectedCount,
      selectedCurrentYearTotal,
      selectedCapRoomImpactTotal,
      selectedTotalValue,
      payrollBefore,
      payrollAfter,
      capRoomBefore,
      capRoomAfter,
      capHoldTotal,
      selectedCapHoldClearance,
      capRoomShortfall: selectedNeedsNormalCapRoom ? Math.max(0, -practicalCapRoomAfter) : 0,
      practicalPayrollAfter,
      practicalCapRoomAfter,
      firstApron,
      secondApron,
      hardCapRoomBefore,
      hardCapRoomAfter,
      rosterBefore,
      rosterAfter,
      rosterLimit,
      warnings,
      blockingWarnings,
      hasBlockingIssue: blockingWarnings.length > 0,
    };
  }, [livePendingUserTeamSnapshot, selectedPendingRows, selectedCapHoldClearance]);

  const toggleDecision = (playerKey) => {
    setSelectedDecisionMap((prev) => ({
      ...prev,
      [playerKey]: !prev[playerKey],
    }));
    setActionError("");
  };

  const handleRfaMatchDecision = async (row, decision) => {
    if (!selectedTeam?.name) {
      setActionError("No team selected.");
      return;
    }

    if (!row?.playerKey) {
      setActionError("Missing restricted free agent decision key.");
      return;
    }

    try {
      setProcessingBack(true);
      setActionError("");

      const backendLeagueData = buildLeagueDataForFreeAgencyBackendAction(leagueData);

      const res = await processPendingRfaMatchDecision(
        backendLeagueData,
        selectedTeam.name,
        row.playerKey,
        decision,
        selectedRightsDecisions
      );

      if (!res?.ok) {
        if (res?.leagueData) {
          applyLeagueUpdate(res.leagueData);
        }
        setActionError(res?.reason || "Failed to process RFA match decision.");
        return;
      }

      // Surgical RFA deadlock guard:
      // The backend should remove the processed row, but older/local saves can
      // leave it behind after Decline Match. Clean only this row so the page can
      // unlock without touching any other pending RFA decisions.
      const nextFreeAgencyState = res.leagueData?.freeAgencyState || {};
      const cleanedPendingRfaMatchDecisions = Array.isArray(nextFreeAgencyState.pendingRfaMatchDecisions)
        ? nextFreeAgencyState.pendingRfaMatchDecisions.filter((decisionRow) => decisionRow?.playerKey !== row.playerKey)
        : [];

      const cleanedLeagueData = {
        ...res.leagueData,
        freeAgencyState: {
          ...nextFreeAgencyState,
          pendingRfaMatchDecisions: cleanedPendingRfaMatchDecisions,
        },
      };

      const latest = {
        dayResolved: dayResolved ?? row?.day ?? null,
        signings: res?.processedSignings || (res?.processedSigning ? [res.processedSigning] : []),
        generatedOffers: keepVisibleGeneratedOffers(res?.generatedOffers || []),
        stateSummary: res?.stateSummary || latestResults?.stateSummary || null,
      };

      applyLeagueUpdateWithLatestResults(cleanedLeagueData, latest);
    } catch (err) {
      setActionError(err?.message || "Failed to process RFA match decision.");
    } finally {
      setProcessingBack(false);
    }
  };

  const processSelections = async ({ requireSelected = false, declineUnselected = false } = {}) => {
    if (!selectedTeam?.name) {
      return { ok: false, reason: "No team selected." };
    }

    if (selectionPreview?.hasBlockingIssue) {
      const blockingReason = (
        selectionPreview?.blockingWarnings?.length
          ? selectionPreview.blockingWarnings
          : selectionPreview.warnings || []
      ).join(" ");

      return {
        ok: false,
        reason: blockingReason || "Selected signings have a blocking issue.",
      };
    }

    const selectedPlayerKeys = pendingUserDecisions
      .filter((row) => selectedDecisionMap[row.playerKey])
      .map((row) => row.playerKey);

    if (requireSelected && pendingUserDecisions.length > 0 && selectedPlayerKeys.length === 0) {
      return {
        ok: false,
        reason:
          "You have pending signings waiting. Select at least one player to sign, or go back without advancing the day.",
      };
    }

    // Navigating back never declines anyone. Pressing the advance/finalize button
    // is the explicit decision point: checked rows sign, unchecked rows are declined.
    const declinedPlayerKeys = declineUnselected
      ? pendingUserDecisions
          .filter((row) => !selectedDecisionMap[row.playerKey])
          .map((row) => row.playerKey)
      : [];

    const backendLeagueData = buildLeagueDataForFreeAgencyBackendAction(leagueData);

    return await processPendingUserFreeAgencyDecisions(
      backendLeagueData,
      selectedTeam.name,
      selectedPlayerKeys,
      selectedRightsDecisions,
      declinedPlayerKeys
    );
  };

const handleReturnToOffseasonHub = () => {
  try {
    setActionError("");
    localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/viewing-offers");

    if (leagueData) {
      applyLeagueUpdate(leagueData);
    }

    navigate("/offseason");
  } catch (err) {
    setActionError(err?.message || "Failed to return to offseason hub.");
  }
};

  const handleAdvanceFromResults = async () => {
    try {
      setProcessingAdvance(true);
      setActionError("");

      // Cleaner flow: ViewingOffers is only a review/decision screen.
      // FreeAgents advances the market, this page resolves user decisions,
      // then returns to FreeAgents for the next day. Once the market is closed,
      // this button should finish FA and move directly into progression.
      const hadPendingUserDecisions = pendingUserDecisions.length > 0;

      if (marketClosed && !hadPendingUserDecisions) {
        finalizeFreeAgencyComplete(leagueData, latestResults);
        localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/free-agents");
        navigate("/player-progression");
        return;
      }

      if (!hadPendingUserDecisions) {
        const shouldResumeAfterImmediateRfaMatch = Boolean(
          leagueData?.freeAgencyState?.resumeAdvanceAfterImmediateRfaMatch ||
            leagueData?.freeAgencyState?.forceViewingOffersReturnReason === "immediate_rfa_match"
        );

        if (shouldResumeAfterImmediateRfaMatch) {
          if (!selectedTeam?.name) {
            setActionError("No team selected.");
            return;
          }

          if (typeof processPendingUserFreeAgencyDecisions !== "function") {
            setActionError("Pending free-agency decisions are not wired in simEnginePy.js yet.");
            return;
          }

          const backendLeagueData = buildLeagueDataForFreeAgencyBackendAction(leagueData);
          const resumeRes = await processPendingUserFreeAgencyDecisions(
            backendLeagueData,
            selectedTeam.name,
            [],
            {},
            []
          );

          if (!resumeRes?.ok || !resumeRes?.leagueData) {
            if (resumeRes?.leagueData) {
              applyLeagueUpdate(resumeRes.leagueData);
            }
            setActionError(resumeRes?.reason || "Failed to continue after the RFA match update.");
            return;
          }

          const latest = {
            dayResolved: resumeRes?.resumedAfterImmediateRfaMatch
              ? dayResolved ?? leagueData?.freeAgencyState?.currentDay ?? null
              : resumeRes?.dayResolved ?? resumeRes?.stateSummary?.currentDay ?? null,
            signings: resumeRes?.processedSignings || [],
            generatedOffers: resumeRes?.generatedOffers || [],
            stateSummary: resumeRes?.stateSummary || null,
          };

          applyLeagueUpdateWithLatestResults(resumeRes.leagueData, latest);

          if (!resumeRes?.stateSummary?.isActive) {
            finalizeFreeAgencyComplete(resumeRes.leagueData, latest);
            localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/free-agents");
            navigate("/player-progression");
            return;
          }

          localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/free-agents");
          navigate("/free-agents");
          return;
        }

        localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/free-agents");

        if (leagueData) {
          applyLeagueUpdate(leagueData);
        }

        navigate("/free-agents");
        return;
      }

      const processRes = await processSelections({
        requireSelected: false,
        declineUnselected: true,
      });

      if (!processRes?.ok) {
        if (processRes?.leagueData) {
          applyLeagueUpdate(processRes.leagueData);
        }
        setActionError(processRes?.reason || "Failed to process pending signings.");
        return;
      }

      const baseLeague = processRes?.leagueData || leagueData;
      const baseStateSummary = processRes?.stateSummary || null;
      const latest = {
        dayResolved: dayResolved ?? baseLeague?.freeAgencyState?.currentDay ?? null,
        signings: processRes?.processedSignings || [],
        generatedOffers: keepVisibleGeneratedOffers(processRes?.generatedOffers || []),
        stateSummary: baseStateSummary || latestResults?.stateSummary || null,
      };

      if (processRes?.immediateRfaMatch) {
        applyLeagueUpdateWithLatestResults(baseLeague, latest);
        localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/viewing-offers");
        navigate("/viewing-offers");
        return;
      }

      if (baseStateSummary && !baseStateSummary.isActive) {
        finalizeFreeAgencyComplete(baseLeague, latest);
        localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/free-agents");
        navigate("/player-progression");
        return;
      } else {
        applyLeagueUpdateWithLatestResults(baseLeague, latest);
      }

      localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/free-agents");
      navigate("/free-agents");
    } catch (err) {
      setActionError(err?.message || "Failed to continue free agency.");
    } finally {
      setProcessingAdvance(false);
    }
  };

  const handleDevAdvanceDayFromViewingOffers = async () => {
    if (!selectedTeam?.name) {
      setActionError("No team selected.");
      return;
    }

    if (typeof advanceFreeAgencyDay !== "function") {
      setActionError("Advance day is not wired in simEnginePy.js yet.");
      return;
    }

    if (pendingRfaMatchDecisions.length > 0) {
      setActionError("Resolve RFA match decisions first, then use Dev Advance Day.");
      return;
    }

    try {
      setProcessingDevAdvance(true);
      setActionError("");

      let baseLeague = leagueData;
      let processedSignings = [];
      let baseStateSummary = null;

      // Dev shortcut keeps the old behavior: if pending user signings are on
      // the screen, checked players sign and unchecked players are declined
      // before advancing to the next FA day.
      if (pendingUserDecisions.length > 0) {
        const processRes = await processSelections({
          requireSelected: false,
          declineUnselected: true,
        });

        if (!processRes?.ok) {
          if (processRes?.leagueData) {
            applyLeagueUpdate(processRes.leagueData);
          }
          setActionError(processRes?.reason || "Failed to process pending signings before dev advance.");
          return;
        }

        baseLeague = processRes?.leagueData || leagueData;
        processedSignings = processRes?.processedSignings || [];
        baseStateSummary = processRes?.stateSummary || null;

        if (baseStateSummary && !baseStateSummary.isActive) {
          const latest = {
            dayResolved: dayResolved ?? baseLeague?.freeAgencyState?.currentDay ?? null,
            signings: processedSignings,
            generatedOffers: keepVisibleGeneratedOffers(processRes?.generatedOffers || []),
            stateSummary: baseStateSummary,
          };

          finalizeFreeAgencyComplete(baseLeague, latest);
          localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/free-agents");
          navigate("/player-progression");
          return;
        }
      }

      const res = await advanceFreeAgencyDay(
        baseLeague,
        selectedTeam.name
      );

      if (!res?.ok || !res?.leagueData) {
        if (res?.leagueData) {
          applyLeagueUpdate(res.leagueData);
        }
        setActionError(res?.reason || "Failed to dev advance free agency day.");
        return;
      }

      const latest = {
        dayResolved: res?.dayResolved ?? res?.stateSummary?.currentDay ?? null,
        signings: [
          ...processedSignings,
          ...(res?.signings || []),
        ],
        generatedOffers: res?.generatedOffers || [],
        stateSummary: res?.stateSummary || null,
      };

      applyLeagueUpdateWithLatestResults(res.leagueData, latest);

      if (!res?.stateSummary?.isActive) {
        finalizeFreeAgencyComplete(res.leagueData, latest);
      }

      localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/viewing-offers");
      navigate("/viewing-offers");
    } catch (err) {
      setActionError(err?.message || "Failed to dev advance free agency day.");
    } finally {
      setProcessingDevAdvance(false);
    }
  };


  const handleDevSimToEndFreeAgency = async () => {
    if (!selectedTeam?.name) {
      setActionError("No team selected.");
      return;
    }

    if (typeof advanceFreeAgencyDay !== "function") {
      setActionError("Advance day is not wired in simEnginePy.js yet.");
      return;
    }

    if (pendingRfaMatchDecisions.length > 0) {
      setActionError("Resolve RFA match decisions first, then use Dev Sim to End FA.");
      return;
    }

    const processFuturePendingUserDecisions = async (workingLeague) => {
      const futurePending = Array.isArray(workingLeague?.freeAgencyState?.pendingUserDecisions)
        ? workingLeague.freeAgencyState.pendingUserDecisions
        : [];

      if (!futurePending.length) {
        return {
          ok: true,
          leagueData: workingLeague,
          processedSignings: [],
          generatedOffers: [],
          stateSummary: workingLeague?.freeAgencyState?.latestResults?.stateSummary || null,
        };
      }

      const declinedPlayerKeys = futurePending
        .map((row) => row?.playerKey)
        .filter(Boolean);

      const backendLeagueData = buildLeagueDataForFreeAgencyBackendAction(workingLeague);

      return await processPendingUserFreeAgencyDecisions(
        backendLeagueData,
        selectedTeam.name,
        [],
        {},
        declinedPlayerKeys
      );
    };

    try {
      setProcessingDevSimToEnd(true);
      setActionError("");

      let workingLeague = leagueData;
      let latest = latestResults || null;
      const safetyLimit = Number(workingLeague?.freeAgencyState?.maxDays || 10) + 6;

      // First, resolve pending user signings currently visible on this page.
      // Same rule as Dev Advance Day: checked players sign, unchecked players are declined.
      if (pendingUserDecisions.length > 0) {
        const processRes = await processSelections({
          requireSelected: false,
          declineUnselected: true,
        });

        if (!processRes?.ok) {
          if (processRes?.leagueData) {
            applyLeagueUpdate(processRes.leagueData);
          }
          setActionError(processRes?.reason || "Failed to process pending signings before dev simming to the end of free agency.");
          return;
        }

        workingLeague = processRes?.leagueData || workingLeague;
        latest = {
          dayResolved: dayResolved ?? workingLeague?.freeAgencyState?.currentDay ?? null,
          signings: processRes?.processedSignings || [],
          generatedOffers: keepVisibleGeneratedOffers(processRes?.generatedOffers || []),
          stateSummary: processRes?.stateSummary || latestResults?.stateSummary || null,
        };

        if (processRes?.stateSummary && !processRes.stateSummary.isActive) {
          finalizeFreeAgencyComplete(workingLeague, latest);
          localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/viewing-offers");
          navigate("/viewing-offers");
          return;
        }
      }

      for (let step = 0; step < safetyLimit; step += 1) {
        const rfaPending = Array.isArray(workingLeague?.freeAgencyState?.pendingRfaMatchDecisions)
          ? workingLeague.freeAgencyState.pendingRfaMatchDecisions
          : [];

        if (rfaPending.length > 0) {
          applyLeagueUpdateWithLatestResults(workingLeague, latest);
          localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/viewing-offers");
          setActionError("Dev sim stopped because an RFA match decision needs your manual choice.");
          navigate("/viewing-offers");
          return;
        }

        const pendingProcessRes = await processFuturePendingUserDecisions(workingLeague);

        if (!pendingProcessRes?.ok) {
          if (pendingProcessRes?.leagueData) {
            applyLeagueUpdate(pendingProcessRes.leagueData);
          }
          setActionError(pendingProcessRes?.reason || "Failed to process future pending signings while dev simming to the end of free agency.");
          return;
        }

        if (pendingProcessRes?.leagueData && pendingProcessRes.leagueData !== workingLeague) {
          workingLeague = pendingProcessRes.leagueData;
          latest = {
            dayResolved: workingLeague?.freeAgencyState?.currentDay ?? latest?.dayResolved ?? null,
            signings: pendingProcessRes?.processedSignings || [],
            generatedOffers: pendingProcessRes?.generatedOffers || [],
            stateSummary: pendingProcessRes?.stateSummary || latest?.stateSummary || null,
          };

          if (pendingProcessRes?.stateSummary && !pendingProcessRes.stateSummary.isActive) {
            finalizeFreeAgencyComplete(workingLeague, latest);
            localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/viewing-offers");
            navigate("/viewing-offers");
            return;
          }
        }

        const state = workingLeague?.freeAgencyState || {};
        const stateSummaryFromLatest = latest?.stateSummary || state?.latestResults?.stateSummary || null;
        const isActive = stateSummaryFromLatest?.isActive ?? state?.isActive;
        const currentDay = Number(stateSummaryFromLatest?.currentDay ?? state?.currentDay ?? 0);
        const maxDays = Number(stateSummaryFromLatest?.maxDays ?? state?.maxDays ?? 10);

        if (isActive === false || currentDay >= maxDays) {
          finalizeFreeAgencyComplete(workingLeague, latest);
          localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/viewing-offers");
          navigate("/viewing-offers");
          return;
        }

        const res = await advanceFreeAgencyDay(
          workingLeague,
          selectedTeam.name
        );

        if (!res?.ok || !res?.leagueData) {
          if (res?.leagueData) {
            applyLeagueUpdate(res.leagueData);
          }
          setActionError(res?.reason || "Failed to dev sim to the end of free agency.");
          return;
        }

        workingLeague = res.leagueData;
        latest = {
          dayResolved: res?.dayResolved ?? res?.stateSummary?.currentDay ?? null,
          signings: res?.signings || [],
          generatedOffers: res?.generatedOffers || [],
          stateSummary: res?.stateSummary || null,
        };

        applyLeagueUpdateWithLatestResults(workingLeague, latest);

        if (!res?.stateSummary?.isActive) {
          finalizeFreeAgencyComplete(workingLeague, latest);
          localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/viewing-offers");
          navigate("/viewing-offers");
          return;
        }
      }

      applyLeagueUpdateWithLatestResults(workingLeague, latest);
      localStorage.setItem(FREE_AGENCY_LAST_ROUTE_KEY, "/viewing-offers");
      setActionError("Dev sim stopped after the safety limit. The latest safe market state was saved.");
      navigate("/viewing-offers");
    } catch (err) {
      setActionError(err?.message || "Failed to dev sim to the end of free agency.");
    } finally {
      setProcessingDevSimToEnd(false);
    }
  };

return (
  <div className={`${styles.viewingOffersPage} min-h-screen text-white px-6 py-8`}>
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
        <div className="mb-8">
          <h1 className="text-4xl font-extrabold text-orange-500 mb-2">
            Viewing Offers
          </h1>
          <p className="text-gray-400 text-base">
            Review the latest free agency activity before moving on.
          </p>
        </div>

        {shouldShowEmptyResults ? (
          <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 shadow-lg">
            <p className="text-lg text-gray-300">
              No daily results available yet.
            </p>

            <div className="mt-6 flex gap-3 flex-wrap">
              <button
                onClick={handleReturnToOffseasonHub}
                className="px-5 py-3 bg-neutral-700 hover:bg-neutral-600 rounded-lg font-semibold transition"
              >
                Back to Offseason Hub
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 mb-6 shadow-lg">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                  <div className="text-sm text-gray-400 mb-1">
                    Free Agency Daily Results
                  </div>
                  <div className="text-2xl font-bold text-white">
                    {dayResolved ? `Day ${dayResolved} Complete` : "Opening Market Results"}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full lg:w-auto">
                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Signings</div>
                    <div className="text-base font-semibold text-white">
                      {signings.length}
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">New CPU Offers</div>
                    <div className="text-base font-semibold text-white">
                      {generatedOffers.length}
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Free Agents Left</div>
                    <div className="text-base font-semibold text-white">
                      {stateSummary?.freeAgentCount ?? "-"}
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Pending User Decisions</div>
                    <div className="text-base font-semibold text-white">
                      {stateSummary?.pendingUserDecisionCount ?? 0}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {showFullFreeAgencySummary && (
              <div className="bg-neutral-800 border border-orange-500/30 rounded-2xl p-6 mb-6 shadow-lg">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                  <div>
                    <div className="text-lg font-semibold text-orange-400">
                      Full Free Agency Summary
                    </div>
                    <div className="text-sm text-gray-400 mt-1">
                      Copy-friendly recap of every saved signing and CPU offer from the full market.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={copyFullFreeAgencySummary}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-bold transition"
                  >
                    {fullSummaryCopied ? "Copied" : "Copy All"}
                  </button>
                </div>

                <pre className="bm-orange-scroll max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-xl border border-neutral-700 bg-neutral-950/90 p-4 text-sm leading-6 text-gray-200 select-text">
                  {fullFreeAgencySummaryText}
                </pre>
              </div>
            )}


            {userOfferActivity.length > 0 && (
              <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 mb-6 shadow-lg">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <div className="text-lg font-semibold text-orange-400">
                      Your Offer Tracker
                    </div>
                    <div className="text-sm text-gray-400 mt-1">
                      Live status for players you submitted offers to.
                    </div>
                  </div>
                  <div className="text-sm text-gray-400">
                    {userOfferActivity.length} tracked
                  </div>
                </div>

                <div className="bm-orange-scroll max-h-[280px] overflow-y-auto pr-2 space-y-3">
                  {userOfferActivity.map((row) => (
                    <div
                      key={row.id}
                      className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
                    >
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div>
                          <div className="text-white font-semibold">
                            <PlayerNameButton onClick={() => openPlayerCardFromRow(row, row.signedWith || selectedTeam?.name || "Free Agent")}>
                              {row.playerName}
                            </PlayerNameButton>
                          </div>
                          <div className="text-sm text-gray-400 mt-1">
                            {row.detail}
                          </div>
                          <div className="text-sm text-gray-500 mt-2 space-y-1">
                            {row.status === "active" || row.status === "pending_user_decision" ? (
                              <div>
                                Your offer: {formatContractLine(row.contract, row.totalValue, row.years)}
                                {row.day ? ` • Day ${row.day}` : ""}
                              </div>
                            ) : (
                              <>
                                <div>
                                  Signed with: <span className="text-gray-300 font-semibold">{getSignedWithDisplay(row.signedWith, selectedTeam?.name)}</span>
                                </div>
                                <div>
                                  Signed contract: {formatContractLine(row.signedContract || row.contract, row.signedTotalValue || row.totalValue, row.signedYears || row.years)}
                                </div>
                                <div>
                                  Your offer: {formatContractLine(row.userOfferContract || row.contract, row.userOfferTotalValue || row.totalValue, row.userOfferYears || row.years)}
                                  {row.day ? ` • Day ${row.day}` : ""}
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 md:justify-end">
                          <InfoChip tone="orange" onClick={() => openUserOfferInfo(row, "Full Transaction Context", "full")}>Click For Context</InfoChip>
                          <ContractOptionChip source={row} />
                          <InfoChip
                            tone={getOfferStatusTone(row.status)}
                            onClick={() => openUserOfferInfo(row, getOfferStatusLabel(row.status, row.signedWith, selectedTeam?.name), "cba")}
                          >
                            {getOfferStatusLabel(row.status, row.signedWith, selectedTeam?.name)}
                          </InfoChip>
                          {row.signedWith && row.signedWith !== selectedTeam?.name && (
                            <InfoChip tone="orange" onClick={() => openUserOfferInfo(row, `Signed With ${row.signedWith}`, "direction")}>Signed With {row.signedWith}</InfoChip>
                          )}
                          {row.signedWith && row.signedWith === selectedTeam?.name && (
                            <InfoChip tone="green" onClick={() => openUserOfferInfo(row, "Signed With You", "direction")}>Signed With You</InfoChip>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}


            {pendingRfaMatchDecisions.length > 0 && (
              <div className="bg-neutral-800 border border-orange-500/40 rounded-2xl p-6 mb-6 shadow-lg">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <div className="text-lg font-semibold text-orange-400">
                      Restricted Free Agent Match Decisions
                    </div>
                    <div className="text-sm text-gray-400 mt-1">
                      Another team signed one of your restricted free agents to an offer sheet. Match it or let him leave.
                    </div>
                  </div>
                  <div className="text-sm text-gray-400">
                    {pendingRfaMatchDecisions.length} pending
                  </div>
                </div>

                <div className="space-y-3">
                  {pendingRfaMatchDecisions.map((row) => {
                    const contractSummary = getContractSummary(
                      row?.contract || row?.offerSheet?.contract,
                      row?.totalValue,
                      row?.years
                    );

                    return (
                      <div
                        key={row.playerKey}
                        className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-4"
                      >
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                          <div className="flex items-center gap-4 min-w-0">
                            <div className="w-16 h-16 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 shrink-0 flex items-center justify-center">
                              {row?.player?.headshot ? (
                                <img
                                  src={row.player.headshot}
                                  alt={row?.player?.name || row?.playerName || "Player"}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="text-xs text-gray-400">No Image</div>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="text-white font-semibold text-2xl leading-tight">
                                <PlayerNameButton onClick={() => openPlayerCardFromRow(row, row?.rightsTeamName || selectedTeam?.name || "Free Agent")} className="text-2xl">
                                  {row?.player?.name || row?.playerName || "Unknown Player"}
                                </PlayerNameButton>
                              </div>

                              <div className="text-sm text-gray-400 mt-1">
                                Rights Team: <span className="text-orange-200 font-semibold">{row?.rightsTeamName || selectedTeam?.name}</span>
                                {row?.offeringTeamName ? ` • Offer Sheet From: ${row.offeringTeamName}` : ""}
                              </div>

                              <div className="text-base text-gray-300 mt-2">
                                {formatContractLine(row?.contract || row?.offerSheet?.contract, row?.totalValue, row?.years)}
                              </div>

                              <div className="text-sm text-gray-500 mt-1">
                                Current year cap hit: {formatDollars(contractSummary.currentYearSalary || row?.currentYearSalary || 0)}
                              </div>

                              <div className="flex flex-wrap gap-2 mt-3">
                                <InfoChip tone="orange" onClick={() => openSigningInfo(row, "Full Transaction Context", "full")}>Click For Context</InfoChip>
                                <ContractOptionChip source={row} />
                                <InfoChip tone="orange" onClick={() => openSigningInfo(row, "RFA Offer Sheet", "cba")}>RFA Offer Sheet</InfoChip>
                                {row?.deadlineDay && <InfoChip onClick={() => openSigningInfo(row, `Deadline Day ${row.deadlineDay}`, "cba")}>Deadline Day {row.deadlineDay}</InfoChip>}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 lg:justify-end shrink-0">
                            <button
                              onClick={() => handleRfaMatchDecision(row, "match")}
                              disabled={processingBack}
                              className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold transition"
                            >
                              Match Offer
                            </button>
                            <button
                              onClick={() => handleRfaMatchDecision(row, "decline")}
                              disabled={processingBack}
                              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold transition"
                            >
                              Decline Match
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 mb-6 shadow-lg">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div className="text-lg font-semibold text-orange-400">
                  Your Pending Signings
                </div>
                <div className="text-sm text-gray-400">
                  {selectedTeam?.name || "No Team Selected"}
                </div>
              </div>

              {pendingUserDecisions.length > 0 && (
                <div className="mb-4 rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-100">
                  Select the pending players you want to finalize. Pressing Sign Selected / Decline Rest signs checked players, declines unchecked players, and returns you to Free Agency for the next day. Returning to the Offseason Hub only saves the current state.
                </div>
              )}

              {livePendingUserTeamSnapshot?.ok && (
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Payroll</div>
                    <div className="text-base font-semibold text-white">
                      {formatDollars(selectionPreview?.payrollAfter ?? livePendingUserTeamSnapshot?.payroll ?? 0)}
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Cap Space</div>
                    <div className={`text-base font-semibold ${(selectionPreview?.capRoomAfter ?? livePendingUserTeamSnapshot?.capRoom ?? 0) < 0 ? "text-red-300" : "text-white"}`}>
                      {formatDollars(selectionPreview?.capRoomAfter ?? livePendingUserTeamSnapshot?.capRoom ?? 0)}
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Practical Cap</div>
                    <div className={`text-base font-semibold ${(selectionPreview?.practicalCapRoomAfter ?? livePendingUserTeamSnapshot?.practicalCapRoom ?? 0) < 0 ? "text-red-300" : "text-white"}`}>
                      {formatDollars(selectionPreview?.practicalCapRoomAfter ?? livePendingUserTeamSnapshot?.practicalCapRoom ?? 0)}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">incl. holds</div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Hard Cap Room</div>
                    <div className={`text-base font-semibold ${
                      selectionPreview?.hardCapRoomAfter !== null &&
                      selectionPreview?.hardCapRoomAfter !== undefined &&
                      selectionPreview?.hardCapRoomAfter < 0
                        ? "text-red-300"
                        : "text-white"
                    }`}>
                      {selectionPreview?.hardCapRoomAfter === null ||
                      selectionPreview?.hardCapRoomAfter === undefined
                        ? "Not Hard Capped"
                        : formatDollars(selectionPreview.hardCapRoomAfter)}
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Roster</div>
                    <div className={`text-base font-semibold ${(selectionPreview?.rosterAfter ?? livePendingUserTeamSnapshot?.rosterCount ?? 0) > (selectionPreview?.rosterLimit ?? livePendingUserTeamSnapshot?.rosterLimit ?? 15) ? "text-red-300" : "text-white"}`}>
                      {(selectionPreview?.rosterAfter ?? livePendingUserTeamSnapshot?.rosterCount ?? 0)} / {(selectionPreview?.rosterLimit ?? livePendingUserTeamSnapshot?.rosterLimit ?? 15)}
                    </div>
                  </div>

                  <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                    <div className="text-xs text-gray-400 mb-1">Selected This Screen</div>
                    <div className="text-base font-semibold text-white">
                      {selectedPendingRows.length}
                    </div>
                  </div>
                </div>
              )}

              {selectionPreview?.warnings?.length > 0 && (
                <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                  <div className="text-sm font-semibold text-red-200">
                    {selectionPreview.warnings.join(" ")}
                  </div>
                </div>
              )}

              {(selectedPendingRows.length > 0 || pendingRfaMatchDecisions.length > 0) && capHoldRenounceRows.length > 0 && (
                <div className="mb-4 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3">
                    <div>
                      <div className="text-base font-bold text-yellow-200">
                        Cap Hold Clearance
                      </div>
                      <div className="text-sm text-yellow-100/90 mt-1">
                        You can renounce your own free-agent rights here before confirming the selected signing. Renouncing clears the hold, but you lose that player's Bird/RFA control.
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm shrink-0">
                      <div className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2">
                        <div className="text-xs text-gray-400 mb-1">Short By</div>
                        <div className={`font-bold ${(selectionPreview?.capRoomShortfall || 0) > 0 ? "text-red-300" : "text-emerald-300"}`}>
                          {formatDollars(selectionPreview?.capRoomShortfall || 0)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2">
                        <div className="text-xs text-gray-400 mb-1">Selected Clear</div>
                        <div className="font-bold text-emerald-300">
                          {formatDollars(selectionPreview?.selectedCapHoldClearance || 0)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bm-orange-scroll max-h-[240px] overflow-y-auto pr-2 space-y-2">
                    {capHoldRenounceRows.map((row) => {
                      const isRenounced = Boolean(selectedRightsRenounceMap[row.playerKey]);

                      return (
                        <div
                          key={row.playerKey}
                          className={`flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-xl border px-3 py-3 ${
                            isRenounced
                              ? "border-red-500/40 bg-red-500/10"
                              : "border-neutral-700 bg-neutral-900"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-white font-semibold">
                              <PlayerNameButton onClick={() => openPlayerCardFromRow(row.player, selectedTeam?.name || "Free Agent")}>
                                {row.playerName}
                              </PlayerNameButton>
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              {row.position} {row.age ? `• Age ${row.age}` : ""} {row.overall ? `• OVR ${row.overall}` : ""}
                            </div>
                            <div className="flex flex-wrap gap-2 mt-2">
                              <InfoChip tone="orange">{formatBirdLevel(row.birdLevel)}</InfoChip>
                              {row.restrictedFreeAgent && <InfoChip tone="green">RFA</InfoChip>}
                              <InfoChip tone="red">Hold {formatDollars(row.capHold)}</InfoChip>
                              {row.marketValue?.expectedYear1Salary && (
                                <InfoChip>Market {formatDollars(row.marketValue.expectedYear1Salary)}</InfoChip>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleRightsRenounce(row.playerKey)}
                            className={`px-4 py-2 rounded-lg font-bold transition ${
                              isRenounced
                                ? "bg-red-600 hover:bg-red-500 text-white"
                                : "bg-neutral-700 hover:bg-neutral-600 text-white"
                            }`}
                          >
                            {isRenounced ? "Undo Renounce" : "Renounce Rights"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {actionError && (
                <div className="mb-4 text-sm font-semibold text-red-300">
                  {actionError}
                </div>
              )}

              {!pendingUserDecisions.length ? (
                <p className="text-gray-400">No user signings are waiting for your decision right now.</p>
              ) : (
                <div className="space-y-3">
                  {pendingUserDecisions.map((row) => {
                    const isSelected = Boolean(selectedDecisionMap[row.playerKey]);
                    const contractSummary = getContractSummary(
                      row?.contract,
                      row?.totalValue,
                      row?.years
                    );

                    return (
                      <div
                        key={row.playerKey}
                        className={`border rounded-xl px-4 py-4 transition ${
                          isSelected
                            ? "bg-green-500/10 border-green-500/40"
                            : "bg-neutral-900 border-neutral-700"
                        }`}
                      >
<div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
  <div className="flex items-center gap-4 min-w-0">
    <button
      onClick={() => toggleDecision(row.playerKey)}
      className={`w-8 h-8 rounded-md border-2 flex items-center justify-center font-bold transition shrink-0 ${
        isSelected
          ? "bg-green-500 border-green-300 text-white"
          : "bg-neutral-800 border-neutral-600 text-neutral-300"
      }`}
      title={isSelected ? "Selected" : "Select this signing"}
    >
      {isSelected ? "✓" : ""}
    </button>

    <div className="w-16 h-16 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 shrink-0 flex items-center justify-center">
      {row?.player?.headshot ? (
        <img
          src={row.player.headshot}
          alt={row?.player?.name || row?.playerName || "Player"}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="text-xs text-gray-400">No Image</div>
      )}
    </div>

    <div className="relative w-20 h-20 shrink-0 hidden sm:flex items-center justify-center">
      {(() => {
        const ring = getOvrRingMetrics(row?.player?.overall);
        const gradientId = `pending-ovr-${row.playerKey}`;

        return (
          <>
            <svg width="80" height="80" viewBox="0 0 60 60">
              <defs>
                <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#FFA500" />
                  <stop offset="100%" stopColor="#FFD54F" />
                </linearGradient>
              </defs>

              <circle
                cx="30"
                cy="30"
                r={ring.radius}
                stroke="rgba(255,255,255,0.10)"
                strokeWidth="5"
                fill="none"
              />

              <circle
                cx="30"
                cy="30"
                r={ring.radius}
                stroke={`url(#${gradientId})`}
                strokeWidth="5"
                strokeLinecap="round"
                fill="none"
                strokeDasharray={ring.circumference}
                strokeDashoffset={ring.strokeOffset}
                transform="rotate(-90 30 30)"
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <div className="text-[10px] text-gray-400 leading-none mb-1">OVR</div>
              <div className="text-2xl font-extrabold text-orange-400 leading-none">
                {row?.player?.overall ?? "-"}
              </div>
            </div>
          </>
        );
      })()}
    </div>

    <div className="min-w-0 flex-1">
      <div className="text-white font-semibold text-2xl leading-tight">
        <PlayerNameButton onClick={() => openPlayerCardFromRow(row, selectedTeam?.name || "Free Agent")} className="text-2xl">
          {row?.player?.name || row?.playerName || "Unknown Player"}
        </PlayerNameButton>
      </div>

      <div className="text-sm text-gray-400 mt-1">
        {row?.player?.position || "-"}
        {row?.player?.age ? ` • Age ${row.player.age}` : ""}
      </div>

      <div className="text-base text-gray-300 mt-2">
        {formatContractLine(row?.contract, row?.totalValue, row?.years)}
      </div>

      <div className="text-sm text-gray-500 mt-1">
        Current year cap hit: {formatDollars(contractSummary.currentYearSalary || row?.currentYearSalary || 0)}
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <InfoChip tone="orange" onClick={() => openSigningInfo(row, "Full Transaction Context", "full")}>Click For Context</InfoChip>
                                <ContractOptionChip source={row} />
        {row?.spendingType && <InfoChip tone={row.spendingType === "bird_rights" ? "orange" : "green"} onClick={() => openSigningInfo(row, formatToolLabel(row.spendingType), "cba")}>{formatToolLabel(row.spendingType)}</InfoChip>}
        {row?.exceptionType && <InfoChip tone="green" onClick={() => openSigningInfo(row, formatToolLabel(row.exceptionType), "cba")}>{formatToolLabel(row.exceptionType)}</InfoChip>}
        {row?.payrollZone && <InfoChip onClick={() => openSigningInfo(row, formatToolLabel(row.payrollZone), "cba")}>{formatToolLabel(row.payrollZone)}</InfoChip>}
        {row?.chosenOffer?.rfaMatched && <InfoChip tone="orange" onClick={() => openSigningInfo(row, "RFA Match", "cba")}>RFA Match</InfoChip>}
      </div>
    </div>
  </div>

  <div className="text-sm text-gray-400 shrink-0">
    {isSelected ? "Selected to sign" : "Waiting"}
  </div>
</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
              {!hideLeagueEvents && (
                <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 shadow-lg">
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div className="text-lg font-semibold text-orange-400">
                      League Events
                    </div>

                    <button
                      onClick={() => setHideLeagueEvents(true)}
                      className="px-3 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm font-semibold transition"
                    >
                      Hide League Events
                    </button>
                  </div>

                  {!signings.length ? (
                    <p className="text-gray-400">No signings recorded.</p>
                  ) : (
<div className="bm-orange-scroll max-h-[540px] overflow-y-auto pr-2 space-y-3">
  {signings.map((signing, idx) => {
                        const logo = getTeamLogo(signing?.signedWith);

                        return (
                          <div
                            key={`${signing.playerName || "player"}-${idx}`}
                            className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
                          >
                            <div className="flex items-start gap-3">
                              {logo ? (
                                <img
                                  src={logo}
                                  alt={signing?.signedWith || "Team logo"}
                                  className="w-10 h-10 object-contain mt-1"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-neutral-700 mt-1" />
                              )}

                              <div className="min-w-0 flex-1">
                                <div className="text-white font-semibold">
                                  <PlayerNameButton onClick={() => openPlayerCardFromRow(signing, signing?.signedWith || "Free Agent")}>
                                    {signing.playerName || "Unknown Player"}
                                  </PlayerNameButton>
                                </div>
                                <div className="text-sm text-gray-400 mt-1">
                                  Signed with {signing.signedWith || "Unknown Team"}
                                </div>
                                <div className="text-sm text-gray-500 mt-2">
                                  {formatContractLine(signing?.contract)}
                                </div>
                                <div className="flex flex-wrap gap-2 mt-2">
                                  <InfoChip tone="orange" onClick={() => openSigningInfo(signing, "Full Transaction Context", "full")}>Click For Context</InfoChip>
                                  <ContractOptionChip source={signing} />
                                  {signing?.spendingType && <InfoChip tone={signing.spendingType === "bird_rights" ? "orange" : "green"} onClick={() => openSigningInfo(signing, formatToolLabel(signing.spendingType), "cba")}>{formatToolLabel(signing.spendingType)}</InfoChip>}
                                  {signing?.exceptionType && <InfoChip tone="green" onClick={() => openSigningInfo(signing, formatToolLabel(signing.exceptionType), "cba")}>{formatToolLabel(signing.exceptionType)}</InfoChip>}
                                  {signing?.exceptionUsage?.amountUsed > 0 && <InfoChip tone="orange" onClick={() => openSigningInfo(signing, `Used ${formatDollars(signing.exceptionUsage.amountUsed)}`, "cba")}>Used {formatDollars(signing.exceptionUsage.amountUsed)}</InfoChip>}
                                  {signing?.rfaMatched && <InfoChip tone="orange" onClick={() => openSigningInfo(signing, "RFA Matched", "cba")}>RFA Matched</InfoChip>}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {!hideCpuOffers && (
                <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 shadow-lg">
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div className="text-lg font-semibold text-orange-400">
                      New CPU Offers
                    </div>

                    <button
                      onClick={() => setHideCpuOffers(true)}
                      className="px-3 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm font-semibold transition"
                    >
                      Hide New CPU Offers
                    </button>
                  </div>

                  {!generatedOffers.length ? (
                    <p className="text-gray-400">No new CPU offers were generated.</p>
                  ) : (
<div className="bm-orange-scroll max-h-[540px] overflow-y-auto pr-2 space-y-3">
  {generatedOffers.map((offer, idx) => {
                        const logo = getTeamLogo(offer?.teamName);

                        return (
                          <div
                            key={`${offer.playerName || "player"}-${offer.teamName || "team"}-${idx}`}
                            className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3"
                          >
                            <div className="flex items-start gap-3">
                              {logo ? (
                                <img
                                  src={logo}
                                  alt={offer?.teamName || "Team logo"}
                                  className="w-10 h-10 object-contain mt-1"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-neutral-700 mt-1" />
                              )}

                              <div className="min-w-0 flex-1">
                                <div className="text-white font-semibold">
                                  {offer.teamName || "Unknown Team"}
                                </div>
                                <div className="text-sm text-gray-400 mt-1">
                                  Offered{" "}
                                  <PlayerNameButton onClick={() => openPlayerCardFromRow(offer, "Free Agent")} className="text-sm text-gray-200">
                                    {offer.playerName || "Unknown Player"}
                                  </PlayerNameButton>
                                </div>
                                <div className="text-sm text-gray-500 mt-2">
                                  {formatContractLine(offer?.contract, offer?.totalValue, offer?.years)}
                                </div>
                                <div className="flex flex-wrap gap-2 mt-2">
                                  <InfoChip tone="orange" onClick={() => openOfferInfo(offer, "Full Transaction Context", "full")}>Click For Context</InfoChip>
                                  <ContractOptionChip source={offer} />
                                  {offer?.spendingType && <InfoChip tone={offer.spendingType === "bird_rights" ? "orange" : "green"} onClick={() => openOfferInfo(offer, formatToolLabel(offer.spendingType), "cba")}>{formatToolLabel(offer.spendingType)}</InfoChip>}
                                  {offer?.exceptionType && <InfoChip tone="green" onClick={() => openOfferInfo(offer, formatToolLabel(offer.exceptionType), "cba")}>{formatToolLabel(offer.exceptionType)}</InfoChip>}
                                  {offer?.rosterNeed?.position && <InfoChip tone="orange" onClick={() => openOfferInfo(offer, `Need ${formatPositionChipLabel(offer.rosterNeed.position)}`, "need")}>Need {formatPositionChipLabel(offer.rosterNeed.position)} {formatNeedScore(offer.rosterNeed.needScore)}</InfoChip>}
                                  {offer?.teamDirection && <InfoChip onClick={() => openOfferInfo(offer, formatToolLabel(offer.teamDirection), "direction")}>{formatToolLabel(offer.teamDirection)}</InfoChip>}
                                  {offer?.payrollZone && <InfoChip onClick={() => openOfferInfo(offer, formatToolLabel(offer.payrollZone), "cba")}>{formatToolLabel(offer.payrollZone)}</InfoChip>}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {!hideRightsRenounced && (
                <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 shadow-lg xl:col-span-2">
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <div className="text-lg font-semibold text-orange-400">
                        Rights Renounced
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Shows teams that cleared their own cap holds during this free-agency day or earlier saved market activity.
                      </div>
                    </div>

                    <button
                      onClick={() => setHideRightsRenounced(true)}
                      className="px-3 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm font-semibold transition"
                    >
                      Hide Rights Renounced
                    </button>
                  </div>

                  {!rightsRenounceRows.length ? (
                    <p className="text-gray-400">No teams renounced rights in the available market log.</p>
                  ) : (
                    <div className="bm-orange-scroll max-h-[300px] overflow-y-auto pr-2 space-y-3">
                      {rightsRenounceRows.map((row, idx) => {
                        const logo = getTeamLogo(row?.teamName);

                        return (
                          <div
                            key={`${row.teamName || "team"}-${row.playerName || "player"}-${idx}`}
                            className="bg-neutral-900 border border-red-500/25 rounded-xl px-4 py-3"
                          >
                            <div className="flex items-start gap-3">
                              {logo ? (
                                <img
                                  src={logo}
                                  alt={row?.teamName || "Team logo"}
                                  className="w-9 h-9 object-contain mt-1"
                                />
                              ) : (
                                <div className="w-9 h-9 rounded-full bg-neutral-700 mt-1" />
                              )}

                              <div className="min-w-0 flex-1">
                                <div className="text-white font-semibold">
                                  {row.teamName || "Unknown Team"}
                                </div>
                                <div className="text-sm text-gray-300 mt-1">
                                  Renounced rights on {row.playerName || "Unknown Player"}
                                </div>
                                <div className="flex flex-wrap gap-2 mt-2">
                                  <InfoChip tone="orange" onClick={() => openRightsRenouncedInfo(row)}>Click For Context</InfoChip>
                                  <InfoChip tone="red">{formatDollars(row.capHoldCleared || 0)} cleared</InfoChip>
                                  {row.day !== null && row.day !== undefined && <InfoChip>Day {row.day}</InfoChip>}
                                  {row.source && <InfoChip>{row.source}</InfoChip>}
                                  {(row.targetPlayerName || row.triggerPlayerName) && <InfoChip tone="orange">For {row.targetPlayerName || row.triggerPlayerName}</InfoChip>}
                                  {row.teamDirection && <InfoChip onClick={() => openRightsRenouncedInfo(row)}>{formatToolLabel(row.teamDirection)}</InfoChip>}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {(hideLeagueEvents || hideCpuOffers || hideRightsRenounced) && (
                <div className="xl:col-span-2 flex gap-3 flex-wrap">
                  {hideLeagueEvents && (
                    <button
                      onClick={() => setHideLeagueEvents(false)}
                      className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm font-semibold transition"
                    >
                      Show League Events
                    </button>
                  )}

                  {hideCpuOffers && (
                    <button
                      onClick={() => setHideCpuOffers(false)}
                      className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm font-semibold transition"
                    >
                      Show New CPU Offers
                    </button>
                  )}

                  {hideRightsRenounced && (
                    <button
                      onClick={() => setHideRightsRenounced(false)}
                      className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm font-semibold transition"
                    >
                      Show Rights Renounced
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 mb-6 shadow-lg">
              <div className="text-lg font-semibold text-orange-400 mb-4">
                Market Status
              </div>

              <div className="text-sm text-gray-300 space-y-2">
                <div>
                  Current Day:{" "}
                  <span className="text-white font-semibold">
                    {stateSummary?.currentDay ?? "-"}
                  </span>
                </div>
                <div>
                  Max Days:{" "}
                  <span className="text-white font-semibold">
                    {stateSummary?.maxDays ?? "-"}
                  </span>
                </div>
                <div>
                  Market Active:{" "}
                  <span className="text-white font-semibold">
                    {stateSummary?.isActive ? "Yes" : "No"}
                  </span>
                </div>
                <div>
                  Total Signed So Far:{" "}
                  <span className="text-white font-semibold">
                    {stateSummary?.signedCount ?? "-"}
                  </span>
                </div>
              </div>
            </div>

<div className="flex gap-3 flex-wrap">
  <button
    onClick={handleAdvanceFromResults}
    disabled={processingBack || processingAdvance || processingDevAdvance || processingDevSimToEnd || pendingRfaMatchDecisions.length > 0}
    className="px-6 py-3 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition"
  >
    {processingAdvance
      ? "Processing..."
      : pendingRfaMatchDecisions.length > 0
      ? "Resolve RFA Decisions First"
      : marketClosed
      ? "Continue to Progression"
      : pendingUserDecisions.length > 0
      ? "Sign Selected / Decline Rest"
      : "Continue to Free Agency"}
  </button>

  <button
    onClick={handleDevAdvanceDayFromViewingOffers}
    disabled={processingBack || processingAdvance || processingDevAdvance || processingDevSimToEnd || marketClosed || pendingRfaMatchDecisions.length > 0}
    className="px-6 py-3 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition shadow-lg shadow-purple-950/30"
    title="Developer shortcut: process selected pending signings, decline the rest, then advance the free-agency day without leaving this screen."
  >
    {processingDevAdvance ? "Dev Advancing..." : "DEV: Advance Day"}
  </button>

  <button
    onClick={handleDevSimToEndFreeAgency}
    disabled={processingBack || processingAdvance || processingDevAdvance || processingDevSimToEnd || marketClosed || pendingRfaMatchDecisions.length > 0}
    className="px-6 py-3 bg-purple-800 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition shadow-lg shadow-purple-950/30"
    title="Developer shortcut: keep advancing free agency until the market closes. Future user pending signings are declined automatically; RFA match decisions still stop for manual review."
  >
    {processingDevSimToEnd
      ? "Dev Simming..."
      : pendingRfaMatchDecisions.length > 0
      ? "Resolve RFA Decisions First"
      : "DEV: Sim to End FA"}
  </button>

<button
  onClick={handleReturnToOffseasonHub}
  disabled={processingBack || processingAdvance || processingDevAdvance || processingDevSimToEnd}
  className="px-6 py-3 bg-neutral-700 hover:bg-neutral-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition"
>
  Back to Offseason Hub
</button>
</div>
          </>
        )}
      </div>
      {offerStatusPopupOpen && offerPopupRows.length > 0 && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70] px-4 py-6">
          <div className="w-full max-w-2xl bg-neutral-800 rounded-2xl border border-orange-500/40 shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-2xl font-extrabold text-orange-400">
                  Offer Update
                </h2>
                <p className="text-sm text-gray-400 mt-1">
                  One or more players you offered have made a decision.
                </p>
              </div>
              <button
                onClick={dismissOfferStatusPopup}
                className="px-3 py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white font-semibold transition"
              >
                Close
              </button>
            </div>

            <div className="bm-orange-scroll max-h-[360px] overflow-y-auto pr-2 space-y-3">
              {offerPopupRows.map((row) => (
                <div
                  key={row.id}
                  className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-4"
                >
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <div className="text-white text-lg font-bold">
                        <PlayerNameButton onClick={() => openPlayerCardFromRow(row, row.signedWith || selectedTeam?.name || "Free Agent")} className="text-lg">
                          {row.playerName}
                        </PlayerNameButton>
                      </div>
                      <div className="text-sm text-gray-300 mt-1">
                        {row.detail}
                      </div>
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                        <div className="bg-neutral-800/80 border border-neutral-700 rounded-lg px-3 py-2">
                          <div className="text-xs text-gray-500 mb-1">Signed With</div>
                          <div className="text-gray-100 font-semibold">
                            {getSignedWithDisplay(row.signedWith, selectedTeam?.name)}
                          </div>
                        </div>
                        <div className="bg-neutral-800/80 border border-neutral-700 rounded-lg px-3 py-2">
                          <div className="text-xs text-gray-500 mb-1">Signed Contract</div>
                          <div className="text-gray-100 font-semibold">
                            {formatContractLine(row.signedContract || row.contract, row.signedTotalValue || row.totalValue, row.signedYears || row.years)}
                          </div>
                        </div>
                        <div className="bg-neutral-800/80 border border-neutral-700 rounded-lg px-3 py-2">
                          <div className="text-xs text-gray-500 mb-1">Your Offer</div>
                          <div className="text-gray-100 font-semibold">
                            {formatContractLine(row.userOfferContract || row.contract, row.userOfferTotalValue || row.totalValue, row.userOfferYears || row.years)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 md:justify-end">
                      <InfoChip tone="orange" onClick={() => openUserOfferInfo(row, "Full Transaction Context", "full")}>Click For Context</InfoChip>
                          <ContractOptionChip source={row} />
                      <InfoChip
                        tone={getOfferStatusTone(row.status)}
                        onClick={() => openUserOfferInfo(row, getOfferStatusLabel(row.status, row.signedWith, selectedTeam?.name), "cba")}
                      >
                        {getOfferStatusLabel(row.status, row.signedWith, selectedTeam?.name)}
                      </InfoChip>
                      {row.signedWith && row.signedWith !== selectedTeam?.name && <InfoChip tone="orange" onClick={() => openUserOfferInfo(row, `Signed With ${row.signedWith}`, "direction")}>Signed With {row.signedWith}</InfoChip>}
                      {row.signedWith && row.signedWith === selectedTeam?.name && <InfoChip tone="green" onClick={() => openUserOfferInfo(row, "Signed With You", "direction")}>Signed With You</InfoChip>}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end mt-5">
              <button
                onClick={dismissOfferStatusPopup}
                className="px-5 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-bold transition"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}

      {infoPopup && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[80] px-4 py-6">
          <div className="w-full max-w-2xl bg-neutral-800 rounded-2xl border border-orange-500/40 shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.22em] text-orange-300 mb-2">
                  Transaction Context
                </div>
                <h2 className="text-2xl font-extrabold text-white">
                  {infoPopup.title}
                </h2>
                {infoPopup.subtitle && (
                  <p className="text-sm text-gray-400 mt-1">{infoPopup.subtitle}</p>
                )}
              </div>
              <button
                onClick={() => setInfoPopup(null)}
                className="px-3 py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white font-semibold transition"
              >
                Close
              </button>
            </div>

            <div className="bm-orange-scroll max-h-[430px] overflow-y-auto pr-2 space-y-3">
              {(infoPopup.teamSide || infoPopup.playerSide) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {infoPopup.teamSide && (
                    <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-[0.16em] text-orange-300 mb-1">
                        {infoPopup.teamSide.title || "Team Side"}
                      </div>
                      <div className="text-sm leading-relaxed text-gray-100 whitespace-pre-line">
                        “{infoPopup.teamSide.summary}”
                      </div>
                      {!!infoPopup.teamSide.bullets?.length && (
                        <div className="mt-3 space-y-1">
                          {infoPopup.teamSide.bullets.map((bullet, idx) => (
                            <div key={`team-side-${idx}`} className="text-xs leading-relaxed text-gray-300">
                              • {bullet}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {infoPopup.playerSide && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300 mb-1">
                        {infoPopup.playerSide.title || "Player Side"}
                      </div>
                      <div className="text-sm leading-relaxed text-gray-100 whitespace-pre-line">
                        “{infoPopup.playerSide.summary}”
                      </div>
                      {!!infoPopup.playerSide.bullets?.length && (
                        <div className="mt-3 space-y-1">
                          {infoPopup.playerSide.bullets.map((bullet, idx) => (
                            <div key={`player-side-${idx}`} className="text-xs leading-relaxed text-gray-300">
                              • {bullet}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!!infoPopup.otherOffers?.length && (
                <div className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-orange-300 mb-2">
                    Real competing offers
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {infoPopup.otherOffers.map((offer, idx) => (
                      <div key={`${offer.teamName}-${idx}`} className="bg-neutral-800/80 border border-neutral-700 rounded-lg px-3 py-2">
                        <div className="text-[11px] text-gray-500 uppercase tracking-wide">
                          Option {idx + 2}
                        </div>
                        <div className="text-sm text-white font-bold">
                          {offer.displayTeamName || withTeamArticle(offer.teamName)}
                        </div>
                        <div className="text-xs text-gray-300 mt-0.5">
                          {offer.line || "Terms unavailable"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(infoPopup.sections || []).map((section, idx) => (
                <div key={`${section.label}-${idx}`} className="bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3">
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-orange-300 mb-1">
                    {section.label}
                  </div>
                  <div className="text-sm leading-relaxed text-gray-200">
                    {section.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 mt-5">
              {infoPopup.playerSource && (
                <button
                  onClick={() => openPlayerCardFromRow(infoPopup.playerSource, infoPopup.playerSource?.teamName || infoPopup.playerSource?.signedWith || "Free Agent")}
                  className="px-5 py-2.5 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white font-bold transition"
                >
                  Open Player Card
                </button>
              )}
              <button
                onClick={() => setInfoPopup(null)}
                className="px-5 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-bold transition"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}

      <PlayerCardModal
        open={!!playerCardView?.player}
        player={playerCardView?.player}
        teamName={playerCardView?.teamName || "Free Agent"}
        teamLogo={playerCardView?.teamLogo || ""}
        leagueData={leagueData}
        onClose={() => setPlayerCardView(null)}
      />

    </div>
  );
}