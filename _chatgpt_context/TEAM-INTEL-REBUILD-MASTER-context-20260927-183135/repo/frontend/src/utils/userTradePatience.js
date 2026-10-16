const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const TRADE_PATIENCE_MAX = 100;
export const TRADE_PATIENCE_MIN = 0;
export const TRADE_PATIENCE_SUBMIT_MIN = 24;
export const TRADE_PATIENCE_DAILY_RECOVERY = 3;
export const TRADE_PATIENCE_MIN_DROP = 4;
export const TRADE_PATIENCE_MAX_DROP = 35;

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function safeTeamName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tradePatienceTeamKey(value) {
  return safeTeamName(value).toLowerCase();
}

function parseDateDayKey(value) {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return Math.floor(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) / MS_PER_DAY);
  }

  const raw = String(value || "").trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
    }
  }

  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return Math.floor(parsed / MS_PER_DAY);
  return null;
}

export function getTradePatienceDayKey({ leagueData = {}, currentDate = null } = {}) {
  const parsedCurrent = parseDateDayKey(currentDate);
  if (parsedCurrent !== null) return parsedCurrent;

  const directCandidates = [
    leagueData?.calendarDate,
    leagueData?.calendar?.currentDate,
    leagueData?.calendar?.cursorDate,
    leagueData?.currentDate,
    leagueData?.date,
  ];
  for (const candidate of directCandidates) {
    const parsed = parseDateDayKey(candidate);
    if (parsed !== null) return parsed;
  }

  const seasonYear = Number(
    leagueData?.seasonYear ||
      leagueData?.currentSeasonYear ||
      leagueData?.seasonStartYear ||
      leagueData?.year ||
      2026
  );
  const seasonBase = Number.isFinite(seasonYear) ? seasonYear * 400 : 2026 * 400;
  const dayOffset = Number(
    leagueData?.calendar?.dayIndex ??
      leagueData?.calendar?.currentDay ??
      leagueData?.freeAgencyState?.currentDay ??
      leagueData?.offseasonState?.currentDay ??
      0
  );
  return seasonBase + (Number.isFinite(dayOffset) ? Math.max(0, Math.floor(dayOffset)) : 0);
}

function getStoredTradePatience(leagueData = {}) {
  const raw = leagueData?.userTradePatience;
  if (!raw || typeof raw !== "object") return { userTeamName: "", byTeamName: {} };
  const byTeamName = raw.byTeamName && typeof raw.byTeamName === "object" ? raw.byTeamName : {};
  return {
    userTeamName: safeTeamName(raw.userTeamName),
    byTeamName,
  };
}

function getRawTeamEntry(byTeamName = {}, cpuTeamName = "") {
  const key = tradePatienceTeamKey(cpuTeamName);
  if (!key) return null;
  if (byTeamName[key]) return byTeamName[key];
  const exactName = safeTeamName(cpuTeamName);
  if (byTeamName[exactName]) return byTeamName[exactName];
  return null;
}

function normalizeEntry(entry, dayKey) {
  const baseValue = entry && Number.isFinite(Number(entry.value)) ? Number(entry.value) : TRADE_PATIENCE_MAX;
  const lastUpdatedDayKey = entry && Number.isFinite(Number(entry.lastUpdatedDayKey))
    ? Number(entry.lastUpdatedDayKey)
    : dayKey;
  return {
    value: clampNumber(baseValue, TRADE_PATIENCE_MIN, TRADE_PATIENCE_MAX),
    lastUpdatedDayKey,
  };
}

export function recoverTradePatienceEntry(entry, dayKey) {
  const normalized = normalizeEntry(entry, dayKey);
  const daysPassed = Math.max(0, Math.floor(Number(dayKey || 0) - Number(normalized.lastUpdatedDayKey || 0)));
  const recoveredValue = clampNumber(
    normalized.value + daysPassed * TRADE_PATIENCE_DAILY_RECOVERY,
    TRADE_PATIENCE_MIN,
    TRADE_PATIENCE_MAX
  );
  return {
    value: Math.round(recoveredValue),
    rawValue: normalized.value,
    lastUpdatedDayKey: dayKey,
    daysPassed,
  };
}

export function getTeamTradePatience({ leagueData = {}, userTeamName = "", cpuTeamName = "", currentDate = null } = {}) {
  const userName = safeTeamName(userTeamName);
  const cpuName = safeTeamName(cpuTeamName);
  const dayKey = getTradePatienceDayKey({ leagueData, currentDate });
  if (!userName || !cpuName || tradePatienceTeamKey(userName) === tradePatienceTeamKey(cpuName)) {
    return {
      value: TRADE_PATIENCE_MAX,
      canNegotiate: true,
      isLocked: false,
      daysUntilCanNegotiate: 0,
      dayKey,
      userTeamChanged: false,
      teamName: cpuName,
    };
  }

  const stored = getStoredTradePatience(leagueData);
  const storedUserKey = tradePatienceTeamKey(stored.userTeamName);
  const currentUserKey = tradePatienceTeamKey(userName);
  const userTeamChanged = Boolean(stored.userTeamName && storedUserKey !== currentUserKey);
  const byTeamName = userTeamChanged ? {} : stored.byTeamName;
  const entry = getRawTeamEntry(byTeamName, cpuName);
  const recovered = recoverTradePatienceEntry(entry, dayKey);
  const daysUntilCanNegotiate = recovered.value >= TRADE_PATIENCE_SUBMIT_MIN
    ? 0
    : Math.ceil((TRADE_PATIENCE_SUBMIT_MIN - recovered.value) / TRADE_PATIENCE_DAILY_RECOVERY);

  return {
    ...recovered,
    canNegotiate: recovered.value >= TRADE_PATIENCE_SUBMIT_MIN,
    isLocked: recovered.value < TRADE_PATIENCE_SUBMIT_MIN,
    daysUntilCanNegotiate,
    dayKey,
    userTeamChanged,
    teamName: cpuName,
  };
}

export function ensureTradePatienceForUserTeam(leagueData = {}, userTeamName = "") {
  const userName = safeTeamName(userTeamName);
  if (!leagueData || !userName) return { leagueData, changed: false };
  const stored = getStoredTradePatience(leagueData);
  const storedUserKey = tradePatienceTeamKey(stored.userTeamName);
  const currentUserKey = tradePatienceTeamKey(userName);
  if (stored.userTeamName && storedUserKey === currentUserKey) return { leagueData, changed: false };

  return {
    leagueData: {
      ...leagueData,
      userTradePatience: {
        userTeamName: userName,
        byTeamName: {},
      },
    },
    changed: stored.userTeamName !== userName || Object.keys(stored.byTeamName || {}).length > 0,
  };
}

export function calculateRejectedTradePatienceDrop(decisionMargin = 0) {
  const margin = Number(decisionMargin || 0);
  const shortfall = Math.max(0, -margin);
  if (shortfall <= 0) return { drop: 0, shortfall };
  const drop = clampNumber(
    Math.round(TRADE_PATIENCE_MIN_DROP + Math.log1p(shortfall) * 10),
    TRADE_PATIENCE_MIN_DROP,
    TRADE_PATIENCE_MAX_DROP
  );
  return { drop: Math.round(drop), shortfall };
}

function withStoredTeamEntry({ leagueData = {}, userTeamName = "", cpuTeamName = "", currentDate = null, value = TRADE_PATIENCE_MAX } = {}) {
  const userName = safeTeamName(userTeamName);
  const cpuName = safeTeamName(cpuTeamName);
  if (!leagueData || !userName || !cpuName) return leagueData;
  const dayKey = getTradePatienceDayKey({ leagueData, currentDate });
  const normalizedValue = Math.round(clampNumber(value, TRADE_PATIENCE_MIN, TRADE_PATIENCE_MAX));
  const stored = getStoredTradePatience(leagueData);
  const byTeamName = stored.userTeamName && tradePatienceTeamKey(stored.userTeamName) !== tradePatienceTeamKey(userName)
    ? {}
    : { ...(stored.byTeamName || {}) };
  byTeamName[tradePatienceTeamKey(cpuName)] = {
    teamName: cpuName,
    value: normalizedValue,
    lastUpdatedDayKey: dayKey,
  };
  return {
    ...leagueData,
    userTradePatience: {
      userTeamName: userName,
      byTeamName,
    },
  };
}

export function applyRejectedTradePatienceDrop({ leagueData = {}, userTeamName = "", cpuTeamName = "", currentDate = null, decisionMargin = 0 } = {}) {
  const before = getTeamTradePatience({ leagueData, userTeamName, cpuTeamName, currentDate });
  const { drop, shortfall } = calculateRejectedTradePatienceDrop(decisionMargin);
  const nextValue = Math.round(clampNumber(before.value - drop, TRADE_PATIENCE_MIN, TRADE_PATIENCE_MAX));
  const nextLeagueData = withStoredTeamEntry({
    leagueData,
    userTeamName,
    cpuTeamName,
    currentDate,
    value: nextValue,
  });
  const after = getTeamTradePatience({ leagueData: nextLeagueData, userTeamName, cpuTeamName, currentDate });
  return {
    leagueData: nextLeagueData,
    before: before.value,
    after: after.value,
    drop,
    shortfall,
    daysUntilCanNegotiate: after.daysUntilCanNegotiate,
  };
}

export function resetTeamTradePatience({ leagueData = {}, userTeamName = "", cpuTeamName = "", currentDate = null } = {}) {
  const nextLeagueData = withStoredTeamEntry({
    leagueData,
    userTeamName,
    cpuTeamName,
    currentDate,
    value: TRADE_PATIENCE_MAX,
  });
  return {
    leagueData: nextLeagueData,
    value: TRADE_PATIENCE_MAX,
  };
}

export function getTradePatienceBlockedTeams({ leagueData = {}, userTeamName = "", teamNames = [], currentDate = null } = {}) {
  const blocked = [];
  const eligible = [];
  for (const teamName of teamNames || []) {
    const cleanName = safeTeamName(teamName);
    if (!cleanName || tradePatienceTeamKey(cleanName) === tradePatienceTeamKey(userTeamName)) continue;
    const status = getTeamTradePatience({ leagueData, userTeamName, cpuTeamName: cleanName, currentDate });
    if (status.canNegotiate) eligible.push(cleanName);
    else blocked.push({ teamName: cleanName, value: status.value, daysUntilCanNegotiate: status.daysUntilCanNegotiate });
  }
  return { blocked, eligible };
}

export function formatTradePatienceWait(days = 0) {
  const count = Math.max(0, Math.ceil(Number(days || 0)));
  if (count <= 0) return "now";
  return `${count} day${count === 1 ? "" : "s"}`;
}
