export const LEAGUE_CLOCK_STORAGE_KEY = "bm_league_clock_v1";
export const POSTSEASON_CALENDAR_VERSION = 1;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SERIES_GAME_DAY_OFFSETS = [0, 2, 5, 7, 9, 12, 14];

export function normalizeIsoDate(value) {
  const text = String(value || "").trim();
  const match = text.match(ISO_DATE_RE);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addIsoDays(value, days) {
  const iso = normalizeIsoDate(value);
  if (!iso) return null;

  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

export function maxIsoDate(...values) {
  const valid = values.flat().map(normalizeIsoDate).filter(Boolean).sort();
  return valid.length ? valid[valid.length - 1] : null;
}

export function formatLeagueDate(value) {
  const iso = normalizeIsoDate(value);
  if (!iso) return "DATE UNAVAILABLE";

  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(Date.UTC(year, month - 1, day)))
    .toUpperCase();
}

export function readLeagueClock() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEAGUE_CLOCK_STORAGE_KEY) || "null");
    const date = normalizeIsoDate(parsed?.date);
    return date ? { ...parsed, date } : null;
  } catch {
    return null;
  }
}

export function writeLeagueClock({ date, phase, seasonYear, source = "game" } = {}) {
  const normalizedDate = normalizeIsoDate(date);
  if (!normalizedDate) return null;

  const payload = {
    date: normalizedDate,
    phase: String(phase || "unknown"),
    seasonYear: Number.isFinite(Number(seasonYear)) ? Number(seasonYear) : null,
    source,
    updatedAt: Date.now(),
  };

  try {
    localStorage.setItem(LEAGUE_CLOCK_STORAGE_KEY, JSON.stringify(payload));
  } catch {}

  return payload;
}

export function inferRegularSeasonEndDate(scheduleByDate, seasonStartYear) {
  const scheduleDates = Object.keys(scheduleByDate || {})
    .map(normalizeIsoDate)
    .filter(Boolean)
    .sort();

  if (scheduleDates.length) return scheduleDates[scheduleDates.length - 1];

  const startYear = Number(seasonStartYear);
  const fallbackYear = Number.isFinite(startYear) && startYear >= 2020 ? startYear + 1 : 2026;
  return `${fallbackYear}-04-13`;
}

export function buildSeriesGameDates(startDate) {
  const start = normalizeIsoDate(startDate);
  if (!start) return [];
  return SERIES_GAME_DAY_OFFSETS.map((offset) => addIsoDays(start, offset));
}

export function buildPostseasonCalendar({ scheduleByDate, seasonStartYear } = {}) {
  const regularSeasonEndDate = inferRegularSeasonEndDate(scheduleByDate, seasonStartYear);
  const playInOpeningDate1 = addIsoDays(regularSeasonEndDate, 2);
  const playInOpeningDate2 = addIsoDays(regularSeasonEndDate, 3);
  const playInFinalDate1 = addIsoDays(regularSeasonEndDate, 5);
  const playInFinalDate2 = addIsoDays(regularSeasonEndDate, 6);
  const round1StartDate = addIsoDays(regularSeasonEndDate, 9);
  const round2StartDate = addIsoDays(round1StartDate, 17);
  const conferenceFinalsStartDate = addIsoDays(round2StartDate, 17);
  const finalsStartDate = addIsoDays(conferenceFinalsStartDate, 18);

  return {
    version: POSTSEASON_CALENDAR_VERSION,
    seasonYear: Number(seasonStartYear) || null,
    regularSeasonEndDate,
    currentDate: playInOpeningDate1,
    playIn: {
      openingDate1: playInOpeningDate1,
      openingDate2: playInOpeningDate2,
      finalDate1: playInFinalDate1,
      finalDate2: playInFinalDate2,
    },
    rounds: {
      r1: buildSeriesGameDates(round1StartDate),
      r2: buildSeriesGameDates(round2StartDate),
      r3: buildSeriesGameDates(conferenceFinalsStartDate),
      finals: buildSeriesGameDates(finalsStartDate),
    },
  };
}

function listSeries(post) {
  const out = [];
  for (const conf of Object.values(post?.conf || {})) {
    const rounds = conf?.rounds || {};
    out.push(...Object.values(rounds?.r1 || {}));
    out.push(...Object.values(rounds?.r2 || {}));
    out.push(...Object.values(rounds?.r3 || {}));
  }
  if (post?.finals) out.push(post.finals);
  return out.filter(Boolean);
}

function assignSeriesDates(post, calendar) {
  const conferenceEntries = Object.entries(post?.conf || {});
  const leftConference = post?.layout?.left || conferenceEntries[0]?.[0] || null;

  for (const [conferenceKey, conf] of conferenceEntries) {
    const rounds = conf?.rounds || {};
    for (const series of Object.values(rounds?.r1 || {})) {
      series.gameDates = [...calendar.rounds.r1];
    }
    for (const series of Object.values(rounds?.r2 || {})) {
      series.gameDates = [...calendar.rounds.r2];
    }
    for (const series of Object.values(rounds?.r3 || {})) {
      series.gameDates = [...calendar.rounds.r3];
    }

    const playIn = conf?.playIn;
    const isLeftConference = conferenceKey === leftConference;
    if (playIn?.g78) {
      playIn.g78.date = isLeftConference
        ? calendar.playIn.openingDate1
        : calendar.playIn.openingDate2;
    }
    if (playIn?.g910) {
      playIn.g910.date = isLeftConference
        ? calendar.playIn.openingDate2
        : calendar.playIn.openingDate1;
    }
    if (playIn?.gFinal) {
      playIn.gFinal.date = isLeftConference
        ? calendar.playIn.finalDate1
        : calendar.playIn.finalDate2;
    }
  }

  if (post?.finals) post.finals.gameDates = [...calendar.rounds.finals];
}

function latestCompletedPostseasonDate(post) {
  const completedDates = [];

  for (const conf of Object.values(post?.conf || {})) {
    const playIn = conf?.playIn;
    for (const node of [playIn?.g78, playIn?.g910, playIn?.gFinal]) {
      if (node?.played && node?.date) completedDates.push(node.date);
    }
  }

  for (const series of listSeries(post)) {
    const completedCount = Math.max(0, Number(series?.nextGameIndex || 0));
    if (!completedCount || !Array.isArray(series?.gameDates)) continue;
    const lastCompletedIndex = Math.min(completedCount - 1, series.gameDates.length - 1);
    if (series.gameDates[lastCompletedIndex]) completedDates.push(series.gameDates[lastCompletedIndex]);
  }

  return maxIsoDate(completedDates);
}

export function ensurePostseasonCalendar(post, { scheduleByDate, seasonStartYear } = {}) {
  if (!post || typeof post !== "object") return post;

  const resolvedSeasonYear = Number(seasonStartYear ?? post.seasonYear) || null;
  const existing = post.calendar;
  const canReuseExisting =
    existing?.version === POSTSEASON_CALENDAR_VERSION &&
    normalizeIsoDate(existing?.regularSeasonEndDate) &&
    Array.isArray(existing?.rounds?.r1) &&
    existing.rounds.r1.length === 7;

  const calendar = canReuseExisting
    ? {
        ...existing,
        rounds: {
          r1: [...existing.rounds.r1],
          r2: [...existing.rounds.r2],
          r3: [...existing.rounds.r3],
          finals: [...existing.rounds.finals],
        },
      }
    : buildPostseasonCalendar({ scheduleByDate, seasonStartYear: resolvedSeasonYear });

  calendar.seasonYear = resolvedSeasonYear;
  assignSeriesDates(post, calendar);

  const latestCompletedDate = latestCompletedPostseasonDate(post);
  calendar.currentDate =
    maxIsoDate(calendar.currentDate, latestCompletedDate) || calendar.playIn.openingDate1;

  post.calendar = calendar;
  return post;
}

export function setPostseasonCurrentDate(post, value) {
  if (!post || typeof post !== "object") return null;
  const date = normalizeIsoDate(value);
  if (!date) return normalizeIsoDate(post?.calendar?.currentDate);

  if (!post.calendar) post.calendar = {};
  post.calendar.currentDate = maxIsoDate(post.calendar.currentDate, date) || date;
  return post.calendar.currentDate;
}

export function getPostseasonPhase(post) {
  if (post?.finals?.complete) return "postseasonComplete";

  const playIns = Object.values(post?.conf || {}).map((conf) => conf?.playIn).filter(Boolean);
  const playInComplete =
    playIns.length > 0 &&
    playIns.every((playIn) => playIn?.g78?.played && playIn?.g910?.played && playIn?.gFinal?.played);

  return playInComplete ? "playoffs" : "playIn";
}

export function syncPostseasonLeagueClock(post) {
  const date = normalizeIsoDate(post?.calendar?.currentDate);
  if (!date) return null;

  return writeLeagueClock({
    date,
    phase: getPostseasonPhase(post),
    seasonYear: post?.seasonYear,
    source: "postseason",
  });
}


export function getOffseasonFreeAgencyDay(leagueData = {}) {
  const state = leagueData?.freeAgencyState || {};
  const currentDay = Number(state?.currentDay || 0);
  const maxDays = Number(state?.maxDays || 10) || 10;

  if (currentDay > 0) return Math.max(1, Math.min(maxDays, Math.round(currentDay)));
  return 1;
}

export function getOffseasonCurrentDate({ seasonYear, offseasonState = {}, leagueData = {} } = {}) {
  const year = Number(seasonYear || offseasonState?.seasonYear || leagueData?.seasonYear || leagueData?.currentSeasonYear || 2027);
  const safeYear = Number.isFinite(year) && year >= 2020 && year <= 2100 ? year : 2027;

  if (!offseasonState?.retirementsComplete) return `${safeYear}-06-23`;
  if (!offseasonState?.draftLotteryComplete) return `${safeYear}-06-24`;
  if (!offseasonState?.draftComplete) return `${safeYear}-06-26`;
  if (!offseasonState?.rookieSigningsComplete) return `${safeYear}-06-30`;
  if (!offseasonState?.optionsComplete) return `${safeYear}-06-30`;

  const freeAgencyComplete = Boolean(
    offseasonState?.freeAgencyComplete ||
      leagueData?.freeAgencyState?.marketComplete ||
      leagueData?.freeAgencyState?.freeAgencyComplete ||
      leagueData?.freeAgencyState?.completed
  );

  if (!freeAgencyComplete) {
    const day = getOffseasonFreeAgencyDay(leagueData);
    return addIsoDays(`${safeYear}-07-01`, Math.max(0, day - 1)) || `${safeYear}-07-01`;
  }

  if (!offseasonState?.progressionComplete) return `${safeYear}-09-20`;
  return `${safeYear}-09-23`;
}
