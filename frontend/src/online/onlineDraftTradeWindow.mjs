// Pure online-only UI advisory. PostgreSQL revalidates the full transaction
// against the locked shared state. Never authorize trades from browser state.
// Bounded support: 2026-27, 2027-28, and 2028-29 only.
const exactHistory = (history, year) => Array.isArray(history) &&
  history.filter(row => Number(row?.seasonYear) === year).length === 1;
const exactYear = x => typeof x === 'number' || typeof x === 'string' ? Number(x) : NaN;

export function onlineDraftTradeWindow(league = null) {
  const raw = league?.seasonYear ?? league?.seasonStartYear ?? league?.onlineSchedule?.seasonYear ?? 2026;
  const active = exactYear(raw);
  if (!Number.isInteger(active) || active < 2026 || active > 2028) return null;
  if (active === 2027 &&
    (exactYear(league?.onlineSchedule?.seasonYear) !== 2027 ||
     exactYear(league?.onlineSeasonRollover?.toYear) !== 2027 ||
     String(league?.onlineSchedule?.phase || '') !== 'regular-season')) return null;
  if (active === 2028) {
    const cursor = String(league?.onlineSchedule?.cursor || '');
    const rolled = league?.onlineSeasonRollover;
    const meta = league?.draftPickMeta;
    const picks = league?.draftPicks;
    const valid = exactYear(league?.seasonStartYear) === 2028 &&
      exactYear(league?.onlineSchedule?.seasonYear) === 2028 &&
      String(league?.onlineSchedule?.phase || '') === 'regular-season' &&
      String(rolled?.status || '') === 'complete' &&
      exactYear(rolled?.fromYear) === 2027 && exactYear(rolled?.toYear) === 2028 &&
      exactHistory(league?.onlineSeasonHistory, 2026) &&
      exactHistory(league?.onlineSeasonHistory, 2027) &&
      exactYear(meta?.lastRolledCompletedSeasonYear) === 2028 &&
      exactYear(meta?.lastAutoAddedFutureYear) === 2035 &&
      meta?.rollingWindowVersion === 'online_future_draft_rights_f3b2' &&
      Array.isArray(picks) && picks.filter(p => exactYear(p?.year) === 2035).length >= 60 &&
      /^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(cursor) &&
      cursor >= '2028-09-01' && cursor < '2029-02-05';
    if (!valid) return null;
  }
  return {activeSeason:active,firstPickYear:active+1,
    lastPickYear:active+7,lastSwapYear:active+6};
}
