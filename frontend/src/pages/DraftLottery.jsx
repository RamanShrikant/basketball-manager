import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import LZString from "lz-string";
import { useGame } from "../context/GameContext";
import * as simEngine from "../api/simEnginePy.js";

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
    if (Number.isFinite(y) && y >= 2020 && y <= 2100) {
      candidates.push(y);
    }
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

function loadResultsIndexV3() {
  const parsed = safeJSON(localStorage.getItem(RESULT_V3_INDEX_KEY), []);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function loadOneResultV3(gameId) {
  try {
    const stored = localStorage.getItem(`${RESULT_V3_PREFIX}${gameId}`);
    if (!stored) return null;
    const decompressed = LZString.decompressFromUTF16(stored);
    const json = decompressed || stored;
    return JSON.parse(json);
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

    if (!stats[homeName]) {
      stats[homeName] = {
        teamName: homeName,
        conference: meta.confHome || null,
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

    if (!stats[awayName]) {
      stats[awayName] = {
        teamName: awayName,
        conference: meta.confAway || null,
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

function getLatestSeasonHistoryEntry(leagueData, seasonYear) {
  const history = Array.isArray(leagueData?.seasonHistory) ? leagueData.seasonHistory : [];
  if (!history.length) return null;

  const matching = history.filter((row) => Number(row?.seasonYear) === Number(seasonYear));
  if (matching.length) {
    const complete = matching.filter((row) => row?.status === "complete");
    return complete.at(-1) || matching.at(-1);
  }

  return [...history].sort((a, b) => Number(a?.seasonYear || 0) - Number(b?.seasonYear || 0)).at(-1);
}

function getTeamRecordsForLottery(leagueData, seasonYear) {
  const latest = getLatestSeasonHistoryEntry(leagueData, seasonYear);
  if (Array.isArray(latest?.teams) && latest.teams.length) {
    return latest.teams;
  }

  return buildFallbackTeamRecordsFromSchedule(leagueData);
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
  localStorage.setItem(LEAGUE_KEY, JSON.stringify(updated));
}

function formatRecord(row = {}) {
  const wins = Number(row.wins || 0);
  const losses = Number(row.losses || 0);
  if (!wins && !losses) return "-";
  return `${wins}-${losses}`;
}

function getLotterySystemLabel(system, seasonYear) {
  if (system === "legacy_14") return "2026 Old System";
  if (system === "three_two_one") return "3-2-1 System";
  return `Auto (${seasonYear >= 2027 ? "3-2-1" : "2026 Old"})`;
}

function getResultSystemLabel(result, seasonYear) {
  const system = result?.meta?.system || result?.meta?.autoResolvedSystem || null;
  return getLotterySystemLabel(system || "auto", seasonYear);
}

function getResolvedLotterySystem(system, seasonYear) {
  if (system === "legacy_14" || system === "three_two_one") return system;
  return Number(seasonYear) >= 2027 ? "three_two_one" : "legacy_14";
}

function sortWorstFirst(rows = []) {
  return [...rows].sort((a, b) => {
    const aGames = Number(a.wins || 0) + Number(a.losses || 0);
    const bGames = Number(b.wins || 0) + Number(b.losses || 0);
    const aPct = aGames ? Number(a.wins || 0) / aGames : 0;
    const bPct = bGames ? Number(b.wins || 0) / bGames : 0;

    return (
      aPct - bPct ||
      Number(a.pointDifferential || 0) - Number(b.pointDifferential || 0) ||
      String(a.teamName || a.name || "").localeCompare(String(b.teamName || b.name || ""))
    );
  });
}

function normalizeTeamName(value = "") {
  return String(value || "").trim().toLowerCase();
}

function resolveTeamLogoFromLeague(leagueData, teamName) {
  const target = normalizeTeamName(teamName);
  if (!target) return "";

  for (const team of getAllTeamsFromLeague(leagueData)) {
    const names = [
      team.name,
      team.teamName,
      team.currentOwnerTeamName,
      team.originalTeamName,
    ];

    if (names.some((name) => normalizeTeamName(name) === target)) {
      return resolveLogo(team);
    }
  }

  return "";
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

function formatChance(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "-";
  if (num >= 99.95) return "100%";
  return `${num.toFixed(1)}%`;
}

function getTeamKey(row = {}) {
  return normalizeTeamName(row.currentOwnerTeamName || row.teamName || row.name || "");
}

function getPickOddsFromMap(row = {}, pickNumber) {
  const oddsByPick = row?.oddsByPick || {};
  const direct = oddsByPick?.[String(pickNumber)] ?? oddsByPick?.[Number(pickNumber)];
  return Number(direct || 0);
}

function formatPickChange(value) {
  const change = Number(value || 0);
  if (!Number.isFinite(change) || change === 0) return "No move";
  if (change > 0) return `Moved up ${change}`;
  return `Moved down ${Math.abs(change)}`;
}

function normalizeOddsRows(result = null, leagueData = null) {
  const backendRows = Array.isArray(result?.preLotteryOdds)
    ? result.preLotteryOdds
    : Array.isArray(result?.lotteryOdds)
    ? result.lotteryOdds
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
        finalPick,
        actualPickOddsPct,
        pickChange: Number(row?.pickChange || 0),
        simulationCount: Number(row?.simulationCount || result?.oddsSimulationCount || result?.meta?.oddsSimulationCount || 0),
      };
    });
  }

  const fallbackRows = Array.isArray(result?.lotteryTeams) ? result.lotteryTeams : [];

  return fallbackRows.map((row) => {
    const clean = normalizePreviewRow(row, leagueData);
    const chanceText = String(row?.chanceLabel || "");
    const parsedChance = Number(chanceText.match(/[0-9.]+/)?.[0] || 0);
    const combinations = Number(row?.combinations || row?.lotteryBalls || row?.balls || 0);

    return {
      ...clean,
      firstPickOddsPct: Number(row?.firstPickOddsPct ?? parsedChance ?? 0),
      topFourOddsPct: Number(row?.topFourOddsPct || 0),
      finalPick: Number(row?.finalPick || 0),
      actualPickOddsPct: Number(row?.actualPickOddsPct || 0),
      pickChange: Number(row?.pickChange || 0),
      combinations,
      simulationCount: Number(result?.oddsSimulationCount || result?.meta?.oddsSimulationCount || 0),
    };
  });
}

function getFinalPickOddsLabel(oddsRow = {}, pickNumber) {
  const finalPick = Number(pickNumber || oddsRow?.finalPick || 0);
  const directOdds = oddsRow?.actualPickOddsPct !== undefined && oddsRow?.actualPickOddsPct !== null
    ? Number(oddsRow.actualPickOddsPct || 0)
    : getPickOddsFromMap(oddsRow, finalPick);

  if (!finalPick || !Number.isFinite(directOdds) || directOdds <= 0) {
    return "Lottery result";
  }

  return `${formatChance(directOdds)} odds at #${finalPick}`;
}

function makePreviewPickRow(pick, round, pickInRound, team, source, chanceLabel) {
  const cleanTeam = normalizePreviewRow(team);

  return {
    pick,
    round,
    pickInRound,
    teamName: cleanTeam.teamName,
    currentOwnerTeamName: cleanTeam.currentOwnerTeamName,
    originalTeamName: cleanTeam.originalTeamName,
    wins: Number(cleanTeam.wins || 0),
    losses: Number(cleanTeam.losses || 0),
    winPct: cleanTeam.winPct,
    madePlayoffs: Boolean(cleanTeam.madePlayoffs),
    madePlayIn: Boolean(cleanTeam.madePlayIn),
    playoffResult: cleanTeam.playoffResult || "",
    leagueRank: cleanTeam.leagueRank,
    conferenceSeed: cleanTeam.conferenceSeed,
    logo: cleanTeam.logo || "",
    source,
    chanceLabel,
    isPreview: true,
  };
}

function getThreeTwoOneBallCount(team = {}, draftRelegatedNames = new Set()) {
  const name = team.teamName || team.name || "";
  const seed = Number(team.conferenceSeed || team.seed || team.playInSeed || 0);
  const madePlayIn = Boolean(team.madePlayIn);
  const playoffResult = String(team.playoffResult || "").toLowerCase();

  if (draftRelegatedNames.has(name)) return 2;

  if (madePlayIn && (seed === 7 || seed === 8 || playoffResult.includes("7") || playoffResult.includes("8"))) {
    return 1;
  }

  if (madePlayIn && (seed === 9 || seed === 10 || playoffResult.includes("9") || playoffResult.includes("10"))) {
    return 2;
  }

  return 3;
}

function buildLotteryPreviewState(leagueData, seasonYear, requestedSystem) {
  const records = sortWorstFirst(
    getTeamRecordsForLottery(leagueData, seasonYear).map((row) => normalizePreviewRow(row, leagueData))
  );
  const resolvedSystem = getResolvedLotterySystem(requestedSystem, seasonYear);
  const allTeamNames = new Set(records.map((row) => row.teamName));

  let firstRoundTeams = [];
  let lotteryTeams = [];
  let lotterySummary = [];

  if (resolvedSystem === "three_two_one") {
    const nonPlayoffTeams = records.filter((row) => !row.madePlayoffs);
    lotteryTeams = (nonPlayoffTeams.length >= 16 ? nonPlayoffTeams : records).slice(0, 16);
    const lotteryNames = new Set(lotteryTeams.map((row) => row.teamName));
    const playoffTeams = records.filter((row) => !lotteryNames.has(row.teamName));
    const draftRelegatedNames = new Set(sortWorstFirst(lotteryTeams).slice(0, 3).map((row) => row.teamName));
    const ballRows = lotteryTeams.map((team) => ({
      team,
      balls: getThreeTwoOneBallCount(team, draftRelegatedNames),
    }));
    const totalBalls = ballRows.reduce((sum, row) => sum + row.balls, 0) || 1;

    lotterySummary = ballRows.map((row, index) => ({
      lotterySeed: index + 1,
      teamName: row.team.teamName,
      wins: row.team.wins,
      losses: row.team.losses,
      winPct: row.team.winPct,
      balls: row.balls,
      combinations: row.balls,
      chanceLabel: `${formatChance((row.balls / totalBalls) * 100)} #1 odds`,
      logo: row.team.logo || "",
    }));

    firstRoundTeams = [...ballRows.map((row) => ({
      ...row.team,
      chanceLabel: `${formatChance((row.balls / totalBalls) * 100)} #1 odds`,
      previewSource: "3-2-1 odds",
    })), ...playoffTeams.map((team) => ({
      ...team,
      chanceLabel: "100%",
      previewSource: "Locked by record",
    }))].slice(0, 30);
  } else {
    const legacyOdds = [14, 14, 14, 12.5, 10.5, 9, 7.5, 6, 4.5, 3, 2, 1.5, 1, 0.5];
    const nonPlayoffTeams = records.filter((row) => !row.madePlayoffs);
    lotteryTeams = (nonPlayoffTeams.length >= 14 ? nonPlayoffTeams : records).slice(0, 14);
    const lotteryNames = new Set(lotteryTeams.map((row) => row.teamName));
    const playoffTeams = records.filter((row) => !lotteryNames.has(row.teamName));

    lotterySummary = lotteryTeams.map((team, index) => ({
      lotterySeed: index + 1,
      teamName: team.teamName,
      wins: team.wins,
      losses: team.losses,
      winPct: team.winPct,
      combinations: legacyOdds[index] || 0,
      chanceLabel: `${formatChance(legacyOdds[index] || 0)} #1 odds`,
      logo: team.logo || "",
    }));

    firstRoundTeams = [...lotteryTeams.map((team, index) => ({
      ...team,
      chanceLabel: `${formatChance(legacyOdds[index] || 0)} #1 odds`,
      previewSource: "Lottery odds",
    })), ...playoffTeams.map((team) => ({
      ...team,
      chanceLabel: "100%",
      previewSource: "Locked by record",
    }))].slice(0, 30);
  }

  const firstRoundOrder = firstRoundTeams.map((team, index) => makePreviewPickRow(
    index + 1,
    1,
    index + 1,
    team,
    team.previewSource || "Preview",
    team.chanceLabel || "100%"
  ));

  const secondRoundOrder = records
    .filter((team) => allTeamNames.has(team.teamName))
    .slice(0, 30)
    .map((team, index) => makePreviewPickRow(
      index + 31,
      2,
      index + 1,
      team,
      "Second round inverse record",
      "100%"
    ));

  return {
    seasonYear,
    generatedAt: new Date().toISOString(),
    isPreview: true,
    lotterySystem: resolvedSystem,
    requestedLotterySystem: requestedSystem,
    secondRoundRevealed: true,
    firstRoundRevealed: true,
    result: {
      ok: true,
      seasonYear,
      source: "reset_preview_inverse_record",
      lotteryTeams: lotterySummary,
      preLotteryOdds: lotterySummary.map((row) => ({
        ...row,
        firstPickOddsPct: Number(String(row.chanceLabel || "").match(/[0-9.]+/)?.[0] || 0),
        topFourOddsPct: 0,
        finalPick: null,
        actualPickOddsPct: 0,
        pickChange: 0,
      })),
      lotteryOdds: lotterySummary.map((row) => ({
        ...row,
        firstPickOddsPct: Number(String(row.chanceLabel || "").match(/[0-9.]+/)?.[0] || 0),
        topFourOddsPct: 0,
        finalPick: null,
        actualPickOddsPct: 0,
        pickChange: 0,
      })),
      topFourDrawn: [],
      firstRoundOrder,
      secondRoundOrder,
      fullDraftOrder: [...firstRoundOrder, ...secondRoundOrder],
      meta: {
        system: resolvedSystem,
        autoResolvedSystem: resolvedSystem,
        isPreview: true,
        rules: resolvedSystem === "three_two_one"
          ? "Preview only: inverse-record reset with 3-2-1 #1 lottery odds shown. Dev Resim Both performs the actual draw."
          : "Preview only: inverse-record reset with legacy #1 lottery odds shown. Dev Resim Both performs the actual draw.",
      },
    },
  };
}

function TeamLogo({ src, name, size = 28 }) {
  if (!src) {
    return <div className="rounded-full bg-neutral-700" style={{ width: size, height: size }} />;
  }

  return <img src={src} alt={name || "Team"} className="object-contain" style={{ width: size, height: size }} />;
}

function PickRow({ pick, revealRank = false, animationIndex = 0 }) {
  const detailText = pick.chanceLabel || String(pick.source || "").replaceAll("_", " ");

  return (
    <div
      className="bmRowEnter grid grid-cols-[70px_1fr_90px_140px] items-center gap-3 px-4 py-3 border-b border-white/10 hover:bg-white/5"
      style={{ animationDelay: `${Math.min(animationIndex, 18) * 18}ms` }}
    >
      <div className="font-extrabold text-orange-300">
        {revealRank ? `#${pick.pick}` : pick.pick}
      </div>
      <div className="flex items-center gap-3 min-w-0">
        <TeamLogo src={pick.logo} name={pick.teamName} />
        <div className="font-bold text-white truncate">{pick.currentOwnerTeamName || pick.teamName}</div>
      </div>
      <div className="text-sm text-white/65 text-center">{formatRecord(pick)}</div>
      <div className="text-xs text-white/45 text-right capitalize">
        {detailText}
      </div>
    </div>
  );
}

function LotteryOddsTable({ rows = [], isPreview = false, firstRoundRevealed = false }) {
  if (!rows.length) return null;

  const simulationCount = rows.find((row) => Number(row?.simulationCount || 0) > 0)?.simulationCount;

  return (
    <div className="bmTablePanel rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden shadow-2xl mb-6">
      <div className="px-5 py-4 bg-neutral-800/80 border-b border-white/10 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold">Lottery Odds</h2>
          <p className="text-sm text-white/50">
            {isPreview
              ? "Pre-lottery odds preview before the order is locked."
              : firstRoundRevealed
              ? "Final lottery result with each team's odds of landing its actual pick."
              : "Pre-lottery odds before the first round reveal."}
          </p>
        </div>
        {simulationCount ? (
          <div className="text-xs text-white/45 font-bold text-right">
            {Number(simulationCount).toLocaleString()} sims
          </div>
        ) : null}
      </div>

      <div className="bmOrangeScrollbar max-h-[420px] overflow-auto">
        <div className="grid grid-cols-[70px_1fr_90px_90px_90px_110px] gap-3 px-4 py-3 bg-black/20 border-b border-white/10 text-xs text-white/45 uppercase tracking-wide font-bold sticky top-0 z-10">
          <div>Seed</div>
          <div>Team</div>
          <div className="text-center">Record</div>
          <div className="text-right">#1 Odds</div>
          <div className="text-right">Top 4</div>
          <div className="text-right">Result</div>
        </div>

        {rows.map((row, index) => {
          const finalPick = Number(row?.finalPick || 0);
          const resultLabel = finalPick
            ? `#${finalPick} - ${formatChance(row?.actualPickOddsPct || getPickOddsFromMap(row, finalPick))}`
            : row?.chanceLabel || "Pending";

          return (
            <div
              key={`${row?.teamName || "team"}-${index}`}
              className="bmRowEnter grid grid-cols-[70px_1fr_90px_90px_90px_110px] items-center gap-3 px-4 py-3 border-b border-white/10 hover:bg-white/5"
              style={{ animationDelay: `${Math.min(index, 18) * 18}ms` }}
            >
              <div className="font-extrabold text-orange-300">#{row?.lotterySeed || index + 1}</div>
              <div className="flex items-center gap-3 min-w-0">
                <TeamLogo src={row?.logo} name={row?.teamName} />
                <div className="min-w-0">
                  <div className="font-bold text-white truncate">{row?.teamName || "Unknown Team"}</div>
                  <div className="text-[11px] text-white/35 truncate">
                    {String(row?.lotteryCategory || "Lottery").replaceAll("_", " ")}
                  </div>
                </div>
              </div>
              <div className="text-sm text-white/65 text-center">{formatRecord(row)}</div>
              <div className="text-sm text-white/75 text-right font-bold">{formatChance(row?.firstPickOddsPct)}</div>
              <div className="text-sm text-white/75 text-right font-bold">
                {Number(row?.topFourOddsPct || 0) > 0 ? formatChance(row?.topFourOddsPct) : "-"}
              </div>
              <div className="text-xs text-white/50 text-right">
                <div className="font-bold text-white/75">{resultLabel}</div>
                {finalPick ? <div>{formatPickChange(row?.pickChange)}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DraftLottery() {
  const navigate = useNavigate();
  const { leagueData, setLeagueData } = useGame();

  const seasonYear = getSeasonYear(leagueData);
  const [lotteryState, setLotteryState] = useState(() => readDraftLottery(seasonYear));
  const [lotterySystem, setLotterySystem] = useState(() => {
    return localStorage.getItem(DEV_LOTTERY_SYSTEM_KEY) || "auto";
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLotteryState(readDraftLottery(seasonYear));
  }, [seasonYear]);

  const latestHistory = useMemo(() => {
    return getLatestSeasonHistoryEntry(leagueData, seasonYear);
  }, [leagueData, seasonYear]);

  const result = lotteryState?.result || null;
  const secondRoundRevealed = Boolean(lotteryState?.secondRoundRevealed);
  const firstRoundRevealed = Boolean(lotteryState?.firstRoundRevealed);
  const isPreview = Boolean(lotteryState?.isPreview || result?.meta?.isPreview);

  const setDevLotterySystem = (system) => {
    setLotterySystem(system);
    localStorage.setItem(DEV_LOTTERY_SYSTEM_KEY, system);
  };

  const persistLotteryResult = (nextLotteryState, draftLotteryComplete = false) => {
    const updatedLeague = {
      ...(leagueData || {}),
      draftState: {
        ...(leagueData?.draftState || {}),
        seasonYear,
        lottery: nextLotteryState.result,
        draftOrder: nextLotteryState.result?.fullDraftOrder || [],
        draftLotteryComplete,
      },
    };

    saveDraftLottery(nextLotteryState);
    persistLeagueData(updatedLeague, setLeagueData);
    setLotteryState(nextLotteryState);

    if (draftLotteryComplete) {
      updateOffseasonState({ draftLotteryComplete: true });
    }

    return nextLotteryState;
  };

  const generateLottery = async ({
    forceNew = false,
    revealSecond = false,
    revealFirst = false,
    systemOverride = lotterySystem,
  } = {}) => {
    const existing = readDraftLottery(seasonYear);
    if (!forceNew && existing?.result?.fullDraftOrder?.length) {
      const nextExisting = {
        ...existing,
        secondRoundRevealed: revealSecond || revealFirst || existing.secondRoundRevealed,
        firstRoundRevealed: revealFirst || existing.firstRoundRevealed,
      };
      return persistLotteryResult(nextExisting, Boolean(nextExisting.firstRoundRevealed));
    }

    if (!leagueData) {
      throw new Error("League data is still loading.");
    }

    if (typeof simEngine.runDraftLottery !== "function") {
      throw new Error("runDraftLottery is not wired in simEnginePy.js yet.");
    }

    const teamRecords = getTeamRecordsForLottery(leagueData, seasonYear);
    const payload = await simEngine.runDraftLottery(leagueData, {
      seasonYear,
      teamRecords,
      lotterySystem: systemOverride,
      forceLotterySystem: systemOverride,
      seed: `${seasonYear}_${systemOverride}_draft_lottery_${Date.now()}_${Math.random()}`,
    });

    if (!payload?.ok) {
      throw new Error(payload?.reason || "Draft lottery failed.");
    }

    const nextLotteryState = {
      seasonYear,
      generatedAt: new Date().toISOString(),
      lotterySystem: payload?.meta?.system || payload?.meta?.autoResolvedSystem || systemOverride,
      requestedLotterySystem: systemOverride,
      secondRoundRevealed: revealSecond || revealFirst,
      firstRoundRevealed: revealFirst,
      result: payload,
    };

    return persistLotteryResult(nextLotteryState, revealFirst);
  };

  const revealSecondRound = async () => {
    setLoading(true);
    setError("");

    try {
      await generateLottery({ revealSecond: true });
    } catch (err) {
      console.error("[DraftLottery] revealSecondRound failed", err);
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  const revealFirstRound = async () => {
    setLoading(true);
    setError("");

    try {
      await generateLottery({ revealSecond: true, revealFirst: true });
    } catch (err) {
      console.error("[DraftLottery] revealFirstRound failed", err);
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  const simAll = async () => {
    setLoading(true);
    setError("");

    try {
      await generateLottery({ revealSecond: true, revealFirst: true });
    } catch (err) {
      console.error("[DraftLottery] simAll failed", err);
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  const resetLotteryPreview = () => {
    try {
      localStorage.removeItem(DRAFT_LOTTERY_KEY);
      const preview = buildLotteryPreviewState(leagueData, seasonYear, lotterySystem);
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

      updateOffseasonState({ draftLotteryComplete: false });
      persistLeagueData(updatedLeague, setLeagueData);
      setLotteryState(preview);
      setError("");
    } catch (err) {
      console.error("[DraftLottery] resetLotteryPreview failed", err);
      setError(String(err?.message || err));
    }
  };

  const devResimAll = async () => {
    setLoading(true);
    setError("");

    try {
      localStorage.removeItem(DRAFT_LOTTERY_KEY);
      await generateLottery({
        forceNew: true,
        revealSecond: true,
        revealFirst: true,
        systemOverride: lotterySystem,
      });
    } catch (err) {
      console.error("[DraftLottery] devResimAll failed", err);
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  const secondRound = result?.secondRoundOrder || [];
  const firstRound = result?.firstRoundOrder || [];
  const oddsRows = useMemo(() => normalizeOddsRows(result, leagueData), [result, leagueData]);
  const oddsByTeam = useMemo(() => {
    const map = new Map();
    for (const row of oddsRows) {
      const key = getTeamKey(row);
      if (key) map.set(key, row);
    }
    return map;
  }, [oddsRows]);
  const firstRoundRevealOrder = useMemo(() => {
    return (firstRound || []).map((pick) => {
      const key = getTeamKey(pick);
      const oddsRow = key ? oddsByTeam.get(key) : null;
      if (!oddsRow) return pick;

      return {
        ...pick,
        chanceLabel: getFinalPickOddsLabel(oddsRow, pick?.pick),
        actualPickOddsPct: oddsRow.actualPickOddsPct,
        pickChange: oddsRow.pickChange,
      };
    });
  }, [firstRound, oddsByTeam]);
  const resultSystemLabel = getResultSystemLabel(result, seasonYear);
  const devSystemLabel = getLotterySystemLabel(lotterySystem, seasonYear);

  if (!leagueData) {
    return (
      <div className="min-h-screen bmCourtPage text-white flex items-center justify-center">
        Loading draft lottery...
      </div>
    );
  }

  return (
    <div className="min-h-screen bmCourtPage text-white py-8 px-4">
      <style>{`
        .bmOrangeScrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(249, 115, 22, 0.92) rgba(12, 12, 12, 0.78);
        }

        .bmOrangeScrollbar::-webkit-scrollbar {
          width: 12px;
          height: 12px;
        }

        .bmOrangeScrollbar::-webkit-scrollbar-track {
          background: rgba(12, 12, 12, 0.78);
          border-left: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 999px;
        }

        .bmOrangeScrollbar::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, #fb923c 0%, #f97316 55%, #ea580c 100%);
          border: 3px solid rgba(12, 12, 12, 0.92);
          border-radius: 999px;
          box-shadow: 0 0 14px rgba(249, 115, 22, 0.22);
        }

        .bmOrangeScrollbar::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, #fdba74 0%, #fb923c 45%, #f97316 100%);
        }
      `}</style>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-8">
          <div>
            <p className="text-xs text-white/40 tracking-[0.25em] uppercase mb-2">Offseason</p>
            <h1 className="text-4xl md:text-5xl font-extrabold text-orange-500">NBA Draft Lottery</h1>
            <p className="text-white/60 mt-2">
              {seasonYear} draft order. Auto uses the old system for 2026 and 3-2-1 from 2027 onward.
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
            <div className="text-lg font-bold mt-1">{result ? resultSystemLabel : devSystemLabel}</div>
          </div>
          <div className="bmSolidPanel rounded-2xl bg-neutral-900 border border-white/10 p-4">
            <div className="text-xs text-white/45 uppercase tracking-wide">Status</div>
            <div className="text-lg font-bold mt-1">
              {isPreview ? "Reset Preview" : firstRoundRevealed ? "Locked" : secondRoundRevealed ? "Round 2 Revealed" : "Ready"}
            </div>
          </div>
        </div>

        <div className="bmSolidPanel rounded-2xl bg-purple-950/30 border border-purple-400/30 p-4 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs text-purple-200/70 uppercase tracking-[0.18em] font-bold">Dev Lottery Tool</div>
              <div className="text-sm text-white/55 mt-1">
                Choose the lottery system, then resimulate both rounds.
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
                  className={`bmSmoothButton px-4 py-2 rounded-xl text-sm font-extrabold border ${
                    lotterySystem === value
                      ? "bg-purple-600 border-purple-300 text-white"
                      : "bg-purple-950/40 border-purple-400/20 text-purple-100/70 hover:bg-purple-800/50"
                  }`}
                >
                  {label}
                </button>
              ))}

              <button
                onClick={resetLotteryPreview}
                disabled={loading}
                className="bmSmoothButton px-5 py-2 rounded-xl bg-purple-950/60 hover:bg-purple-800/70 border border-purple-300/30 disabled:bg-neutral-700 disabled:text-white/45 font-extrabold"
              >
                Reset
              </button>

              <button
                onClick={devResimAll}
                disabled={loading}
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

        <LotteryOddsTable
          rows={oddsRows}
          isPreview={isPreview}
          firstRoundRevealed={firstRoundRevealed}
        />

        <div className="flex flex-wrap gap-3 mb-8">
          <button
            onClick={revealSecondRound}
            disabled={loading || secondRoundRevealed}
            className="bmSmoothButton px-6 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-700 disabled:text-white/45 font-extrabold"
          >
            {loading && !secondRoundRevealed ? "Generating..." : secondRoundRevealed ? "Second Round Revealed" : "Reveal Second Round"}
          </button>

          <button
            onClick={revealFirstRound}
            disabled={loading || !secondRoundRevealed || firstRoundRevealed}
            className="bmSmoothButton px-6 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-700 disabled:text-white/45 font-extrabold"
          >
            {firstRoundRevealed ? "First Round Revealed" : "Reveal First Round"}
          </button>

          <button
            onClick={simAll}
            disabled={loading || (firstRoundRevealed && !isPreview)}
            className="bmSmoothButton px-6 py-3 rounded-xl bg-orange-700 hover:bg-orange-600 disabled:bg-neutral-700 disabled:text-white/45 font-extrabold"
          >
            Sim All
          </button>

          <button
            onClick={() => navigate("/draft")}
            disabled={!firstRoundRevealed || isPreview}
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
                  <PickRow key={`r1-${pick.pick}`} pick={pick} revealRank animationIndex={index} />
                ))}
              </div>
            ) : (
              <div className="p-8 text-white/50 text-center">
                Reveal the first round after the second round, use Sim All, or use Reset for odds preview.
              </div>
            )}
          </div>

          <div className="bmTablePanel rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-neutral-800/80 border-b border-white/10 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-extrabold">Second Round</h2>
                <p className="text-sm text-white/50">Picks 31-60 by inverse record.</p>
              </div>
              <div className="text-sm font-bold text-white/50">{secondRoundRevealed ? "Visible" : "Hidden"}</div>
            </div>

            {secondRoundRevealed ? (
              <div className="bmOrangeScrollbar max-h-[640px] overflow-auto">
                {secondRound.map((pick, index) => (
                  <PickRow key={`r2-${pick.pick}`} pick={pick} animationIndex={index} />
                ))}
              </div>
            ) : (
              <div className="p-8 text-white/50 text-center">Reveal the second round to lock the full draft order.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
