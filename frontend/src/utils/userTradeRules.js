import { getLeagueFinancialRules } from "./leagueFinancials.js";
import { getContractSeasonYear, getSeasonCalendarConfig } from "./seasonContext.js";
import {
  getOffseasonTradeContext,
} from "./offseasonTradeContext.js";
import {
  addIsoDays,
  formatLeagueDate,
  getOffseasonCurrentDate,
  normalizeIsoDate,
  readLeagueClock,
} from "./leagueClock.js";
import {
  DEFAULT_TRADE_RULE_SETTINGS,
  normalizeTradeRuleSettings,
} from "./tradeRuleSettings.js";
import {
  getTradePickBaseProtectionLabel,
  isProtectedDraftPickAsset,
  isResolvedDraftPickAsset,
  isSwapDraftPickAsset,
  normalizeDraftPicks,
  normalizeTeamName,
} from "./draftPicks.js";
import { bumpPerfCounter } from "./bmPerfRescueDebug.js";

const TRADE_DEADLINE_STATUS_KEY = "bm_trade_deadline_status_v1";
const USER_TRADE_RULE_META_KEY = "userTradeRuleMeta";
const TRADE_RULE_STATE_KEY = "tradeRuleState";
const tradeRuleTransactionIndexCache = new WeakMap();
const tradeHistoryAcquisitionIndexCache = new WeakMap();
const normalizedLeaguePicksCache = new WeakMap();
const playerEligibilityResultCache = new WeakMap();
const pickEligibilityResultCache = new WeakMap();
const stepienViolationsCache = new WeakMap();
const secondApronFurthestFirstCache = new WeakMap();
const SALARY_TOLERANCE = 1_000;
const MATCHING_SMALL_OUTGOING = 7_500_000;
const MATCHING_MID_OUTGOING = 29_000_000;
const MATCHING_BUFFER = 250_000;

function safeJSON(raw, fallback = null) {
  try {
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

function teamNameOf(team = {}) {
  return team?.name || team?.teamName || team?.team || "";
}

function playerNameOf(player = {}) {
  return player?.name || player?.player || "Unknown Player";
}

function playerIdentity(player = {}) {
  const id = player?.id ?? player?.playerId ?? player?.player_id ?? player?.uuid ?? null;
  if (id !== null && id !== undefined && String(id).trim()) return `id:${String(id)}`;
  return `name:${normalizeTeamName(playerNameOf(player))}`;
}

function samePlayer(a = {}, b = {}) {
  const aId = playerIdentity(a);
  const bId = playerIdentity(b);
  return Boolean(aId && bId && aId === bId);
}

function getTeamByName(leagueData = {}, teamName = "") {
  const key = normalizeTeamName(teamName);
  return getAllTeams(leagueData).find((team) => normalizeTeamName(teamNameOf(team)) === key) || null;
}

function resolveTeamNameForTradeRules({ leagueData = {}, teamName = "", pick = null, outgoingItems = [], incomingItems = [] } = {}) {
  const exact = getTeamByName(leagueData, teamName);
  if (exact) return teamNameOf(exact);

  const candidateNames = [];
  const addName = (value) => {
    const name = String(value || "").trim();
    if (name) candidateNames.push(name);
  };

  // Pick selectors sometimes pass a short/empty UI team value, especially in
  // Trade Finder. Stepien must use the actual owner stored on the pick ledger.
  addName(pickOwner(pick || {}));
  for (const item of outgoingItems || []) {
    if (item?.type === "pick" && item.pick) addName(pickOwner(item.pick));
  }
  for (const item of incomingItems || []) {
    if (item?.type === "pick" && item.pick) addName(pickOwner(item.pick));
  }

  for (const candidate of candidateNames) {
    const team = getTeamByName(leagueData, candidate);
    if (team) return teamNameOf(team);
  }

  return String(teamName || "").trim();
}

function getCurrentSeasonStartYear(leagueData = {}) {
  const candidates = [
    leagueData?.seasonStartYear,
    leagueData?.currentSeasonYear,
    leagueData?.seasonYear,
  ]
    .map(Number)
    .filter((year) => Number.isFinite(year) && year >= 2020 && year <= 2100);
  return candidates.length ? Math.min(...candidates) : 2026;
}

function getCurrentDraftYear(leagueData = {}, tradeContext = null) {
  const context = tradeContext || getOffseasonTradeContext(leagueData);
  if (Number.isFinite(Number(context?.seasonYear))) {
    const contextYear = Number(context.seasonYear);
    return context?.inOffseason ? contextYear : contextYear + 1;
  }
  const start = getCurrentSeasonStartYear(leagueData);
  return context?.inOffseason ? start : start + 1;
}

function utcMs(isoDate) {
  const iso = normalizeIsoDate(isoDate);
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function compareIsoDates(a, b) {
  const aMs = utcMs(a);
  const bMs = utcMs(b);
  if (aMs === null || bMs === null) return null;
  return aMs === bMs ? 0 : aMs < bMs ? -1 : 1;
}

function addIsoMonths(value, months) {
  const iso = normalizeIsoDate(value);
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + Number(months || 0));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return date.toISOString().slice(0, 10);
}


export function getUserTradeRuleSettings(leagueData = {}) {
  return normalizeTradeRuleSettings(
    leagueData?.settings?.tradeRules || DEFAULT_TRADE_RULE_SETTINGS
  );
}

function readCalendarCursorDateForYear(seasonYear) {
  if (typeof localStorage === "undefined") return null;
  const year = Number(seasonYear);
  if (!Number.isFinite(year) || year < 2020 || year > 2100) return null;
  const keys = [
    `bm_calendar_sim_cursor_v1_${year}`,
    `bm_calendar_cursor_v1_${year}`,
  ];
  for (const key of keys) {
    try {
      const parsed = safeJSON(localStorage.getItem(key), null);
      const date = typeof parsed === "string" ? parsed : parsed?.date || parsed?.currentDate || null;
      const iso = normalizeIsoDate(date);
      if (iso) return iso;
    } catch {}
  }
  return null;
}

function latestIsoDate(values = []) {
  const dates = values.map(normalizeIsoDate).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

function getDirectUserTradeDate(leagueData = {}) {
  const clock = readLeagueClock();
  const seasonStartYear = getCurrentSeasonStartYear(leagueData);
  const candidates = [
    clock?.date,
    leagueData?.__userTradeRules?.currentDate,
    leagueData?.currentDate,
    leagueData?.leagueDate,
    leagueData?.today,
    leagueData?.date,
    leagueData?.calendar?.currentDate,
    leagueData?.scheduleState?.currentDate,
    leagueData?.seasonState?.currentDate,
    readCalendarCursorDateForYear(seasonStartYear),
    readCalendarCursorDateForYear(seasonStartYear - 1),
    readCalendarCursorDateForYear(seasonStartYear + 1),
  ];

  // Use the latest real league cursor instead of the first stored value. This
  // prevents stale offseason/July localStorage from keeping Dec. 15 locks alive
  // once the user has advanced into the regular-season calendar.
  return latestIsoDate(candidates);
}

function readClockPhase() {
  const clock = readLeagueClock();
  return String(clock?.phase || "").toLowerCase();
}

function shouldUseOffseasonDateForUserTrades(leagueData = {}, context = null) {
  const direct = getDirectUserTradeDate(leagueData);
  const phase = readClockPhase();
  const seasonStartYear = getCurrentSeasonStartYear(leagueData);

  // This is the important Stepien guard: a stale draft/offseason localStorage
  // payload from an older test save must not make the trade screens think the
  // current draft is already resolved while the active league clock is in the
  // regular season. If the real league clock says regular season, use that.
  if (phase === "regularseason" || phase === "regular_season") return false;

  // If a real direct date is before the offseason year/month window, this is
  // still preseason/regular season/postseason for the current league year.
  // Example: 2026-10-20 in the 2026-27 season => 2027 picks are future picks.
  if (direct) {
    const [year, month] = direct.split("-").map(Number);
    if (Number.isFinite(year) && Number.isFinite(month)) {
      const draftYear = seasonStartYear + 1;
      if (year < draftYear || (year === draftYear && month < 6)) return false;
    }
  }

  const state = leagueData?.offseasonState || {};
  const leagueHasOffseasonState = Boolean(
    state?.inOffseason ||
      state?.offseason ||
      state?.active ||
      state?.started ||
      state?.retirementsComplete ||
      state?.draftLotteryComplete ||
      state?.draftComplete ||
      state?.rookieSigningsComplete ||
      state?.freeAgencyComplete ||
      leagueData?.draftState?.draftLotteryComplete ||
      leagueData?.draftState?.draft?.completed ||
      leagueData?.draftState?.completed
  );

  return Boolean(leagueHasOffseasonState || context?.inOffseason);
}

export function getUserTradeCurrentDate(leagueData = {}) {
  const direct = getDirectUserTradeDate(leagueData);
  const context = getOffseasonTradeContext(leagueData);

  if (context?.inOffseason && shouldUseOffseasonDateForUserTrades(leagueData, context)) {
    return getOffseasonCurrentDate({
      seasonYear: context?.seasonYear,
      offseasonState: leagueData?.offseasonState || {},
      leagueData,
    });
  }

  if (direct) return direct;

  // Imported July/preseason roster files do not always carry an active calendar
  // cursor yet. User trade restrictions still need a stable league date before
  // opening night, so default to July 30 of the season-start year. Once the
  // schedule/playoffs/offseason clock exists, the candidates above always win.
  const seasonStartYear = getCurrentSeasonStartYear(leagueData);
  return `${seasonStartYear}-07-30`;
}

export function getUserTradeDeadlineStatus(leagueData = {}) {
  const settings = getUserTradeRuleSettings(leagueData);
  if (!settings.tradeDeadline) {
    return { enabled: false, locked: false, reason: "" };
  }

  const context = getOffseasonTradeContext(leagueData);
  if (context?.inOffseason) return { enabled: true, locked: false, reason: "" };

  const status = typeof localStorage !== "undefined"
    ? safeJSON(localStorage.getItem(TRADE_DEADLINE_STATUS_KEY), null)
    : null;
  const seasonStartYear = getCurrentSeasonStartYear(leagueData);
  const calendarConfig = getSeasonCalendarConfig({
    ...(leagueData || {}),
    seasonYear: seasonStartYear,
    currentSeasonYear: seasonStartYear,
    seasonStartYear,
  });
  const deadlineDate = normalizeIsoDate(
    status?.deadlineDate ||
      status?.date ||
      calendarConfig?.tradeDeadlineDate ||
      `${seasonStartYear + 1}-02-04`
  );
  const currentDate = getUserTradeCurrentDate(leagueData);
  const deadlineDayOfferOpen = Boolean(
    status?.deadlineDayOfferOpen ||
      status?.offerWindowOpen ||
      status?.promptOpen ||
      status?.phase === "deadline_day_open" ||
      status?.phase === "deadline_day" ||
      (
        status?.promptHandled &&
        status?.promptChoice === "trade_center" &&
        !status?.lockedAt &&
        status?.locked !== true
      )
  );

  // When the calendar pauses on deadline day and the user chooses to make
  // trades, trade screens may still see a later calendar dropdown/cursor date
  // from the sim target. Treat that paused deadline-day offer window as open
  // until simulation actually resumes past the deadline and writes locked=true.
  if (deadlineDayOfferOpen && status?.locked !== true) {
    return {
      enabled: true,
      locked: false,
      deadlineDate,
      currentDate: deadlineDate || currentDate,
      deadlineDayOfferOpen: true,
      reason: "",
      message: deadlineDate
        ? `Today is the ${formatLeagueDate(deadlineDate)} trade deadline. Make final trades before resuming.`
        : "Today is the trade deadline. Make final trades before resuming.",
    };
  }

  const dateLocked = Boolean(
    currentDate &&
      deadlineDate &&
      compareIsoDates(currentDate, deadlineDate) > 0
  );
  const locked = Boolean(status?.locked || dateLocked);

  return {
    enabled: true,
    locked,
    deadlineDate,
    currentDate,
    deadlineDayOfferOpen: false,
    reason: locked
      ? `The ${formatLeagueDate(deadlineDate)} trade deadline has passed. New user trade offers are locked until the offseason.`
      : "",
  };
}

function getPlayerSalaryForYear(player = {}, payrollSeasonYear) {
  const contract = player?.contract && typeof player.contract === "object" ? player.contract : {};
  const salaries = Array.isArray(contract?.salaryByYear)
    ? contract.salaryByYear.map((value) => Number(value) || 0)
    : [];
  if (salaries.length) {
    let startYear = Number(contract.startYear || payrollSeasonYear);
    let index = Number(payrollSeasonYear) - startYear;
    if (salaries.length === 1 && startYear === payrollSeasonYear - 1 && (index < 0 || index >= salaries.length)) {
      startYear = payrollSeasonYear;
      index = 0;
    }
    if (!Number.isFinite(index) || index < 0) index = 0;
    if (index >= salaries.length) index = salaries.length - 1;
    return Number(salaries[index] || 0);
  }
  const fallback = Number(
    player?.salary ?? player?.currentSalary ?? player?.contractSalary ?? player?.capHit ?? player?.aav ?? 0
  );
  return Number.isFinite(fallback) ? fallback : 0;
}

export function getUserTradePlayerSalary(player = {}, leagueData = {}) {
  return getPlayerSalaryForYear(player, getContractSeasonYear(leagueData || {}));
}

export function getUserTradeSideSalary(items = [], leagueData = {}) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    if (item?.type !== "player" || !item.player) return sum;
    return sum + getUserTradePlayerSalary(item.player, leagueData);
  }, 0);
}

function getTeamBasePayroll(team = {}, leagueData = {}) {
  const payrollSeasonYear = getContractSeasonYear(leagueData || {});
  const rosterPayroll = (Array.isArray(team?.players) ? team.players : []).reduce(
    (sum, player) => sum + getPlayerSalaryForYear(player, payrollSeasonYear),
    0
  );
  if (rosterPayroll > 0) return rosterPayroll;
  const stored = Number(
    team?.payroll ?? team?.totalSalary ?? team?.salaryTotal ?? team?.financials?.payroll ?? team?.financials?.totalSalary ?? 0
  );
  return Number.isFinite(stored) ? stored : 0;
}

function belowApronMatchingLimit(outgoingSalary, leagueData = {}) {
  const rules = getLeagueFinancialRules(leagueData);
  const inflation = Math.max(0.5, Number(rules?.inflationIndex || 1));
  const outgoing = Number(outgoingSalary || 0);
  const small = MATCHING_SMALL_OUTGOING * inflation;
  const mid = MATCHING_MID_OUTGOING * inflation;
  const buffer = MATCHING_BUFFER * inflation;
  if (outgoing <= 0) return 0;
  if (outgoing <= small) return outgoing * 2 + buffer;
  if (outgoing <= mid) return outgoing + small;
  return outgoing * 1.25 + buffer;
}

function financialRows({ basePayroll, outgoing, incoming, projectedPayroll, rules }) {
  return [
    { label: "Current payroll", value: formatMoney(basePayroll) },
    { label: "Outgoing salary", value: formatMoney(outgoing) },
    { label: "Incoming salary", value: formatMoney(incoming) },
    { label: "Net salary change", value: formatMoney(Number(incoming || 0) - Number(outgoing || 0)) },
    { label: "Projected payroll", value: formatMoney(projectedPayroll) },
    { label: "Salary cap", value: formatMoney(Number(rules?.salaryCap || 0)) },
    { label: "First apron", value: formatMoney(Number(rules?.firstApron || 0)) },
    { label: "Second apron", value: formatMoney(Number(rules?.secondApron || 0)) },
    { label: "Hard cap", value: formatMoney(Number(rules?.hardCap || rules?.secondApron || 0)) },
  ];
}

export function evaluateUserTradeFinancialLegality({
  leagueData = {},
  team = null,
  outgoingItems = [],
  incomingItems = [],
  settings = null,
} = {}) {
  if (!team) return { ok: false, code: "missing_team", message: "Trade team could not be found." };
  const active = settings || getUserTradeRuleSettings(leagueData);
  const outgoing = getUserTradeSideSalary(outgoingItems, leagueData);
  const incoming = getUserTradeSideSalary(incomingItems, leagueData);
  const basePayroll = getTeamBasePayroll(team, leagueData);
  const projectedPayroll = Math.max(0, basePayroll - outgoing + incoming);
  const rules = getLeagueFinancialRules(leagueData);
  const salaryCap = Number(rules?.salaryCap || 0);
  const firstApron = Number(rules?.firstApron || 0);
  const secondApron = Number(rules?.secondApron || 0);
  const hardCap = Number(rules?.hardCap || secondApron || 0);
  const rows = financialRows({ basePayroll, outgoing, incoming, projectedPayroll, rules });
  const teamName = teamNameOf(team) || "This team";

  if (active.firstApron && firstApron > 0 && basePayroll >= firstApron - SALARY_TOLERANCE && incoming > outgoing + SALARY_TOLERANCE) {
    return {
      ok: false,
      code: "first_apron_salary",
      message: `${teamName} is at or above the first apron and cannot receive more salary than it sends out.`,
      rows,
      statusLabel: "1st Apron Issue",
    };
  }

  if (active.secondApron && secondApron > 0 && basePayroll >= secondApron - SALARY_TOLERANCE) {
    if (incoming > outgoing + SALARY_TOLERANCE) {
      return {
        ok: false,
        code: "second_apron_salary",
        message: `${teamName} is at or above the second apron and cannot receive more salary than it sends out.`,
        rows,
        statusLabel: "2nd Apron Issue",
      };
    }
    const outgoingPlayers = outgoingItems.filter((item) => item?.type === "player" && item.player);
    const incomingPlayers = incomingItems.filter((item) => item?.type === "player" && item.player);
    const highestIncoming = incomingPlayers.reduce(
      (max, item) => Math.max(max, getUserTradePlayerSalary(item.player, leagueData)),
      0
    );
    const highestOutgoing = outgoingPlayers.reduce(
      (max, item) => Math.max(max, getUserTradePlayerSalary(item.player, leagueData)),
      0
    );
    if (outgoingPlayers.length > 1 && incomingPlayers.length === 1 && highestIncoming > highestOutgoing + SALARY_TOLERANCE) {
      return {
        ok: false,
        code: "second_apron_aggregation",
        message: `${teamName} is at or above the second apron and cannot aggregate multiple outgoing players to acquire one larger incoming salary.`,
        rows,
        statusLabel: "2nd Apron Aggregation",
      };
    }
  }

  if (active.hardCapApronCeiling && hardCap > 0 && projectedPayroll > hardCap + SALARY_TOLERANCE) {
    const alreadyAbove = basePayroll > hardCap + SALARY_TOLERANCE;
    if (!alreadyAbove || projectedPayroll > basePayroll + SALARY_TOLERANCE) {
      return {
        ok: false,
        code: "hard_cap",
        message: `${teamName} cannot complete this trade because it would push payroll above the hard cap/apron ceiling.`,
        rows,
        statusLabel: "Hard Cap Issue",
      };
    }
  }

  if (active.salaryMatching && incoming > outgoing + SALARY_TOLERANCE) {
    const capRoomBefore = Math.max(0, salaryCap - basePayroll);
    const canUseCapRoom = basePayroll < salaryCap && incoming <= outgoing + capRoomBefore + SALARY_TOLERANCE;
    if (!canUseCapRoom) {
      const matchingLimit = belowApronMatchingLimit(outgoing, leagueData);
      if (incoming > matchingLimit + SALARY_TOLERANCE) {
        return {
          ok: false,
          code: "salary_matching",
          message: `${teamName} can receive up to ${formatMoney(matchingLimit)} under the salary matching rule.`,
          rows: [...rows, { label: "Max incoming by matching", value: formatMoney(matchingLimit) }],
          statusLabel: "Salary Match Issue",
        };
      }
    }
  }

  return {
    ok: true,
    code: "ok",
    message: `${teamName} passes the enabled user-trade financial rules.`,
    rows,
    statusLabel: "Valid Trade",
  };
}

function formatMoney(value) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `$${Math.round(n / 1_000)}K`;
}

function getTradeRuleStateRoot(leagueData = {}) {
  const root = leagueData?.[TRADE_RULE_STATE_KEY];
  if (!root || typeof root !== "object") {
    return { version: 1, playerLocks: {}, transactions: [] };
  }
  return {
    ...root,
    version: Number(root.version || 1),
    playerLocks: root.playerLocks && typeof root.playerLocks === "object" ? root.playerLocks : {},
    transactions: Array.isArray(root.transactions) ? root.transactions : [],
  };
}

function getLegacyRestrictionRoot(leagueData = {}) {
  const root = leagueData?.[USER_TRADE_RULE_META_KEY];
  return root && typeof root === "object" && root.players && typeof root.players === "object"
    ? root.players
    : {};
}

function getUserTradeRestrictionLedger(leagueData = {}) {
  const state = getTradeRuleStateRoot(leagueData);
  return {
    ...getLegacyRestrictionRoot(leagueData),
    ...(state.playerLocks || {}),
  };
}

export function getTradeRuleState(leagueData = {}) {
  return getTradeRuleStateRoot(leagueData);
}

export function getTradeRuleTransactions(leagueData = {}) {
  return getTradeRuleStateRoot(leagueData).transactions;
}

function transactionPlayerKeys(row = {}) {
  const keys = [];
  const rowId = String(row?.playerId ?? row?.player_id ?? row?.id ?? "").trim();
  const rowName = normalizeTeamName(row?.playerName || row?.name || "");
  if (rowId) keys.push(`id:${rowId}`);
  if (rowName) keys.push(`name:${rowName}`);
  return keys;
}

function getTradeRuleTransactionIndex(leagueData = {}) {
  if (leagueData && typeof leagueData === "object") {
    const cached = tradeRuleTransactionIndexCache.get(leagueData);
    if (cached) return cached;
  }

  const transactions = getTradeRuleTransactions(leagueData);
  const index = new Map();
  for (const row of Array.isArray(transactions) ? transactions : []) {
    const rowType = String(row?.type || "").toLowerCase();
    const rowTeam = normalizeTeamName(row?.teamName || row?.toTeam || row?.signedWith || "");
    if (!rowType) continue;
    for (const playerKey of transactionPlayerKeys(row)) {
      const keys = [
        `${rowType}|${rowTeam}|${playerKey}`,
        `${rowType}||${playerKey}`,
      ];
      for (const key of keys) {
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(row);
      }
    }
  }

  if (leagueData && typeof leagueData === "object") {
    tradeRuleTransactionIndexCache.set(leagueData, index);
  }
  return index;
}

function getTradeHistoryAcquisitionIndex(leagueData = {}) {
  if (leagueData && typeof leagueData === "object") {
    const cached = tradeHistoryAcquisitionIndexCache.get(leagueData);
    if (cached) return cached;
  }
  const index = new Map();
  const history = Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory : [];
  for (const row of history) {
    const date = normalizeIsoDate(row?.date || row?.currentDate || "");
    if (!date) continue;
    for (const move of Array.isArray(row?.movedPlayers) ? row.movedPlayers : []) {
      const teamKey = normalizeTeamName(move?.toTeam || "");
      const playerKey = normalizeTeamName(move?.name || move?.playerName || "");
      if (!teamKey || !playerKey) continue;
      const key = `${teamKey}|${playerKey}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ acquiredDate: date, source: "tradeHistory", row });
    }
  }
  if (leagueData && typeof leagueData === "object") {
    tradeHistoryAcquisitionIndexCache.set(leagueData, index);
  }
  return index;
}

function getLatestTradeRuleTransactionForPlayer({ leagueData = {}, teamName = "", player = {}, types = [] } = {}) {
  if (!player) return null;
  const typeSet = new Set((types || []).map((value) => String(value || "").toLowerCase()).filter(Boolean));
  const targetTeam = normalizeTeamName(teamName);
  const targetId = String(player?.id ?? player?.playerId ?? player?.player_id ?? "").trim();
  const targetName = normalizeTeamName(playerNameOf(player));
  const playerKeys = [];
  if (targetId) playerKeys.push(`id:${targetId}`);
  if (targetName) playerKeys.push(`name:${targetName}`);
  if (!typeSet.size || !playerKeys.length) return null;

  const index = getTradeRuleTransactionIndex(leagueData);
  let matches = [];
  for (const type of typeSet) {
    for (const playerKey of playerKeys) {
      matches = matches.concat(index.get(`${type}|${targetTeam}|${playerKey}`) || []);
      matches = matches.concat(index.get(`${type}||${playerKey}`) || []);
    }
  }
  if (!matches.length) return null;

  // Keep the old "latest row wins" behavior without scanning hundreds of rows
  // for every player in Trade Finder.
  const row = matches[matches.length - 1] || null;
  if (!row) return null;
  return {
    ...row,
    signedDate: normalizeIsoDate(row?.date || row?.signedDate || ""),
    acquiredDate: normalizeIsoDate(row?.date || row?.acquiredDate || ""),
    eligibleDate: normalizeIsoDate(row?.eligibleDate || row?.tradeEligibleDate || ""),
    source: "tradeRuleTransactionLedger",
  };
}
function normalizeRestrictionMetadata(player = {}, leagueData = {}) {
  const direct = player?.tradeRestrictions && typeof player.tradeRestrictions === "object"
    ? player.tradeRestrictions
    : {};
  const meta = player?.tradeMeta && typeof player.tradeMeta === "object" ? player.tradeMeta : {};
  const ledgerRoot = getUserTradeRestrictionLedger(leagueData);
  const ledger = ledgerRoot?.[playerIdentity(player)] || ledgerRoot?.[`name:${normalizeTeamName(playerNameOf(player))}`] || {};
  const extensionMeta = player?.contract?.extensionMeta && typeof player.contract.extensionMeta === "object"
    ? player.contract.extensionMeta
    : {};
  const merged = { ...meta, ...direct, ...ledger };
  const extensionSignedDate = normalizeIsoDate(
    merged?.extensionSignedDate || extensionMeta?.signedDate || ""
  ) || undefined;
  return {
    ...merged,
    extensionSignedDate,
  };
}

function getLatestFreeAgentSigningFromPlayerHistory({ leagueData = {}, teamName = "", player = {} } = {}) {
  const transactions = Array.isArray(player?.history?.transactions) ? player.history.transactions : [];
  if (!transactions.length) return null;
  const teamKey = normalizeTeamName(teamName);
  const currentStartYear = getCurrentSeasonStartYear(leagueData);
  const currentFinancialYear = Number(leagueData?.currentFinancialSeasonYear || leagueData?.financialSeasonYear || currentStartYear + 1);
  for (let index = transactions.length - 1; index >= 0; index -= 1) {
    const row = transactions[index] || {};
    const rowTeam = normalizeTeamName(row?.toTeam || row?.teamName || row?.team || "");
    if (teamKey && rowTeam && rowTeam !== teamKey) continue;
    const rowType = String(row?.type || row?.transactionType || "").toLowerCase();
    const note = String(row?.note || row?.description || "").toLowerCase();
    const looksLikeSigning =
      rowType.includes("sign") ||
      rowType.includes("free_agency") ||
      note.includes("agrees to") ||
      note.includes("signed") ||
      note.includes("free agent");
    if (!looksLikeSigning) continue;
    const seasonYear = Number(row?.seasonYear || row?.year || 0);
    if (seasonYear && seasonYear !== currentFinancialYear && seasonYear !== currentStartYear + 1) continue;
    const explicitDate = normalizeIsoDate(row?.date || row?.currentDate || row?.signedDate || "");
    const inferredDate = explicitDate || `${currentStartYear}-07-30`;
    const window = getFreeAgentSigningWindow({ leagueData, signedDate: inferredDate });
    return {
      signedDate: window.date,
      eligibleDate: window.eligibleDate,
      signingContext: window.signingContext,
      source: "playerHistory",
    };
  }
  return null;
}

function getLatestAcquisitionFromHistory({ leagueData = {}, teamName = "", player = {} } = {}) {
  const targetTeam = normalizeTeamName(teamName);
  const targetName = normalizeTeamName(playerNameOf(player));
  if (!targetTeam || !targetName) return null;
  const rows = getTradeHistoryAcquisitionIndex(leagueData).get(`${targetTeam}|${targetName}`) || [];
  return rows.length ? rows[rows.length - 1] : null;
}
function lockedEligibility({ code, reason, eligibleDate, source }) {
  return {
    ok: false,
    code,
    reason,
    eligibleDate: normalizeIsoDate(eligibleDate),
    eligibleDateLabel: eligibleDate ? formatLeagueDate(eligibleDate) : "DATE UNAVAILABLE",
    source,
  };
}

export function getUserTradePlayerEligibility({
  leagueData = {},
  teamName = "",
  player = null,
  currentDate = null,
  settings = null,
} = {}) {
  bumpPerfCounter("tradeRules.playerEligibilityCalls");
  if (!player) return { ok: false, code: "missing_player", reason: "Player could not be found." };
  const active = settings || getUserTradeRuleSettings(leagueData);
  const today = normalizeIsoDate(currentDate) || getUserTradeCurrentDate(leagueData);
  const cache = getScopedResultCache(playerEligibilityResultCache, leagueData);
  const playerCacheKey = cache ? [
    normalizeTeamName(teamName),
    playerIdentity(player) || `name:${normalizeTeamName(playerNameOf(player))}`,
    today,
    primitiveSettingsSignature(active),
    leagueRuleHistorySignature(leagueData),
    normalizeIsoDate(player?.tradeMeta?.eligibleDate || player?.tradeRestrictions?.eligibleDate || ""),
    normalizeIsoDate(player?.tradeMeta?.acquiredTradeEligibleDate || player?.tradeRestrictions?.acquiredTradeEligibleDate || ""),
  ].join("|") : "";
  if (cache && cache.has(playerCacheKey)) {
    bumpPerfCounter("tradeRules.playerEligibilityCacheHit");
    return cache.get(playerCacheKey);
  }
  const metadata = normalizeRestrictionMetadata(player, leagueData);
  const restrictions = [];

  if (active.recentlyAcquired) {
    const historyAcquisition = getLatestAcquisitionFromHistory({ leagueData, teamName, player });
    const ledgerAcquisition = getLatestTradeRuleTransactionForPlayer({ leagueData, teamName, player, types: ["trade"] });
    const acquiredDate = normalizeIsoDate(
      metadata?.acquiredDate || metadata?.lastTradeDate || historyAcquisition?.acquiredDate || ledgerAcquisition?.acquiredDate || ""
    );
    const eligibleDate = normalizeIsoDate(
      metadata?.acquiredTradeEligibleDate || metadata?.acquiredEligibleDate || ledgerAcquisition?.eligibleDate || ""
    ) || addIsoDays(acquiredDate, 30);
    if (today && eligibleDate && compareIsoDates(today, eligibleDate) < 0) {
      restrictions.push(lockedEligibility({
        code: "recently_acquired",
        eligibleDate,
        source: historyAcquisition?.source || "playerMetadata",
        reason: `${playerNameOf(player)} cannot be traded until ${formatLeagueDate(eligibleDate)} because the player was recently acquired.`,
      }));
    }
  }

  if (active.recentlySigned) {
    const historySigning = getLatestFreeAgentSigningFromPlayerHistory({ leagueData, teamName, player });
    const ledgerSigning = getLatestTradeRuleTransactionForPlayer({ leagueData, teamName, player, types: ["signing"] });
    const signedDate = normalizeIsoDate(
      metadata?.freeAgentSignedDate || metadata?.signedDate || historySigning?.signedDate || ledgerSigning?.signedDate || ""
    );
    const eligibleDate = normalizeIsoDate(
      metadata?.freeAgentTradeEligibleDate || metadata?.signedTradeEligibleDate || historySigning?.eligibleDate || ledgerSigning?.eligibleDate || ""
    );
    if (signedDate && eligibleDate && today && compareIsoDates(today, eligibleDate) < 0) {
      restrictions.push(lockedEligibility({
        code: "recently_signed",
        eligibleDate,
        source: historySigning?.source || "playerMetadata",
        reason: `${playerNameOf(player)} cannot be traded until ${formatLeagueDate(eligibleDate)} because the player was recently signed as a free agent.`,
      }));
    }
  }

  if (active.newlyDraftedRookie) {
    const signedDate = normalizeIsoDate(metadata?.rookieSignedDate || "");
    const eligibleDate = normalizeIsoDate(metadata?.rookieTradeEligibleDate || "");
    if (signedDate && eligibleDate && today && compareIsoDates(today, eligibleDate) < 0) {
      restrictions.push(lockedEligibility({
        code: "newly_drafted_rookie",
        eligibleDate,
        source: "playerMetadata",
        reason: `${playerNameOf(player)} cannot be traded until ${formatLeagueDate(eligibleDate)} because the rookie was newly signed.`,
      }));
    }
  }

  if (active.recentlyExtended) {
    const signedDate = normalizeIsoDate(metadata?.extensionSignedDate || "");
    const eligibleDate = normalizeIsoDate(metadata?.extensionTradeEligibleDate || "") || addIsoMonths(signedDate, 6);
    if (signedDate && eligibleDate && today && compareIsoDates(today, eligibleDate) < 0) {
      restrictions.push(lockedEligibility({
        code: "recently_extended",
        eligibleDate,
        source: "playerMetadata",
        reason: `${playerNameOf(player)} cannot be traded until ${formatLeagueDate(eligibleDate)} because the player recently signed an extension.`,
      }));
    }
  }

  if (restrictions.length) {
    restrictions.sort((a, b) => String(a.eligibleDate || "").localeCompare(String(b.eligibleDate || "")));
    const locked = restrictions[restrictions.length - 1];
    if (cache && playerCacheKey) cache.set(playerCacheKey, locked);
    return locked;
  }
  const okResult = { ok: true, code: "ok", reason: "" };
  if (cache && playerCacheKey) cache.set(playerCacheKey, okResult);
  return okResult;
}

function pickYear(pick = {}) {
  const year = Number(pick?.year ?? pick?.seasonYear ?? pick?.season ?? 0);
  return Number.isFinite(year) ? year : 0;
}

function pickRound(pick = {}) {
  const round = Number(pick?.round ?? pick?.rnd ?? 1);
  return Number.isFinite(round) ? round : 1;
}

function pickOwner(pick = {}) {
  return pick?.ownerTeam || pick?.owner || pick?.currentOwnerTeamName || pick?.ownerTeamName || pick?.teamName || "";
}

function pickOriginal(pick = {}) {
  return pick?.originalTeam || pick?.originalTeamName || pick?.original || pick?.fromTeam || "";
}

function isActivePick(pick = {}) {
  return String(pick?.status || "active").toLowerCase() === "active";
}

function pickProtectionLabel(pick = {}, item = null) {
  return String(
    item?.protection ||
      item?.tradeRule?.baseProtectionLabel ||
      pick?.displayProtection ||
      pick?.protections ||
      pick?.protection ||
      getTradePickBaseProtectionLabel(pick) ||
      "Unprotected"
  ).trim();
}

function isGuaranteedFirst(pick = {}, item = null) {
  if (pickRound(pick) !== 1 || !isActivePick(pick)) return false;
  if (isResolvedDraftPickAsset(pick)) return true;
  if (isSwapDraftPickAsset(pick) || String(item?.tradeRule?.action || "").toLowerCase() === "swap") return true;
  if (String(item?.tradeRule?.action || "").toLowerCase() === "protected") return false;
  if (isProtectedDraftPickAsset(pick)) return false;
  const label = pickProtectionLabel(pick, item).toLowerCase();
  if (label.includes("protect") && !label.includes("unprotected")) return false;
  return true;
}

function futureStepienStartYear(leagueData = {}, context = null) {
  const tradeContext = context || getOffseasonTradeContext(leagueData);
  const seasonStartYear = getCurrentSeasonStartYear(leagueData);
  const draftYear = seasonStartYear + 1;
  const currentDate = getUserTradeCurrentDate(leagueData);
  const [dateYear, dateMonth] = String(currentDate || "")
    .split("-")
    .map((value) => Number(value));

  // During the 2026-27 season, the 2027 1st is a future pick even if old
  // lottery/draft localStorage still exists. Only after the real offseason
  // draft order is locked should Stepien start at the following draft year.
  const inRealOffseason = shouldUseOffseasonDateForUserTrades(leagueData, tradeContext);
  const currentDraftResolved = Boolean(
    inRealOffseason &&
      tradeContext?.draftOrderLocked &&
      Number.isFinite(dateYear) &&
      Number(dateYear) === Number(draftYear) &&
      Number(dateMonth) >= 6
  );

  return currentDraftResolved ? draftYear + 1 : draftYear;
}

function normalizeLeaguePicks(leagueData = {}) {
  if (leagueData && typeof leagueData === "object") {
    const cached = normalizedLeaguePicksCache.get(leagueData);
    if (cached) {
      bumpPerfCounter("tradeRules.normalizedPickCacheHit");
      return cached;
    }
  }
  bumpPerfCounter("tradeRules.normalizedPickBuild");
  const names = getAllTeams(leagueData).map(teamNameOf).filter(Boolean);
  const normalized = normalizeDraftPicks(leagueData?.draftPicks || [], names);
  if (leagueData && typeof leagueData === "object") {
    normalizedLeaguePicksCache.set(leagueData, normalized);
  }
  return normalized;
}

function selectedOutgoingPickRows(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.type === "pick" && item.pick && !item?.tradeRule?.mirror && !item?.tradeValueExcluded)
    .map((item) => ({ item, pick: item.pick }));
}

function selectedOutgoingPickKeys(items = []) {
  return new Set(selectedOutgoingPickRows(items).map((row) => pickIdentity(row.pick)));
}

function compactPickDescriptor(pick = {}) {
  return [
    pickYear(pick),
    pickRound(pick),
    normalizeTeamName(pickOriginal(pick)),
    normalizeTeamName(pickOwner(pick)),
    normalizeTeamName(pick?.swapWithTeam || pick?.swapTeam || pick?.swapWith || ""),
    isSwapDraftPickAsset(pick) ? "swap" : isResolvedDraftPickAsset(pick) ? "resolved" : "pick",
  ].join("|");
}

function samePickForStepien(a = {}, b = {}) {
  const aId = String(a?.id || a?.pickId || a?.draftPickId || "").trim();
  const bId = String(b?.id || b?.pickId || b?.draftPickId || "").trim();
  if (aId && bId && aId === bId) return true;
  if (pickYear(a) !== pickYear(b) || pickRound(a) !== pickRound(b)) return false;
  if (compactPickDescriptor(a) === compactPickDescriptor(b)) return true;

  // Some swap assets are rebuilt with slightly different display owner labels.
  // For Stepien, if the year/round/swap flag and the core teams match, treat it
  // as the same first so outgoing swaps stop counting as guaranteed picks.
  const aTeams = new Set([normalizeTeamName(pickOriginal(a)), normalizeTeamName(pickOwner(a)), normalizeTeamName(a?.swapWithTeam || a?.swapTeam || a?.swapWith || "")].filter(Boolean));
  const bTeams = new Set([normalizeTeamName(pickOriginal(b)), normalizeTeamName(pickOwner(b)), normalizeTeamName(b?.swapWithTeam || b?.swapTeam || b?.swapWith || "")].filter(Boolean));
  let overlap = 0;
  for (const team of aTeams) if (bTeams.has(team)) overlap += 1;
  return overlap >= 2 && (isSwapDraftPickAsset(a) || isSwapDraftPickAsset(b));
}

function pickIdentity(pick = {}) {
  return [
    pick?.id || pick?.pickId || "",
    pickYear(pick),
    pickRound(pick),
    normalizeTeamName(pickOriginal(pick)),
    normalizeTeamName(pickOwner(pick)),
    isSwapDraftPickAsset(pick) ? "swap" : isResolvedDraftPickAsset(pick) ? "resolved" : "pick",
  ].join("|");
}

function buildGuaranteedFirstMap({ leagueData = {}, teamName = "", outgoingItems = [], incomingItems = [] } = {}) {
  const context = getOffseasonTradeContext(leagueData);
  const startYear = futureStepienStartYear(leagueData, context);
  const resolvedTeamName = resolveTeamNameForTradeRules({ leagueData, teamName, outgoingItems, incomingItems });
  const teamKey = normalizeTeamName(resolvedTeamName);
  const outgoingKeys = selectedOutgoingPickKeys(outgoingItems);
  const outgoingRows = selectedOutgoingPickRows(outgoingItems);
  const years = new Map();
  let maxYear = startYear;

  for (const pick of normalizeLeaguePicks(leagueData)) {
    const year = pickYear(pick);
    if (year < startYear || pickRound(pick) !== 1 || !isActivePick(pick)) continue;
    maxYear = Math.max(maxYear, year);
    if (normalizeTeamName(pickOwner(pick)) !== teamKey) continue;
    if (outgoingKeys.has(pickIdentity(pick)) || outgoingRows.some((row) => samePickForStepien(row.pick, pick))) continue;
    if (isGuaranteedFirst(pick)) years.set(year, true);
  }

  for (const item of incomingItems || []) {
    if (item?.type !== "pick" || !item.pick || item?.tradeRule?.mirror || item?.tradeValueExcluded) continue;
    const year = pickYear(item.pick);
    if (year < startYear || pickRound(item.pick) !== 1) continue;
    maxYear = Math.max(maxYear, year);
    if (isGuaranteedFirst(item.pick, item)) years.set(year, true);
  }

  for (const item of outgoingItems || []) {
    if (item?.type !== "pick" || !item.pick) continue;
    maxYear = Math.max(maxYear, pickYear(item.pick));
  }

  return { startYear, maxYear, years };
}

function stepienItemsSignature(items = []) {
  return selectedOutgoingPickRows(items)
    .map((row) => `${pickIdentity(row.pick)}:${isGuaranteedFirst(row.pick, row.item) ? "G" : "P"}`)
    .sort()
    .join(";");
}


function primitiveSettingsSignature(settings = {}) {
  if (!settings || typeof settings !== "object") return "default";
  return [
    settings.tradeDeadline,
    settings.salaryMatching,
    settings.stepienRule,
    settings.recentlyAcquired,
    settings.recentlySigned,
    settings.newlyDrafted,
    settings.newlyDraftedRookie,
    settings.recentlyExtended,
    settings.secondApron,
  ].map((value) => value === false ? "0" : "1").join("");
}

function leagueRuleHistorySignature(leagueData = {}) {
  const state = getTradeRuleStateRoot(leagueData);
  const tradeHistoryLength = Array.isArray(leagueData?.tradeHistory) ? leagueData.tradeHistory.length : 0;
  const txLength = Array.isArray(state?.transactions) ? state.transactions.length : 0;
  const lockCount = state?.playerLocks && typeof state.playerLocks === "object" ? Object.keys(state.playerLocks).length : 0;
  return `${tradeHistoryLength}|${txLength}|${lockCount}|${leagueData?.seasonYear || leagueData?.currentSeasonYear || ""}`;
}

function outgoingPickSignature(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.type === "pick" && item.pick)
    .map((item) => {
      const pick = item.pick || {};
      return [
        pickIdentity(pick),
        pickProtectionLabel(pick),
        pick?.protection || pick?.displayProtection || "",
        item?.tradeRule?.mode || "",
        item?.tradeRule?.protectEnd || "",
      ].join(":");
    })
    .sort()
    .join("||");
}

function getScopedResultCache(cacheRoot, leagueData) {
  if (!leagueData || typeof leagueData !== "object") return null;
  let cache = cacheRoot.get(leagueData);
  if (!cache) {
    cache = new Map();
    cacheRoot.set(leagueData, cache);
  }
  if (cache.size > 2500) cache.clear();
  return cache;
}

function getLeagueScopedCache(weakCache, leagueData = {}) {
  if (!leagueData || typeof leagueData !== "object") return null;
  let cache = weakCache.get(leagueData);
  if (!cache) {
    cache = new Map();
    weakCache.set(leagueData, cache);
  }
  return cache;
}

function findStepienViolations(args = {}) {
  const leagueData = args?.leagueData || {};
  const resolvedTeamName = resolveTeamNameForTradeRules(args);
  const context = getOffseasonTradeContext(leagueData);
  const startYear = futureStepienStartYear(leagueData, context);
  const cache = getLeagueScopedCache(stepienViolationsCache, leagueData);
  const key = cache
    ? [
        normalizeTeamName(resolvedTeamName || args?.teamName || ""),
        startYear,
        stepienItemsSignature(args?.outgoingItems || []),
        stepienItemsSignature(args?.incomingItems || []),
      ].join("|")
    : "";
  if (cache && cache.has(key)) {
    bumpPerfCounter("tradeRules.stepienViolationCacheHit");
    return cache.get(key);
  }

  bumpPerfCounter("tradeRules.stepienViolationBuild");
  const map = buildGuaranteedFirstMap({ ...args, teamName: resolvedTeamName || args?.teamName || "" });
  const violations = [];
  for (let year = map.startYear; year < map.maxYear; year += 1) {
    if (!map.years.get(year) && !map.years.get(year + 1)) {
      violations.push({ year1: year, year2: year + 1, map });
    }
  }
  if (cache) cache.set(key, violations);
  return violations;
}

function findStepienViolation(args = {}) {
  return findStepienViolations(args)[0] || null;
}

function findNewStepienViolation(before = [], after = []) {
  const beforeKeys = new Set(
    (before || []).map((row) => `${Number(row?.year1 || 0)}-${Number(row?.year2 || 0)}`)
  );
  return (after || []).find(
    (row) => !beforeKeys.has(`${Number(row?.year1 || 0)}-${Number(row?.year2 || 0)}`)
  ) || null;
}

function isUnprotectedNormalFutureFirst(pick = {}, item = null) {
  return Boolean(
    pickRound(pick) === 1 &&
      isActivePick(pick) &&
      !isResolvedDraftPickAsset(pick) &&
      !isSwapDraftPickAsset(pick) &&
      isGuaranteedFirst(pick, item)
  );
}

function getSecondApronFurthestFirstYear({ leagueData = {}, teamName = "", pick = null, outgoingItems = [], incomingItems = [] } = {}) {
  const resolvedTeamName = resolveTeamNameForTradeRules({ leagueData, teamName, pick, outgoingItems, incomingItems });
  const team = getTeamByName(leagueData, resolvedTeamName);
  if (!team) return null;
  const rules = getLeagueFinancialRules(leagueData);
  const secondApron = Number(rules?.secondApron || 0);
  if (!secondApron || getTeamBasePayroll(team, leagueData) < secondApron - SALARY_TOLERANCE) return null;
  const startYear = futureStepienStartYear(leagueData);
  const cache = getLeagueScopedCache(secondApronFurthestFirstCache, leagueData);
  const key = cache
    ? [normalizeTeamName(resolvedTeamName), startYear, stepienItemsSignature(outgoingItems), stepienItemsSignature(incomingItems)].join("|")
    : "";
  if (cache && cache.has(key)) {
    bumpPerfCounter("tradeRules.secondApronCacheHit");
    return cache.get(key);
  }

  bumpPerfCounter("tradeRules.secondApronBuild");
  const teamKey = normalizeTeamName(resolvedTeamName);
  const years = normalizeLeaguePicks(leagueData)
    .filter((pick) => normalizeTeamName(pickOwner(pick)) === teamKey)
    .filter((pick) => pickYear(pick) >= startYear)
    .filter((pick) => isUnprotectedNormalFutureFirst(pick))
    .map(pickYear);
  const result = years.length ? Math.max(...years) : null;
  if (cache) cache.set(key, result);
  return result;
}

export function getUserTradePickEligibility({
  leagueData = {},
  teamName = "",
  pick = null,
  item = null,
  outgoingItems = [],
  incomingItems = [],
  settings = null,
} = {}) {
  bumpPerfCounter("tradeRules.pickEligibilityCalls");
  if (!pick) return { ok: false, code: "missing_pick", reason: "Draft pick could not be found." };
  const active = settings || getUserTradeRuleSettings(leagueData);
  const context = getOffseasonTradeContext(leagueData);
  const startYear = futureStepienStartYear(leagueData, context);
  const year = pickYear(pick);
  const resolvedTeamName = resolveTeamNameForTradeRules({ leagueData, teamName, pick, outgoingItems, incomingItems });
  const cache = getScopedResultCache(pickEligibilityResultCache, leagueData);
  const cacheKey = cache ? [
    normalizeTeamName(resolvedTeamName || teamName),
    pickIdentity(pick),
    pickProtectionLabel(pick),
    primitiveSettingsSignature(active),
    futureStepienStartYear(leagueData, context),
    leagueRuleHistorySignature(leagueData),
    Array.isArray(leagueData?.draftPicks) ? leagueData.draftPicks.length : 0,
    outgoingPickSignature(outgoingItems),
    outgoingPickSignature(incomingItems),
  ].join("|") : "";
  if (cache && cache.has(cacheKey)) {
    bumpPerfCounter("tradeRules.pickEligibilityCacheHit");
    return cache.get(cacheKey);
  }

  if (active.secondApron && isUnprotectedNormalFutureFirst(pick, item)) {
    const furthestYear = getSecondApronFurthestFirstYear({ leagueData, teamName: resolvedTeamName, pick, outgoingItems, incomingItems });
    if (furthestYear && year === furthestYear && year >= startYear) {
      return {
        ok: false,
        code: "second_apron_furthest_first",
        reason: `${year} 1st is locked because a second-apron team cannot trade its furthest fully unprotected future 1st.`,
      };
    }
  }

  if (active.stepienRule && pickRound(pick) === 1 && year >= startYear && !isResolvedDraftPickAsset(pick)) {
    const candidate = item || { type: "pick", pick };
    const alreadyPresent = (outgoingItems || []).some((row) => row?.type === "pick" && pickIdentity(row.pick || {}) === pickIdentity(pick));
    const projectedOutgoing = alreadyPresent ? outgoingItems : [...(outgoingItems || []), candidate];
    const before = findStepienViolations({ leagueData, teamName: resolvedTeamName, outgoingItems, incomingItems });
    const after = findStepienViolations({ leagueData, teamName: resolvedTeamName, outgoingItems: projectedOutgoing, incomingItems });
    const newViolation = findNewStepienViolation(before, after);
    if (newViolation) {
      return {
        ok: false,
        code: "stepien_rule",
        reason: `Trading this pick would leave ${resolvedTeamName || teamName || "this team"} without a guaranteed 1st in both ${newViolation.year1} and ${newViolation.year2}.`,
        violationYears: [newViolation.year1, newViolation.year2],
      };
    }
  }

  const okResult = { ok: true, code: "ok", reason: "" };
  if (cache && cacheKey) cache.set(cacheKey, okResult);
  return okResult;
}

export function validateUserTradeAssetPackage({
  leagueData = {},
  teamName = "",
  outgoingItems = [],
  incomingItems = [],
  settings = null,
} = {}) {
  const active = settings || getUserTradeRuleSettings(leagueData);
  const resolvedTeamName = resolveTeamNameForTradeRules({ leagueData, teamName, outgoingItems, incomingItems });
  for (const item of outgoingItems || []) {
    if (item?.type === "player" && item.player) {
      const result = getUserTradePlayerEligibility({
        leagueData,
        teamName: resolvedTeamName || teamName,
        player: item.player,
        settings: active,
      });
      if (!result.ok) return result;
    }
    if (item?.type === "pick" && item.pick && !item?.tradeRule?.mirror && !item?.tradeValueExcluded) {
      const result = getUserTradePickEligibility({
        leagueData,
        teamName: resolvedTeamName || teamName,
        pick: item.pick,
        item,
        outgoingItems,
        incomingItems,
        settings: active,
      });
      if (!result.ok) return result;
    }
  }
  if (active.stepienRule) {
    const baseline = findStepienViolations({ leagueData, teamName: resolvedTeamName || teamName, outgoingItems: [], incomingItems: [] });
    const projected = findStepienViolations({ leagueData, teamName: resolvedTeamName || teamName, outgoingItems, incomingItems });
    const newViolation = findNewStepienViolation(baseline, projected);
    if (newViolation) {
      return {
        ok: false,
        code: "stepien_rule",
        reason: `This package would leave ${resolvedTeamName || teamName || "this team"} without a guaranteed 1st in both ${newViolation.year1} and ${newViolation.year2}.`,
        violationYears: [newViolation.year1, newViolation.year2],
      };
    }
  }
  return { ok: true, code: "ok", reason: "" };
}

export function validateUserTradeRules({
  leagueData = {},
  userTeam = null,
  cpuTeam = null,
  userTeamName = "",
  cpuTeamName = "",
  userItems = [],
  cpuItems = [],
  includeDeadline = true,
  includeFinancial = true,
  settings = null,
} = {}) {
  const active = settings || getUserTradeRuleSettings(leagueData);
  const resolvedUserTeam = userTeam || getTeamByName(leagueData, userTeamName);
  const resolvedCpuTeam = cpuTeam || getTeamByName(leagueData, cpuTeamName);
  const resolvedUserName = userTeamName || teamNameOf(resolvedUserTeam);
  const resolvedCpuName = cpuTeamName || teamNameOf(resolvedCpuTeam);

  if (includeDeadline) {
    const deadline = getUserTradeDeadlineStatus(leagueData);
    if (deadline.locked) return { ok: false, code: "trade_deadline", reason: deadline.reason };
  }

  const userAssets = validateUserTradeAssetPackage({
    leagueData,
    teamName: resolvedUserName,
    outgoingItems: userItems,
    incomingItems: cpuItems,
    settings: active,
  });
  if (!userAssets.ok) return userAssets;

  const cpuAssets = validateUserTradeAssetPackage({
    leagueData,
    teamName: resolvedCpuName,
    outgoingItems: cpuItems,
    incomingItems: userItems,
    settings: active,
  });
  if (!cpuAssets.ok) return cpuAssets;

  if (includeFinancial) {
    const userFinancial = evaluateUserTradeFinancialLegality({
      leagueData,
      team: resolvedUserTeam,
      outgoingItems: userItems,
      incomingItems: cpuItems,
      settings: active,
    });
    if (!userFinancial.ok) return { ...userFinancial, reason: userFinancial.message };
    const cpuFinancial = evaluateUserTradeFinancialLegality({
      leagueData,
      team: resolvedCpuTeam,
      outgoingItems: cpuItems,
      incomingItems: userItems,
      settings: active,
    });
    if (!cpuFinancial.ok) return { ...cpuFinancial, reason: cpuFinancial.message };
  }

  return { ok: true, code: "ok", reason: "" };
}

function makeTradeRuleTransactionId(prefix = "tx", date = "", identity = "") {
  const cleanDate = normalizeIsoDate(date) || "unknown-date";
  const cleanIdentity = String(identity || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${prefix}_${cleanDate}_${cleanIdentity}_${Math.random().toString(36).slice(2, 8)}`;
}

function mergeTradeRuleTransactions(existing = [], additions = []) {
  const rows = Array.isArray(existing) ? existing.filter(Boolean) : [];
  const addRows = Array.isArray(additions) ? additions.filter(Boolean) : [];
  if (!addRows.length) return rows;
  const seen = new Set(rows.map((row) => String(row?.id || "")).filter(Boolean));
  const next = [...rows];
  for (const row of addRows) {
    const id = String(row?.id || "");
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    next.push({ ...row, recordedAt: row?.recordedAt || new Date().toISOString() });
  }
  return next.slice(-600);
}

function applyTradeRuleMetadataToPlayer(player = {}, metadata = {}) {
  if (!player || typeof player !== "object" || !metadata || typeof metadata !== "object") return player;
  const mergedMeta = {
    ...(player.tradeMeta && typeof player.tradeMeta === "object" ? player.tradeMeta : {}),
    ...metadata,
  };
  const mergedRestrictions = {
    ...(player.tradeRestrictions && typeof player.tradeRestrictions === "object" ? player.tradeRestrictions : {}),
    ...metadata,
  };
  return {
    ...player,
    tradeMeta: mergedMeta,
    tradeRestrictions: mergedRestrictions,
  };
}

function patchPlayerCollectionsWithTradeRuleLocks(leagueData = {}, playerLocks = {}) {
  if (!leagueData || typeof leagueData !== "object" || !playerLocks || typeof playerLocks !== "object") return leagueData;

  const patchPlayer = (player) => {
    if (!player || typeof player !== "object") return player;
    const identity = playerIdentity(player);
    const byName = `name:${normalizeTeamName(playerNameOf(player))}`;
    const metadata = playerLocks[identity] || playerLocks[byName] || null;
    return metadata ? applyTradeRuleMetadataToPlayer(player, metadata) : player;
  };

  const patchTeam = (team) => {
    if (!team || typeof team !== "object") return team;
    let changed = false;
    const patchArray = (rows) => {
      if (!Array.isArray(rows)) return rows;
      const nextRows = rows.map((player) => {
        const next = patchPlayer(player);
        if (next !== player) changed = true;
        return next;
      });
      return changed ? nextRows : rows;
    };

    const nextPlayers = patchArray(team.players);
    const nextTwoWay = patchArray(team.twoWayPlayers);
    const nextStash = patchArray(team.stashPlayers);
    if (!changed) return team;
    return {
      ...team,
      players: Array.isArray(team.players) ? nextPlayers : team.players,
      twoWayPlayers: Array.isArray(team.twoWayPlayers) ? nextTwoWay : team.twoWayPlayers,
      stashPlayers: Array.isArray(team.stashPlayers) ? nextStash : team.stashPlayers,
    };
  };

  let nextLeague = leagueData;
  if (Array.isArray(leagueData.teams)) {
    nextLeague = {
      ...nextLeague,
      teams: leagueData.teams.map(patchTeam),
    };
  }

  if (leagueData.conferences && typeof leagueData.conferences === "object") {
    const nextConferences = {};
    for (const [conferenceName, teams] of Object.entries(leagueData.conferences)) {
      nextConferences[conferenceName] = Array.isArray(teams) ? teams.map(patchTeam) : teams;
    }
    nextLeague = {
      ...nextLeague,
      conferences: nextConferences,
    };
  }

  return nextLeague;
}

function applyUserTradeRestrictionPatches(leagueData = {}, patches = new Map(), transactions = []) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;
  const hasPatches = patches instanceof Map && patches.size;
  const hasTransactions = Array.isArray(transactions) && transactions.length;
  if (!hasPatches && !hasTransactions) return leagueData;

  const currentRoot = leagueData?.[USER_TRADE_RULE_META_KEY] && typeof leagueData[USER_TRADE_RULE_META_KEY] === "object"
    ? leagueData[USER_TRADE_RULE_META_KEY]
    : {};
  const currentPlayers = currentRoot?.players && typeof currentRoot.players === "object"
    ? currentRoot.players
    : {};
  const currentState = getTradeRuleStateRoot(leagueData);
  const currentLocks = currentState.playerLocks && typeof currentState.playerLocks === "object"
    ? currentState.playerLocks
    : {};

  const activePlayerIdentities = new Set();
  for (const team of getAllTeams(leagueData)) {
    for (const player of Array.isArray(team?.players) ? team.players : []) {
      activePlayerIdentities.add(playerIdentity(player));
    }
  }

  const nextPlayers = {};
  const nextLocks = {};
  for (const [identity, metadata] of Object.entries(currentPlayers)) {
    if (activePlayerIdentities.has(identity)) nextPlayers[identity] = metadata;
  }
  for (const [identity, metadata] of Object.entries(currentLocks)) {
    if (activePlayerIdentities.has(identity)) nextLocks[identity] = metadata;
  }

  if (hasPatches) {
    for (const [identity, patch] of patches.entries()) {
      if (!identity || !patch || typeof patch !== "object") continue;
      const merged = {
        ...(currentPlayers[identity] && typeof currentPlayers[identity] === "object" ? currentPlayers[identity] : {}),
        ...(currentLocks[identity] && typeof currentLocks[identity] === "object" ? currentLocks[identity] : {}),
        ...patch,
      };
      nextPlayers[identity] = merged;
      nextLocks[identity] = merged;
    }
  }

  const leagueWithState = {
    ...leagueData,
    [USER_TRADE_RULE_META_KEY]: {
      ...currentRoot,
      version: 1,
      players: nextPlayers,
    },
    [TRADE_RULE_STATE_KEY]: {
      ...currentState,
      version: 1,
      playerLocks: nextLocks,
      transactions: mergeTradeRuleTransactions(currentState.transactions, transactions),
    },
  };

  return patchPlayerCollectionsWithTradeRuleLocks(leagueWithState, nextLocks);
}


function playerIdsOnTeams(leagueData = {}) {
  const map = new Map();
  for (const team of getAllTeams(leagueData)) {
    for (const player of Array.isArray(team?.players) ? team.players : []) {
      map.set(playerIdentity(player), { player, teamName: teamNameOf(team) });
    }
  }
  return map;
}

export function stampUserTradeAcquisitionRestrictions({
  leagueData = {},
  movedPlayers = [],
  currentDate = null,
  source = "trade",
  sourceTransactionId = "",
} = {}) {
  const date = normalizeIsoDate(currentDate) || getUserTradeCurrentDate(leagueData);
  if (!date || !Array.isArray(movedPlayers) || !movedPlayers.length) return leagueData;
  const patches = new Map();
  const transactions = [];
  for (const move of movedPlayers) {
    const team = getTeamByName(leagueData, move?.toTeam || "");
    const player = (team?.players || []).find((row) => normalizeTeamName(playerNameOf(row)) === normalizeTeamName(move?.name));
    if (!player) continue;
    const identity = playerIdentity(player);
    const eligibleDate = addIsoDays(date, 30);
    const transactionId = sourceTransactionId || makeTradeRuleTransactionId("trade_acq", date, `${identity}_${move?.toTeam || ""}`);
    patches.set(identity, {
      lockType: "recentlyAcquired",
      type: "recentlyAcquired",
      playerName: playerNameOf(player),
      teamName: move?.toTeam || teamNameOf(team),
      fromTeam: move?.fromTeam || "",
      acquiredDate: date,
      lastTradeDate: date,
      acquiredTradeEligibleDate: eligibleDate,
      eligibleDate,
      sourceTransactionId: transactionId,
      reason: "Recently acquired by trade",
    });
    transactions.push({
      id: `${transactionId}_${identity}`,
      date,
      type: "trade",
      subtype: source,
      playerId: player?.id || null,
      playerName: playerNameOf(player),
      fromTeam: move?.fromTeam || "",
      toTeam: move?.toTeam || teamNameOf(team),
      title: `${move?.toTeam || teamNameOf(team)} acquired ${playerNameOf(player)}`,
      eligibleDate,
      restrictionType: "recentlyAcquired",
      restrictionLabel: `Trade eligible ${formatLeagueDate(eligibleDate)}`,
    });
  }
  return applyUserTradeRestrictionPatches(leagueData, patches, transactions);
}

function getFreeAgentSigningWindow({ leagueData = {}, signedDate = null } = {}) {
  const date = normalizeIsoDate(signedDate) || getUserTradeCurrentDate(leagueData);
  const context = getOffseasonTradeContext(leagueData);
  const seasonStartYear = getCurrentSeasonStartYear(leagueData);
  const calendarConfig = getSeasonCalendarConfig({
    ...(leagueData || {}),
    seasonYear: seasonStartYear,
    currentSeasonYear: seasonStartYear,
    seasonStartYear,
  });
  const gameStart = normalizeIsoDate(calendarConfig?.regularSeasonGameStart || `${seasonStartYear}-10-20`);
  const beforeOpeningGames = Boolean(date && gameStart && compareIsoDates(date, gameStart) < 0);
  const offseasonLike = Boolean(context?.inOffseason || beforeOpeningGames);
  const eligibleDate = offseasonLike ? `${Number(String(date || `${seasonStartYear}-07-30`).slice(0, 4))}-12-15` : addIsoDays(date, 30);
  return {
    date,
    signingContext: offseasonLike ? "offseasonFreeAgency" : "inSeasonFreeAgency",
    eligibleDate,
  };
}

function freeAgencySigningDateFromDay({ leagueData = {}, dayResolved = null, signedDate = null } = {}) {
  const explicit = normalizeIsoDate(signedDate);
  if (explicit) return explicit;
  const day = Number(dayResolved);
  if (!Number.isFinite(day)) return null;
  const context = getOffseasonTradeContext(leagueData);
  const year = Number(context?.seasonYear || getCurrentDraftYear(leagueData) || getCurrentSeasonStartYear(leagueData) + 1);
  if (!Number.isFinite(year) || year < 2020 || year > 2100) return null;
  if (day <= 0) return `${year}-06-30`;
  const date = new Date(Date.UTC(year, 6, Math.max(1, Math.round(day))));
  return date.toISOString().slice(0, 10);
}

function getSigningTeamName(row = {}) {
  return row?.teamName || row?.signedWith || row?.toTeam || row?.team || "";
}

function getSigningPlayerName(row = {}) {
  return row?.playerName || row?.name || row?.player || "";
}

function findSignedPlayerOnTeam(leagueData = {}, row = {}) {
  const teamName = getSigningTeamName(row);
  const playerName = getSigningPlayerName(row);
  const playerId = String(row?.playerId ?? row?.id ?? row?.player_id ?? "").trim();
  const team = getTeamByName(leagueData, teamName);
  const players = Array.isArray(team?.players) ? team.players : [];
  return players.find((player) => {
    const id = String(player?.id ?? player?.playerId ?? player?.player_id ?? "").trim();
    if (playerId && id && playerId === id) return true;
    return normalizeTeamName(playerNameOf(player)) === normalizeTeamName(playerName);
  }) || null;
}

export function stampFreeAgentSigningRestrictions({
  beforeLeague = {},
  afterLeague = {},
  signedDate = null,
  dayResolved = null,
  signings = [],
  source = "user_free_agent_signing",
} = {}) {
  const explicitSigningRows = Array.isArray(signings) ? signings.filter(Boolean) : [];
  const inferredDate = freeAgencySigningDateFromDay({ leagueData: afterLeague, dayResolved, signedDate });
  const window = getFreeAgentSigningWindow({ leagueData: afterLeague, signedDate: inferredDate });
  const actor = String(source || "").toLowerCase().includes("cpu") ? "cpu" : "user";
  const date = window.date;
  if (!date) return afterLeague;

  const before = playerIdsOnTeams(beforeLeague);
  const patches = new Map();
  const transactions = [];
  const seenTransactionKeys = new Set();
  const seenSigningEntityKeys = new Set();

  const addSigning = (row = {}, fallbackTeamName = "", fallbackPlayer = null) => {
    const teamName = getSigningTeamName(row) || fallbackTeamName;
    const playerName = getSigningPlayerName(row) || playerNameOf(fallbackPlayer || {});
    if (!teamName || !playerName) return;
    const entityKey = `${date}|${normalizeTeamName(teamName)}|${normalizeTeamName(playerName)}`;
    if (seenSigningEntityKeys.has(entityKey)) return;
    seenSigningEntityKeys.add(entityKey);

    const player = findSignedPlayerOnTeam(afterLeague, { ...row, teamName, playerName }) || fallbackPlayer;
    const identity = player ? playerIdentity(player) : `name:${normalizeTeamName(playerName)}`;
    const sourceKey = String(row?.playerKey || row?.playerId || row?.id || identity || playerName);
    const transactionId = makeTradeRuleTransactionId("fa_sign", date, `${sourceKey}_${teamName}`);
    if (seenTransactionKeys.has(transactionId)) return;
    seenTransactionKeys.add(transactionId);

    const metadata = {
      lockType: "recentlySignedFreeAgent",
      type: "recentlySignedFreeAgent",
      playerName,
      teamName,
      signingContext: window.signingContext,
      freeAgentSignedDate: date,
      signedDate: date,
      freeAgentTradeEligibleDate: window.eligibleDate,
      signedTradeEligibleDate: window.eligibleDate,
      eligibleDate: window.eligibleDate,
      sourceTransactionId: transactionId,
      transactionSource: source,
      transactionActor: actor,
      reason: window.signingContext === "offseasonFreeAgency" ? "Recently signed offseason free agent" : "Recently signed in-season free agent",
    };

    patches.set(identity, metadata);
    // Also keep a name-based fallback lock. This is intentional: some older saves
    // lose player ids during FA/offseason transfer steps, but the UI still needs
    // to obey the visible transaction-history lock.
    patches.set(`name:${normalizeTeamName(playerName)}`, metadata);

    transactions.push({
      id: transactionId,
      date,
      type: "signing",
      subtype: window.signingContext,
      source,
      actor,
      playerId: row?.playerId || player?.id || null,
      playerName,
      teamName,
      title: `${teamName} signed ${playerName}`,
      eligibleDate: window.eligibleDate,
      restrictionType: "recentlySignedFreeAgent",
      restrictionLabel: `Trade eligible ${formatLeagueDate(window.eligibleDate)}`,
    });
  };

  for (const row of explicitSigningRows) {
    addSigning(row);
  }

  // Keep the old before/after safety net for manual and repair signings, but do
  // not rely on it exclusively. FA day results can sign players who already
  // existed in the league file/free-agent pool and are therefore not detected as
  // brand-new ids.
  for (const team of getAllTeams(afterLeague)) {
    for (const player of Array.isArray(team?.players) ? team.players : []) {
      if (before.has(playerIdentity(player))) continue;
      addSigning({
        playerId: player?.id || null,
        playerName: playerNameOf(player),
        teamName: teamNameOf(team),
      }, teamNameOf(team), player);
    }
  }

  return applyUserTradeRestrictionPatches(afterLeague, patches, transactions);
}

export function stampRookieSigningRestrictions({ beforeLeague = {}, afterLeague = {}, draftYear = null } = {}) {
  const before = playerIdsOnTeams(beforeLeague);
  const year = Number(draftYear || getCurrentDraftYear(afterLeague));
  const signedDate = `${year}-06-30`;
  const eligibleDate = `${year}-07-30`;
  const patches = new Map();
  const transactions = [];
  for (const team of getAllTeams(afterLeague)) {
    for (const player of Array.isArray(team?.players) ? team.players : []) {
      if (before.has(playerIdentity(player))) continue;
      const playerDraftYear = Number(player?.draftYear ?? player?.meta?.draftYear ?? player?.draft?.year ?? year);
      if (playerDraftYear !== year) continue;
      const identity = playerIdentity(player);
      const transactionId = makeTradeRuleTransactionId("rookie_sign", signedDate, `${identity}_${teamNameOf(team)}`);
      patches.set(identity, {
        lockType: "newlyDraftedRookie",
        type: "newlyDraftedRookie",
        playerName: playerNameOf(player),
        teamName: teamNameOf(team),
        rookieSignedDate: signedDate,
        rookieTradeEligibleDate: eligibleDate,
        eligibleDate,
        sourceTransactionId: transactionId,
        reason: "Newly drafted rookie signing",
      });
      transactions.push({
        id: transactionId,
        date: signedDate,
        type: "rookieSigning",
        subtype: "rookieSigning",
        playerId: player?.id || null,
        playerName: playerNameOf(player),
        teamName: teamNameOf(team),
        title: `${teamNameOf(team)} signed rookie ${playerNameOf(player)}`,
        eligibleDate,
        restrictionType: "newlyDraftedRookie",
        restrictionLabel: `Trade eligible ${formatLeagueDate(eligibleDate)}`,
      });
    }
  }
  return applyUserTradeRestrictionPatches(afterLeague, patches, transactions);
}

export function stampExtensionRestriction({ leagueData = {}, teamName = "", player = null, signedDate = null } = {}) {
  const date = normalizeIsoDate(signedDate) || getUserTradeCurrentDate(leagueData);
  if (!player || !date) return leagueData;
  const team = getTeamByName(leagueData, teamName);
  const target = (team?.players || []).find((row) => samePlayer(row, player));
  if (!target) return leagueData;
  const eligibleDate = addIsoMonths(date, 6);
  const identity = playerIdentity(target);
  const transactionId = makeTradeRuleTransactionId("extension", date, `${identity}_${teamName || teamNameOf(team)}`);
  return applyUserTradeRestrictionPatches(leagueData, new Map([[
    identity,
    {
      lockType: "recentlyExtended",
      type: "recentlyExtended",
      playerName: playerNameOf(target),
      teamName: teamName || teamNameOf(team),
      extensionSignedDate: date,
      extensionTradeEligibleDate: eligibleDate,
      eligibleDate,
      sourceTransactionId: transactionId,
      reason: "Recently signed contract extension",
    },
  ]]), [{
    id: transactionId,
    date,
    type: "extension",
    subtype: "extension",
    playerId: target?.id || null,
    playerName: playerNameOf(target),
    teamName: teamName || teamNameOf(team),
    title: `${teamName || teamNameOf(team)} extended ${playerNameOf(target)}`,
    eligibleDate,
    restrictionType: "recentlyExtended",
    restrictionLabel: `Trade eligible ${formatLeagueDate(eligibleDate)}`,
  }]);
}


export function attachUserTradeRuleContext(leagueData = {}) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;
  return {
    ...leagueData,
    __userTradeRules: {
      enabled: true,
      settings: getUserTradeRuleSettings(leagueData),
      currentDate: getUserTradeCurrentDate(leagueData),
    },
  };
}

export const __userTradeRuleTestHelpers = {
  addIsoMonths,
  compareIsoDates,
  futureStepienStartYear,
  findStepienViolation,
  findStepienViolations,
  findNewStepienViolation,
  getSecondApronFurthestFirstYear,
  isGuaranteedFirst,
  getUserTradeRestrictionLedger,
  samePickForStepien,
  resolveTeamNameForTradeRules,
  getFreeAgentSigningWindow,
};
