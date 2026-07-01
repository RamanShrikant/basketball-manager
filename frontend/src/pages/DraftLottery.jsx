import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import LZString from "lz-string";
import { useGame } from "../context/GameContext";
import * as simEngine from "../api/simEnginePy.js";
import { applyDraftPickOwnershipToLotteryResult, applyDraftPickOwnershipToOrder } from "../utils/draftPicks.js";

const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const DRAFT_LOTTERY_KEY = "bm_draft_lottery_v1";
const LEAGUE_KEY = "leagueData";
const DEV_LOTTERY_SYSTEM_KEY = "bm_dev_lottery_system_v1";
const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const SCHEDULE_KEY = "bm_schedule_v3";

function safeJSON(raw, fallback = null) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getSeasonYear(leagueData) {
  const candidates = [];
  const pushYear = (value) => {
    const y = Number(value);
    if (Number.isFinite(y) && y >= 2020 && y <= 2100) candidates.push(y);
  };

  const meta = safeJSON(localStorage.getItem("bm_league_meta_v1"), {}) || {};
  const offseasonState = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), {}) || {};

  pushYear(offseasonState?.seasonYear);
  pushYear(leagueData?.seasonYear);
  pushYear(leagueData?.currentSeasonYear);
  pushYear(leagueData?.seasonStartYear);
  pushYear(meta?.seasonYear);
  pushYear(meta?.currentSeasonYear);
  pushYear(meta?.seasonStartYear);

  if (candidates.length) return Math.max(...candidates);
  return 2026;
}

function getAllTeamsFromLeague(leagueData) {
  if (!leagueData) return [];
  if (Array.isArray(leagueData.teams)) return leagueData.teams;
  if (leagueData.conferences) return Object.values(leagueData.conferences).flat();
  return [];
}

function resolveLogo(team = {}) {
  return (
    team.logo ||
    team.teamLogo ||
    team.newTeamLogo ||
    team.logoUrl ||
    team.image ||
    team.img ||
    ""
  );
}

function normalizeTeamName(value = "") {
  return String(value || "").trim().toLowerCase();
}

function resolveTeamLogoFromLeague(leagueData, teamName) {
  const target = normalizeTeamName(teamName);
  if (!target) return "";

  for (const team of getAllTeamsFromLeague(leagueData)) {
    const names = [team.name, team.teamName, team.currentOwnerTeamName, team.originalTeamName];
    if (names.some((name) => normalizeTeamName(name) === target)) return resolveLogo(team);
  }
  return "";
}

function loadResultsIndexV3() {
  const parsed = safeJSON(localStorage.getItem(RESULT_V3_INDEX_KEY), []);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function loadOneResultV3(gameId) {
  try {
    const stored = localStorage.getItem(`${RESULT_V3_PREFIX}${gameId}`);
    if (!stored) return null;
    const decompressed = LZString.decompressFromUTF16(stored);
    return JSON.parse(decompressed || stored);
  } catch {
    return null;
  }
}

function loadAllResultsV3() {
  const ids = loadResultsIndexV3();
  const out = {};
  for (const id of ids) {
    const result = loadOneResultV3(id);
    if (result) out[String(id)] = result;
  }
  return out;
}

function buildFallbackTeamRecordsFromSchedule(leagueData) {
  const schedule = safeJSON(localStorage.getItem(SCHEDULE_KEY), {}) || {};
  const results = loadAllResultsV3();
  const teams = getAllTeamsFromLeague(leagueData);

  const stats = {};
  for (const team of teams) {
    stats[team.name] = {
      teamName: team.name,
      conference: team.conference || team.conf || null,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0,
      madePlayoffs: false,
      madePlayIn: false,
      playoffResult: "unknown",
      logo: resolveLogo(team),
    };
  }

  const scheduleById = {};
  for (const games of Object.values(schedule || {})) {
    for (const game of games || []) {
      if (game?.id == null) continue;
      scheduleById[String(game.id)] = game;
    }
  }

  for (const [gameId, result] of Object.entries(results)) {
    const meta = scheduleById[String(gameId)];
    if (!meta || !result?.totals) continue;
    if (String(meta.id || "").startsWith("PO_") || String(meta.id || "").startsWith("PI_")) continue;

    const homeName = meta.home;
    const awayName = meta.away;
    const homePts = Number(result.totals.home || 0);
    const awayPts = Number(result.totals.away || 0);

    for (const [name, conf] of [[homeName, meta.confHome], [awayName, meta.confAway]]) {
      if (!stats[name]) {
        stats[name] = {
          teamName: name,
          conference: conf || null,
          wins: 0,
          losses: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          madePlayoffs: false,
          madePlayIn: false,
          playoffResult: "unknown",
          logo: "",
        };
      }
    }

    stats[homeName].pointsFor += homePts;
    stats[homeName].pointsAgainst += awayPts;
    stats[awayName].pointsFor += awayPts;
    stats[awayName].pointsAgainst += homePts;

    if (homePts > awayPts) {
      stats[homeName].wins += 1;
      stats[awayName].losses += 1;
    } else if (awayPts > homePts) {
      stats[awayName].wins += 1;
      stats[homeName].losses += 1;
    }
  }

  const rows = Object.values(stats).map((row) => {
    const gamesPlayed = row.wins + row.losses;
    return {
      ...row,
      gamesPlayed,
      winPct: gamesPlayed ? Number((row.wins / gamesPlayed).toFixed(3)) : 0,
      pointDifferential: row.pointsFor - row.pointsAgainst,
    };
  });

  const sortedBest = [...rows].sort(
    (a, b) =>
      b.winPct - a.winPct ||
      b.pointDifferential - a.pointDifferential ||
      String(a.teamName).localeCompare(String(b.teamName))
  );

  sortedBest.forEach((row, index) => {
    row.leagueRank = index + 1;
    row.madePlayoffs = index < 16;
    row.playoffResult = index < 16 ? "playoffs" : "missed_playoffs";
  });

  return sortedBest;
}

function getRecordTeamName(row = {}) {
  return row.teamName || row.team || row.name || row.team_name || "";
}

function getRecordWins(row = {}) {
  return Number(row.wins ?? row.w ?? row.record?.wins ?? row.teamRecord?.wins ?? row.standings?.wins ?? 0);
}

function getRecordLosses(row = {}) {
  return Number(row.losses ?? row.l ?? row.record?.losses ?? row.teamRecord?.losses ?? row.standings?.losses ?? 0);
}

function extractConferenceSeed(row = {}) {
  for (const key of ["conferenceSeed", "confSeed", "seed", "regularSeasonConferenceSeed", "playInSeed"]) {
    const value = Number(row?.[key] || 0);
    if (Number.isFinite(value) && value >= 1 && value <= 15) return value;
  }
  return null;
}

function hasUsableLotteryRecord(row = {}) {
  const teamName = getRecordTeamName(row);
  const wins = getRecordWins(row);
  const losses = getRecordLosses(row);
  return Boolean(teamName) && Number.isFinite(wins) && Number.isFinite(losses) && wins + losses > 0;
}

function normalizeLotteryRecord(row = {}, leagueData = null, index = 0) {
  const teamName = getRecordTeamName(row) || `Team ${index + 1}`;
  const wins = getRecordWins(row);
  const losses = getRecordLosses(row);
  const gamesPlayed = wins + losses;
  const conferenceSeed = extractConferenceSeed(row);

  return {
    ...row,
    teamName,
    name: row.name || teamName,
    currentOwnerTeamName: row.currentOwnerTeamName || teamName,
    originalTeamName: row.originalTeamName || teamName,
    wins,
    losses,
    gamesPlayed,
    winPct: gamesPlayed ? Number((wins / gamesPlayed).toFixed(3)) : 0,
    pointDifferential: Number(row.pointDifferential || row.netRating || 0),
    conferenceSeed,
    madePlayoffs: Boolean(row.madePlayoffs),
    madePlayIn: Boolean(row.madePlayIn || (conferenceSeed && conferenceSeed >= 7 && conferenceSeed <= 10)),
    playoffResult: row.playoffResult || (row.madePlayoffs ? "playoffs" : "missed_playoffs"),
    leagueRank: Number(row.leagueRank || index + 1),
    logo: resolveLogo(row) || resolveTeamLogoFromLeague(leagueData, teamName),
  };
}

function getUsableLotteryRows(rows = [], leagueData = null) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => normalizeLotteryRecord(row, leagueData, index))
    .filter(hasUsableLotteryRecord);
}

function getSeasonHistoryCandidates(leagueData, seasonYear) {
  const history = Array.isArray(leagueData?.seasonHistory) ? leagueData.seasonHistory : [];
  if (!history.length) return [];

  const resolvedSeasonYear = Number(seasonYear);
  const targetYears = [resolvedSeasonYear - 1, resolvedSeasonYear].filter(
    (year) => Number.isFinite(year) && year >= 2020 && year <= 2100
  );

  const out = [];
  const seenRows = new Set();
  const pushEntry = (entry) => {
    if (!entry || typeof entry !== "object" || seenRows.has(entry)) return;
    if (!Array.isArray(entry.teams)) return;
    seenRows.add(entry);
    out.push(entry);
  };

  for (const targetYear of targetYears) {
    const matches = history.filter(
      (row) => row && typeof row === "object" && Number(row.seasonYear) === Number(targetYear) && Array.isArray(row.teams)
    );
    const complete = matches.filter((row) => row.status === "complete");
    [...complete, ...matches].reverse().forEach(pushEntry);
  }

  [...history]
    .filter((row) => row && typeof row === "object" && Array.isArray(row.teams))
    .filter((row) => Number(row.seasonYear || 0) <= resolvedSeasonYear)
    .sort((a, b) => Number(b.seasonYear || 0) - Number(a.seasonYear || 0))
    .forEach(pushEntry);

  return out;
}

function getLatestSeasonHistoryEntry(leagueData, seasonYear) {
  for (const entry of getSeasonHistoryCandidates(leagueData, seasonYear)) {
    const usableRows = getUsableLotteryRows(entry?.teams || [], leagueData);
    if (usableRows.length >= 30) return entry;
  }
  return null;
}

function getTeamRecordsForLottery(leagueData, seasonYear) {
  const latest = getLatestSeasonHistoryEntry(leagueData, seasonYear);
  if (latest) {
    const rows = getUsableLotteryRows(latest.teams, leagueData);
    if (rows.length >= 30) return rows.slice(0, 30);
  }

  const fallbackRows = getUsableLotteryRows(buildFallbackTeamRecordsFromSchedule(leagueData), leagueData);
  if (fallbackRows.length >= 30) return fallbackRows.slice(0, 30);

  return [];
}

function readDraftLottery(seasonYear) {
  const saved = safeJSON(localStorage.getItem(DRAFT_LOTTERY_KEY), null);
  if (!saved || typeof saved !== "object") return null;
  if (Number(saved.seasonYear) !== Number(seasonYear)) return null;
  return saved;
}

function saveDraftLottery(row) {
  localStorage.setItem(DRAFT_LOTTERY_KEY, JSON.stringify(row));
}

function updateOffseasonState(patch) {
  const current = safeJSON(localStorage.getItem(OFFSEASON_STATE_KEY), {}) || {};
  const next = { ...current, ...patch };
  localStorage.setItem(OFFSEASON_STATE_KEY, JSON.stringify(next));
  return next;
}

function persistLeagueData(updated, setLeagueData) {
  if (!updated) return;
  setLeagueData(updated);
  try {
    localStorage.setItem(LEAGUE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn("[DraftLottery] localStorage save failed", err);
  }
}

function formatRecord(row = {}) {
  const wins = Number(row.wins || 0);
  const losses = Number(row.losses || 0);
  if (!wins && !losses) return "-";
  return `${wins}-${losses}`;
}

function getResolvedLotterySystem(system, seasonYear) {
  if (system === "legacy_14" || system === "three_two_one") return system;
  return Number(seasonYear) >= 2027 ? "three_two_one" : "legacy_14";
}

function getLotterySystemLabel(system, seasonYear) {
  const resolved = getResolvedLotterySystem(system, seasonYear);
  if (resolved === "legacy_14") return "2026 Old System";
  return "3-2-1 System";
}

function getResultSystemLabel(result, seasonYear) {
  const system = result?.meta?.system || result?.meta?.autoResolvedSystem || null;
  return getLotterySystemLabel(system || "auto", seasonYear);
}

function formatChance(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "-";
  if (num >= 99.95) return "100%";
  if (num > 0 && num < 0.1) return "<0.1%";
  return `${num.toFixed(1)}%`;
}

function getTeamKey(row = {}) {
  return normalizeTeamName(
    row.originalTeamName ||
      row.originalPickTeamName ||
      row.naturalLotteryTeamName ||
      row.teamName ||
      row.currentOwnerTeamName ||
      row.name ||
      ""
  );
}

function getPickOddsFromMap(row = {}, pickNumber) {
  const oddsByPick = row?.oddsByPick || {};
  const direct = oddsByPick?.[String(pickNumber)] ?? oddsByPick?.[Number(pickNumber)];
  return Number(direct || 0);
}

function formatPickChangeLong(value) {
  const change = Number(value || 0);
  if (!Number.isFinite(change) || change === 0) return "Held expected slot";
  if (change > 0) return `Moved up ${change}`;
  return `Moved down ${Math.abs(change)}`;
}

function formatRecordRank(row = {}) {
  const rank = Number(row?.leagueRank || 0);
  if (Number.isFinite(rank) && rank > 0) return `#${rank}`;
  return "-";
}

function formatExpectedPick(row = {}) {
  const pick = Number(row?.expectedPick || row?.projectedPick || row?.lotterySeed || 0);
  if (Number.isFinite(pick) && pick > 0) return `#${Math.round(pick)}`;
  return "-";
}

function resultSummaryText(row = {}) {
  const finalPick = Number(row?.finalPick || 0);
  if (!finalPick) return "Pending";
  return `Actual #${finalPick}`;
}

function resultOddsText(row = {}) {
  const finalPick = Number(row?.finalPick || 0);
  const odds = Number(row?.actualPickOddsPct || 0);
  if (!finalPick || !Number.isFinite(odds) || odds <= 0) return "Final result";
  return `${formatChance(odds)} chance`;
}

function secondRoundExplanation(pick = {}, resolvedSystem = "legacy_14") {
  const pickNumber = Number(pick?.pick || 0);
  if (resolvedSystem === "three_two_one") {
    if (pickNumber >= 31 && pickNumber <= 46) {
      return `Inverted from R1 lottery #${47 - pickNumber}`;
    }
    return "Non-lottery inverse record";
  }
  return "Round 2 inverse record";
}

function normalizePreviewRow(row = {}, leagueData = null) {
  const teamName = row.teamName || row.name || "Unknown Team";
  return {
    ...row,
    teamName,
    currentOwnerTeamName: row.currentOwnerTeamName || teamName,
    originalTeamName: row.originalTeamName || teamName,
    logo: resolveLogo(row) || resolveTeamLogoFromLeague(leagueData, teamName),
  };
}

function normalizeOddsRows(result = null, leagueData = null) {
  const backendRows = Array.isArray(result?.preLotteryOdds)
    ? result.preLotteryOdds
    : Array.isArray(result?.lotteryOdds)
    ? result.lotteryOdds
    : Array.isArray(result?.oddsMatrix)
    ? result.oddsMatrix
    : [];

  if (backendRows.length) {
    return backendRows.map((row) => {
      const clean = normalizePreviewRow(row, leagueData);
      const finalPick = Number(row?.finalPick || 0);
      const actualPickOddsPct = row?.actualPickOddsPct !== undefined && row?.actualPickOddsPct !== null
        ? Number(row.actualPickOddsPct || 0)
        : finalPick
        ? getPickOddsFromMap(row, finalPick)
        : 0;

      return {
        ...clean,
        oddsByPick: row?.oddsByPick || {},
        firstPickOddsPct: Number(row?.firstPickOddsPct ?? row?.firstPickOdds ?? 0),
        topFourOddsPct: Number(row?.topFourOddsPct ?? row?.top4OddsPct ?? 0),
        expectedPick: Number(row?.expectedPick || 0),
        mostLikelyPick: Number(row?.mostLikelyPick || 0),
        mostLikelyPickOddsPct: Number(row?.mostLikelyPickOddsPct || 0),
        projectedPick: Number(row?.projectedPick || row?.lotterySeed || 0),
        bestPick: Number(row?.bestPick || 0),
        worstPick: Number(row?.worstPick || 0),
        finalPick,
        actualPickOddsPct,
        pickChange: Number(row?.pickChange || 0),
        resultTag: row?.resultTag || "",
        simulationCount: Number(row?.simulationCount || result?.oddsSimulationCount || result?.meta?.oddsSimulationCount || 0),
      };
    });
  }

  return (Array.isArray(result?.lotteryTeams) ? result.lotteryTeams : []).map((row) => normalizePreviewRow(row, leagueData));
}


function getOriginalPickTeam(row = {}) {
  return row.originalTeamName || row.originalPickTeamName || row.naturalLotteryTeamName || row.teamName || row.name || "";
}

function getCurrentOwnerPickTeam(row = {}) {
  return row.currentOwnerTeamName || row.ownerTeamName || row.teamName || getOriginalPickTeam(row) || "";
}

function getLotteryOwnershipSubtext(row = {}) {
  const original = getOriginalPickTeam(row);
  const owner = getCurrentOwnerPickTeam(row);
  const protection = row.swapProtectionLabel || row.draftPickProtection || row.protectionLabel || row.displayProtection || "Unprotected";
  const protectedText = row.draftPickProtected ? "Reverted" : "";
  const via = original ? `via ${original}` : "";
  const clean = [protectedText, protection, via].filter(Boolean).join(" · ");
  if (clean) return clean;
  return normalizeTeamName(owner) === normalizeTeamName(original) ? "Own pick" : "Pick rights";
}

function buildProjectedLotteryOrderForMatrix(rows = []) {
  const seenPicks = new Set();
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const expected = Number(row.expectedPick || row.projectedPick || row.mostLikelyPick || row.lotterySeed || index + 1);
      const pick = Number.isFinite(expected) && expected > 0 ? Math.round(expected) : index + 1;
      seenPicks.add(pick);
      const original = getOriginalPickTeam(row);
      return {
        ...row,
        pick,
        round: 1,
        teamName: original,
        currentOwnerTeamName: original,
        originalTeamName: original,
        originalPickTeamName: original,
        naturalLotteryTeamName: original,
      };
    })
    .sort((a, b) => Number(a.pick || 0) - Number(b.pick || 0));
}

function buildOwnerAwareMatrixRows({ oddsRows = [], firstRound = [], firstRoundRevealed = false, leagueData, seasonYear }) {
  const orderSource = firstRoundRevealed && Array.isArray(firstRound) && firstRound.length
    ? firstRound
    : buildProjectedLotteryOrderForMatrix(oddsRows);

  const resolvedOrder = applyDraftPickOwnershipToOrder(orderSource, { leagueData, seasonYear });
  const byOriginal = new Map();
  for (const row of resolvedOrder || []) {
    const key = normalizeTeamName(getOriginalPickTeam(row));
    if (key) byOriginal.set(key, row);
  }

  return (oddsRows || []).map((row, index) => {
    const key = normalizeTeamName(getOriginalPickTeam(row));
    const ownership = byOriginal.get(key) || null;
    const ownerName = ownership ? getCurrentOwnerPickTeam(ownership) : getCurrentOwnerPickTeam(row);
    const ownerLogo = ownership
      ? (ownership.currentOwnerTeamLogo || ownership.ownerLogo || ownership.logo || resolveTeamLogoFromLeague(leagueData, ownerName))
      : (resolveTeamLogoFromLeague(leagueData, ownerName) || row.logo);
    const original = getOriginalPickTeam(row);

    return {
      ...row,
      matrixOwnerTeamName: ownerName || row.teamName,
      matrixOwnerLogo: ownerLogo || row.logo,
      matrixOriginalTeamName: original,
      matrixOwnershipSubtext: getLotteryOwnershipSubtext(ownership || row),
      matrixOwnershipType: ownership?.ownershipType || row.ownershipType || "projected",
      matrixPickNumber: ownership?.pick || row.finalPick || row.expectedPick || row.projectedPick || index + 1,
    };
  });
}

function getFinalPickOddsLabel(oddsRow = {}, pickNumber) {
  const finalPick = Number(pickNumber || oddsRow?.finalPick || 0);
  const directOdds = oddsRow?.actualPickOddsPct !== undefined && oddsRow?.actualPickOddsPct !== null
    ? Number(oddsRow.actualPickOddsPct || 0)
    : getPickOddsFromMap(oddsRow, finalPick);
  if (!finalPick || !Number.isFinite(directOdds) || directOdds <= 0) return "Lottery result";
  return `${formatChance(directOdds)} odds at #${finalPick}`;
}

function categoryLabel(row = {}) {
  const raw = String(row.lotteryCategoryLabel || row.lotteryCategory || row.source || "");
  if (raw.includes("draft_relegated")) return "Draft relegated";
  if (raw.includes("7_8")) return "7/8 play-in loser";
  if (raw.includes("9_10")) return "9/10 play-in seed";
  if (raw.includes("non_play_in")) return "Missed play-in";
  if (raw.includes("legacy")) return "Legacy lottery";
  return raw ? raw.replaceAll("_", " ") : "Lottery team";
}

function sourceLabel(value = "") {
  const raw = String(value || "");
  if (raw === "lottery_drawn_top_4") return "Lottery draw";
  if (raw === "lottery_inverse_record") return "Lottery order by record";
  if (raw === "playoff_inverse_record") return "Playoff inverse record";
  if (raw === "second_round_inverse_record") return "Round 2 inverse record";
  if (raw === "second_round_inverse_lottery_result") return "Round 2 inverted lottery";
  if (raw === "second_round_non_lottery_inverse_record") return "Round 2 non-lottery record";
  if (raw.includes("three_two_one")) return categoryLabel({ lotteryCategory: raw });
  return raw.replaceAll("_", " ");
}

function TeamLogo({ src, name, size = 28 }) {
  if (!src) {
    return <div className="rounded-full bg-neutral-700" style={{ width: size, height: size }} />;
  }
  return <img src={src} alt={name || "Team"} className="object-contain" style={{ width: size, height: size }} />;
}

function PickRow({ pick, animationIndex = 0, oddsRow = null, showMovement = true }) {
  const teamName = pick.teamName || pick.currentOwnerTeamName || "Unknown Team";
  const movement = Number(oddsRow?.pickChange ?? pick.pickChange ?? 0);
  const resultTag = showMovement ? (oddsRow?.resultTag || pick.resultTag || "") : "";
  const chanceLabel = oddsRow ? `${resultOddsText({ ...oddsRow, finalPick: pick.pick })}` : pick.chanceLabel || sourceLabel(pick.source);
  const sourceText = pick.round === 2 ? (pick.chanceLabel || sourceLabel(pick.source)) : sourceLabel(pick.source);
  const originalTeamName = pick.originalTeamName || pick.originalPickTeamName || pick.naturalLotteryTeamName || "";
  const ownershipNote = originalTeamName && normalizeTeamName(originalTeamName) !== normalizeTeamName(teamName)
    ? `Original: ${originalTeamName}`
    : "";

  return (
    <div
      className="bmRowEnter px-4 py-4 border-b border-white/10 hover:bg-white/[0.035]"
      style={{ animationDelay: `${Math.min(animationIndex * 22, 500)}ms` }}
    >
      <div className="flex items-start gap-3">
        <div className="w-14 shrink-0 text-orange-300 font-black text-lg leading-8">#{pick.pick}</div>
        <TeamLogo src={pick.logo || pick.currentOwnerTeamLogo || pick.ownerLogo} name={teamName} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <div className="font-extrabold text-base leading-tight break-words">{teamName}</div>
            <div className="text-sm text-white/65">{formatRecord(pick)}</div>
          </div>
          <div className="mt-1 text-xs text-white/45 leading-snug break-words">{sourceText}</div>
          {ownershipNote ? <div className="mt-1 text-xs font-bold text-sky-200/80 leading-snug break-words">{ownershipNote}</div> : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-black text-white/75">{chanceLabel}</span>
            {showMovement && Number.isFinite(movement) && movement !== 0 ? (
              <span className={movement > 0 ? "font-bold text-emerald-300" : "font-bold text-red-300"}>
                {formatPickChangeLong(movement)}
              </span>
            ) : null}
            {resultTag ? <span className="font-extrabold text-white/45">{resultTag}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function LotteryOddsTable({ rows = [], firstRoundRevealed = false }) {
  if (!rows.length) return null;
  const simulationCount = rows.find((row) => Number(row?.simulationCount || 0) > 0)?.simulationCount;

  return (
    <div className="bmTablePanel rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden shadow-2xl mb-6">
      <div className="px-5 py-4 bg-neutral-800/80 border-b border-white/10 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold">Lottery Odds</h2>
          <p className="text-sm text-white/50">
            {firstRoundRevealed
              ? "Final lottery result compared against each team's expected pick slot."
              : "Pre-reveal odds. Green in the matrix marks each team's expected pick; actual results stay hidden until reveal."}
          </p>
        </div>
        {simulationCount ? <div className="text-xs text-white/40">Matrix from {Number(simulationCount).toLocaleString()} sims</div> : null}
      </div>

      <div className="bmOrangeScrollbar overflow-auto max-h-[520px]">
        <div className="min-w-[1040px]">
          <div className="grid grid-cols-[92px_100px_minmax(230px,1fr)_90px_150px_90px_95px_150px] gap-3 px-5 py-3 bg-neutral-950/80 text-[11px] uppercase tracking-wide text-white/45 font-black border-b border-white/10 sticky top-0 z-10">
            <div>Record Rank</div>
            <div className="text-right">Expected Pick</div>
            <div>Projected Owner</div>
            <div className="text-center">Record</div>
            <div>Path</div>
            <div className="text-right">#1 Odds</div>
            <div className="text-right">Range</div>
            <div className="text-right">Result</div>
          </div>

          {rows.map((row, index) => {
            const finalPick = firstRoundRevealed ? Number(row.finalPick || 0) : 0;
            const movement = finalPick ? Number(row.pickChange || 0) : 0;
            return (
              <div
                key={`${row.teamName}-${index}`}
                className="grid grid-cols-[92px_100px_minmax(230px,1fr)_90px_150px_90px_95px_150px] gap-3 px-5 py-4 border-b border-white/10 items-center hover:bg-white/[0.035]"
              >
                <div className="text-orange-300 font-black">{formatRecordRank(row)}</div>
                <div className="text-sm text-right font-black text-emerald-300">{formatExpectedPick(row)}</div>
                <div className="flex items-center gap-3 min-w-0">
                  <TeamLogo src={row.logo} name={row.teamName} size={26} />
                  <div className="min-w-0">
                    <div className="font-extrabold truncate">{row.teamName}</div>
                    <div className="text-xs text-white/40 truncate">
                      {row.conferenceSeed ? `Conf seed ${row.conferenceSeed}` : "League-wide record"}
                    </div>
                  </div>
                </div>
                <div className="text-sm text-white/70 text-center">{formatRecord(row)}</div>
                <div className="text-xs text-white/50 truncate">
                  {categoryLabel(row)}{row.lotteryBalls ? ` · ${row.lotteryBalls} ${Number(row.lotteryBalls) === 1 ? "ball" : "balls"}` : ""}
                </div>
                <div className="text-sm text-white/80 text-right font-black">{formatChance(row.firstPickOddsPct)}</div>
                <div className="text-sm text-white/65 text-right">
                  {row.bestPick && row.worstPick ? `#${row.bestPick}-#${row.worstPick}` : "-"}
                </div>
                <div className="text-xs text-right">
                  {finalPick ? (
                    <>
                      <div className="font-black text-white/90">{resultSummaryText(row)}</div>
                      <div className="text-white/50">{resultOddsText(row)}</div>
                      <div className={movement > 0 ? "text-emerald-300" : movement < 0 ? "text-red-300" : "text-white/45"}>
                        {formatPickChangeLong(movement)}
                      </div>
                    </>
                  ) : (
                    <div className="font-black text-white/45">Pending</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DraftMatrix({ rows = [], system, firstRoundRevealed = false }) {
  if (!rows.length) return null;
  const maxPick = system === "three_two_one" ? 16 : 14;
  const pickColumns = Array.from({ length: maxPick }, (_, index) => index + 1);

  return (
    <div className="bmTablePanel rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden shadow-2xl mb-8">
      <div className="px-5 py-4 bg-neutral-800/80 border-b border-white/10">
        <h2 className="text-2xl font-extrabold">Draft Probability Matrix</h2>
        <p className="text-sm text-white/50">
          Green marks the expected pick. Logos show the projected current owner before the reveal, then update to the actual resolved owner after the reveal.
        </p>
      </div>
      <div className="overflow-x-hidden">
        <div className="w-full">
          <div
            className="grid gap-1 px-3 py-3 bg-neutral-950/80 text-[10px] uppercase tracking-wide text-white/45 font-black border-b border-white/10 sticky top-0 z-10"
            style={{ gridTemplateColumns: `210px repeat(${maxPick}, minmax(44px, 1fr))` }}
          >
            <div>Team</div>
            {pickColumns.map((pick) => <div key={pick} className="text-center">#{pick}</div>)}
          </div>

          {rows.map((row, rowIndex) => {
            const expectedPick = Number(row.expectedPick || row.projectedPick || row.lotterySeed || 0);
            const finalPick = firstRoundRevealed ? Number(row.finalPick || 0) : 0;
            return (
              <div
                key={`${row.teamName}-matrix-${rowIndex}`}
                className="grid gap-1 px-3 py-2 border-b border-white/10 items-center hover:bg-white/[0.035]"
                style={{ gridTemplateColumns: `210px repeat(${maxPick}, minmax(44px, 1fr))` }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <TeamLogo src={row.matrixOwnerLogo || row.logo} name={row.matrixOwnerTeamName || row.teamName} size={24} />
                  <div className="min-w-0">
                    <div className="font-bold truncate">{row.matrixOwnerTeamName || row.teamName}</div>
                    <div className="text-[11px] text-white/40 truncate" title={row.matrixOwnershipSubtext}>
                      {row.matrixOwnershipSubtext || "Pick rights"}
                    </div>
                  </div>
                </div>
                {pickColumns.map((pick) => {
                  const pct = getPickOddsFromMap(row, pick);
                  const intensity = Math.min(0.66, Math.max(0.035, pct / 45));
                  const isExpected = Number(expectedPick) === pick;
                  const isFinal = Number(finalPick) === pick;
                  const bg = isExpected
                    ? `rgba(16, 185, 129, ${Math.max(0.24, intensity)})`
                    : `rgba(249, 115, 22, ${intensity})`;
                  const borderClass = isFinal
                    ? "border-amber-300 ring-2 ring-amber-300/80 text-amber-50"
                    : isExpected
                    ? "border-emerald-300/80 text-emerald-50"
                    : "border-white/5 text-white/75";
                  return (
                    <div
                      key={pick}
                      className={`relative rounded-md px-1 py-2 text-center text-[11px] font-black border ${borderClass}`}
                      style={{ background: bg }}
                      title={`${row.matrixOriginalTeamName || row.teamName} odds at #${pick}: ${formatChance(pct)}`}
                    >
                      {pct > 0 ? formatChance(pct) : "-"}
                      {isFinal ? <div className="mt-1 text-[8px] tracking-wide text-amber-100">FINAL</div> : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function DraftLottery() {
  const navigate = useNavigate();
  const { leagueData, setLeagueData } = useGame();

  const seasonYear = getSeasonYear(leagueData);
  const [lotteryState, setLotteryState] = useState(() => readDraftLottery(seasonYear));
  const [lotterySystem, setLotterySystem] = useState(() => localStorage.getItem(DEV_LOTTERY_SYSTEM_KEY) || "auto");
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const preparingRef = useRef(false);

  useEffect(() => {
    setLotteryState(readDraftLottery(seasonYear));
  }, [seasonYear]);

  const latestHistory = useMemo(() => getLatestSeasonHistoryEntry(leagueData, seasonYear), [leagueData, seasonYear]);

  const rawResult = lotteryState?.result || null;
  const result = useMemo(() => {
    return rawResult ? applyDraftPickOwnershipToLotteryResult(rawResult, { leagueData, seasonYear }) : null;
  }, [rawResult, leagueData, seasonYear]);
  const secondRoundRevealed = Boolean(lotteryState?.secondRoundRevealed);
  const firstRoundRevealed = Boolean(lotteryState?.firstRoundRevealed);
  const lotteryComplete = Boolean(firstRoundRevealed && secondRoundRevealed && !lotteryState?.isPreview);
  const resolvedSystem = result?.meta?.system || result?.meta?.autoResolvedSystem || getResolvedLotterySystem(lotterySystem, seasonYear);

  const persistLotteryResult = (nextLotteryState) => {
    const resolvedResult = nextLotteryState?.result
      ? applyDraftPickOwnershipToLotteryResult(nextLotteryState.result, { leagueData, seasonYear })
      : nextLotteryState?.result;

    const resolvedLotteryState = {
      ...nextLotteryState,
      result: resolvedResult,
    };

    const complete = Boolean(
      resolvedLotteryState.firstRoundRevealed &&
        resolvedLotteryState.secondRoundRevealed &&
        !resolvedLotteryState.isPreview
    );

    const updatedLeague = {
      ...(leagueData || {}),
      draftState: {
        ...(leagueData?.draftState || {}),
        seasonYear,
        lottery: resolvedLotteryState.result,
        draftOrder: complete ? resolvedLotteryState.result?.fullDraftOrder || [] : [],
        draftLotteryComplete: complete,
      },
    };

    saveDraftLottery(resolvedLotteryState);
    persistLeagueData(updatedLeague, setLeagueData);
    setLotteryState(resolvedLotteryState);
    updateOffseasonState({ draftLotteryComplete: complete });
    return resolvedLotteryState;
  };

  const runLotteryBackend = async ({ forceNew = false, revealFirst = false, revealSecond = false, systemOverride = lotterySystem } = {}) => {
    const existing = readDraftLottery(seasonYear);
    const existingRequest = existing?.requestedLotterySystem || "auto";
    const requestMatches = String(existingRequest) === String(systemOverride || "auto");
    const existingAlreadyRevealed = Boolean(existing?.firstRoundRevealed || existing?.secondRoundRevealed);

    if (
      !forceNew &&
      existing?.result?.fullDraftOrder?.length &&
      !existing?.isPreview &&
      (requestMatches || existingAlreadyRevealed)
    ) {
      const nextExisting = {
        ...existing,
        firstRoundRevealed: Boolean(revealFirst || existing.firstRoundRevealed),
        secondRoundRevealed: Boolean(revealSecond || existing.secondRoundRevealed),
      };
      return persistLotteryResult(nextExisting);
    }

    if (!leagueData) throw new Error("League data is still loading.");
    if (typeof simEngine.runDraftLottery !== "function") throw new Error("runDraftLottery is not wired in simEnginePy.js yet.");

    const teamRecords = getTeamRecordsForLottery(leagueData, seasonYear);
    if (!Array.isArray(teamRecords) || teamRecords.length < 30) {
      throw new Error(
        `NO_USABLE_TEAM_RECORDS_FOR_LOTTERY: found ${teamRecords?.length || 0}. ` +
        `Need previous completed season standings for the ${seasonYear} draft.`
      );
    }

    const payload = await simEngine.runDraftLottery(leagueData, {
      seasonYear,
      teamRecords,
      lotterySystem: systemOverride,
      forceLotterySystem: systemOverride,
      seed: `${seasonYear}_${systemOverride}_draft_lottery_${Date.now()}_${Math.random()}`,
    });

    if (!payload?.ok) throw new Error(payload?.reason || "Draft lottery failed.");

    const nextLotteryState = {
      seasonYear,
      generatedAt: new Date().toISOString(),
      lotterySystem: payload?.meta?.system || payload?.meta?.autoResolvedSystem || systemOverride,
      requestedLotterySystem: systemOverride,
      isPreview: false,
      firstRoundRevealed: Boolean(revealFirst),
      secondRoundRevealed: Boolean(revealSecond),
      result: payload,
    };

    return persistLotteryResult(nextLotteryState);
  };

  useEffect(() => {
    if (!leagueData) return;
    const saved = readDraftLottery(seasonYear);
    if (saved?.result?.fullDraftOrder?.length && !saved?.isPreview) return;
    if (preparingRef.current) return;

    preparingRef.current = true;
    setPreparing(true);
    setError("");

    runLotteryBackend({ forceNew: true, revealFirst: false, revealSecond: false, systemOverride: lotterySystem })
      .catch((err) => {
        console.error("[DraftLottery] prepare hidden lottery failed", err);
        setError(String(err?.message || err));
      })
      .finally(() => {
        preparingRef.current = false;
        setPreparing(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueData, seasonYear]);

  const setDevLotterySystem = (system) => {
    setLotterySystem(system);
    localStorage.setItem(DEV_LOTTERY_SYSTEM_KEY, system);
  };

  const revealFirstRound = async () => {
    setLoading(true);
    setError("");
    try {
      await runLotteryBackend({ revealFirst: true, revealSecond: secondRoundRevealed });
    } catch (err) {
      console.error("[DraftLottery] revealFirstRound failed", err);
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  const revealSecondRound = async () => {
    setLoading(true);
    setError("");
    try {
      await runLotteryBackend({ revealFirst: true, revealSecond: true });
    } catch (err) {
      console.error("[DraftLottery] revealSecondRound failed", err);
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  const simAll = async () => {
    setLoading(true);
    setError("");
    try {
      await runLotteryBackend({ revealFirst: true, revealSecond: true });
    } catch (err) {
      console.error("[DraftLottery] simAll failed", err);
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  const resetLottery = async () => {
    setLoading(true);
    setError("");
    try {
      localStorage.removeItem(DRAFT_LOTTERY_KEY);
      updateOffseasonState({ draftLotteryComplete: false });
      const updatedLeague = {
        ...(leagueData || {}),
        draftState: {
          ...(leagueData?.draftState || {}),
          seasonYear,
          lottery: null,
          draftOrder: [],
          draftLotteryComplete: false,
        },
      };
      persistLeagueData(updatedLeague, setLeagueData);
      await runLotteryBackend({ forceNew: true, revealFirst: false, revealSecond: false, systemOverride: lotterySystem });
    } catch (err) {
      console.error("[DraftLottery] resetLottery failed", err);
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  const devResimAll = async () => {
    setLoading(true);
    setError("");
    try {
      localStorage.removeItem(DRAFT_LOTTERY_KEY);
      await runLotteryBackend({ forceNew: true, revealFirst: true, revealSecond: true, systemOverride: lotterySystem });
    } catch (err) {
      console.error("[DraftLottery] devResimAll failed", err);
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  const oddsRows = useMemo(() => normalizeOddsRows(result, leagueData), [result, leagueData]);
  const oddsByTeam = useMemo(() => {
    const map = new Map();
    for (const row of oddsRows) {
      const key = getTeamKey(row);
      if (key) map.set(key, row);
    }
    return map;
  }, [oddsRows]);

  const firstRound = Array.isArray(result?.firstRoundOrder) ? result.firstRoundOrder.filter(Boolean) : [];
  const secondRound = Array.isArray(result?.secondRoundOrder) ? result.secondRoundOrder.filter(Boolean) : [];
  const matrixRows = useMemo(
    () => buildOwnerAwareMatrixRows({ oddsRows, firstRound, firstRoundRevealed, leagueData, seasonYear }),
    [oddsRows, firstRound, firstRoundRevealed, leagueData, seasonYear]
  );

  const firstRoundRevealOrder = useMemo(() => {
    return (firstRound || []).filter(Boolean).map((pick) => {
      const key = getTeamKey(pick);
      const oddsRow = key ? oddsByTeam.get(key) : null;
      return oddsRow
        ? {
            ...pick,
            chanceLabel: getFinalPickOddsLabel(oddsRow, pick?.pick),
            actualPickOddsPct: oddsRow.actualPickOddsPct,
            pickChange: oddsRow.pickChange,
            resultTag: oddsRow.resultTag,
          }
        : pick;
    });
  }, [firstRound, oddsByTeam]);

  const secondRoundRevealOrder = useMemo(() => {
    return (secondRound || []).filter(Boolean).map((pick) => ({
      ...pick,
      chanceLabel: secondRoundExplanation(pick, resolvedSystem),
    }));
  }, [secondRound, resolvedSystem]);

  const statusLabel = preparing
    ? "Preparing"
    : lotteryComplete
    ? "Locked"
    : firstRoundRevealed
    ? "Round 1 Revealed"
    : result
    ? "Ready"
    : "Loading";

  if (!leagueData) {
    return <div className="min-h-screen bmCourtPage text-white flex items-center justify-center">Loading draft lottery...</div>;
  }

  return (
    <div className="min-h-screen bmCourtPage text-white py-8 px-4">
      <style>{`
        .bmOrangeScrollbar { scrollbar-width: thin; scrollbar-color: rgba(249, 115, 22, 0.92) rgba(12, 12, 12, 0.78); }
        .bmOrangeScrollbar::-webkit-scrollbar { width: 12px; height: 12px; }
        .bmOrangeScrollbar::-webkit-scrollbar-track { background: rgba(12, 12, 12, 0.78); border-left: 1px solid rgba(255,255,255,0.08); border-radius: 999px; }
        .bmOrangeScrollbar::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #fb923c 0%, #f97316 55%, #ea580c 100%); border: 3px solid rgba(12,12,12,0.92); border-radius: 999px; box-shadow: 0 0 14px rgba(249,115,22,0.22); }
        .bmOrangeScrollbar::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, #fdba74 0%, #fb923c 45%, #f97316 100%); }
      `}</style>

      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-8">
          <div>
            <p className="text-xs text-white/40 tracking-[0.25em] uppercase mb-2">Offseason</p>
            <h1 className="text-4xl md:text-5xl font-extrabold text-orange-500">NBA Draft Lottery</h1>
            <p className="text-white/60 mt-2">
              {seasonYear} draft order. First round reveals first; second round locks the full draft order.
            </p>
          </div>

          <button
            onClick={() => navigate("/offseason")}
            className="bmSmoothButton px-5 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 font-bold"
          >
            Back to Offseason
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          <div className="bmSolidPanel rounded-2xl bg-neutral-900 border border-white/10 p-4">
            <div className="text-xs text-white/45 uppercase tracking-wide">Season</div>
            <div className="text-2xl font-extrabold mt-1">{seasonYear}</div>
          </div>
          <div className="bmSolidPanel rounded-2xl bg-neutral-900 border border-white/10 p-4">
            <div className="text-xs text-white/45 uppercase tracking-wide">Source</div>
            <div className="text-lg font-bold mt-1">{latestHistory ? "Season History" : "Schedule Fallback"}</div>
          </div>
          <div className="bmSolidPanel rounded-2xl bg-neutral-900 border border-white/10 p-4">
            <div className="text-xs text-white/45 uppercase tracking-wide">Lottery Teams</div>
            <div className="text-2xl font-extrabold mt-1">{result?.lotteryTeams?.length || "-"}</div>
          </div>
          <div className="bmSolidPanel rounded-2xl bg-neutral-900 border border-white/10 p-4">
            <div className="text-xs text-white/45 uppercase tracking-wide">System</div>
            <div className="text-lg font-bold mt-1">{result ? getResultSystemLabel(result, seasonYear) : getLotterySystemLabel(lotterySystem, seasonYear)}</div>
          </div>
          <div className="bmSolidPanel rounded-2xl bg-neutral-900 border border-white/10 p-4">
            <div className="text-xs text-white/45 uppercase tracking-wide">Status</div>
            <div className="text-lg font-bold mt-1">{statusLabel}</div>
          </div>
        </div>

        <div className="bmSolidPanel rounded-2xl bg-purple-950/30 border border-purple-400/30 p-4 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs text-purple-200/70 uppercase tracking-[0.18em] font-bold">Dev Lottery Tool</div>
              <div className="text-sm text-white/55 mt-1">
                Choose the lottery system, reset for a hidden fresh draw, or resimulate both rounds instantly.
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                ["auto", "Auto By Year"],
                ["legacy_14", "Force 2026 Old"],
                ["three_two_one", "Force 3-2-1"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setDevLotterySystem(value)}
                  disabled={loading || preparing}
                  className={`bmSmoothButton px-4 py-2 rounded-xl text-sm font-extrabold border ${
                    lotterySystem === value
                      ? "bg-purple-600 border-purple-300 text-white"
                      : "bg-purple-950/40 border-purple-400/20 text-purple-100/70 hover:bg-purple-800/50"
                  } disabled:bg-neutral-700 disabled:text-white/45`}
                >
                  {label}
                </button>
              ))}

              <button
                onClick={resetLottery}
                disabled={loading || preparing}
                className="bmSmoothButton px-5 py-2 rounded-xl bg-purple-950/60 hover:bg-purple-800/70 border border-purple-300/30 disabled:bg-neutral-700 disabled:text-white/45 font-extrabold"
              >
                Reset
              </button>

              <button
                onClick={devResimAll}
                disabled={loading || preparing}
                className="bmSmoothButton px-5 py-2 rounded-xl bg-purple-700 hover:bg-purple-600 disabled:bg-neutral-700 disabled:text-white/45 font-extrabold"
              >
                Dev Resim Both
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200 font-semibold">
            {error}
          </div>
        )}

        {(preparing || !result) && !error ? (
          <div className="mb-6 rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-orange-100 font-semibold">
            Preparing lottery odds and draft matrix...
          </div>
        ) : null}

        <DraftMatrix rows={matrixRows} system={resolvedSystem} firstRoundRevealed={firstRoundRevealed} />

        <div className="flex flex-wrap gap-3 mb-8">
          <button
            onClick={revealFirstRound}
            disabled={loading || preparing || !result || firstRoundRevealed}
            className="bmSmoothButton px-6 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-700 disabled:text-white/45 font-extrabold"
          >
            {loading && !firstRoundRevealed ? "Generating..." : firstRoundRevealed ? "First Round Revealed" : "Reveal First Round"}
          </button>

          <button
            onClick={revealSecondRound}
            disabled={loading || preparing || !firstRoundRevealed || secondRoundRevealed}
            className="bmSmoothButton px-6 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-700 disabled:text-white/45 font-extrabold"
          >
            {secondRoundRevealed ? "Second Round Revealed" : "Reveal Second Round"}
          </button>

          <button
            onClick={simAll}
            disabled={loading || preparing || lotteryComplete}
            className="bmSmoothButton px-6 py-3 rounded-xl bg-orange-700 hover:bg-orange-600 disabled:bg-neutral-700 disabled:text-white/45 font-extrabold"
          >
            Sim All
          </button>

          <button
            onClick={() => navigate("/draft")}
            disabled={!lotteryComplete}
            className="bmSmoothButton px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-700 disabled:text-white/45 font-extrabold"
          >
            Continue to Draft
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bmTablePanel rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-neutral-800/80 border-b border-white/10 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-extrabold">First Round Reveal</h2>
                <p className="text-sm text-white/50">Displayed from pick 1 to pick 30.</p>
              </div>
              <div className="text-sm font-bold text-white/50">{firstRoundRevealed ? "Visible" : "Hidden"}</div>
            </div>

            {firstRoundRevealed ? (
              <div className="bmOrangeScrollbar max-h-[640px] overflow-auto">
                {firstRoundRevealOrder.map((pick, index) => (
                  <PickRow key={`r1-${pick?.pick || index}`} pick={pick} oddsRow={oddsByTeam.get(getTeamKey(pick))} animationIndex={index} />
                ))}
              </div>
            ) : (
              <div className="p-8 text-white/50 text-center">
                Review the odds and matrix, then reveal the first round before the second round.
              </div>
            )}
          </div>

          <div className="bmTablePanel rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-neutral-800/80 border-b border-white/10 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-extrabold">Second Round</h2>
                <p className="text-sm text-white/50">
                  {resolvedSystem === "three_two_one"
                    ? "Picks 31-46 invert Round 1 lottery picks 1-16; picks 47-60 use inverse record."
                    : "Picks 31-60 by league-wide inverse record."}
                </p>
              </div>
              <div className="text-sm font-bold text-white/50">{secondRoundRevealed ? "Visible" : "Hidden"}</div>
            </div>

            {secondRoundRevealed ? (
              <div className="bmOrangeScrollbar max-h-[640px] overflow-auto">
                {secondRoundRevealOrder.map((pick, index) => (
                  <PickRow key={`r2-${pick?.pick || index}`} pick={pick} animationIndex={index} showMovement={false} />
                ))}
              </div>
            ) : (
              <div className="p-8 text-white/50 text-center">
                Reveal the second round after the first round to lock the full draft order.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
