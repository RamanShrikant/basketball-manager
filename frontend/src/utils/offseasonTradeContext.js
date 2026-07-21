import LZString from "lz-string";
import { projectPlayerForNextSeason, progressionProjectionSignature } from "./offseasonProgressionProjection.js";

const OFFSEASON_STATE_KEY = "bm_offseason_state_v1";
const DRAFT_LOTTERY_KEY = "bm_draft_lottery_v1";
const DRAFT_STATE_KEY = "bm_draft_state_v1";
const RESULT_V3_INDEX_KEY = "bm_results_index_v3";
const RESULT_V3_PREFIX = "bm_result_v3_";
const SCHEDULE_KEY = "bm_schedule_v3";
const CUSTOM_DRAFT_CLASS_KEY = "bm_custom_draft_class_v1";
const CUSTOM_DRAFT_CLASS_PREFIX = "bm_custom_draft_class_";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeName(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function safeStorageGet(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {}
}

function parseMaybeCompressed(raw, fallback = null) {
  if (!raw) return fallback;

  try {
    if (raw.startsWith("lz:")) {
      const decompressed = LZString.decompressFromUTF16(raw.slice(3));
      return decompressed ? JSON.parse(decompressed) : fallback;
    }
  } catch {}

  try {
    return JSON.parse(raw);
  } catch {}

  try {
    const decompressed = LZString.decompressFromUTF16(raw);
    return decompressed ? JSON.parse(decompressed) : fallback;
  } catch {
    return fallback;
  }
}

function safeJSON(raw, fallback = null) {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getAllTeams(leagueData = {}) {
  if (Array.isArray(leagueData?.teams)) return leagueData.teams;
  if (leagueData?.conferences && typeof leagueData.conferences === "object") {
    return Object.values(leagueData.conferences).flat().filter(Boolean);
  }
  return [];
}

function getTeamName(team = {}) {
  return team?.name || team?.teamName || team?.team || "";
}

function getPlayerIdentity(player = {}) {
  const id = player?.id ?? player?.playerId ?? player?.player_id ?? player?.uuid ?? null;
  if (id !== null && id !== undefined && String(id).trim()) return `id:${String(id)}`;
  return `name:${normalizeName(player?.name || player?.player || "")}`;
}

function currentSeasonYear(leagueData = {}) {
  const candidates = [
    leagueData?.seasonYear,
    leagueData?.currentSeasonYear,
    leagueData?.seasonStartYear,
    leagueData?.draftYear,
    leagueData?.currentDraftYear,
  ]
    .map(Number)
    .filter((year) => Number.isFinite(year) && year >= 2020 && year <= 2100);
  return candidates.length ? Math.max(...candidates) : 2026;
}

function getSavedStateForYear(key, seasonYear) {
  const saved = safeJSON(safeStorageGet(key), null);
  if (!saved || typeof saved !== "object") return null;
  const savedYear = Number(saved.seasonYear || saved.draftYear || seasonYear);
  if (savedYear && Number(savedYear) !== Number(seasonYear)) return null;
  return saved;
}

function getLockedDraftOrder(leagueData, seasonYear, savedLottery, savedDraftState) {
  const candidates = [
    leagueData?.draftState?.fullDraftOrder,
    leagueData?.draftState?.draftOrder,
    leagueData?.draftState?.lottery?.fullDraftOrder,
    leagueData?.draftLottery?.fullDraftOrder,
    savedLottery?.result?.fullDraftOrder,
    savedLottery?.fullDraftOrder,
    savedDraftState?.draftOrder,
  ];
  return candidates.find((rows) => Array.isArray(rows) && rows.length) || [];
}

function getDraftProspects(leagueData, seasonYear, savedDraftState) {
  const directCandidates = [
    savedDraftState?.availableProspects,
    savedDraftState?.draftClass,
    leagueData?.draftState?.draft?.availableProspects,
    leagueData?.draftState?.draft?.draftClass,
    leagueData?.draftState?.availableProspects,
    leagueData?.draftState?.draftClass,
  ];
  const direct = directCandidates.find((rows) => Array.isArray(rows) && rows.length);
  if (direct) return direct;

  const seasonPayload = safeJSON(safeStorageGet(`${CUSTOM_DRAFT_CLASS_PREFIX}${seasonYear}`), null);
  const defaultPayload = safeJSON(safeStorageGet(CUSTOM_DRAFT_CLASS_KEY), null);
  const payload = seasonPayload || defaultPayload;
  if (Array.isArray(payload)) return payload;
  return payload?.draftClass || payload?.prospects || payload?.players || [];
}

function getLotteryOddsRows(leagueData, savedLottery) {
  const candidates = [
    savedLottery?.result?.preLotteryOdds,
    savedLottery?.result?.lotteryOdds,
    savedLottery?.result?.oddsMatrix,
    savedLottery?.preLotteryOdds,
    savedLottery?.lotteryOdds,
    savedLottery?.oddsMatrix,
    leagueData?.draftState?.lottery?.preLotteryOdds,
    leagueData?.draftState?.lottery?.lotteryOdds,
    leagueData?.draftLottery?.preLotteryOdds,
    leagueData?.draftLottery?.lotteryOdds,
  ];
  return candidates.find((rows) => Array.isArray(rows) && rows.length) || [];
}

function normalizeLotteryOddsByTeam(rows = []) {
  const out = {};
  for (const row of rows || []) {
    const teamName = row?.teamName || row?.name || row?.team || row?.originalTeamName || "";
    const key = normalizeName(teamName);
    if (!key) continue;
    const rawMap = row?.oddsByPick && typeof row.oddsByPick === "object" ? row.oddsByPick : {};
    const oddsByPick = {};
    for (const [slot, chance] of Object.entries(rawMap)) {
      const pick = Number(slot);
      const pct = Number(chance);
      if (!Number.isFinite(pick) || pick < 1 || pick > 30 || !Number.isFinite(pct) || pct <= 0) continue;
      oddsByPick[String(pick)] = pct;
    }
    if (Object.keys(oddsByPick).length) out[key] = { teamName, oddsByPick };
  }
  return out;
}

function getLatestHistoryTeamRows(leagueData = {}, seasonYear = 0) {
  const history = Array.isArray(leagueData?.seasonHistory) ? leagueData.seasonHistory : [];
  const usable = history
    .filter((entry) => entry && Array.isArray(entry.teams) && entry.teams.length)
    .sort((a, b) => {
      const aExact = Number(a?.seasonYear) === Number(seasonYear) ? 1 : 0;
      const bExact = Number(b?.seasonYear) === Number(seasonYear) ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return Number(b?.seasonYear || 0) - Number(a?.seasonYear || 0);
    });
  return usable[0]?.teams || [];
}

function recordMapFromHistory(leagueData = {}, seasonYear = 0) {
  const rows = getLatestHistoryTeamRows(leagueData, seasonYear);
  const map = {};
  for (const row of rows) {
    const teamName = row?.teamName || row?.name || row?.team || "";
    if (!teamName) continue;
    const w = toNumber(row?.wins ?? row?.w, 0);
    const l = toNumber(row?.losses ?? row?.l, 0);
    const gp = toNumber(row?.gamesPlayed ?? row?.gp, w + l);
    map[teamName] = {
      w,
      l,
      gp,
      pf: toNumber(row?.pointsFor ?? row?.pf, 0),
      pa: toNumber(row?.pointsAgainst ?? row?.pa, 0),
      conferenceSeed: toNumber(row?.conferenceSeed ?? row?.confSeed ?? row?.seed, 0),
      leagueRank: toNumber(row?.leagueRank, 0),
      madePlayoffs: Boolean(row?.madePlayoffs),
      madePlayIn: Boolean(row?.madePlayIn),
      lostSevenEightGame: Boolean(row?.lostSevenEightGame),
    };
  }
  return map;
}

function expected321PickFromLeagueRank(rank = 0) {
  const n = Number(rank || 0);
  if (n >= 21 && n <= 27) return 28 - n;
  if (n >= 28 && n <= 30) return 38 - n;
  if (n >= 15 && n <= 20) return 31 - n;
  return 0;
}

function buildPreLotteryExpectedSlots(records = {}, lotterySystem = "legacy_14") {
  const rows = Object.entries(records || {})
    .map(([teamName, row]) => {
      const gp = Math.max(0, toNumber(row?.gp, toNumber(row?.w, 0) + toNumber(row?.l, 0)));
      const winPct = gp > 0 ? toNumber(row?.w, 0) / gp : 0.5;
      return { teamName, row, winPct };
    })
    .sort((a, b) => a.winPct - b.winPct || toNumber(a?.row?.pf, 0) - toNumber(b?.row?.pf, 0));

  const out = {};
  rows.forEach((entry, index) => {
    const worstFirstIndex = index + 1;
    const leagueRank = toNumber(entry?.row?.leagueRank, 30 - index) || 30 - index;
    let expectedSlot = 0;
    if (lotterySystem === "three_two_one") {
      expectedSlot = expected321PickFromLeagueRank(leagueRank);
      if (!expectedSlot && worstFirstIndex <= 16) expectedSlot = worstFirstIndex;
    } else if (worstFirstIndex <= 14) {
      const powerRank = 31 - worstFirstIndex;
      if (powerRank >= 29.5) expectedSlot = 3.15;
      else if (powerRank >= 28.5) expectedSlot = 3.75;
      else if (powerRank >= 27.5) expectedSlot = 4.35;
      else expectedSlot = worstFirstIndex;
    }
    if (expectedSlot > 0) {
      out[normalizeName(entry.teamName)] = {
        teamName: entry.teamName,
        expectedSlot,
        leagueRank,
        source: lotterySystem === "three_two_one" ? "final_record_321_projection" : "final_record_legacy_projection",
      };
    }
  });
  return out;
}

function captureRecordSnapshot(leagueData = {}, seasonYear = 0) {
  const existing = safeJSON(safeStorageGet("bm_offseason_trade_record_snapshot_v1"), null);
  const schedule = parseMaybeCompressed(safeStorageGet(SCHEDULE_KEY), {}) || {};
  const ids = parseMaybeCompressed(safeStorageGet(RESULT_V3_INDEX_KEY), []) || [];
  const results = {};

  for (const id of ids) {
    const result = parseMaybeCompressed(safeStorageGet(`${RESULT_V3_PREFIX}${id}`), null);
    if (result) results[String(id)] = result;
  }

  const map = {};
  const ensure = (teamName) => {
    if (!teamName) return null;
    if (!map[teamName]) map[teamName] = { w: 0, l: 0, gp: 0, pf: 0, pa: 0 };
    return map[teamName];
  };

  for (const games of Object.values(schedule || {})) {
    for (const game of games || []) {
      if (!game?.id) continue;
      const result = results[String(game.id)];
      if (!game.played && !result) continue;
      const homePts = Number(result?.totals?.home ?? result?.winner?.home);
      const awayPts = Number(result?.totals?.away ?? result?.winner?.away);
      if (!Number.isFinite(homePts) || !Number.isFinite(awayPts) || homePts === awayPts) continue;
      const home = ensure(game.home);
      const away = ensure(game.away);
      if (!home || !away) continue;
      home.gp += 1;
      away.gp += 1;
      home.pf += homePts;
      home.pa += awayPts;
      away.pf += awayPts;
      away.pa += homePts;
      if (homePts > awayPts) {
        home.w += 1;
        away.l += 1;
      } else {
        away.w += 1;
        home.l += 1;
      }
    }
  }

  const historyMap = recordMapFromHistory(leagueData, seasonYear);
  const currentGames = Object.values(map).reduce((sum, row) => sum + Number(row?.gp || 0), 0);
  const historyGames = Object.values(historyMap).reduce((sum, row) => sum + Number(row?.gp || 0), 0);
  const existingGames = Object.values(existing?.records || {}).reduce((sum, row) => sum + Number(row?.gp || 0), 0);
  const candidates = [
    { records: map, games: currentGames },
    { records: historyMap, games: historyGames },
    { records: existing?.records || {}, games: existingGames },
  ].sort((a, b) => b.games - a.games);
  const best = candidates[0];
  if (best.games > 0 && best.games >= existingGames) {
    safeStorageSet(
      "bm_offseason_trade_record_snapshot_v1",
      JSON.stringify({ capturedAt: Date.now(), seasonYear, records: best.records })
    );
  }
  return best.records || {};
}

function determineStage({ inOffseason, lotteryRevealed, draftComplete, draftInProgress, offseasonState }) {
  if (!inOffseason) return "regular_season";
  if (draftComplete) {
    if (offseasonState?.freeAgencyComplete) return "post_free_agency";
    if (offseasonState?.freeAgencyStarted || offseasonState?.freeAgencyActive) return "free_agency";
    return "post_draft";
  }
  if (draftInProgress) return "live_draft";
  if (lotteryRevealed) return "post_lottery_pre_draft";
  return "pre_lottery";
}

export function getOffseasonTradeContext(leagueData = {}, explicitContext = null) {
  const embedded = explicitContext || leagueData?.__offseasonTradeContext;
  if (embedded && typeof embedded === "object" && embedded.version) return embedded;

  const seasonYear = currentSeasonYear(leagueData);
  const offseasonState = getSavedStateForYear(OFFSEASON_STATE_KEY, seasonYear) || leagueData?.offseasonState || {};
  const savedLottery = getSavedStateForYear(DRAFT_LOTTERY_KEY, seasonYear);
  const savedDraftState = getSavedStateForYear(DRAFT_STATE_KEY, seasonYear);
  const rawDraftOrder = getLockedDraftOrder(leagueData, seasonYear, savedLottery, savedDraftState);
  const firstRoundRevealed = Boolean(
    savedLottery?.firstRoundRevealed ||
      offseasonState?.draftLotteryComplete ||
      leagueData?.draftState?.draftLotteryComplete ||
      (rawDraftOrder.length >= 30 && savedDraftState)
  );
  const secondRoundRevealed = Boolean(
    savedLottery?.secondRoundRevealed ||
      offseasonState?.draftLotteryComplete ||
      leagueData?.draftState?.draftLotteryComplete ||
      (rawDraftOrder.length >= 60 && savedDraftState)
  );
  // DraftLottery pre-generates a hidden full order before the reveal animation.
  // Never attach that hidden order to Trade Finder/Builder: doing so would leak
  // exact picks before the user has completed the lottery. Odds remain available
  // for expected-value calculations, while resolved assets unlock only after both
  // rounds have been revealed and the offseason state marks the lottery complete.
  const lotteryRevealed = Boolean(firstRoundRevealed && secondRoundRevealed);
  const draftOrder = lotteryRevealed ? rawDraftOrder : [];
  const draftComplete = Boolean(
    offseasonState?.draftComplete ||
      savedDraftState?.completed ||
      leagueData?.draftState?.completed ||
      leagueData?.draftState?.draft?.completed
  );
  const currentPickIndex = Number(
    savedDraftState?.currentPickIndex ??
      leagueData?.draftState?.draft?.currentPickIndex ??
      leagueData?.draftState?.currentPickIndex ??
      0
  );
  const draftInProgress = Boolean(!draftComplete && currentPickIndex > 0);
  const inOffseason = Boolean(
    offseasonState?.inOffseason ||
      offseasonState?.offseason ||
      offseasonState?.active ||
      offseasonState?.started ||
      offseasonState?.retirementsComplete ||
      offseasonState?.teamOptionsComplete ||
      offseasonState?.draftLotteryComplete ||
      offseasonState?.draftComplete ||
      offseasonState?.rookieSigningsComplete ||
      offseasonState?.freeAgencyComplete ||
      savedLottery ||
      savedDraftState ||
      leagueData?.draftState?.draftLotteryComplete ||
      leagueData?.draftState?.draftOrder?.length
  );

  const prospects = getDraftProspects(leagueData, seasonYear, savedDraftState);
  const lotteryOddsByTeam = normalizeLotteryOddsByTeam(getLotteryOddsRows(leagueData, savedLottery));
  const attachedRecords = leagueData?.__offseasonTradeRecords;
  const records = attachedRecords && typeof attachedRecords === "object" && Object.keys(attachedRecords).length
    ? attachedRecords
    : captureRecordSnapshot(leagueData, seasonYear);
  const lotterySystem = String(
    savedLottery?.lotterySystem ||
      savedLottery?.result?.meta?.system ||
      leagueData?.draftState?.lottery?.meta?.system ||
      (Number(seasonYear) >= 2027 ? "three_two_one" : "legacy_14")
  );
  const preLotteryExpectedSlotByTeam = buildPreLotteryExpectedSlots(records, lotterySystem);

  return {
    version: 2,
    seasonYear,
    targetSeasonYear: seasonYear + 1,
    inOffseason,
    stage: determineStage({ inOffseason, lotteryRevealed, draftComplete, draftInProgress, offseasonState }),
    lotteryRevealed,
    firstRoundRevealed,
    secondRoundRevealed,
    draftOrderLocked: Boolean(lotteryRevealed && draftOrder.length >= 60),
    draftComplete,
    draftInProgress,
    currentPickIndex,
    progressionComplete: Boolean(offseasonState?.progressionComplete || leagueData?.draftState?.progressionComplete),
    useProjectedNextSeasonRatings: Boolean(inOffseason && !(offseasonState?.progressionComplete || leagueData?.draftState?.progressionComplete)),
    draftOrder,
    lotterySystem,
    lotteryOddsByTeam,
    preLotteryExpectedSlotByTeam,
    draftProspects: Array.isArray(prospects) ? prospects : [],
    recordSnapshot: records,
    enforceRegularSeasonRosterLimits: !inOffseason,
  };
}

function isCurrentOffseasonRookie(player = {}, source = "", context = {}) {
  if (source === "pending_rookie") return true;
  const currentDraftYear = Number(context?.seasonYear || 0);
  const meta = player?.meta && typeof player.meta === "object" ? player.meta : {};
  const draftYear = Number(
    meta?.draftYear ??
      player?.draftYear ??
      player?.draftClassYear ??
      player?.draftedYear ??
      player?.rookieDraftYear ??
      player?.draft?.year ??
      player?.contract?.draftYear ??
      0
  );
  const acquiredVia = String(meta?.acquiredVia || player?.acquiredVia || "").toLowerCase();
  const playerId = String(player?.id || "").toLowerCase();
  if (currentDraftYear && draftYear === currentDraftYear) {
    return Boolean(
      acquiredVia.includes("draft") ||
        playerId.startsWith(`rookie_${currentDraftYear}_`) ||
        player?.rights?.rookieScale ||
        player?.rookieSigningPending ||
        player?.draftRightsOnly ||
        player?.contract?.unsignedRookie
    );
  }
  return Boolean(player?.isCurrentDraftRookie || player?.rookieSigningPending || player?.draftRightsOnly || player?.contract?.unsignedRookie);
}

function cloneProjectionPlayer(player, teamName, source, context = {}) {
  const shouldProject = Boolean(context?.useProjectedNextSeasonRatings) && !isCurrentOffseasonRookie(player, source, context);
  const projected = shouldProject
    ? projectPlayerForNextSeason(player, { seasonYear: context?.targetSeasonYear || 0 })
    : { ...(player || {}) };
  return {
    ...projected,
    __offseasonTradeProjectionOnly: true,
    __offseasonTradeProjectionSource: source,
    __offseasonTradeProjectionTeam: teamName,
    __offseasonProjectionSkippedForCurrentRookie: Boolean(!shouldProject && isCurrentOffseasonRookie(player, source, context)),
  };
}

function isExplicitRelease(player = {}) {
  const reason = String(
    player?.freeAgencyMeta?.reason ||
      player?.freeAgencyReason ||
      player?.releaseReason ||
      player?.meta?.freeAgencyReason ||
      ""
  ).toLowerCase();
  return /release|waiv|undrafted|emergency/.test(reason);
}

function getProjectionOriginTeam(player = {}) {
  return (
    player?.freeAgencyMeta?.fromTeam ||
    player?.freeAgencyMeta?.teamName ||
    player?.previousTeamName ||
    player?.rights?.heldByTeam ||
    player?.offseasonOriginTeamName ||
    ""
  );
}

function addProjectionPlayer(teamPlayers, seen, player, teamName, source, context = {}) {
  if (!player || typeof player !== "object") return;
  const identity = getPlayerIdentity(player);
  if (!identity || seen.has(identity)) return;
  seen.add(identity);
  teamPlayers.push(cloneProjectionPlayer(player, teamName, source, context));
}

function cloneTeamWithProjection(team = {}, projectedPlayers = []) {
  return {
    ...team,
    players: projectedPlayers,
    __offseasonTradeProjectedRoster: true,
  };
}

export function buildOffseasonTradeEvaluationLeague(leagueData = {}, explicitContext = null) {
  const context = getOffseasonTradeContext(leagueData, explicitContext);
  if (!context.inOffseason) {
    return {
      leagueData: {
        ...leagueData,
        __offseasonTradeContext: context,
        __offseasonTradeRecords: context.recordSnapshot || {},
      },
      context,
    };
  }

  const teams = getAllTeams(leagueData);
  const teamRows = new Map();
  const globallyActual = new Set();

  for (const team of teams) {
    for (const player of Array.isArray(team?.players) ? team.players : []) {
      globallyActual.add(getPlayerIdentity(player));
    }
  }

  for (const team of teams) {
    const teamName = getTeamName(team);
    const players = (Array.isArray(team?.players) ? team.players : []).map((player) =>
      cloneProjectionPlayer(player, teamName, "actual_roster", context)
    );
    const seen = new Set(players.map(getPlayerIdentity));

    for (const rookie of Array.isArray(team?.pendingRookieSignings) ? team.pendingRookieSignings : []) {
      addProjectionPlayer(players, seen, rookie, teamName, "pending_rookie", context);
    }

    teamRows.set(normalizeName(teamName), cloneTeamWithProjection(team, players));
  }

  for (const freeAgent of Array.isArray(leagueData?.freeAgents) ? leagueData.freeAgents : []) {
    if (!freeAgent || typeof freeAgent !== "object" || isExplicitRelease(freeAgent)) continue;
    const identity = getPlayerIdentity(freeAgent);
    if (!identity || globallyActual.has(identity)) continue;
    const originTeam = getProjectionOriginTeam(freeAgent);
    const row = teamRows.get(normalizeName(originTeam));
    if (!row) continue;
    const seen = new Set((row.players || []).map(getPlayerIdentity));
    addProjectionPlayer(row.players, seen, freeAgent, getTeamName(row), "unsigned_return_assumption", context);
  }

  let projectedLeague;
  if (Array.isArray(leagueData?.teams)) {
    projectedLeague = {
      ...leagueData,
      teams: leagueData.teams.map((team) => teamRows.get(normalizeName(getTeamName(team))) || team),
    };
  } else if (leagueData?.conferences && typeof leagueData.conferences === "object") {
    projectedLeague = {
      ...leagueData,
      conferences: Object.fromEntries(
        Object.entries(leagueData.conferences).map(([conferenceName, conferenceTeams]) => [
          conferenceName,
          (Array.isArray(conferenceTeams) ? conferenceTeams : []).map(
            (team) => teamRows.get(normalizeName(getTeamName(team))) || team
          ),
        ])
      ),
    };
  } else {
    projectedLeague = { ...leagueData };
  }

  projectedLeague.__offseasonTradeContext = context;
  projectedLeague.__offseasonTradeRecords = context.recordSnapshot || {};
  projectedLeague.__offseasonTradeEvaluationLeague = true;

  return { leagueData: projectedLeague, context };
}

export function attachOffseasonTradeContext(leagueData = {}, explicitContext = null) {
  const context = getOffseasonTradeContext(leagueData, explicitContext);
  return {
    ...leagueData,
    __offseasonTradeContext: context,
    __offseasonTradeRecords: context.recordSnapshot || {},
  };
}

export function getTeamFromTradeLeague(leagueData = {}, teamName = "") {
  const key = normalizeName(teamName);
  return getAllTeams(leagueData).find((team) => normalizeName(getTeamName(team)) === key) || null;
}

export function isOffseasonTradeProjectionPlayer(player = {}) {
  return Boolean(player?.__offseasonTradeProjectionOnly);
}

export function getOffseasonTradeContextSignature(context = {}) {
  const prospectRows = Array.isArray(context?.draftProspects) ? context.draftProspects : [];
  const prospectSignature = prospectRows
    .slice(0, 72)
    .map((row) => [row?.id || row?.name || "", row?.overall || row?.ovr || 0, row?.potential || row?.pot || 0])
    .join(";");
  return [
    context?.seasonYear,
    context?.stage,
    context?.lotteryRevealed ? 1 : 0,
    context?.draftComplete ? 1 : 0,
    context?.progressionComplete ? 1 : 0,
    context?.useProjectedNextSeasonRatings ? 1 : 0,
    context?.currentPickIndex || 0,
    prospectSignature,
  ].join("|");
}

export function getOffseasonProjectedRosterSignature(leagueData = {}) {
  return getAllTeams(leagueData)
    .flatMap((team) => (team?.players || []).map((player) => progressionProjectionSignature(player)))
    .join(";");
}
